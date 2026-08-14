import assert from "node:assert/strict";

import {
  FOUNDRY_OVERLAY_SIZE,
  clampFoundryOverlayPoint,
} from "../utils/foundryCamera";

const padding = 12;
const bounded = [
  clampFoundryOverlayPoint({ x: -40, y: 30 }),
  clampFoundryOverlayPoint({ x: 410, y: -20 }),
  clampFoundryOverlayPoint({ x: 180, y: 280 }),
  clampFoundryOverlayPoint({ x: 180, y: 120 }),
];

assert(bounded.every(Boolean), "finite projected handles remain available");
assert(
  bounded.every(
    (point) =>
      point!.x >= padding &&
      point!.x <= FOUNDRY_OVERLAY_SIZE.width - padding &&
      point!.y >= padding &&
      point!.y <= FOUNDRY_OVERLAY_SIZE.height - padding,
  ),
  "projected connection handles stay inside the clipped pointer surface",
);
assert.deepEqual(
  bounded.at(-1),
  { x: 180, y: 120 },
  "an already visible connection handle is not moved",
);
assert.equal(
  clampFoundryOverlayPoint({ x: Number.NaN, y: 1 }),
  undefined,
  "non-finite projections stay unavailable",
);
assert.deepEqual(
  clampFoundryOverlayPoint({ x: -1, y: 80 }, { width: 16, height: 12 }, 50),
  { x: 6, y: 6 },
  "padding is bounded by half of the smaller overlay edge",
);

console.log("G3 Foundry overlay bounds contracts passed");
