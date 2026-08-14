import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "components/stages/path/SceneSketch.tsx"),
  "utf8",
);

for (const event of [
  "onMouseUp={finishInteraction}",
  "onMouseLeave={finishInteraction}",
  "onPointerUp={finishInteraction}",
  "onPointerCancel={finishInteraction}",
  "onLostPointerCapture={finishInteraction}",
]) {
  assert(source.includes(event), `SceneSketch finalizes path gestures on ${event}`);
}

console.log("G3 path pointer finalization contracts passed");
