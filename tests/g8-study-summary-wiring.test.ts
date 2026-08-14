import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { MechanismType } from "../types";
import {
  STUDY_SUMMARY_ENABLED,
  browserStudySummarySession,
  studyExportBlocker,
  studyMechanismFamily,
} from "../infrastructure/study-summary/browserSession";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

assert.equal(
  STUDY_SUMMARY_ENABLED,
  false,
  "ordinary Bun/default execution keeps the opt-in summary boundary off",
);
assert.equal(
  browserStudySummarySession(),
  undefined,
  "the disabled boundary creates no browser session",
);

const mechanismFamilies: Record<MechanismType, string> = {
  crank: "linkage",
  "4bar": "four-bar",
  piston: "slider",
  yoke: "slider",
  "quick-return": "slider",
  "5bar": "linkage",
  "6bar": "linkage",
  cam: "cam",
  "rack-pinion": "rack",
  gear: "gear",
  gear_linkage: "gear",
  planetary_gear: "gear",
};
for (const [mechanism, family] of Object.entries(mechanismFamilies)) {
  assert.equal(studyMechanismFamily(mechanism as MechanismType), family);
}

assert.equal(studyExportBlocker(undefined), "unknown");
assert.equal(studyExportBlocker("No path selected"), "no-path");
assert.equal(studyExportBlocker("Outside board"), "board-fit");
assert.equal(studyExportBlocker("Missing physical part"), "missing-part");
assert.equal(studyExportBlocker("Collision detected"), "collision");
assert.equal(studyExportBlocker("Unsupported template"), "unsupported");
assert.equal(studyExportBlocker("Invalid mechanism constraint"), "invalid-mechanism");
assert.equal(studyExportBlocker("private free text"), "unknown");

const vite = read("vite.config.ts");
const runtime = read("infrastructure/study-summary/browserSession.ts");
const lifecycle = read("components/shell/StudySummaryLifecycle.tsx");
const shell = read("components/AppWorkspaceShell.tsx");
const autosave = read("hooks/useProjectAutosave.ts");
const controller = read("hooks/useMotionSmithAppController.ts");

assert(
  vite.includes("const studySummaryMode = process.env.MOTIONSMITH_SUMMARY") &&
    vite.includes("studySummaryMode === '1'") &&
    vite.includes("MOTIONSMITH_SUMMARY_TARGET") &&
    vite.includes("MOTIONSMITH_BUILD_SHA") &&
    vite.includes("__MOTIONSMITH_STUDY_SUMMARY_ENABLED__"),
  "Vite owns one explicit opt-in compile boundary",
);
assert(
  !/VITE_(?:STUDY|TELEMETRY)|loadEnv/.test(vite),
  "ordinary Vite client environment variables cannot enable summary collection",
);
assert(
  vite.includes("^[0-9a-f]{7,40}$") &&
    vite.includes("without credentials"),
  "enabled builds reject unbounded build labels and credential-bearing targets",
);
assert(
  shell.includes(
    "STUDY_SUMMARY_ENABLED ? <StudySummaryLifecycle stage={stage} /> : null",
  ),
  "the lifecycle mount is behind the compile-time boundary",
);
assert(
  controller.includes(
    "STUDY_SUMMARY_ENABLED ? recordStudyAutosave : undefined",
  ),
  "default persistence receives no summary observer",
);
assert(
  !/telemetry|study/i.test(autosave),
  "the local persistence lifecycle remains summary-independent",
);
assert(
  !/pointermove|pointerdown|requestAnimationFrame|setInterval|indexedDB|localStorage/i.test(
    `${runtime}\n${lifecycle}`,
  ),
  "summary wiring does no pointer, animation, timer, or durable-storage work",
);
assert(
  runtime.includes('credentials: "omit"') &&
    runtime.includes('referrerPolicy: "no-referrer"') &&
    runtime.includes("navigator.sendBeacon"),
  "delivery is one privacy-bounded browser request plus the adapter-bounded beacon",
);
assert(
  lifecycle.includes("errorNameOf(event.error)") &&
    lifecycle.includes("errorNameOf(event.reason)") &&
    !lifecycle.includes("event.message") &&
    !lifecycle.includes("event.filename"),
  "uncaught-error wiring records only allowlisted names",
);
assert(
  lifecycle.includes("memo(function StudySummaryLifecycle") &&
    lifecycle.includes("stage: AppStage"),
  "the lifecycle skips shell rerenders while the primitive stage is unchanged",
);

console.log("G8 study-summary wiring contracts passed");
