import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const vite = read("vite.config.ts");
const packageJson = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};
const foundry = read("components/stages/foundry/ThreeFoundryPreview.tsx");
const puppet = read("components/ThreePuppetPreview.tsx");

assert(vite.includes("profileFlag('MOTIONSMITH_SUMMARY')"));
assert(vite.includes("profileFlag('MOTIONSMITH_E2E_DIAGNOSTICS')"));
assert(vite.includes("__MOTIONSMITH_E2E_DIAGNOSTICS__"));
assert(vite.includes("__MOTIONSMITH_STUDY_SUMMARY_ENABLED__"));
assert(vite.includes("studySummaryEnabled && e2eDiagnosticsEnabled"));
assert.equal(packageJson.scripts["build:e2e"], "MOTIONSMITH_E2E_DIAGNOSTICS=1 bun run build");
assert.equal(
  packageJson.scripts["test:browser"],
  "bun run build:e2e && env -u NO_COLOR PLAYWRIGHT_SERVER=preview playwright test",
);

assert(foundry.includes("const E2E_DIAGNOSTICS = __MOTIONSMITH_E2E_DIAGNOSTICS__"));
assert(foundry.includes("if (!E2E_DIAGNOSTICS || !stateRef.current) return"));
assert(foundry.includes("E2E_DIAGNOSTICS && <FoundryPreviewStateProbe"));
assert(puppet.includes("const E2E_DIAGNOSTICS = __MOTIONSMITH_E2E_DIAGNOSTICS__"));
assert(puppet.includes("if (E2E_DIAGNOSTICS && stateRef.current)"));
assert(puppet.includes("{E2E_DIAGNOSTICS && <div"));

console.log("b695 diagnostics profile ok");
