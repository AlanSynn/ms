import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  foundryCommandStateFor,
  resolveLocalFoundryCandidate,
} from "../components/stages/foundry/MechanismFoundry";
import { SCENE_PX_PER_MM, defaultPhysicalKit } from "../utils/coordinates";
import { createDefaultMechanism } from "../utils/mechanismDefaults";

const kit = defaultPhysicalKit();
const initial = createDefaultMechanism("4bar", "g3-command-sequence");
const fallbackAnchor = { x: -120, y: -40 };
const movedAnchorX =
  (initial.anchorX ?? 0) + kit.gridPitchMm * 2 * SCENE_PX_PER_MM;
const movedAnchor = {
  x: movedAnchorX,
  y: initial.anchorY ?? 0,
};
const anchored = resolveLocalFoundryCandidate(
  initial,
  {
    ...initial,
    anchorX: movedAnchor.x,
    anchorY: movedAnchor.y,
    sceneAnchor: movedAnchor,
    transform: {
      ...(initial.transform ?? {
        x: initial.anchorX ?? 0,
        y: initial.anchorY ?? 0,
        rotation: initial.groundAngle ?? 0,
        scale: 1,
      }),
      x: movedAnchor.x,
      y: movedAnchor.y,
    },
  },
  kit,
);
assert.equal(anchored.accepted, true, "the first anchor command is accepted");

const commandState = foundryCommandStateFor(
  anchored.mechanism,
  "g3-command-sequence",
  fallbackAnchor,
);
assert.equal(
  commandState.anchorX,
  movedAnchor.x,
  "command state retains an accepted anchor instead of the previous render fallback",
);
assert.equal(commandState.anchorY, movedAnchor.y);

const parameterEdit = resolveLocalFoundryCandidate(
  commandState,
  { ...commandState, phase: (commandState.phase ?? 0) + 12 },
  kit,
);
assert.equal(
  parameterEdit.accepted,
  true,
  "the second parameter command is accepted against the anchored candidate",
);
assert.equal(
  foundryCommandStateFor(
    parameterEdit.mechanism,
    "g3-command-sequence",
    fallbackAnchor,
  ).anchorX,
  movedAnchor.x,
  "anchor survives the back-to-back parameter command",
);

const source = readFileSync(
  new URL("../components/stages/foundry/MechanismFoundry.tsx", import.meta.url),
  "utf8",
);
assert.match(
  source,
  /foundryCommandStateFor\(\s*foundryCommandRef\.current/,
  "runtime command reads use the retained command state",
);
assert.match(
  source,
  /const applyPathFit = \(mechanism = foundryCommandRef\.current\)/,
  "path fitting does not default to stale rendered props",
);
assert.match(
  source,
  /const current = foundryCommandRef\.current;\n    setFoundryPlaying\(false\);/,
  "preview reset does not default to stale rendered props",
);

console.log("G3 Foundry command sequencing contracts passed");
