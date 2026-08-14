import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WORKBENCH_CANONICAL_PLANE_Z,
  WORKBENCH_CANONICAL_VIEW,
  WORKBENCH_CONTRACT_VERSION,
  WORKBENCH_INTERACTION_BOUNDS_STRIDE,
  WORKBENCH_MAX_INTERPOLATION_ERROR_CSS_PX,
  WORKBENCH_MAX_POSE_SAMPLES,
  WORKBENCH_MIN_POSE_SAMPLES,
  WORKBENCH_SCENE_GROUPS,
  WORKBENCH_TRANSFORM_STRIDE,
  fitWorkbenchRenderRect,
  orthographicCameraFrame,
  workbenchClientPointToCanonical,
  type InteractionPlan,
  type RuntimeFrame,
  type StageLens,
} from "../runtime/workbench/contracts";

const close = (actual: number, expected: number, label: string) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected}, received ${actual}`,
  );

assert.equal(WORKBENCH_CONTRACT_VERSION, 1);
assert.deepEqual(WORKBENCH_CANONICAL_VIEW, { width: 900, height: 680 });
assert.equal(WORKBENCH_CANONICAL_PLANE_Z, 0);
assert.equal(WORKBENCH_TRANSFORM_STRIDE, 5);
assert.equal(WORKBENCH_INTERACTION_BOUNDS_STRIDE, 4);
assert.equal(WORKBENCH_MIN_POSE_SAMPLES, 256);
assert.equal(WORKBENCH_MAX_POSE_SAMPLES, 1_024);
assert.equal(WORKBENCH_MAX_INTERPOLATION_ERROR_CSS_PX, 0.5);
assert.deepEqual(WORKBENCH_SCENE_GROUPS, [
  "board",
  "character",
  "sceneObjects",
  "skeleton",
  "paths",
  "mechanisms",
  "hardware",
  "editHandles",
  "physicsOverlay",
  "assemblyOverlay",
  "blueprintOverlay",
  "selectionOverlay",
]);

const wideHost = { left: 10, top: 20, width: 1_000, height: 500 };
const wideFit = fitWorkbenchRenderRect(wideHost);
close(wideFit.width, 500 * 900 / 680, "wide contain width");
close(wideFit.height, 500, "wide contain height");
close(wideFit.left, 10 + (1_000 - wideFit.width) / 2, "wide contain left");
close(wideFit.top, 20, "wide contain top");

const tallHost = { left: -5, top: 8, width: 500, height: 1_000 };
const tallFit = fitWorkbenchRenderRect(tallHost);
close(tallFit.width, 500, "tall contain width");
close(tallFit.height, 500 * 680 / 900, "tall contain height");
close(tallFit.left, -5, "tall contain left");
close(tallFit.top, 8 + (1_000 - tallFit.height) / 2, "tall contain top");

const viewport = { offset: { x: 90, y: -68 }, zoom: 2 };
const camera = orthographicCameraFrame(viewport);
assert.deepEqual(camera.center, { x: -45, y: -34 });
assert.deepEqual(
  { width: camera.width, height: camera.height },
  { width: 450, height: 340 },
);
assert.deepEqual(
  { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom },
  { left: -270, right: 180, top: 136, bottom: -204 },
);

const center = workbenchClientPointToCanonical({
  clientX: wideFit.left + wideFit.width / 2,
  clientY: wideFit.top + wideFit.height / 2,
  host: wideHost,
  viewport,
});
assert.ok(center);
assert.deepEqual(center.scene, camera.center);
assert.deepEqual(center.ndc, { x: 0, y: 0 });

const topLeft = workbenchClientPointToCanonical({
  clientX: wideFit.left,
  clientY: wideFit.top,
  host: wideHost,
  viewport,
});
assert.ok(topLeft);
assert.deepEqual(topLeft.scene, { x: -270, y: 136 });
assert.deepEqual(topLeft.ndc, { x: -1, y: 1 });

assert.equal(
  workbenchClientPointToCanonical({
    clientX: wideFit.left - 0.01,
    clientY: wideFit.top + 1,
    host: wideHost,
    viewport,
  }),
  null,
  "letterbox input must not project onto the canonical plane",
);
assert.throws(
  () => orthographicCameraFrame({ offset: { x: 0, y: 0 }, zoom: 0 }),
  /positive zoom/,
);

const interactionFixture = {
  version: 1,
  revision: "interaction-r1",
  planeZ: 0,
  boundsStride: 4,
  targets: [],
  canonicalBounds: new Float32Array(),
} satisfies InteractionPlan;
const frameFixture = {
  generation: 7,
  phase: 0,
  elapsedMs: 0,
  sampleIndexA: 0,
  sampleIndexB: 1,
  sampleMix: 0,
  transforms: new Float32Array(WORKBENCH_TRANSFORM_STRIDE),
  overlays: new Float32Array(),
} satisfies RuntimeFrame;
const lensFixture = {
  version: 1,
  stage: "path",
  enabled: true,
  camera: {
    mode: "studio-orthographic",
    locked: true,
    fit: "contain-canonical",
    planeZ: 0,
    viewport: { offset: { x: 0, y: 0 }, zoom: 1 },
  },
  visibleGroups: ["board", "character", "skeleton", "paths", "editHandles"],
  materialPolicy: "path-solid",
  interactionPolicy: {
    mode: "path",
    allowedActions: ["draw-path", "path-point", "viewport-pan", "viewport-zoom"],
    authoringWrites: "project-commit",
    editsRequirePaused: false,
    commitOnPointerUp: true,
    hitSlopCssPx: 8,
  },
  physics: { mode: "off", requested: false },
} satisfies StageLens;
assert.equal(interactionFixture.planeZ, 0);
assert.equal(frameFixture.transforms.length, 5);
assert.equal(lensFixture.camera.mode, "studio-orthographic");

const contractSource = readFileSync(
  new URL("../runtime/workbench/contracts.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(contractSource, /from ["'](?:react|three)["']/);
assert.doesNotMatch(contractSource, /InspectorModelKey[\s\S]{0,300}(?:phase|camera)/);
assert.match(contractSource, /semanticProjection: ToonSceneProjection/);
assert.match(contractSource, /rebuildableFromPreparedScene: true/);
for (const frozenInterface of [
  "WorkbenchRuntime",
  "PreparedWorkbenchScene",
  "StageLens",
  "RuntimeFrame",
  "InteractionPlan",
  "InspectorModel",
]) {
  assert.match(
    contractSource,
    new RegExp(`export interface ${frozenInterface}\\b`),
    `${frozenInterface} must remain on the frozen public surface`,
  );
}

console.log("unified workbench contracts passed");
