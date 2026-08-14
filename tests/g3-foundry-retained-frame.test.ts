import assert from "node:assert/strict";
import * as THREE from "three";

import { SCENE_VIEW, defaultPhysicalKit } from "../utils/coordinates";
import { PLANETARY_GEAR_PLANET_COUNT } from "../utils/fabricationSizing";
import { compileMechanismRenderPlan } from "../utils/mechanismCompiler";
import { createDefaultMechanism } from "../utils/mechanismDefaults";
import {
  pointsToSvgPath,
  createPreparedMechanismFitContext,
} from "../utils/mechanismPreview";
import {
  prepareFoundrySupportPointSelector,
  samplePreparedFoundrySupportPoint,
  foundryPinStackPoints,
  foundryPinStacks,
  foundryRenderedLayerZForMechanism,
} from "../utils/mechanismPreviewStacks";
import {
  calculatePreparedLinkage,
  prepareMechanismKinematics,
} from "../utils/kinematics";
import { normalizeMechanismToReference } from "../utils/mechanismReference";
import { samplePreparedMechanismPhysicalLayerEnvelope } from "../utils/mechanismPhysicalEnvelope";
import {
  createFrameCommitQueue,
  type FrameCommitScheduler,
} from "../utils/frameCommitQueue";
import { disposeThreeResourceCaches } from "../utils/threeResourceKit";
import {
  createFoundryAutomataTextureMaterial,
  automataFramePresentationFor,
} from "../components/stages/foundry/ThreeFoundryPreview";
import {
  createFoundryFrameBindingTable,
  foundryFramePointPresentationKey,
  updateFoundryFrameBindings,
} from "../components/stages/foundry/foundryFrameBindings";
import {
  createFoundryThreePrimitiveFactory,
  disposeFoundryThreeObject,
} from "../components/stages/foundry/foundryThreePrimitives";
import { renderFoundryDynamicLayers } from "../components/stages/foundry/foundryThreeRenderLayers";
import {
  captureFoundryAssemblyFrameBinding,
  createFoundryAssemblyFrameBindings,
  updateFoundryAssemblyFrameBindings,
} from "../components/stages/foundry/foundryAssemblyFrameBindings";
import { tagFoundryFrameOwner } from "../components/stages/foundry/foundryThreePrimitives";
import { createLessonProject } from "../utils/project";
import {
  renderFoundryAssemblySceneOverlay,
  type FoundryAssemblySceneFrame,
} from "../components/stages/foundry/foundryAssemblySceneOverlay";

const kit = defaultPhysicalKit();
const mechanism = normalizeMechanismToReference(
  createDefaultMechanism("4bar", "g3-retained-frame"),
);
const renderPlan = compileMechanismRenderPlan(mechanism, kit);
const kinematics = prepareMechanismKinematics(mechanism, kit);
const fit = createPreparedMechanismFitContext(kinematics, 360, 240, 96);
const assertNear = (
  actual: number,
  expected: number,
  message: string,
  epsilon = 1e-12,
) =>
  assert(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, received ${actual}`,
  );

const simulationFor = (
  preparedKinematics: typeof kinematics,
  fitContext: typeof fit,
  angle: number,
) => {
  const rawState = calculatePreparedLinkage(preparedKinematics, angle);
  const map = (point: typeof rawState.p1) => fitContext.map(point);
  return {
    inputAngleRad: angle,
    inputAngleDeg: (angle * 180) / Math.PI,
    driveAngleRad: angle,
    driveAngleDeg: (angle * 180) / Math.PI,
    pathPoints: fitContext.pathPoints,
    pathD: pointsToSvgPath(fitContext.pathPoints),
    scale: fitContext.scale,
    rawState,
    state: {
      ...rawState,
      p1: map(rawState.p1),
      p2: map(rawState.p2),
      j1: map(rawState.j1),
      j2: map(rawState.j2),
      aux: rawState.aux ? map(rawState.aux) : undefined,
      effector: map(rawState.effector),
    },
  };
};
const simulationAt = (angle: number) => simulationFor(kinematics, fit, angle);

const initialSimulation = simulationAt(0);
const asymmetricSimulation = simulationAt(Math.PI * 0.37);
const root = new THREE.Group();
const layer = renderPlan.layers.find((item) => item.renderKind === "linkage");
assert(layer, "the fixture has a direct linkage layer");
const layerOwner = tagFoundryFrameOwner(new THREE.Group(), {
  bindingId: `foundry:layer:${layer.layerId}`,
  role: "layer",
  sourceId: layer.layerId,
});
layerOwner.position.z = layer.z;
root.add(layerOwner);
const automataOwner = new THREE.Group();
automataOwner.userData.partId = "animated-part";
root.add(automataOwner);
const sharedSpanId = renderPlan.pinSpans[0]?.id;
assert(sharedSpanId, "the fixture has a pin span for shared hardware bindings");
const pointOwner = (
  role: "spacer" | "clip" | "pin",
  ordinal?: number,
) => {
  const object = new THREE.Group();
  object.position.z = 0.2 + (ordinal ?? 0) * 0.1;
  tagFoundryFrameOwner(object, {
    bindingId: `foundry:pin:${sharedSpanId}`,
    role,
    sourceId: sharedSpanId,
    ...(ordinal === undefined ? {} : { ordinal }),
  });
  root.add(object);
  return object;
};
const spacerOwner0 = pointOwner("spacer", 0);
const spacerOwner1 = pointOwner("spacer", 1);
const clipOwner = pointOwner("clip", 0);
const pinOwner = pointOwner("pin");

let traversalCount = 0;
const originalTraverse = root.traverse.bind(root);
root.traverse = ((callback: (object: THREE.Object3D) => void) => {
  traversalCount += 1;
  return originalTraverse(callback);
}) as THREE.Group["traverse"];
const table = createFoundryFrameBindingTable({
  root,
  kinematics,
  renderPlan,
  simulation: initialSimulation,
});
assert.equal(traversalCount, 1, "binding capture traverses the structural root once");
assert.equal(table.layers[0]?.owner, layerOwner, "layer binding keeps the direct owner identity");
const spacerBindings = table.points.filter((point) => point.role === "spacer");
assert.deepEqual(
  spacerBindings.map((point) => point.ordinal),
  [0, 1],
  "two spacers sharing one pin span retain distinct stable ordinals",
);
assert.equal(
  spacerBindings[1]?.presentationKey,
  foundryFramePointPresentationKey(`foundry:pin:${sharedSpanId}`, "spacer", 1),
  "spacer ordinal is a separate presentation key, not a changed authoritative binding id",
);
assert.equal(
  table.points.find((point) => point.role === "clip")?.owner,
  clipOwner,
  "clip binding remains a direct hardware owner",
);
assert.equal(
  table.points.find((point) => point.role === "pin")?.owner,
  pinOwner,
  "spanning pin binding remains a direct hardware owner",
);
assert.equal(
  table.automata[0]?.owner,
  automataOwner,
  "automata capture binds the direct owner rather than a nested mesh",
);

updateFoundryFrameBindings(table, {
  simulation: asymmetricSimulation,
  presentation: {
    automataByBindingId: {
      "foundry:automata:part:animated-part": {
        x: 1.25,
        y: -0.75,
        z: 0.5,
        rotationZ: 0.41,
        scale: 1.2,
        visible: true,
      },
    },
    pointZByPointKey: {
      [spacerBindings[0]!.presentationKey]: 0.8,
      [spacerBindings[1]!.presentationKey]: 1.4,
    },
  },
});
assert.equal(
  traversalCount,
  1,
  "ordinary frame updates never traverse the retained structural root",
);
assert.equal(automataOwner.position.x, 1.25, "automata frame updates move the retained owner");
assert.equal(automataOwner.position.y, -0.75, "automata frame updates move the retained owner in y");
assert.equal(automataOwner.rotation.z, 0.41, "automata frame updates apply live rotation");
assert.equal(automataOwner.position.z, 0.5, "automata frame updates include live assembly lift data");
assert.equal(spacerOwner0.position.z, 0.8, "the first live spacer follows its exploded layer Z");
assert.equal(spacerOwner1.position.z, 1.4, "the second live spacer keeps its own exploded layer Z");
assert.equal(clipOwner.position.z, 0.2, "clips preserve their intentionally fixed spanning Z");
assert.equal(pinOwner.position.z, 0.2, "spanning pins preserve their intentionally fixed Z");

const secondAsymmetricSimulation = simulationAt(Math.PI * 0.83);
updateFoundryFrameBindings(table, {
  simulation: secondAsymmetricSimulation,
  presentation: {
    pointZByPointKey: {
      [spacerBindings[0]!.presentationKey]: 1.1,
      [spacerBindings[1]!.presentationKey]: 1.7,
    },
  },
});
assert.equal(spacerOwner0.position.z, 1.1, "spacer Z follows the second exploded layer sample");
assert.equal(spacerOwner1.position.z, 1.7, "the second spacer keeps its distinct ordinal Z");
assert.equal(clipOwner.position.z, 0.2, "clips remain fixed across playback phases");
assert.equal(pinOwner.position.z, 0.2, "spanning pins remain fixed across playback phases");

const retainedPistonMechanism = normalizeMechanismToReference(
  createDefaultMechanism("piston", "g3-retained-frame-piston"),
);
const retainedPistonPlan = compileMechanismRenderPlan(
  retainedPistonMechanism,
  kit,
);
const retainedPistonKinematics = prepareMechanismKinematics(
  retainedPistonMechanism,
  kit,
);
const retainedPistonFit = createPreparedMechanismFitContext(
  retainedPistonKinematics,
  360,
  240,
  96,
);
const retainedPistonSimulationAt = (angle: number) =>
  simulationFor(retainedPistonKinematics, retainedPistonFit, angle);
const retainedPistonStructural = retainedPistonSimulationAt(0);
const retainedPistonRoot = new THREE.Group();
const retainedPistonGeometryCache = new Map<string, THREE.BufferGeometry>();
const retainedPistonMaterialCache = new Map<string, THREE.Material>();
const retainedPistonPrimitives = createFoundryThreePrimitiveFactory({
  root: retainedPistonRoot,
  geometryCache: retainedPistonGeometryCache,
  materialCache: retainedPistonMaterialCache,
  mechanism: retainedPistonMechanism,
  kit,
  color: retainedPistonMechanism.color,
  rigOpacity: 1,
  baseColor: retainedPistonPlan.base.color,
  simulationScale: retainedPistonStructural.scale,
});
const retainedPistonPinPoints = foundryPinStackPoints(retainedPistonPlan, {
  state: retainedPistonStructural.state,
  gearCenters: [],
  planetCenters: [retainedPistonStructural.state.p2],
});
renderFoundryDynamicLayers({
  mechanism: retainedPistonMechanism,
  kit,
  simulation: retainedPistonStructural,
  primitives: retainedPistonPrimitives,
  renderPlan: retainedPistonPlan,
  renderedLayerZ: foundryRenderedLayerZForMechanism(
    retainedPistonPlan.layers,
    retainedPistonPlan.layers.map((layer) => layer.z),
  ),
  pinStacks: foundryPinStacks(retainedPistonPinPoints, retainedPistonPlan),
  visiblePathTraces: [],
  pathLayerZ: 0,
  showPathPreview: false,
  showTrail: false,
  pinionRotation: retainedPistonStructural.driveAngleDeg,
  isGearTrain: false,
  gearRadii: [],
  gearCenters: [],
  gearUsesMeshPhases: false,
  gearOutputRatioForDisplay: 1,
});
const retainedPistonTable = createFoundryFrameBindingTable({
  root: retainedPistonRoot,
  kinematics: retainedPistonKinematics,
  renderPlan: retainedPistonPlan,
  simulation: retainedPistonStructural,
});
const retainedPistonLinkage = retainedPistonTable.layers.find(
  (binding) => binding.prepared.layer.sourceNodeId === "crank-link",
);
const retainedPistonGuide = retainedPistonTable.layers.find(
  (binding) => binding.prepared.layer.sourceNodeId === "guide",
);
assert(retainedPistonLinkage, "actual piston render binds its linkage owner");
assert(retainedPistonGuide, "actual piston render binds its oriented-box guide owner");
const structuralLinkageEnvelope = samplePreparedMechanismPhysicalLayerEnvelope(
  retainedPistonLinkage.prepared,
  retainedPistonStructural.rawState,
);
const structuralGuideEnvelope = samplePreparedMechanismPhysicalLayerEnvelope(
  retainedPistonGuide.prepared,
  retainedPistonStructural.rawState,
);
assertNear(
  retainedPistonLinkage.owner.rotation.z,
  structuralLinkageEnvelope.rotation,
  "structural rendered linkage owner keeps +raw rotation",
);
assertNear(
  retainedPistonGuide.owner.rotation.z,
  structuralGuideEnvelope.rotation,
  "structural rendered oriented-box owner keeps +raw rotation",
);
for (const [index, angle] of [Math.PI * 0.37, Math.PI * 0.83].entries()) {
  const retainedSimulation = retainedPistonSimulationAt(angle);
  updateFoundryFrameBindings(retainedPistonTable, {
    simulation: retainedSimulation,
  });
  const linkageEnvelope = samplePreparedMechanismPhysicalLayerEnvelope(
    retainedPistonLinkage.prepared,
    retainedSimulation.rawState,
  );
  const guideEnvelope = samplePreparedMechanismPhysicalLayerEnvelope(
    retainedPistonGuide.prepared,
    retainedSimulation.rawState,
  );
  assert(
    Math.abs(linkageEnvelope.rotation) > 0.01,
    `retained piston linkage phase ${index + 1} is asymmetric`,
  );
  assertNear(
    retainedPistonLinkage.owner.rotation.z,
    linkageEnvelope.rotation,
    `retained piston linkage phase ${index + 1} keeps +raw rotation`,
  );
  assert(
    Math.abs(guideEnvelope.rotation) > 0.01,
    `retained piston oriented-box phase ${index + 1} has a nonzero angle`,
  );
  assertNear(
    retainedPistonGuide.owner.rotation.z,
    guideEnvelope.rotation,
    `retained piston oriented-box phase ${index + 1} keeps +raw rotation`,
  );
}
disposeFoundryThreeObject(retainedPistonRoot);
disposeThreeResourceCaches(
  retainedPistonGeometryCache,
  retainedPistonMaterialCache,
);
assert.equal(retainedPistonGeometryCache.size, 0, "retained fixture geometry cache disposes and clears");
assert.equal(retainedPistonMaterialCache.size, 0, "retained fixture material cache disposes and clears");

updateFoundryFrameBindings(table, {
  simulation: secondAsymmetricSimulation,
  presentation: { automataByBindingId: {} },
});
assert.equal(automataOwner.visible, false, "missing animated presentation hides a stale automata owner");
assert.equal(traversalCount, 1, "repeated frame updates remain traversal-free");

table.planetCenters[0] = initialSimulation.rawState.p2;
updateFoundryFrameBindings(table, { simulation: secondAsymmetricSimulation });
assert.equal(
  table.planetCenters.length,
  PLANETARY_GEAR_PLANET_COUNT,
  "the binding table exposes every center in the current planetary recipe",
);
assert.equal(table.planetCenters[0], secondAsymmetricSimulation.rawState.p2, "planet centers are refreshed from the sampled raw state");

const assemblyGuideRoot = new THREE.Group();
const assemblyGuideFrame = {
  version: 1,
  kind: "mechanism",
  phase: "assemble-module",
  stepIndex: 0,
  label: "Guide binding split",
  motion: "explode_z",
  explodeAxis: "z",
  boardMode: "active",
  progress: 0.4,
  instruction: "",
  activePartIds: [],
  activeBoardCoords: ["A1"],
  floatingReferenceCoords: [],
  visibleParts: [],
  kitProfileKey: kit.profileKey,
} as FoundryAssemblySceneFrame;
renderFoundryAssemblySceneOverlay({
  root: assemblyGuideRoot,
  frame: assemblyGuideFrame,
  mechanism,
  simulation: asymmetricSimulation,
  kit,
  pinBottomZ: 0.2,
  pinTopZ: 0.8,
  pathLayerZ: 1,
  pathPoints: [],
});
let fixedGuide: THREE.Object3D | undefined;
let animatedGuide: THREE.Object3D | undefined;
assemblyGuideRoot.traverse((object) => {
  if (object.name !== "assembly-z-guide") return;
  if (object.userData.assemblyGuideBinding === "fixed") fixedGuide = object;
  if (object.userData.assemblyGuideBinding === "explode") animatedGuide = object;
});
assert(fixedGuide, "the assembly overlay keeps a baseline fixed guide");
assert(animatedGuide, "the assembly overlay adds a distinct explode guide");
const fixedGuideBefore = {
  x: fixedGuide.position.x,
  y: fixedGuide.position.y,
  z: fixedGuide.position.z,
  scaleY: fixedGuide.scale.y,
};
const assemblyGuideBindings = createFoundryAssemblyFrameBindings();
assemblyGuideRoot.traverse((object) =>
  captureFoundryAssemblyFrameBinding(object, assemblyGuideBindings),
);
assert.equal(
  assemblyGuideBindings.zGuides.length,
  1,
  "assembly binding capture collects only the animated explode guide",
);
const animatedGuideBinding = assemblyGuideBindings.zGuides[0]!;
assert.equal(
  animatedGuideBinding.object,
  animatedGuide,
  "only the userData.assemblyGuideBinding=explode guide enters zGuides",
);
const animatedGuideHeightBefore =
  animatedGuideBinding.baseHeight * animatedGuideBinding.object.scale.y;
const zGuideExtension = 0.37;
updateFoundryAssemblyFrameBindings(assemblyGuideBindings, {
  zGuideExtension,
  automataLift: 0,
  travelProgress: 0,
});
assertNear(
  animatedGuideBinding.baseHeight * animatedGuideBinding.object.scale.y,
  animatedGuideHeightBefore + zGuideExtension,
  "the animated explode guide gains exactly the requested extension",
);
assertNear(fixedGuide.position.x, fixedGuideBefore.x, "fixed guide x stays unchanged");
assertNear(fixedGuide.position.y, fixedGuideBefore.y, "fixed guide y stays unchanged");
assertNear(fixedGuide.position.z, fixedGuideBefore.z, "fixed guide z stays unchanged");
assertNear(fixedGuide.scale.y, fixedGuideBefore.scaleY, "fixed guide height stays unchanged");

const planetSelector = prepareFoundrySupportPointSelector("planet-gear");
assert.equal(
  samplePreparedFoundrySupportPoint(planetSelector, {
    state: secondAsymmetricSimulation.rawState,
    planetCenters: table.planetCenters,
  }),
  secondAsymmetricSimulation.rawState.p2,
  "the prepared planetary selector consumes the refreshed canonical center",
);

const planetaryMechanism = normalizeMechanismToReference(
  createDefaultMechanism("planetary_gear", "g3-retained-planetary"),
);
const planetaryRenderPlan = compileMechanismRenderPlan(planetaryMechanism, kit);
const planetaryKinematics = prepareMechanismKinematics(planetaryMechanism, kit);
const planetaryFit = createPreparedMechanismFitContext(
  planetaryKinematics,
  360,
  240,
  96,
);
const planetaryAt = (angle: number) =>
  simulationFor(planetaryKinematics, planetaryFit, angle);
const planetaryInitial = planetaryAt(Math.PI * 0.2);
const planetaryNext = planetaryAt(Math.PI * 0.71);
const planetaryRoot = new THREE.Group();
const planetaryLayer = planetaryRenderPlan.layers.find(
  (item) => item.sourceNodeId === "planet-gear",
);
const planetaryPath = planetaryRenderPlan.supportPaths.find(
  (path) => path.rootNodeId === "planet-gear",
);
assert(planetaryLayer && planetaryPath?.pinSpanId, "planetary fixture has a planet layer and support span");
const planetaryLayerOwner = tagFoundryFrameOwner(new THREE.Group(), {
  bindingId: `foundry:layer:${planetaryLayer.layerId}`,
  role: "layer",
  sourceId: planetaryLayer.layerId,
});
planetaryLayerOwner.position.z = planetaryLayer.z;
planetaryRoot.add(planetaryLayerOwner);
const planetaryPointOwner = tagFoundryFrameOwner(new THREE.Group(), {
  bindingId: `foundry:pin:${planetaryPath.pinSpanId}`,
  role: "pin",
  sourceId: planetaryPath.pinSpanId,
});
planetaryRoot.add(planetaryPointOwner);
const planetaryTable = createFoundryFrameBindingTable({
  root: planetaryRoot,
  kinematics: planetaryKinematics,
  renderPlan: planetaryRenderPlan,
  simulation: planetaryInitial,
});
const planetaryPointBinding = planetaryTable.points.find(
  (point) => point.selector?.kind === "planet",
);
assert(planetaryPointBinding, "planetary fixture binds the prepared planet selector");
updateFoundryFrameBindings(planetaryTable, { simulation: planetaryNext });
assert.equal(
  planetaryTable.planetCenters.length,
  PLANETARY_GEAR_PLANET_COUNT,
  "planetary frame table has one slot for every current planet",
);
assert.equal(
  planetaryTable.planetCenters[0],
  planetaryNext.rawState.p2,
  "planetary center array refreshes from the new prepared raw state",
);
const planetaryPoint = planetaryFit.map(planetaryNext.rawState.p2);
assert.equal(
  planetaryPointOwner.position.x,
  (planetaryPoint.x - 180) / 18,
  "planet binding follows the refreshed center in x",
);
assert.equal(
  planetaryPointOwner.position.y,
  (120 - planetaryPoint.y) / 18,
  "planet binding follows the refreshed center in y",
);
assert.equal(
  samplePreparedFoundrySupportPoint(planetaryPointBinding.selector, {
    state: planetaryNext.rawState,
    planetCenters: planetaryTable.planetCenters,
  }),
  planetaryNext.rawState.p2,
  "planet binding samples the refreshed canonical center",
);

const automataProject = createLessonProject("waving-arm");
const automataPartId = automataProject.partOrder[0]!;
const automataPart = automataProject.parts[automataPartId]!;
const animatedPart = {
  ...automataPart,
  transform: {
    ...automataPart.transform,
    x: 12,
    y: -8,
    rotation: 32,
    scale: 1.4,
  },
  zIndex: 9,
  visible: false,
};
const automataPresentation = automataFramePresentationFor({
  context: {
    project: automataProject,
    animatedParts: { [automataPartId]: animatedPart },
    showCharacter: true,
  },
  assemblySceneFrame: {
    kind: "character",
    activePartIds: [automataPartId],
  } as unknown as FoundryAssemblySceneFrame,
  assemblyFramePresentation: {
    zGuideExtension: 0,
    automataLift: 0.75,
    travelProgress: 0,
  },
  baseZ: 2,
});
const animatedTransform = automataPresentation[`foundry:automata:part:${automataPartId}`];
assert(animatedTransform, "automata presentation includes the sampled part");
const sceneScale = Math.min(360 / SCENE_VIEW.width, 240 / SCENE_VIEW.height);
assertNear(animatedTransform.x, (12 * sceneScale) / 18, "automata presentation maps scene x through sceneTo3");
assertNear(animatedTransform.y, (-8 * sceneScale) / 18, "automata presentation maps scene y through sceneTo3");
assert.equal(animatedTransform.rotationZ, (32 * Math.PI) / 180, "automata presentation keeps positive scene rotation");
assert.equal(animatedTransform.scale, 1.4, "automata presentation carries animated scale");
assert.equal(animatedTransform.visible, false, "automata presentation carries animated visibility");
assertNear(animatedTransform.z, 2 + 9 * 0.045 + 0.75, "automata presentation applies z index and assembly lift");

const callbacks = new Map<number, () => void>();
const committed: string[] = [];
const scheduler: FrameCommitScheduler = {
  request: (callback) => {
    callbacks.set(1, callback);
    return 1;
  },
  cancel: (handle) => callbacks.delete(handle),
};
const renderQueue = createFrameCommitQueue<string>({
  scheduler,
  commit: (value) => committed.push(value),
});
renderQueue.queue("first");
renderQueue.queue("latest");
assert.equal(callbacks.size, 1, "frame presentation coalesces to one pending render");
callbacks.get(1)?.();
assert.deepEqual(committed, ["latest"], "the queued render commits only the latest frame");
assert.equal(committed.length, 1, "one queued burst produces one render commit");

const originalTextureLoad = THREE.TextureLoader.prototype.load;
const texture = new THREE.Texture();
let textureLoads = 0;
let textureDisposals = 0;
let materialDisposals = 0;
texture.addEventListener("dispose", () => textureDisposals += 1);
(THREE.TextureLoader.prototype as unknown as {
  load: (url: string, onLoad?: (loaded: THREE.Texture) => void) => THREE.Texture;
}).load = (_url, onLoad) => {
  textureLoads += 1;
  onLoad?.(texture);
  return texture;
};
try {
  const materialCache = new Map<string, THREE.Material>();
  const firstMaterial = createFoundryAutomataTextureMaterial(
    "texture://character",
    0.8,
    materialCache,
    () => undefined,
  );
  firstMaterial.addEventListener("dispose", () => materialDisposals += 1);
  const secondMaterial = createFoundryAutomataTextureMaterial(
    "texture://character",
    0.8,
    materialCache,
    () => undefined,
  );
  assert.equal(firstMaterial, secondMaterial, "automata texture materials are cache reference-stable");
  assert.equal(textureLoads, 1, "a cached automata texture loads once");
  disposeThreeResourceCaches(new Map(), materialCache);
  assert.equal(textureDisposals, 1, "cached automata texture disposes once with the material cache");
  assert.equal(materialDisposals, 1, "cached automata material disposes once with the material cache");
  assert.equal(materialCache.size, 0, "texture material cache clears after teardown");
} finally {
  THREE.TextureLoader.prototype.load = originalTextureLoad;
}

console.log("G3 retained-frame binding contracts passed");
