import assert from "node:assert/strict";

import type {
  FoundryExportPackage,
  MechanismConfig,
} from "../types";
import {
  projectMechanismConnectionHoleHandles,
  resolveMechanismConnectionDrop,
  type MechanismConnectionHoleHandle,
} from "../components/stages/mechanism/MechanismConnectionOverlay";
import {
  FOUNDRY_OVERLAY_SIZE,
  FOUNDRY_VIEW_PRESETS,
} from "../utils/foundryCamera";
import { calculateLinkage } from "../utils/kinematics";
import { connectionSelectionRolesForMechanism } from "../utils/mechanismConnectionSelections";
import { FOUNDRY_MECHANISM_TYPES } from "../utils/mechanismTemplates";
import {
  createDefaultMechanism,
  createLessonProject,
  serializeProject,
} from "../utils/project";

const expectedFamilies = [
  "4bar",
  "gear_linkage",
  "gear",
  "planetary_gear",
  "cam",
  "piston",
] as const;

assert.deepEqual(
  [...FOUNDRY_MECHANISM_TYPES].sort(),
  [...expectedFamilies].sort(),
  "the shared direct-manipulation surface exposes exactly six physical families",
);

for (const type of expectedFamilies) {
  const mechanism = createDefaultMechanism(type, `direct-${type}`);
  const handles = projectMechanismConnectionHoleHandles({
    mechanism,
    state: calculateLinkage(mechanism, Math.PI / 3),
    camera: { ...FOUNDRY_VIEW_PRESETS.iso, preset: "iso", pan: { x: 0, y: 0 } },
    projectionSize: FOUNDRY_OVERLAY_SIZE,
  });
  assert(handles.length > 0, `${type} exposes projected physical pointer handles`);
  assert.deepEqual(
    [...new Set(handles.map((handle) => handle.role))].sort(),
    [...connectionSelectionRolesForMechanism(type)].sort(),
    `${type} overlay uses every shared structural role`,
  );
  const target = handles.find((handle) => handle.recoveryEligible);
  assert(target, `${type} exposes a real alternate pointer candidate`);
  const result = resolveMechanismConnectionDrop(mechanism, target);
  assert.equal(result.status, "accepted", `${type} accepts a shared valid pointer drop`);
  if (result.status === "accepted") {
    assert(result.updates.connectionSelections, `${type} pointer drop returns structural selection updates`);
  }
}

const lesson = createLessonProject("waving-arm");
const mechanism = lesson.mechanisms[0];
assert(mechanism, "lesson supplies a prior valid mechanism");
const priorPackage: FoundryExportPackage = {
  id: "g006-package",
  createdAt: "2026-07-14T00:00:00.000Z",
  mechanismId: mechanism.id,
  mechanismType: mechanism.type,
  parameters: { ...mechanism },
  pivot: { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 },
  generatedPath: mechanism.generatedPath ?? [],
  simulationSummary: "valid",
  visual: { color: mechanism.color, scale: 1, constraintsVisible: true },
  animation: { duration: 1, steps: 60, loop: true },
  metadata: { sourceTab: "foundry" },
  warnings: [],
  source: "mechanism-foundry",
};
const prior = { ...lesson, lastFoundryExport: priorPackage };
const serializedPrior = serializeProject(prior);

const missingDrop = resolveMechanismConnectionDrop(mechanism, undefined);
assert.deepEqual(
  missingDrop,
  { status: "rejected", blocker: "Fix: Choose anchor" },
  "off-target pointer release returns the exact transient recovery blocker",
);
assert.strictEqual(prior.lastFoundryExport, priorPackage);
assert.equal(
  serializeProject(prior),
  serializedPrior,
  "rejected pointer release preserves the serialized aggregate and package",
);

const projected = projectMechanismConnectionHoleHandles({
  mechanism,
  state: calculateLinkage(mechanism, 0),
  camera: { ...FOUNDRY_VIEW_PRESETS.iso, preset: "iso", pan: { x: 0, y: 0 } },
  projectionSize: FOUNDRY_OVERLAY_SIZE,
});
const projectedHandle = projected[0];
assert(projectedHandle);
const invalidHandle: MechanismConnectionHoleHandle = {
  ...projectedHandle,
  selection: { kind: "linkage-hole", linkageKey: "linkage-2-cell", holeIndex: 99 },
};
assert.equal(
  resolveMechanismConnectionDrop(mechanism, invalidHandle).status,
  "rejected",
  "an incompatible physical hole cannot escape the shared selection policy",
);

console.log("mechanism direct-manipulation contracts passed");
