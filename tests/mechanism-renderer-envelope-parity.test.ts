import assert from "node:assert/strict";
import * as THREE from "three";
import type { MechanismConfig, MechanismType, PhysicalKitSettings } from "../types";
import { SCENE_PX_PER_MM } from "../utils/coordinates";
import { createDefaultMechanism } from "../utils/mechanismDefaults";
import { createMechanismFitContext, fitMechanismSimulationWithContext } from "../utils/mechanismPreview";
import { buildMechanismPhysicalEnvelopeDescriptors, type MechanismPhysicalEnvelopeDescriptor } from "../utils/mechanismPhysicalEnvelope";
import { compileMechanismRenderPlan } from "../utils/mechanismCompiler";
import {
  foundryPhysicalEnvelopeAffine,
  mapPhysicalEnvelopeToFoundryPreview,
  renderFoundryDynamicLayers,
  type FoundryPhysicalEnvelopePreview,
} from "../components/stages/foundry/foundryThreeRenderLayers";
import { createFoundryThreePrimitiveFactory, disposeFoundryThreeObject } from "../components/stages/foundry/foundryThreePrimitives";
import { foundryPinStackPoints, foundryPinStacks, foundryRenderedLayerZForMechanism } from "../utils/mechanismPreviewStacks";
import { fittedGearTrainCenters } from "../components/stages/foundry/foundryPreviewGeometry";
import { gearPairOutputRatio, gearTrainOutputRatio, gearTrainPitchRadii } from "../utils/kinematics";
import { fabricationRingGearSpecForPitchRadius } from "../utils/fabricationContract";
import { planetaryRingPitchRadius } from "../utils/fabricationSizing";

const testTypes: MechanismType[] = ["4bar", "gear_linkage", "gear", "cam", "piston", "planetary_gear"];
const testKit: PhysicalKitSettings = {
  profileKey: "letter-15x15-2cm",
  gridPitchMm: 20,
  sheetWidthMm: 215.9,
  sheetHeightMm: 279.4,
  boardCells: 15,
  holeDiameterMm: 4,
  exportMode: "both",
  defaultExportFormat: "both",
  cutSheetFileType: "pdf",
};

const fit = (mechanism: MechanismConfig) => {
  const context = createMechanismFitContext(mechanism, 360, 240, 120);
  return fitMechanismSimulationWithContext(mechanism, 0.61, context);
};

const alterMechanism = (mechanism: MechanismConfig): MechanismConfig => {
  if (mechanism.type === "4bar") {
    return {
      ...mechanism,
      crankLength: Math.abs(mechanism.crankLength) + 14,
      couplerLength: Math.abs(mechanism.couplerLength) + 8,
      rockerLength: Math.abs(mechanism.rockerLength) + 12,
      anchorX: mechanism.anchorX,
    };
  }
  if (mechanism.type === "gear_linkage") {
    return {
      ...mechanism,
      crankLength: Math.abs(mechanism.crankLength) + 12,
      couplerLength: Math.abs(mechanism.couplerLength) + 10,
      rockerLength: Math.abs(mechanism.rockerLength) + 10,
    };
  }
  if (mechanism.type === "gear") {
    const crankLength = Math.abs(mechanism.crankLength) + 10;
    const rockerLength = Math.max(1, mechanism.groundLength - crankLength);
    return {
      ...mechanism,
      crankLength,
      rockerLength,
      groundLength: mechanism.groundLength,
      gearTrainRadii: [crankLength, rockerLength],
      gearRatio: rockerLength / crankLength,
      speed2: rockerLength / crankLength,
    };
  }
  if (mechanism.type === "cam") {
    const alteredSamples = mechanism.camProfileSamples ?? [1, 1.1, 1.2, 1.3, 1.4];
    return {
      ...mechanism,
      crankLength: Math.abs(mechanism.crankLength) + 10,
      camProfileSamples: alteredSamples.map((value, index) => value * (index % 2 ? 1.03 : 0.98)),
    };
  }
  if (mechanism.type === "piston") {
    return {
      ...mechanism,
      rockerLength: Math.abs(mechanism.rockerLength) + 10,
      couplerPointDist: Math.abs(mechanism.couplerPointDist) + 4,
      rodLength: Math.abs(mechanism.rodLength ?? mechanism.couplerPointDist) + 6,
    };
  }
  const crankLength = Math.abs(mechanism.crankLength) + 8;
  const rockerLength = Math.abs(mechanism.rockerLength) + 8;
  return {
    ...mechanism,
    crankLength,
    rockerLength,
    ...(mechanism.type === "planetary_gear"
      ? {
          groundLength: crankLength + rockerLength,
        }
      : {}),
  };
};

const worldFromMapped = (value: number) => (value - 180) / 18;
const worldYFromMapped = (value: number) => (120 - value) / 18;

const collectPointsFromMesh = (mesh: THREE.Mesh) => {
  const geometry = mesh.geometry;
  const position = geometry?.attributes.position;
  if (!position) return [];
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < position.count; index++) {
    points.push(new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld));
  }
  return points;
};

const collectLayerPoints = (root: THREE.Group, layerId: string) => {
  const points: THREE.Vector3[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.fabricationLayerId !== layerId) return;
    points.push(...collectPointsFromMesh(mesh));
  });
  return points;
};

const rotatedExtents = (points: THREE.Vector3[], center: THREE.Vector3, rotation: number) => {
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const x = dx * cos - dy * sin;
    const y = dx * sin + dy * cos;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
};

const assertEnvelopeShapeMatch = (
  descriptor: MechanismPhysicalEnvelopeDescriptor,
  points: THREE.Vector3[],
  mapped: FoundryPhysicalEnvelopePreview,
) => {
  const pose = new THREE.Vector3(
    worldFromMapped(mapped.x),
    worldYFromMapped(mapped.y),
    0,
  );
  const expectedRot = -mapped.rotation;
  if (mapped.kind === "circle") {
    const expectedRadius = Math.abs(mapped.radius / 18);
    assert(points.length > 0, `${descriptor.layerId} has visible mesh points`);
    const center = pose;
    let maxR = 0;
    for (const point of points) {
      const r = new THREE.Vector2(point.x - center.x, point.y - center.y).length();
      maxR = Math.max(maxR, r);
    }
    assert(maxR > 0, `${descriptor.layerId} circle has non-zero radius`);
    assert(
      Math.abs(maxR - expectedRadius) <= Math.max(0.003, expectedRadius * 0.01),
      `${descriptor.layerId} circle radius matches mapped envelope`,
    );
    return;
  }
  const expectedWidth = mapped.kind === "capsule"
    ? (mapped.length + mapped.radius * 2) / 18
    : mapped.width / 18;
  const expectedHeight = mapped.kind === "capsule"
    ? (mapped.radius * 2) / 18
    : mapped.height / 18;
  const bounds = rotatedExtents(points, pose, expectedRot);
  assert(Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX), `${descriptor.layerId} rotated bounds are finite`);
  const actualWidth = bounds.maxX - bounds.minX;
  const actualHeight = bounds.maxY - bounds.minY;
  assert(actualWidth > 0 && actualHeight > 0, `${descriptor.layerId} rotated bounds are positive`);
  assert(
    Math.abs(actualWidth - expectedWidth) <= Math.max(0.025, expectedWidth * 0.04),
    `${descriptor.layerId} width matches mapped envelope`,
  );
  assert(
    Math.abs(actualHeight - expectedHeight) <= Math.max(0.025, expectedHeight * 0.04),
    `${descriptor.layerId} height matches mapped envelope`,
  );
  assert(
    bounds.minX >= -expectedWidth / 2 - 0.03 &&
    bounds.maxX <= expectedWidth / 2 + 0.03 &&
    bounds.minY >= -expectedHeight / 2 - 0.03 &&
    bounds.maxY <= expectedHeight / 2 + 0.03,
    `${descriptor.layerId} decorative geometry stays within mapped envelope`,
  );
};

for (const type of testTypes) {
  const defaultMechanism = createDefaultMechanism(type, `${type}-parity`);
  const alternateMechanism = alterMechanism(defaultMechanism);
  const descriptorSamples: [MechanismConfig, boolean][] = [
    [defaultMechanism, false],
    [alternateMechanism, true],
  ];
  let defaultPlanetRingRadiusPx: number | undefined;
  for (const [mechanism, altered] of descriptorSamples) {
    const simulation = fit(mechanism);
    const renderPlan = compileMechanismRenderPlan(mechanism, testKit);
    assert(renderPlan.layers.length > 0, `${mechanism.type} has renderable layers`);
    const descriptors = buildMechanismPhysicalEnvelopeDescriptors(mechanism, [simulation.inputAngleRad], renderPlan, testKit);
    assert(descriptors.length > 0, `${mechanism.type} descriptor set is non-empty`);
    const affine = foundryPhysicalEnvelopeAffine(mechanism, simulation);
    const mappedByLayerId = new Map(
      descriptors.map((descriptor) => [
        descriptor.layerId,
        mapPhysicalEnvelopeToFoundryPreview(descriptor, affine),
      ]),
    );
    const structureDescriptors = descriptors.filter((descriptor) => descriptor.collisionClass === "mechanism-part");

    const isGearTrain = ["gear", "gear_linkage"].includes(mechanism.type);
    const gearRadii = isGearTrain ? gearTrainPitchRadii(mechanism) : [mechanism.crankLength, mechanism.rockerLength ?? mechanism.couplerLength];
    const gearCenters = isGearTrain ? fittedGearTrainCenters(gearRadii, simulation.state.p1, simulation.state.p2) : [];
    const planetCenters = isGearTrain ? [] : [simulation.state.p2];
    const renderedLayerZ = foundryRenderedLayerZForMechanism(renderPlan.layers, renderPlan.layers.map((layer) => layer.z));
    const pinStackPoints = foundryPinStackPoints(renderPlan, {
      state: simulation.state,
      gearCenters,
      planetCenters,
    });
    const pinStacks = foundryPinStacks(pinStackPoints, renderPlan);

    const root = new THREE.Group();
    const geometryCache = new Map<string, THREE.BufferGeometry>();
    const materialCache = new Map<string, THREE.Material>();
    const primitives = createFoundryThreePrimitiveFactory({
      root,
      geometryCache,
      materialCache,
      mechanism,
      kit: testKit,
      color: mechanism.color,
      rigOpacity: 1,
      baseColor: renderPlan.base.color,
      simulationScale: simulation.scale,
    });

    renderFoundryDynamicLayers({
      mechanism,
      kit: testKit,
      simulation,
      primitives,
      renderPlan,
      renderedLayerZ,
      pinStacks,
      visiblePathTraces: [],
      pathLayerZ: 0,
      showPathPreview: false,
      showTrail: false,
      pinionRotation: simulation.driveAngleDeg,
      isGearTrain,
      gearRadii,
      gearCenters,
      gearUsesMeshPhases: isGearTrain,
      gearOutputRatioForDisplay: isGearTrain
        ? gearTrainOutputRatio(mechanism)
        : gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength || mechanism.couplerLength || mechanism.groundLength),
    });
    root.updateMatrixWorld(true);

    for (const descriptor of structureDescriptors) {
      const mapped = mappedByLayerId.get(descriptor.layerId);
      assert(mapped, `${mechanism.type}${altered ? " altered" : ""} ${descriptor.layerId} has mapped envelope`);
      const layerPoints = collectLayerPoints(root, descriptor.layerId);
      assertEnvelopeShapeMatch(descriptor, layerPoints, mapped!);
    }

    if (mechanism.type === "planetary_gear") {
      const ringDescriptor = descriptors.find((candidate) => candidate.sourceNodeId === "ring-gear");
      assert(
        ringDescriptor && ringDescriptor.envelope.kind === "circle",
        `${mechanism.type} has ring descriptor`,
      );
      const expectedRingRadiusPx = fabricationRingGearSpecForPitchRadius(planetaryRingPitchRadius(mechanism) / SCENE_PX_PER_MM).outerRadiusMm * SCENE_PX_PER_MM;
      assert.equal(ringDescriptor.envelope.radius, expectedRingRadiusPx, `${mechanism.type} ring descriptor uses planetary profile radius`);
      if (!altered) {
        defaultPlanetRingRadiusPx = ringDescriptor.envelope.radius;
      } else {
        assert(defaultPlanetRingRadiusPx !== undefined, `${mechanism.type} baseline ring radius cached`);
        assert(
          Math.abs(defaultPlanetRingRadiusPx - ringDescriptor.envelope.radius) > 1,
          `${mechanism.type} altered ring descriptor differs from baseline`,
        );
      }
      const ringPoints = collectLayerPoints(root, ringDescriptor.layerId);
      const ringMapped = mappedByLayerId.get(ringDescriptor.layerId)!;
      assert.equal(ringMapped.kind, "circle", `${mechanism.type} mapped ring is circular`);
      if (ringMapped.kind !== "circle") throw new Error(`${mechanism.type} mapped ring is not circular`);
      const ringCenter = new THREE.Vector3(worldFromMapped(ringMapped.x), worldYFromMapped(ringMapped.y), 0);
      const expectedRadius = Math.abs(ringMapped.radius / 18);
      let maxR = 0;
      for (const point of ringPoints) {
        const r = new THREE.Vector2(point.x - ringCenter.x, point.y - ringCenter.y).length();
        maxR = Math.max(maxR, r);
      }
      assert(maxR > 0, `${mechanism.type} rendered ring mesh exists`);
      assert(Math.abs(maxR - expectedRadius) <= Math.max(0.001, expectedRadius * 0.01), `${mechanism.type} rendered ring radius matches mapped exactly`);
    }

    disposeFoundryThreeObject(root);
    geometryCache.forEach((geometry) => geometry.dispose());
    materialCache.forEach((material) => material.dispose());
  }
}

console.log("mechanism-renderer-envelope-parity passed");
