import assert from "node:assert/strict";

import { defaultPhysicalKit } from "../utils/coordinates";
import {
  calculatePreparedLinkage,
  prepareMechanismKinematics,
} from "../utils/kinematics";
import { compileMechanismRenderPlan } from "../utils/mechanismCompiler";
import { createDefaultMechanism } from "../utils/mechanismDefaults";
import {
  resolveMechanismPhysicalConnections,
} from "../utils/mechanismConnectionSelections";
import {
  buildMechanismPhysicalEnvelopeDescriptors,
  prepareMechanismPhysicalEnvelopeModel,
  samplePreparedMechanismPhysicalEnvelopeDescriptors,
  samplePreparedMechanismPhysicalLayerEnvelope,
} from "../utils/mechanismPhysicalEnvelope";
import { normalizeMechanismToReference } from "../utils/mechanismReference";
import { ALL_MECHANISM_TYPES } from "../utils/mechanismTemplates";

const kit = defaultPhysicalKit();
const phases = [0, Math.PI * 0.37, Math.PI * 1.31];

const assertFiniteEnvelope = (
  envelope: ReturnType<typeof samplePreparedMechanismPhysicalLayerEnvelope>,
  label: string,
) => {
  for (const [key, value] of Object.entries(envelope)) {
    if (key === "kind") continue;
    assert(Number.isFinite(value), `${label} ${key} is finite`);
  }
};

for (const type of ALL_MECHANISM_TYPES) {
  const mechanism = normalizeMechanismToReference(
    createDefaultMechanism(type, `prepared-envelope-${type}`),
  );
  const renderPlan = compileMechanismRenderPlan(mechanism, kit);
  let connectionResolutionCalls = 0;
  const kinematics = prepareMechanismKinematics(mechanism, kit, {
    resolvePhysicalConnections: (candidate, candidateKit) => {
      connectionResolutionCalls += 1;
      return resolveMechanismPhysicalConnections(candidate, candidateKit);
    },
  });
  const prepared = prepareMechanismPhysicalEnvelopeModel(
    kinematics,
    renderPlan,
  );
  const structuralResolutionCalls = connectionResolutionCalls;
  const preparedLayerIdentities = [...prepared.layers];

  for (const [phaseIndex, phase] of phases.entries()) {
    const state = calculatePreparedLinkage(kinematics, phase);
    for (const layer of prepared.layers) {
      assertFiniteEnvelope(
        samplePreparedMechanismPhysicalLayerEnvelope(layer, state),
        `${type} ${layer.layer.layerId}`,
      );
    }
    const sampled = samplePreparedMechanismPhysicalEnvelopeDescriptors(
      prepared,
      state,
      phase,
      phaseIndex,
    );
    const compatibility = buildMechanismPhysicalEnvelopeDescriptors(
      mechanism,
      [phase],
      renderPlan,
      kit,
    ).map((descriptor) => ({ ...descriptor, phaseIndex }));
    assert.deepEqual(
      sampled,
      compatibility,
      `${type} prepared envelopes preserve the public descriptor contract`,
    );
  }

  assert.equal(
    connectionResolutionCalls,
    structuralResolutionCalls,
    `${type} prepared envelope sampling performs no connection resolution`,
  );
  for (const [index, layer] of prepared.layers.entries()) {
    assert.equal(
      layer,
      preparedLayerIdentities[index],
      `${type} keeps ${layer.layer.layerId} reference-stable`,
    );
    assert.equal(
      prepared.layerById.get(layer.layer.layerId),
      layer,
      `${type} resolves ${layer.layer.layerId} to its stable prepared record`,
    );
  }
}

console.log("prepared physical envelope contracts passed");
