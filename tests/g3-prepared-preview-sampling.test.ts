import assert from "node:assert/strict";

import { defaultPhysicalKit } from "../utils/coordinates";
import {
  samplePreparedFoundryMechanismPreviewModel,
  prepareFoundryMechanismPreviewModel,
} from "../utils/foundryPreviewModel";
import {
  calculatePreparedLinkage,
  gearTrainMeshPhaseRadAt,
  normalizeCamProfileSamples,
  prepareMechanismKinematics,
} from "../utils/kinematics";
import { createDefaultMechanism } from "../utils/mechanismDefaults";
import { resolveMechanismPhysicalConnections } from "../utils/mechanismConnectionSelections";
import {
  normalizeGearLinkageToReference,
  normalizeMechanismToReference,
} from "../utils/mechanismReference";
import { foundryPlaybackPhaseToInputAngle } from "../utils/foundryPlayback";
import { createEmptyProject } from "../utils/project";
import { ALL_MECHANISM_TYPES } from "../utils/mechanismTemplates";

const settings = {
  ...createEmptyProject().settings,
  physicalKit: defaultPhysicalKit(),
};
const phases = [0, Math.PI / 7, Math.PI, Math.PI * 1.9];

for (const type of ALL_MECHANISM_TYPES) {
  const mechanism = normalizeMechanismToReference(
    createDefaultMechanism(type, `g3-prepared-preview-${type}`),
  );
  const structuralCalls = {
    physicalConnections: 0,
    gearLinkageNormalization: 0,
    camProfileNormalization: 0,
    gearCatalogPhase: 0,
  };
  const kinematics = prepareMechanismKinematics(mechanism, settings.physicalKit, {
    resolvePhysicalConnections: (candidate, kit) => {
      structuralCalls.physicalConnections += 1;
      return resolveMechanismPhysicalConnections(candidate, kit);
    },
    normalizeGearLinkage: (candidate) => {
      structuralCalls.gearLinkageNormalization += 1;
      return normalizeGearLinkageToReference(candidate);
    },
    normalizeCamProfile: (samples) => {
      structuralCalls.camProfileNormalization += 1;
      return normalizeCamProfileSamples(samples);
    },
    gearMeshPhaseAt: (radii, index) => {
      structuralCalls.gearCatalogPhase += 1;
      return gearTrainMeshPhaseRadAt(radii, index);
    },
  });
  const prepared = prepareFoundryMechanismPreviewModel({
    mechanism,
    settings,
    resolution: 24,
    frame: "scene",
    kinematics,
  });
  const afterPreparation = { ...structuralCalls };
  let stablePreviewPoints = prepared.previewPoints;
  let stablePointTraces = prepared.pointTraces;

  for (const phase of phases) {
    const model = samplePreparedFoundryMechanismPreviewModel(prepared, phase);
    const inputAngle = foundryPlaybackPhaseToInputAngle(mechanism, phase);
    assert.deepEqual(
      model.physicalSimulation.rawState,
      calculatePreparedLinkage(kinematics, inputAngle),
      `${type} samples the canonical prepared kinematic state`,
    );
    assert.equal(
      model.previewPoints,
      stablePreviewPoints,
      `${type} keeps fitted preview points structural`,
    );
    assert.equal(
      model.pointTraces,
      stablePointTraces,
      `${type} keeps point traces structural`,
    );
    assert(Number.isFinite(model.physicsOverlay.constraintError));
    assert(Number.isFinite(model.physicsOverlay.velocityMagnitude));
    assert(Number.isFinite(model.physicsOverlay.forceMagnitude));
    stablePreviewPoints = model.previewPoints;
    stablePointTraces = model.pointTraces;
  }

  assert.deepEqual(
    structuralCalls,
    afterPreparation,
    `${type} ordinary preview frames perform zero catalog resolution or normalization calls`,
  );
}

console.log("prepared foundry preview sampling contracts passed");
