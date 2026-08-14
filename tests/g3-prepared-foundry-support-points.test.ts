import assert from "node:assert/strict";

import type { JointState } from "../types";
import {
  prepareFoundrySupportPointSelector,
  samplePreparedFoundrySupportPoint,
} from "../utils/mechanismPreviewStacks";

const state: JointState = {
  p1: { x: 1, y: 2 },
  p2: { x: 3, y: 4 },
  j1: { x: 5, y: 6 },
  j2: { x: 7, y: 8 },
  aux: { x: 9, y: 10 },
  effector: { x: 11, y: 12 },
  isValid: true,
};
const gearCenters = [
  { x: 20, y: 21 },
  { x: 22, y: 23 },
];
const planetCenters = [{ x: 24, y: 25 }];
const context = { state, gearCenters, planetCenters };
const cases = [
  ["p1", state.p1],
  ["cam-axle", state.p1],
  ["ring-gear", state.p1],
  ["p2", state.p2],
  ["drive-pin", state.j1],
  ["rack", state.j2],
  ["aux", state.aux],
  ["output-point", state.effector],
  ["gear-0", gearCenters[0]],
  ["gear-1", gearCenters[1]],
  ["gear-8", state.p2],
  ["planet-gear", planetCenters[0]],
] as const;

for (const [nodeId, expected] of cases) {
  const selector = prepareFoundrySupportPointSelector(nodeId);
  assert(selector, `${nodeId} has a prepared support selector`);
  assert.equal(
    samplePreparedFoundrySupportPoint(selector, context),
    expected,
    `${nodeId} samples the canonical support point by identity`,
  );
}

assert.equal(
  prepareFoundrySupportPointSelector("unknown-node"),
  undefined,
  "unknown support nodes stay unresolved",
);
assert.equal(
  samplePreparedFoundrySupportPoint(
    prepareFoundrySupportPointSelector("planet-gear"),
    { state },
  ),
  state.p2,
  "planet support falls back to p2 without an explicit center",
);

console.log("prepared Foundry support-point contracts passed");
