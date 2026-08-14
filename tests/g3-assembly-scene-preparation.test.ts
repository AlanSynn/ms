import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type AssemblySceneFrame,
  withAssemblySceneProgress,
} from "../utils/assemblySceneFrame";

const mechanismContract = { version: 1 } as AssemblySceneFrame["mechanismContract"];
const prepared = {
  version: 1,
  kind: "mechanism",
  phase: "test-motion",
  stepIndex: 4,
  label: "Test",
  motion: "scrub_time",
  explodeAxis: "none",
  boardMode: "active",
  progress: 0,
  instruction: "Test motion",
  activePartIds: ["link-a"],
  activeBoardCoords: ["A1"],
  floatingReferenceCoords: [],
  visibleParts: [],
  mechanismContract,
} satisfies AssemblySceneFrame;

assert.equal(
  withAssemblySceneProgress(prepared, 0),
  prepared,
  "an unchanged phase preserves the prepared frame identity",
);
const sampled = withAssemblySceneProgress(prepared, 0.75)!;
assert.notEqual(sampled, prepared, "a changed phase publishes a new frame value");
assert.equal(sampled.progress, 0.75, "the sampled frame exposes live progress");
assert.equal(
  sampled.mechanismContract,
  mechanismContract,
  "phase sampling preserves the prepared scene-contract identity",
);

const paneSource = readFileSync(
  join(process.cwd(), "components/stages/assembly/AssemblyCanvasPane.tsx"),
  "utf8",
);
assert(
  paneSource.includes("const mechanismFrameBase = useMemo") &&
    paneSource.includes("const characterFrameBase = useMemo") &&
    paneSource.match(/progress: 0/g)?.length === 2 &&
    paneSource.includes("withAssemblySceneProgress(mechanismFrameBase, progress)"),
  "AssemblyCanvasPane prepares structural frames outside the progress hot path",
);

console.log("G3 assembly scene preparation contracts passed");
