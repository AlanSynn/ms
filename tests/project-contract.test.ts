import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { boardGridLines, boardToScene, bodyPartPivotScene, physicalKitPreset, placeBodyPartPivotAt, SCENE_PX_PER_MM, sceneToBoard, sceneToBoardRaw, sceneToSheetMm, sceneToSvg, sheetMmToScene } from '../utils/coordinates';
import { createDefaultMechanism, createSampleProject, handoffGate, loadProjectSnapshot, serializeProject, applyProjectAction, projectSelfCheck, mechanismRequiredParts, mechanismWithGeneratedPath } from '../utils/project';
import { createFabricationPackage, FABRICATION_GEAR_SPECS, FABRICATION_SPACER_SPEC, fabricationGearPathD, fabricationGearProfileForPitchRadius, fabricationGearSpecForPitchRadius, fabricationRingGearPathD, fabricationRenderPlanForMechanism, fabricationStackForMechanism, sampleFeasibleRange, validateFabricationStack, validateForFabrication } from '../utils/fabrication';
import { generateDXF, generateSVG } from '../utils/exporter';
import { createProjectFromPackageData, parseCharConfig } from '../utils/packageLoader';
import { animationDeltaRadians, calculateLinkage, camFollowerRise, camProfileScale, gearPairOutputRatio, generateCurvePoints, planetaryPlanetSpinRatio } from '../utils/kinematics';
import { animatedPartsForProject, describeMotionChain, mechanismBindingWarnings, motionAnchorJointIds, motionPreviewForPath, motionPreviewForProject, motionPreviewForTarget, preferredMotionJointId } from '../utils/motion';
import { buildToonSceneProjection } from '../utils/sceneProjection';
import { buildKinematicPhysicsSession } from '../utils/physicsSession';
import { fabricablePartOutlinePoints, partLandmarkJointIds, partLandmarkLocalPoints, partOutlineBounds, pointInsideOutline } from '../utils/partGeometry';
import { MECHANISM_FEATURE_REGISTRY, mechanismFeature, validateMechanismFeatureRegistry, type MechanismDragHandle } from '../utils/mechanismFeatureRegistry';
import { buildMechanismSnapshot, buildMechanismSnapshots } from '../utils/mechanismSnapshot';
import { ALL_MECHANISM_TYPES, AUTHORABLE_MECHANISM_TYPES, MECHANISM_TEMPLATE_LIBRARY, mechanismTemplateLabel } from '../utils/mechanismTemplates';
import { MECHANISM_TYPES as SANITIZE_MECHANISM_TYPES } from '../utils/sanitize';
import { generateSmartConfig, mutateConfig, OPTIMIZER_MECHANISM_TYPES } from '../utils/optimizer';
import type { BodyPartLayer, MechanismType, ProjectState } from '../types';

projectSelfCheck();

const onnxPath = join(process.cwd(), 'public', 'onnx', 'pose_model.onnx');
assert(existsSync(onnxPath), 'web ONNX asset is present');
assert(statSync(onnxPath).size > 1_000_000, 'web ONNX asset is real model data, not a Git LFS pointer or mock');
assert(!readFileSync(onnxPath).subarray(0, 64).toString('utf8').startsWith('version https://git-lfs'), 'web ONNX asset is checked out from Git LFS before tests run');

const sample = createSampleProject();
const expectedCanvasDragHandles: Record<MechanismType, MechanismDragHandle[]> = {
  crank: ['P1', 'J1'],
  '4bar': ['P1', 'J1', 'P2', 'J2', 'Effector'],
  piston: ['P1', 'J1', 'P2', 'J2', 'Effector'],
  yoke: ['P1', 'J1', 'P2', 'J2', 'Effector'],
  'quick-return': ['P1', 'J1', 'P2', 'J2', 'Effector'],
  '5bar': ['P1', 'J1', 'P2', 'J2', 'Aux', 'Effector'],
  cam: ['P1', 'J1', 'P2'],
  'rack-pinion': ['P1', 'J1', 'Effector'],
  gear: ['P1', 'J1', 'P2', 'J2', 'Effector'],
  planetary_gear: ['P1', 'J1', 'J2', 'Effector']
};
assert(existsSync(join(process.cwd(), 'resources/examples/raw/girl.png')), 'girl starter source image is present');
assert(existsSync(join(process.cwd(), 'resources/examples/raw/boy.PNG')), 'boy starter source image is present');
const designContract = readFileSync(join(process.cwd(), 'DESIGN.md'), 'utf8');
const agentsContract = readFileSync(join(process.cwd(), 'AGENTS.md'), 'utf8');
const brandStaticFiles = [
  'App.tsx',
  'index.html',
  'package.json',
  'package-lock.json',
  'metadata.json',
  'README.md',
  'DESIGN.md',
  'vite.config.ts',
  'run_browser.bat',
  'build_portable_exe.bat',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json',
  'docs/mechanism-blueprint-manual.md',
  'docs/prd/novice-canva-style-ui-plan.md',
  'docs/prd/realistic-25d-3d-physics-platform-plan.md',
  'docs/prd/canva-video-editor-workspace-plan.md',
  'docs/prd/toon-25d-main-3d-unlock-plan.md',
  'docs/subsystem-governance-and-mechanism-contracts.md',
  'docs/subsystem-governance-execution-log.md'
];
const brandStaticText = brandStaticFiles.map(file => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');
const subsystemGovernanceContract = readFileSync(join(process.cwd(), 'docs', 'subsystem-governance-and-mechanism-contracts.md'), 'utf8');
const legacyBrand = ['Mech', 'Anim'].join('');
const legacySlug = ['mech', 'anim'].join('');
assert(!brandStaticText.includes(legacyBrand), 'legacy product name is absent from static project files');
assert(!brandStaticText.includes(legacySlug), 'legacy package/storage slug is absent from static project files');
assert(brandStaticText.includes('MotionSmith'), 'MotionSmith appears across static project files');
assert.equal(JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).name, 'motionsmith-character-motion-designer', 'npm package name uses the MotionSmith slug');
assert.equal(JSON.parse(readFileSync(join(process.cwd(), 'metadata.json'), 'utf8')).name, 'MotionSmith: Character Motion Designer', 'metadata product name uses MotionSmith');
assert(readFileSync(join(process.cwd(), 'index.html'), 'utf8').includes('<title>MotionSmith - Mechanical Character Designer</title>'), 'HTML title uses MotionSmith');
assert(readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8').includes("'/MotionSmith/'"), 'web deployment base path uses MotionSmith');
assert.equal(JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8')).productName, 'MotionSmith', 'Tauri product name uses MotionSmith');
assert(readFileSync(join(process.cwd(), 'App.tsx'), 'utf8').includes('motionsmith.hideWelcome'), 'local storage namespace uses the MotionSmith slug');
const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const playwrightConfigText = readFileSync(join(process.cwd(), 'playwright.config.ts'), 'utf8');
assert(playwrightConfigText.includes('fullyParallel: true'), 'browser tests default to full parallel execution without reducing coverage');
assert(playwrightConfigText.includes('PLAYWRIGHT_WORKERS'), 'browser worker count can be tuned by environment instead of weakening tests');
assert(playwrightConfigText.includes('MAX_BROWSER_WORKERS'), 'browser worker defaults are bounded to avoid local over-parallelization');
assert(playwrightConfigText.includes('Number.isInteger'), 'browser worker override validates positive integer input');
assert(playwrightConfigText.includes('PLAYWRIGHT_SERVER') && playwrightConfigText.includes('preview'), 'browser tests can run against production preview without Vite HMR noise');
assert(packageJson.scripts['test:browser'].includes('npm run build') && packageJson.scripts['test:browser'].includes('PLAYWRIGHT_SERVER=preview'), 'browser test script validates the production build through preview mode');
assert(agentsContract.includes('preserve coverage while optimizing wall time'), 'AGENTS.md requires test speedups to preserve test quality');
assert(agentsContract.includes('bounded Playwright parallel workers'), 'AGENTS.md requires bounded browser test parallelism');
assert(designContract.includes('Shared editor workbench'), 'DESIGN.md documents the shared editor workbench');
assert(designContract.includes('Project governance: `AGENTS.md`'), 'DESIGN.md points contributors at the project agent contract');
assert(designContract.includes('#8b5cf6'), 'DESIGN.md uses the MotionSmith light primary color');
assert(!designContract.includes('Cyber-Industrial Minimalism'), 'DESIGN.md no longer points contributors at the old dark CAD direction');
assert(agentsContract.includes('tinkerable workbench'), 'AGENTS.md codifies the tinkerable workbench direction');
assert(agentsContract.includes('direct manipulation'), 'AGENTS.md prioritizes direct manipulation over explanatory text');
assert(agentsContract.includes('3D physics'), 'AGENTS.md codifies the 3D physics simulation direction');
assert(agentsContract.includes('fabrication'), 'AGENTS.md codifies fabrication-oriented mechanisms');
assert(agentsContract.includes('canonical `ProjectState`'), 'AGENTS.md requires one canonical ProjectState across workflows');
assert(agentsContract.includes('Foundry preview'), 'AGENTS.md locks foundry simulation preview expectations');
assert(agentsContract.includes('Do not add artificial test time limits'), 'AGENTS.md forbids artificial test time limits');
assert(agentsContract.includes('Simulation verification may be rigorous'), 'AGENTS.md allows rigorous simulation verification');
assert(subsystemGovernanceContract.includes('ProjectState'), 'subsystem governance keeps ProjectState as the canonical app document');
assert(subsystemGovernanceContract.includes('MechanismFeatureRegistry'), 'subsystem governance names the single mechanism feature registry seam');
assert(subsystemGovernanceContract.includes('MechanismSnapshot'), 'subsystem governance names deterministic mechanism snapshots');
assert(subsystemGovernanceContract.includes('ToonSceneProjection'), 'subsystem governance keeps ToonSceneProjection as the scene projection contract');
assert(subsystemGovernanceContract.includes('Do not create duplicate mechanism registries'), 'subsystem governance forbids duplicate mechanism registries');
assert(subsystemGovernanceContract.includes('Performance governance'), 'subsystem governance includes the performance-governance rules');
assert(subsystemGovernanceContract.includes('production preview build'), 'subsystem governance locks browser QA to shipped production preview evidence');
assert(Object.keys(sample.skeleton?.joints ?? {}).length >= 17, 'sample placeholder exposes the full editable joint set');
assert(sample.partOrder.every(id => ['#cbd5e1', '#e2e8f0', '#b6c2d2', '#94a3b8'].includes(sample.parts[id].fillColor)), 'sample character uses muted placeholder part colors');
assert.equal(sample.mechanisms[0].targetAnchorJointId, 'right_hand', 'sample waving arm drives the hand, not the shoulder root');
assert.deepEqual(motionAnchorJointIds(sample, 'right_arm'), ['right_shoulder', 'right_elbow', 'right_hand'], 'IK anchor choices stay within the target limb chain');
assert.equal(preferredMotionJointId(sample, 'right_arm', 'left_hand'), 'right_shoulder', 'invalid IK anchor falls back to the target part root');
assert.deepEqual(SANITIZE_MECHANISM_TYPES, [...ALL_MECHANISM_TYPES], 'import sanitizer accepts every low-level mechanism template including crank');
assert.deepEqual(OPTIMIZER_MECHANISM_TYPES, [...AUTHORABLE_MECHANISM_TYPES], 'optimizer searches authorable mechanism templates only');
assert(!AUTHORABLE_MECHANISM_TYPES.includes('crank'), 'bare crank stays a low-level driver, not a novice authoring template');
ALL_MECHANISM_TYPES.forEach(type => {
  assert(MECHANISM_TEMPLATE_LIBRARY[type].label && MECHANISM_TEMPLATE_LIBRARY[type].sense, `${type} has shared template metadata`);
});
assert.deepEqual(Object.keys(MECHANISM_FEATURE_REGISTRY).sort(), [...ALL_MECHANISM_TYPES].sort(), 'feature registry covers every mechanism type exactly once');
assert.deepEqual(validateMechanismFeatureRegistry(), [], 'feature registry passes static self-checks');
ALL_MECHANISM_TYPES.forEach(type => {
  const feature = mechanismFeature(type);
  const mechanism = feature.defaults(`${type}-registry-test`);
  assert.equal(mechanism.type, type, `${type} feature creates a default mechanism of the same type`);
  assert.equal(feature.label, MECHANISM_TEMPLATE_LIBRARY[type].label, `${type} feature label mirrors shared metadata`);
  assert.deepEqual(feature.requiredParts(mechanism), mechanismRequiredParts(mechanism), `${type} feature required parts use canonical project helper`);
  assert.deepEqual(feature.fabricationStack(mechanism), fabricationStackForMechanism(mechanism), `${type} feature stack uses canonical fabrication helper`);
  assert.equal(feature.fabricationPlan(mechanism).roleSummary, fabricationRenderPlanForMechanism(mechanism).roleSummary, `${type} feature render plan uses canonical fabrication helper`);
  assert.equal(feature.sampleKinematics(mechanism, 0).isValid, calculateLinkage(mechanism, 0).isValid, `${type} feature kinematics use canonical solver`);
  assert.equal(feature.sampleFeasibleRange(mechanism, 12).percentValid, sampleFeasibleRange(mechanism, 12).percentValid, `${type} feature feasible range uses canonical sampler`);
  assert(feature.interactionPolicy(mechanism).writesProjectState, `${type} feature declares ProjectState-backed edits`);
  assert.deepEqual(feature.interactionPolicy(mechanism).draggableHandles, expectedCanvasDragHandles[type], `${type} feature preserves legacy Canvas drag handles`);
  assert(feature.projectionHints(mechanism).every(hint => hint.source === 'mechanism-feature-registry' && hint.zStackUsesFabricationPlan), `${type} feature declares fabrication-backed projection`);
  assert(feature.physicsHints(mechanism).every(hint => hint.solver === 'kinematic-derived' && hint.preservesProjectState), `${type} feature declares derived physics sidecar behavior`);
});
const sampleMechanismId = sample.mechanisms[0].id;
const snapshotBeforeProject = serializeProject(sample);
const snapshotA = buildMechanismSnapshot(sample, sampleMechanismId);
const snapshotB = buildMechanismSnapshot(sample, sampleMechanismId);
assert(snapshotA && snapshotB, 'mechanism snapshot builder returns a snapshot for an existing mechanism id');
assert.deepEqual(snapshotA, snapshotB, 'mechanism snapshot builder is deterministic for the same project and mechanism');
assert.equal(serializeProject(sample), snapshotBeforeProject, 'mechanism snapshot builder does not mutate ProjectState');
assert(Object.isFrozen(snapshotA) && Object.isFrozen(snapshotA.fabricationPlan.layers), 'mechanism snapshot is recursively frozen for adapter safety');
assert.equal(snapshotA.sourceIds.mechanismId, sampleMechanismId, 'mechanism snapshot records mechanism source id');
assert(snapshotA.feasibleRange.percentValid >= 0 && snapshotA.feasibleRange.percentValid <= 1, 'mechanism snapshot includes feasible range');
assert(snapshotA.interactionPolicy.writesProjectState, 'mechanism snapshot includes interaction policy');
assert(snapshotA.projectionHints.every(hint => hint.zStackUsesFabricationPlan), 'mechanism snapshot includes fabrication-backed projection hints');
assert(snapshotA.physicsHints.every(hint => hint.preservesProjectState), 'mechanism snapshot includes derived physics hints');
assert(Array.isArray(snapshotA.fabricationPlan.validationErrors), 'mechanism snapshot includes fabrication plan validation result');
const snapshotParamChanged = buildMechanismSnapshot({
  ...sample,
  mechanisms: sample.mechanisms.map(mechanism => mechanism.id === sampleMechanismId ? { ...mechanism, crankLength: mechanism.crankLength + 1 } : mechanism)
}, sampleMechanismId);
assert(snapshotParamChanged && snapshotParamChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when mechanism params change');
const snapshotOutputGearChanged = buildMechanismSnapshot({
  ...sample,
  mechanisms: sample.mechanisms.map(mechanism => mechanism.id === sampleMechanismId ? { ...mechanism, showOutputGear: !(mechanism.showOutputGear ?? false) } : mechanism)
}, sampleMechanismId);
assert(snapshotOutputGearChanged && snapshotOutputGearChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when showOutputGear changes');
const snapshotOutputGearRadiusChanged = buildMechanismSnapshot({
  ...sample,
  mechanisms: sample.mechanisms.map(mechanism => mechanism.id === sampleMechanismId ? { ...mechanism, outputGearRadius: (mechanism.outputGearRadius ?? 42) + 1 } : mechanism)
}, sampleMechanismId);
assert(snapshotOutputGearRadiusChanged && snapshotOutputGearRadiusChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when outputGearRadius changes');
const snapshotTargetChanged = buildMechanismSnapshot({
  ...sample,
  mechanisms: sample.mechanisms.map(mechanism => mechanism.id === sampleMechanismId ? { ...mechanism, targetAnchorJointId: 'right_elbow' } : mechanism)
}, sampleMechanismId);
assert(snapshotTargetChanged && snapshotTargetChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when target ids change');
if (snapshotA.sourceIds.targetPathId) {
  const pathId = snapshotA.sourceIds.targetPathId;
  const snapshotPathChanged = buildMechanismSnapshot({
    ...sample,
    paths: {
      ...sample.paths,
      [pathId]: {
        ...sample.paths[pathId],
        points: sample.paths[pathId].points.map((point, index) => index === 0 ? { ...point, x: point.x + 1 } : point)
      }
    }
  }, sampleMechanismId);
  assert(snapshotPathChanged && snapshotPathChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when the relevant target path changes');
}
const snapshotKitChanged = buildMechanismSnapshot({
  ...sample,
  settings: {
    ...sample.settings,
    physicalKit: { ...sample.settings.physicalKit, gridPitchMm: sample.settings.physicalKit.gridPitchMm + 1 }
  }
}, sampleMechanismId);
assert(snapshotKitChanged && snapshotKitChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when physical kit changes');
const allMechanismSnapshotProject: ProjectState = {
  ...sample,
  mechanisms: ALL_MECHANISM_TYPES.map(type => ({
    ...createDefaultMechanism(type, `${type}-snapshot`),
    targetPartId: 'right_arm',
    targetPathId: 'path-right-arm',
    targetAnchorJointId: 'right_hand',
    activeVisualPartIds: ['right_arm']
  }))
};
const allMechanismSnapshots = buildMechanismSnapshots(allMechanismSnapshotProject);
assert.equal(allMechanismSnapshots.length, ALL_MECHANISM_TYPES.length, 'snapshot builder covers every mechanism type');
allMechanismSnapshots.forEach(snapshot => {
  assert.equal(snapshot.version, 1, `${snapshot.mechanism.type} snapshot carries schema version`);
  assert(snapshot.fingerprint.startsWith('ms-'), `${snapshot.mechanism.type} snapshot carries a stable fingerprint`);
  assert(Array.isArray(snapshot.fabricationPlan.validationErrors), `${snapshot.mechanism.type} snapshot carries fabrication validation results`);
  assert(snapshot.projectionHints.length > 0 && snapshot.physicsHints.length > 0, `${snapshot.mechanism.type} snapshot carries adapter hints`);
});
assert.equal(buildMechanismSnapshot(sample, 'missing-mechanism'), null, 'missing mechanism snapshot returns null instead of fabricating data');
const controlsText = readFileSync(join(process.cwd(), 'components', 'Controls.tsx'), 'utf8');
const fabricationManifest = JSON.parse(readFileSync(join(process.cwd(), 'fabrication', 'manifest.json'), 'utf8')) as { parts: {
  gears: Array<{ key: string; teeth: number; pitch_radius_mm: number; root_radius_mm: number; outer_radius_mm: number; hole_diameter_mm: number; path: string; attachment_hole_centers_mm: number[][] }>;
  spacers: Array<{ key: string; label: string; path: string; outer_diameter_mm: number; inner_diameter_mm: number; hole_diameter_mm: number; hole_centers_mm: number[][]; stackable: boolean }>;
} };
assert.deepEqual(FABRICATION_GEAR_SPECS.map(spec => ({ key: spec.key, teeth: spec.teeth, pitchRadiusMm: spec.pitchRadiusMm, rootRadiusMm: spec.rootRadiusMm, outerRadiusMm: spec.outerRadiusMm, holeDiameterMm: spec.holeDiameterMm, path: spec.path, attachmentHoleCentersMm: spec.attachmentHoleCentersMm.map(point => [point.x, point.y]) })), fabricationManifest.parts.gears.map(spec => ({ key: spec.key, teeth: spec.teeth, pitchRadiusMm: spec.pitch_radius_mm, rootRadiusMm: spec.root_radius_mm, outerRadiusMm: spec.outer_radius_mm, holeDiameterMm: spec.hole_diameter_mm, path: spec.path, attachmentHoleCentersMm: spec.attachment_hole_centers_mm })), 'runtime gear primitives mirror fabrication/manifest.json');
assert.deepEqual(FABRICATION_SPACER_SPEC, {
  source: 'fabrication/manifest.json',
  key: fabricationManifest.parts.spacers[0].key,
  label: fabricationManifest.parts.spacers[0].label,
  path: fabricationManifest.parts.spacers[0].path,
  outerDiameterMm: fabricationManifest.parts.spacers[0].outer_diameter_mm,
  innerDiameterMm: fabricationManifest.parts.spacers[0].inner_diameter_mm,
  holeDiameterMm: fabricationManifest.parts.spacers[0].hole_diameter_mm,
  holeCentersMm: fabricationManifest.parts.spacers[0].hole_centers_mm.map(point => ({ x: point[0], y: point[1] })),
  stackable: fabricationManifest.parts.spacers[0].stackable
}, 'runtime S10 spacer primitive mirrors fabrication/manifest.json');
assert.equal(fabricationGearSpecForPitchRadius(27).key, 'g24', 'gear display chooses the nearest fabrication preset by physical pitch radius');
const g24Profile = fabricationGearProfileForPitchRadius(60, 30);
assert.equal(g24Profile.source, 'fabrication/manifest.json', 'gear profile declares fabrication source');
assert.equal(g24Profile.preset.key, 'g24', 'gear profile preserves fabrication preset key');
assert.equal(g24Profile.outlinePoints.length, 96, 'G24 profile uses fabrication tooth segmentation, not sparse saw teeth');
assert.equal(g24Profile.attachmentHoleCenters.length, 4, 'G24 profile carries grid attachment holes into shared renderers');
assert(fabricationGearPathD(30, 30).startsWith('M 28.44 0 L 31.43 2.06 L 31.23 4.11'), 'shared SVG gear path matches fabrication gear outline convention');
assert(fabricationRingGearPathD(70).includes('M 90 0 A 90 90'), 'shared SVG ring gear path carries fabrication outer ring geometry');
assert(fabricationRingGearPathD(70).includes('68.54'), 'shared SVG ring gear path carries internal tooth geometry');
const canvasText = readFileSync(join(process.cwd(), 'components', 'Canvas.tsx'), 'utf8');
const threePreviewText = readFileSync(join(process.cwd(), 'components', 'ThreePuppetPreview.tsx'), 'utf8');
const exporterText = readFileSync(join(process.cwd(), 'utils', 'exporter.ts'), 'utf8');
const appText = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
const indexText = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
assert(canvasText.includes('fabricationGearPathD'), '2D canvas gear rendering uses shared fabrication gear geometry');
assert(threePreviewText.includes('fabricationGearProfileForPitchRadius'), '3D foundry gear rendering uses shared fabrication gear geometry');
assert(threePreviewText.includes('fabricationRenderPlanForMechanism'), 'Mechanism Design 3D preview uses the same fabrication stack plan as Foundry');
assert(threePreviewText.includes('data-three-stack-source'), 'Mechanism Design exposes fabrication stack provenance for browser verification');
assert(exporterText.includes('fabricationGearPathD'), 'SVG export gear rendering uses shared fabrication gear geometry');
assert(appText.includes('fabricationGearProfileForPitchRadius'), 'Foundry gear helper uses shared fabrication gear holes/profile');
assert(appText.includes('fabricationRingGearPathD'), '2D Foundry planetary preview uses shared ring gear geometry');
assert(appText.includes('fabricationRingGearProfileForPitchRadius'), '3D Foundry ring uses shared fabrication ring gear geometry');
assert(appText.includes('SHARED_PLAYBACK_STAGES') && appText.includes('!SHARED_PLAYBACK_STAGES.includes(stage)'), 'shared playback rAF only runs on stages that actually consume the animated angle');
assert(appText.includes('FOUNDRY_ANIMATION_COMMIT_MS') && appText.includes('data-three-animation-commit-ms'), 'Foundry exposes a bounded animation commit budget for browser perf tests');
assert(appText.includes("scene.remove(old)") && appText.includes("disposeThreeObject(old)"), 'Foundry disposes noncached dynamic resources when replacing animation groups');
assert(appText.includes('geometryCacheRef') && appText.includes('materialCacheRef'), 'Foundry caches reusable Three geometry/material resources during playback');
assert(appText.includes('foundryCached') && appText.includes('data-three-geometry-cache-size'), 'Foundry tags cached resources and exposes cache size for browser perf tests');
assert(appText.includes('const geom = new THREE.BufferGeometry().setFromPoints(points.map(point => to3(point, z)))'), 'Foundry path/trail line geometry is intentionally not long-cached because it can be phase-dependent');
assert(appText.includes('sweepBounds') && appText.includes('data-three-fit-bounds=\"phase-invariant-sweep\"'), 'Foundry fitting bounds are sampled across the mechanism sweep instead of jittering per animation frame');
assert(appText.includes('data-three-static-grid-mode=\"persistent-scene-layer\"'), 'Foundry grid and plane live in a persistent scene layer, not the per-frame dynamic group');
assert(!appText.includes('starShape'), 'Foundry sandbox no longer carries saw-tooth star gears');
assert(!appText.includes('teeth * 2'), 'Foundry sandbox no longer carries sparse saw-tooth gear implementation');
assert(appText.includes("if (key === 'gearRatio') return false"), 'Foundry hides stale gear-ratio controls when physical pitch radii define rotation');
assert(!canvasText.includes('toothWidth'), '2D canvas no longer carries a separate saw-tooth gear implementation');
assert(!threePreviewText.includes('teeth * 2'), '3D preview no longer carries a separate saw-tooth gear implementation');
assert(threePreviewText.includes('fabricablePartOutlinePoints'), '3D puppet preview uses fabrication-fit part outlines instead of raw image crop rectangles');
assert(threePreviewText.includes('data-three-part-surface="solid-cut-plates"'), '3D puppet preview exposes the solid cut-plate surface contract');
assert(threePreviewText.includes('data-three-part-art="top-texture-decal"'), '3D puppet preview exposes that artwork is rendered on top of plates');
assert(threePreviewText.includes('TextureLoader'), '3D puppet preview loads character part images as surface decals');
assert(threePreviewText.includes('new THREE.ShapeGeometry(shape)'), '3D puppet artwork decals are clipped to fabrication part outlines');
assert(threePreviewText.includes('part-art-decal'), '3D puppet preview names surface decal meshes for browser inspection');
assert(threePreviewText.includes('cut-hole-ring'), '3D puppet preview draws raised joint-hole rings on part surfaces');
assert(threePreviewText.includes('transparent: false, opacity: 1'), '3D puppet body plates are opaque assembled solids, not ghost overlays');
assert(threePreviewText.includes('disposeOwnedMaterials(scene)'), '3D puppet preview disposes owned decal textures on unmount');
assert(designContract.includes('Getting Started is a compact modal dialog'), 'DESIGN.md separates Getting Started from full-screen onboarding');
assert(designContract.includes('The Character tab is functional'), 'DESIGN.md defines Character as a functional editor tab');
assert(appText.includes('splash-dialog') && appText.includes('MotionSmith'), 'first-run welcome is a logo-only splash dialog');
assert(appText.includes('readStorageWithLegacy') && appText.includes('migrateStorageValue'), 'MotionSmith storage rename keeps legacy autosave/workspace migration hooks');
assert(!appText.includes('MOTIONSMITH_VIDEO_URL'), 'welcome splash does not embed the old preview video');
assert(appText.includes('getting-started-dialog') && appText.includes('getting-started-gallery'), 'Getting Started is an explicit compact starter dialog');
assert(appText.includes('Pick a starter, then tune it in Character.'), 'Getting Started copy routes users into the Character tab');
assert(appText.includes('setShowGettingStarted(!hideNextTime)'), 'Start opens Getting Started unless the splash is hidden for next time');
assert(appText.includes('onOpenGettingStarted'), 'Character tab can reopen Getting Started without owning its starter gallery');
assert(!appText.includes('Start with character art'), 'Character tab no longer carries the old hero/onboarding copy');
assert(!indexText.includes('.onboarding-page'), 'CSS no longer keeps a full-screen onboarding page mode');
assert(!indexText.includes('.welcome-simple'), 'CSS no longer keeps the old welcome video layout');
assert(appText.includes('character-setup-panel'), 'Character tab exposes direct part settings instead of only getting-started cards');
assert(appText.includes('character-part-list') && appText.includes('character-part-item-${part.id}'), 'Character tab owns body-part selection in the left workflow pane');
assert(appText.includes('viewport={viewport} testId="character-three-puppet"'), 'Character preview uses the shared canvas viewport instead of a detached default viewport');
assert(appText.includes("setStage('character')"), 'Character edit controls stay in the functional Character tab');
assert(appText.includes('Art width') && appText.includes('Art offset X'), 'Character part inspector exposes artwork extent and offset controls');
assert(appText.includes('data-testid={`path-part-art-${part.id}`}') && appText.includes('part.bounds.x * part.transform.scale'), 'Path Editor renders artwork from the editable part bounds offset');
assert(canvasText.includes('data-testid={`design-part-art-${part.id}`}') && canvasText.includes('part.bounds.x * part.transform.scale'), 'Mechanism Design renders artwork from the same editable part bounds offset');
assert(appText.includes('partOutlinePathD(part, landmarks') && appText.includes('path-part-surface-mask'), 'Path Editor clips part art to the shared fabrication outline and hole mask');
assert(canvasText.includes('partOutlinePathD(part, landmarks') && canvasText.includes('design-part-surface-mask'), 'Mechanism Design clips part art to the shared fabrication outline and hole mask');
assert(appText.includes('Accept or discard the reviewed package before fine-tuning part artwork'), 'Character tab disables active-project artwork edits while a package review is pending');
assert(appText.includes('disabled={partPanelDisabled} onClick={onEditCharacter}'), 'Pending package review disables active-character edit buttons');
assert(appText.includes('disabled={partPanelDisabled} onClick={onSaveSkeleton}'), 'Pending package review disables active skeleton save controls');
assert(appText.includes('stage-body editor-workbench relative min-h-0 flex-1 overflow-hidden'), 'shared workbench prevents right-pane scroll from moving the center canvas');
assert(appText.includes('const [showSensemaking, setShowSensemaking] = useState(false)'), 'Foundry starts in compact tinkerable mode with sensemaking collapsed');
assert(appText.includes('compact-fabrication-stack') && appText.includes('data-testid="foundry-fabrication-stack"'), 'Foundry keeps fabrication stack visible as a compact action datum');
const blueprintCanvasStart = appText.indexOf('canvas: canvasPane(<div className="path-canvas-shell canvas-workspace overflow-hidden p-0" data-testid="blueprint-canvas-preview">');
const blueprintInspectorStart = appText.indexOf('inspector: inspectorPane(<section className="stage-pane-stack" data-testid="assembly-guide-preview">', blueprintCanvasStart);
assert(blueprintCanvasStart >= 0 && blueprintInspectorStart > blueprintCanvasStart, 'Blueprint layout exposes parseable canvas and inspector slots');
const blueprintCanvasBlock = appText.slice(blueprintCanvasStart, blueprintInspectorStart);
const blueprintInspectorBlock = appText.slice(blueprintInspectorStart, appText.indexOf('        }}', blueprintInspectorStart));
assert(!blueprintCanvasBlock.includes('assembly-guide-web-preview'), 'Blueprint center canvas does not embed the printable guide document');
assert(blueprintInspectorBlock.includes('assembly-guide-web-preview'), 'Blueprint printable guide preview lives in the right inspector');
const oversizedCutPart: BodyPartLayer = {
  id: 'right_arm_lower',
  name: 'Right lower arm',
  anchorJointId: 'right_elbow',
  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  zIndex: 0,
  opacity: 1,
  visible: true,
  locked: false,
  selectable: true,
  bounds: { x: -250, y: -250, width: 500, height: 500 },
  fillColor: '#cbd5e1'
};
const oversizedLocalJoints = [{ x: 0, y: 84 }, { x: 0, y: -84 }];
const oversizedOutlineBounds = partOutlineBounds(fabricablePartOutlinePoints(oversizedCutPart, oversizedLocalJoints));
assert(oversizedOutlineBounds.width < 90 && oversizedOutlineBounds.height < 260, 'fabrication-fit outline follows the limb joint chain rather than the full raw ONNX crop');
const sampleWideArm: BodyPartLayer = { ...oversizedCutPart, transform: { x: 0, y: 0, rotation: 0, scale: 1 }, anchorJointId: 'right_elbow' };
assert.deepEqual(partLandmarkJointIds(sampleWideArm, sample.skeleton), ['right_elbow', 'right_hand'], 'oversized lower-arm crop selects only the intended elbow/hand landmarks');
const productionArmLandmarks = partLandmarkLocalPoints(sampleWideArm, sample.skeleton);
const productionArmOutline = fabricablePartOutlinePoints(sampleWideArm, productionArmLandmarks);
const productionArmBounds = partOutlineBounds(productionArmOutline);
assert(productionArmLandmarks.length === 2, 'production 3D outline path ignores unrelated joints inside an oversized ONNX crop');
assert(productionArmBounds.width < 120 && productionArmBounds.height < 140, 'production lower-arm outline stays limb-sized even when the crop contains the full character');
assert(productionArmLandmarks.every(point => pointInsideOutline(point, productionArmOutline, 0.5)), '3D puppet only cuts joint holes inside the generated part outline');
const torsoCutPart: BodyPartLayer = { ...oversizedCutPart, id: 'torso', name: 'Torso', anchorJointId: 'torso' };
const torsoOutlineBounds = partOutlineBounds(fabricablePartOutlinePoints(torsoCutPart, [{ x: -70, y: 90 }, { x: 70, y: 90 }, { x: -42, y: -74 }, { x: 42, y: -74 }, { x: 0, y: 16 }]));
assert(torsoOutlineBounds.width < 230 && torsoOutlineBounds.height < 250, 'torso fabrication outline is compact around skeleton landmarks rather than a background image slab');
assert(controlsText.includes('mechanismTemplateLabel'), 'legacy Controls uses shared mechanism registry labels');
assert(!controlsText.includes('Drawing Machine'), 'legacy Controls no longer hardcodes stale mechanism labels');
assert(!controlsText.includes("m.type === '5bar' ? '5-Bar'"), 'legacy Controls active mechanism chips use shared labels');
assert(!controlsText.includes("m.type === 'crank' ? 'Gear'"), 'legacy Controls no longer aliases crank as gear');
assert.equal(describeMotionChain(sample, 'right_arm', 'right_shoulder').kind, 'root-only', 'root anchor is labeled as a root-only chain');
assert.equal(describeMotionChain(sample, 'right_arm', 'right_elbow').kind, 'two-joint-direct', 'elbow handle is labeled as a 2-joint direct chain');
assert.equal(describeMotionChain(sample, 'right_arm', 'right_hand').kind, 'three-joint-ik', 'hand handle is labeled as a 3-joint IK chain');
const directPinnedPreview = motionPreviewForTarget(sample, 'right_arm', 'right_elbow', { x: 210, y: 40 }, { parts: {}, skeleton: sample.skeleton }, { pinTarget: true });
const directPinnedElbow = directPinnedPreview.skeleton?.joints.right_elbow.position;
assert(directPinnedElbow && Math.hypot(directPinnedElbow.x - 210, directPinnedElbow.y - 40) < 1e-9, '2-joint direct mechanism drive pins the handle exactly');
const directPreview = motionPreviewForTarget(sample, 'right_arm', 'right_elbow', { x: 210, y: 40 }, { parts: {}, skeleton: sample.skeleton }, { pinTarget: false });
const directPreviewElbow = directPreview.skeleton?.joints.right_elbow.position;
assert(directPreviewElbow && Math.hypot(directPreviewElbow.x - 210, directPreviewElbow.y - 40) > 1, '2-joint direct path preview preserves non-pinned limb length');
const rightBendProject = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_elbow', updates: { bendDirection: 1 } });
const leftBendProject = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_elbow', updates: { bendDirection: -1 } });
const rightBendPreview = motionPreviewForTarget(rightBendProject, 'right_arm', 'right_hand', { x: 180, y: 90 }, { parts: {}, skeleton: rightBendProject.skeleton }, { pinTarget: true });
const leftBendPreview = motionPreviewForTarget(leftBendProject, 'right_arm', 'right_hand', { x: 180, y: 90 }, { parts: {}, skeleton: leftBendProject.skeleton }, { pinTarget: true });
const rightBendElbow = rightBendPreview.skeleton?.joints.right_elbow.position;
const leftBendElbow = leftBendPreview.skeleton?.joints.right_elbow.position;
assert(rightBendElbow && leftBendElbow && Math.hypot(rightBendElbow.x - leftBendElbow.x, rightBendElbow.y - leftBendElbow.y) > 1, '3-joint IK fold direction changes elbow/knee side');
const multiJointProject = applyProjectAction(sample, { type: 'add_joint', joint: { id: 'right_finger_tip', name: 'right finger tip', position: { x: 174, y: 30 }, parentId: 'right_hand', locked: false, bendDirection: 1 } });
assert.equal(describeMotionChain(multiJointProject, 'right_arm', 'right_finger_tip').kind, 'multi-joint', '4+ joint limbs are labeled as multi-joint IK');
const multiPreview = motionPreviewForTarget(multiJointProject, 'right_arm', 'right_finger_tip', { x: 205, y: 84 }, { parts: {}, skeleton: multiJointProject.skeleton }, { pinTarget: true });
assert(Number.isFinite(multiPreview.skeleton?.joints.right_finger_tip.position.x) && Number.isFinite(multiPreview.skeleton?.joints.right_finger_tip.position.y), 'multi-joint IK preview stays finite');
const boundMechanism = (type: Parameters<typeof createDefaultMechanism>[0], id: string) => ({
  ...createDefaultMechanism(type, id),
  targetPartId: 'right_arm',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_shoulder',
  activeVisualPartIds: ['right_arm']
});
const roundTrip = loadProjectSnapshot(JSON.parse(serializeProject(sample)));
assert.equal(roundTrip.partOrder.length, sample.partOrder.length, 'project JSON round-trip keeps parts');
assert.equal(roundTrip.mechanisms.length, sample.mechanisms.length, 'project JSON round-trip keeps mechanisms');
assert.equal(roundTrip.mechanisms[0].assemblyMode, sample.mechanisms[0].assemblyMode, 'project JSON round-trip keeps explicit 4bar assembly branch');
assert.equal(loadProjectSnapshot({ mechanisms: [{ ...createDefaultMechanism('4bar', 'crossed-load'), assemblyMode: 'crossed' }] }).mechanisms[0].assemblyMode, 'crossed', 'project import preserves crossed 4bar assembly branch');

const originBoard = sceneToBoard({ x: 0, y: 0 }, sample.settings.physicalKit);
assert.equal(originBoard.label, 'H8', 'scene origin maps to centered 15x15 board H8');
const sheetRoundTrip = sheetMmToScene(sceneToSheetMm({ x: 40, y: -80 }, sample.settings.physicalKit), sample.settings.physicalKit);
assert(Math.hypot(sheetRoundTrip.x - 40, sheetRoundTrip.y + 80) < 1e-9, 'scene/sheet transform round-trips');
const boardRoundTrip = boardToScene(originBoard.col, originBoard.row, sample.settings.physicalKit);
assert.deepEqual(boardRoundTrip, { x: 0, y: 0 }, 'board center round-trips');

const twoFourBars = {
  ...sample,
  mechanisms: [boundMechanism('4bar', 'a'), { ...boundMechanism('4bar', 'b'), targetAnchorJointId: 'right_elbow' }]
};
const pkg = createFabricationPackage(twoFourBars);
assert.equal(pkg.recipes.length, 2, 'duplicate same-type mechanisms create separate recipes');
assert(pkg.sceneSnapshot.skeleton, 'fabrication snapshot includes skeleton');
assert(pkg.cutSheetPdf.startsWith('%PDF-') && pkg.cutSheetPdf.includes('Cut sheet'), 'fabrication package includes a real PDF cut sheet artifact');
assert(pkg.assemblyGuidePdf.startsWith('%PDF-'), 'fabrication package includes a PDF assembly artifact');
assert(pkg.customPartsSvg.startsWith('<svg') && pkg.customPartsSvg.includes('custom-parts'), 'fabrication package includes custom parts SVG artifact');
assert(pkg.customPartsPdf.startsWith('%PDF-'), 'fabrication package includes custom parts PDF artifact');
assert(pkg.customPartsStl.startsWith('solid motionsmith_custom_parts'), 'fabrication package includes custom parts STL artifact');
assert(pkg.customPartsStl.includes('mm_holes') && (pkg.customPartsStl.match(/facet normal/g) ?? []).length > 100, 'custom parts STL meshes extruded plates with joint-hole voids');
assert(pkg.metadataJson.includes('validationIssues'), 'fabrication metadata includes structured validation issues');
assert(pkg.recipes.every(r => r.requiredParts.length > 0), 'fabrication recipes include explicit required parts');
assert.deepEqual(pkg.recipes[0].requiredParts, mechanismRequiredParts(twoFourBars.mechanisms[0]), 'recipe required parts mirror mechanism metadata defaults');
assert(pkg.recipes[0].requiredParts.some(part => part.name === FABRICATION_SPACER_SPEC.label), 'required parts name the S10 spacer explicitly');
assert(pkg.recipes[0].assemblySteps.some(step => step.instruction.includes('pre-fabricated')), 'prefab board workflow starts from a beginner prebuilt module');
assert(pkg.recipes[0].assemblySteps.some(step => step.label === FABRICATION_SPACER_SPEC.label && step.instruction.includes('Insert')), 'prefab board workflow calls out S10 spacer insertion');
assert(pkg.metadataJson.includes('assemblySteps'), 'fabrication metadata includes structured kit assembly steps');

ALL_MECHANISM_TYPES.forEach(type => {
  const stack = fabricationStackForMechanism({ type });
  assert.equal(validateFabricationStack(stack).join('; '), '', `${type} fabrication stack obeys clip/layer/spacer/layer/clip invariant`);
  assert.equal(stack[0].role, 'clip', `${type} moving stack starts with a clip`);
  assert.equal(stack.at(-1)?.role, 'clip', `${type} moving stack ends with a clip`);
  assert(!stack.some(layer => layer.role === 'base'), `${type} moving stack excludes the base board`);
  assert(stack.filter(layer => layer.role === 'spacer').every(layer => layer.label === FABRICATION_SPACER_SPEC.label), `${type} stack uses the S10 spacer convention`);
  const moving = (role: string) => !['clip', 'spacer', 'base'].includes(role);
  stack.slice(1, -1).forEach((layer, index, middle) => {
    const next = index < middle.length - 1 ? middle[index + 1] : stack.at(-1);
    assert(!(moving(layer.role) && next && moving(next.role)), `${type} stack separates adjacent moving layers with spacers`);
  });
  const plan = fabricationRenderPlanForMechanism({ type });
  assert.equal(plan.validationErrors.join('; '), '', `${type} render plan is validated against fabrication stack`);
  assert.equal(plan.base.label, 'Base board', `${type} render plan keeps base board separate`);
  assert.deepEqual(plan.layers.map(layer => layer.label), stack.map(layer => layer.label), `${type} render plan labels mirror fabrication stack`);
  assert.deepEqual(plan.layers.map(layer => layer.role), stack.map(layer => layer.role), `${type} render plan roles mirror fabrication stack`);
  assert.deepEqual(plan.layers.map(layer => layer.color), stack.map(layer => layer.color), `${type} render plan colors mirror fabrication stack`);
  assert(plan.layers.every(layer => layer.source === 'fabrication-stack'), `${type} render layers declare fabrication stack source`);
  const zValues = plan.layers.map(layer => layer.z);
  assert.deepEqual(zValues, [...zValues].sort((a, b) => a - b), `${type} render plan z order follows stack order`);
});

const assertFiniteDeep = (value: unknown, label: string): void => {
  if (typeof value === 'number') {
    assert(Number.isFinite(value), `${label} is finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteDeep(item, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => assertFiniteDeep(child, `${label}.${key}`));
  }
};
const projectionProject = applyProjectAction(sample, { type: 'set_export', fabricationPackage: createFabricationPackage(sample) });
const projectionBeforeJson = JSON.stringify(projectionProject);
const projectionBeforeUpdatedAt = projectionProject.metadata.updatedAt;
const projectionBeforeExport = projectionProject.lastExport;
const projection = buildToonSceneProjection(projectionProject);
assert.equal(JSON.stringify(projectionProject), projectionBeforeJson, 'toon projection does not mutate serialized ProjectState');
assert.equal(projectionProject.metadata.updatedAt, projectionBeforeUpdatedAt, 'toon projection does not touch metadata.updatedAt');
assert.equal(projectionProject.lastExport, projectionBeforeExport, 'toon projection does not invalidate lastExport');
assert.deepEqual(buildToonSceneProjection(projectionProject), projection, 'toon projection is deterministic');
assert.equal(projection.version, 1, 'toon projection exposes schema version');
assert.equal(projection.units.scene, 'px', 'toon projection documents scene units');
assert.equal(projection.units.depth, 'mm', 'toon projection documents depth units');
assert.equal(projection.units.scenePxPerMm, SCENE_PX_PER_MM, 'toon projection uses shared scene/mm bridge');
assert.deepEqual(projection.coordinateSystem, { x: 'right', y: 'up', z: 'toward-camera-depth' }, 'toon projection documents axis mapping');
assert(projection.nodes.some(node => node.id === '/board/sheet' && node.sourceType === 'board'), 'toon projection includes board sheet node');
assert(sample.partOrder.filter(id => sample.parts[id].visible !== false).every(id => projection.nodes.some(node => node.id === `/character/${id}` && node.sourceType === 'part' && node.sourceId === id)), 'toon projection includes every visible body part');
assert(Object.keys(sample.skeleton?.joints ?? {}).every(id => projection.nodes.some(node => node.id === `/skeleton/${id}` && node.sourceType === 'joint' && node.sourceId === id)), 'toon projection includes every skeleton joint');
const sampleBoneIds = new Set((sample.skeleton?.bones ?? []).map(([parentId, childId]) => `${parentId}->${childId}`));
assert([...sampleBoneIds].every(id => projection.nodes.some(node => node.sourceType === 'bone' && node.sourceId === id)), 'toon projection includes every skeleton bone with tuple sourceId');
projection.nodes.filter(node => node.sourceType === 'bone').forEach(node => {
  const [parentId, childId] = (node.sourceId ?? '').split('->');
  assert(sample.skeleton?.joints[parentId] && sample.skeleton?.joints[childId] && sampleBoneIds.has(node.sourceId ?? ''), 'bone sourceId maps to a real skeleton bone tuple');
});
Object.values(sample.paths).filter(path => path.visible && path.points.length).forEach(path => {
  assert(projection.nodes.some(node => node.id === `/paths/${path.id}` && node.sourceType === 'path' && node.sourceId === path.id), 'toon projection includes visible motion path');
});
sample.mechanisms.filter(mechanism => mechanism.visible && mechanism.enabled !== false).forEach(mechanism => {
  assert(projection.nodes.some(node => node.id === `/mechanisms/${mechanism.id}/base` && node.sourceType === 'mechanism' && node.sourceId === mechanism.id), 'toon projection includes mechanism base');
  assert(projection.nodes.some(node => node.id === `/mechanisms/${mechanism.id}/output` && node.sourceType === 'mechanism' && node.sourceId === mechanism.id), 'toon projection includes mechanism output');
});
projection.nodes.forEach(node => {
  assert(node.id.trim().length > 0, 'projection node ids are non-empty stable paths');
  assertFiniteDeep(node.geometry, `${node.id}.geometry`);
  assertFiniteDeep(node.transform2d, `${node.id}.transform2d`);
  assert(Number.isFinite(node.depthMm) && Number.isFinite(node.thicknessMm) && Number.isFinite(node.renderOrder), 'projection node depth/thickness/order are finite');
});
const sourceMapProject = projectionProject;
const mechanismIds = new Set(sourceMapProject.mechanisms.map(mechanism => mechanism.id));
projection.nodes.forEach(node => {
  if (node.sourceType === 'part') assert(node.sourceId && sourceMapProject.parts[node.sourceId], 'part node maps to canonical part');
  if (node.sourceType === 'joint') assert(node.sourceId && sourceMapProject.skeleton?.joints[node.sourceId], 'joint node maps to canonical joint');
  if (node.sourceType === 'path') assert(node.sourceId && sourceMapProject.paths[node.sourceId], 'path node maps to canonical path');
  if (node.sourceType === 'mechanism') assert(node.sourceId && mechanismIds.has(node.sourceId), 'mechanism node maps to canonical mechanism');
  if (node.sourceType === 'bone') assert(node.sourceId && sampleBoneIds.has(node.sourceId), 'bone node maps to canonical skeleton bone tuple');
});
const renderOrders = projection.nodes.map(node => node.renderOrder);
assert.deepEqual(renderOrders, [...renderOrders].sort((a, b) => a - b), 'projection renderOrder is sorted and deterministic');
assert(projection.labels.every(label => label.id && label.text && 'x' in label.anchorPoint && 'y' in label.anchorPoint), 'projection labels follow minimum schema');
assert(projection.cameras.some(camera => camera.id === 'locked-2.5d' && camera.label === '2.5D Locked' && camera.locked && !camera.orbitEnabled), 'projection includes locked authoring camera');
assert(projection.cameras.some(camera => camera.id === 'toy-stage' && camera.label === 'Toy Stage' && !camera.locked && camera.orbitEnabled), 'projection includes toy-stage camera unlock preset');
projection.cameras.forEach(camera => assertFiniteDeep(camera, `camera.${camera.id}`));
assert(projection.interactions.some(binding => binding.type === 'draw-path-on-plane' && binding.enabled && binding.writesProject), 'projection exposes canonical plane path drawing interaction');
assert(projection.interactions.some(binding => binding.type === 'select-source' && binding.enabled && !binding.writesProject), 'projection exposes source selection interactions as view-only');
assert(projection.interactions.some(binding => binding.type === 'pan-zoom-locked-camera' && binding.enabled && !binding.writesProject), 'projection exposes locked pan/zoom as view-only');
assert(projection.interactions.some(binding => binding.type === 'unlock-camera' && binding.enabled && !binding.writesProject), 'projection exposes camera unlock as view-only');
const bakeInteraction = projection.interactions.find(binding => binding.type === 'bake-3d-transform');
assert(bakeInteraction && !bakeInteraction.enabled && !bakeInteraction.writesProject && bakeInteraction.reason, '3D transform bake is disabled and cannot mutate project by default');
const physicsBeforeJson = JSON.stringify(projectionProject);
const physicsSession = buildKinematicPhysicsSession(projectionProject, projection, Math.PI / 3);
assert.equal(JSON.stringify(projectionProject), physicsBeforeJson, 'physics session does not mutate ProjectState');
assert.deepEqual(buildKinematicPhysicsSession(projectionProject, projection, Math.PI / 3), physicsSession, 'physics session is deterministic for the same projection and angle');
assert.equal(physicsSession.version, 1, 'physics session exposes schema version');
assert.equal(physicsSession.sourceProjectionVersion, projection.version, 'physics session records projection schema source');
assert(physicsSession.summary.bodyCount >= projection.nodes.filter(node => ['part', 'joint', 'mechanism', 'hardware'].includes(node.sourceType)).length, 'physics session creates bodies from projected scene nodes');
assert(physicsSession.summary.constraintCount >= projectionProject.mechanisms.filter(mechanism => mechanism.visible && mechanism.enabled !== false).length, 'physics session samples mechanism constraints');
assert(physicsSession.bodies.some(body => body.sourceType === 'mechanism-state' && body.label.includes('effector')), 'physics session includes kinematic end-effector samples');
assert(physicsSession.summary.maxSpeed > 0, 'physics session derives non-zero kinematic velocity from the current mechanism animation');
assert(physicsSession.summary.maxForce > 0, 'physics session derives non-zero acceleration/force from the current mechanism animation');
assert.equal(physicsSession.summary.frictionCoefficient, sample.settings.simulationFriction, 'physics session records project friction');
assert.equal(physicsSession.summary.massKg, sample.settings.simulationMassKg, 'physics session records project mass');
assert(physicsSession.summary.maxConstraintError >= 0, 'physics session reports mechanism constraint error');
assertFiniteDeep(physicsSession, 'physicsSession');
const warningProjection = buildToonSceneProjection({ ...sample, mechanisms: [{ ...sample.mechanisms[0], warnings: ['projection warning'] }] });
assert(warningProjection.warnings.some(warning => warning.message === 'projection warning' && warning.sourceType === 'mechanism' && warning.recoveryStage === 'design'), 'projection warning maps to source and recovery stage');
assert(warningProjection.labels.some(label => label.text === 'projection warning' && label.severity === 'warning'), 'projection creates warning label chips');
const warningLabel = warningProjection.labels.find(label => label.text === 'projection warning');
const warningSourceNode = warningLabel?.anchorNodeId ? warningProjection.nodes.find(node => node.id === warningLabel.anchorNodeId) : undefined;
assert(warningLabel && warningSourceNode && (warningLabel.anchorPoint.x !== 0 || warningLabel.anchorPoint.y !== 0), 'projection warning labels anchor to their source node instead of stacking at origin');
const sceneAnchorOnlyMechanism = {
  ...createDefaultMechanism('crank', 'scene-anchor-only'),
  anchorX: undefined,
  anchorY: undefined,
  sceneAnchor: { x: 77, y: -33 },
  transform: { x: 77, y: -33, rotation: 0, scale: 1 },
  targetPartId: 'right_arm',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand'
};
const sceneAnchorProjection = buildToonSceneProjection({ ...sample, mechanisms: [sceneAnchorOnlyMechanism] });
const sceneAnchorBase = sceneAnchorProjection.nodes.find(node => node.id === '/mechanisms/scene-anchor-only/base');
const sceneAnchorOutput = sceneAnchorProjection.nodes.find(node => node.id === '/mechanisms/scene-anchor-only/output');
assert(sceneAnchorBase?.geometry.kind === 'circle' && sceneAnchorOutput?.geometry.kind === 'circle', 'sceneAnchor-only mechanism projects base and output circles');
assert.deepEqual(sceneAnchorBase.geometry.center, sceneAnchorOnlyMechanism.sceneAnchor, 'projection base uses resolved sceneAnchor');
assert.equal(sceneAnchorOutput.geometry.center.x, sceneAnchorOnlyMechanism.sceneAnchor.x + sceneAnchorOnlyMechanism.crankLength, 'projection linkage uses the same resolved sceneAnchor for kinematics');
assert.equal(sceneAnchorOutput.geometry.center.y, sceneAnchorOnlyMechanism.sceneAnchor.y, 'projection linkage does not fall back to origin when anchorX/Y are absent');
const disabledMechanismProject = {
  ...sample,
  mechanisms: [
    boundMechanism('4bar', 'enabled-one'),
    { ...boundMechanism('4bar', 'disabled-one'), enabled: false },
    { ...boundMechanism('4bar', 'hidden-one'), visible: false }
  ]
};
assert.equal(createFabricationPackage(disabledMechanismProject).recipes.length, 1, 'fabrication exports only visible enabled mechanisms');
assert.equal(loadProjectSnapshot(disabledMechanismProject).mechanisms[1].enabled, false, 'project import preserves disabled mechanism state');
const disabledDxf = generateDXF({ speed: 1, rotation: 0, mechanisms: disabledMechanismProject.mechanisms }, 0);
assert(disabledDxf.includes('ENABLED-ONE'.replace(/[^A-Za-z0-9_-]/g, '_')), 'DXF includes enabled mechanism');
assert(!disabledDxf.includes('DISABLED-ONE'.replace(/[^A-Za-z0-9_-]/g, '_')), 'DXF excludes disabled mechanism');
ALL_MECHANISM_TYPES.forEach(type => {
  const mechanism = createDefaultMechanism(type, `contract-${type}`);
  [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    [state.p1, state.p2, state.j1, state.j2, state.aux, state.effector].filter(Boolean).forEach(point => {
      assert(Number.isFinite(point!.x) && Number.isFinite(point!.y), `${type} animation keeps finite coordinates`);
    });
  });
  assert(generateCurvePoints(mechanism, 24).points.length > 0, `${type} generates an output motion path`);
  const templateProject = {
    ...sample,
    mechanisms: [mechanismWithGeneratedPath({
      ...mechanism,
      targetPartId: 'right_arm',
      targetPathId: 'path-right-arm',
      targetAnchorJointId: 'right_hand',
      activeVisualPartIds: ['right_arm']
    })]
  };
  const templateProjection = buildToonSceneProjection(templateProject);
  const templateLabel = mechanismTemplateLabel(type);
  assert(templateProjection.nodes.some(node => node.sourceType === 'mechanism' && node.sourceId === mechanism.id && node.label.includes(templateLabel)), `${type} projects 2.5D nodes with shared template labels`);
  assert(templateProjection.nodes.some(node => node.sourceType === 'hardware' && node.parentId === `/mechanisms/${mechanism.id}/base` && node.label.includes(templateLabel)), `${type} projects a mechanism hardware preview`);
  const templatePhysics = buildKinematicPhysicsSession(templateProject, templateProjection, Math.PI / 4);
  assert(templatePhysics.bodies.some(body => body.mechanismId === mechanism.id && body.sourceType === 'mechanism-state'), `${type} creates physics mechanism-state bodies`);
  assert(templatePhysics.constraints.some(constraint => constraint.mechanismId === mechanism.id), `${type} creates physics mechanism constraints`);
  const constraintLabels = templatePhysics.constraints.filter(constraint => constraint.mechanismId === mechanism.id).map(constraint => constraint.label).join(' | ');
  const expectedConstraint = ({
    cam: 'cam follower contact',
    'rack-pinion': 'rack linear guide',
    gear: 'gear pitch mesh tangent',
    planetary_gear: 'planet gear mesh',
    piston: 'slider guide',
    yoke: 'pin-in-slot guide',
    'quick-return': 'slotted-arm guide',
    '5bar': 'right crank phase rod',
    '4bar': 'coupler length',
    crank: 'crank length'
  } as Record<string, string>)[type];
  assert(constraintLabels.includes(expectedConstraint), `${type} exposes a type-specific physics constraint (${expectedConstraint})`);
  assert(templatePhysics.summary.maxSpeed >= 0 && templatePhysics.summary.maxForce >= 0, `${type} exports velocity and force magnitudes`);
  assert(templatePhysics.summary.maxConstraintError < 1e-6, `${type} physics constraints match the sampled kinematic pose`);
  assertFiniteDeep(templatePhysics, `${type}.templatePhysics`);
});

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const assertDistance = (a: { x: number; y: number }, b: { x: number; y: number }, expected: number, label: string, epsilon = 1e-6) => {
  assert(Math.abs(distance(a, b) - expected) < epsilon, label);
};
const localTrack = (mechanism: ReturnType<typeof createDefaultMechanism>, point: { x: number; y: number }) => {
  const angle = ((mechanism.groundAngle ?? 0) * Math.PI) / 180;
  const dx = point.x - (mechanism.anchorX ?? 0);
  const dy = point.y - (mechanism.anchorY ?? 0);
  return {
    x: dx * Math.cos(-angle) - dy * Math.sin(-angle),
    y: dx * Math.sin(-angle) + dy * Math.cos(-angle)
  };
};
const requiredPartNames = (type: Parameters<typeof createDefaultMechanism>[0]) =>
  mechanismRequiredParts(createDefaultMechanism(type, `parts-${type}`)).map(part => part.name);

{
  const mechanism = createDefaultMechanism('4bar', 'contract-4bar-physical');
  const state = calculateLinkage(mechanism, 0);
  assert(state.isValid, '4bar default has a valid sampled assembly pose');
  assertDistance(state.p1, state.j1, mechanism.crankLength, '4bar crank length is preserved');
  assertDistance(state.j1, state.j2, mechanism.couplerLength, '4bar coupler length is preserved');
  assertDistance(state.p2, state.j2, mechanism.rockerLength, '4bar rocker length is preserved');
  assert(state.j2.y > state.p1.y, '4bar default uses the front/open assembly branch instead of the crossed underside branch');
  const negativeOutputAngleState = calculateLinkage({ ...mechanism, couplerPointAngle: -40 }, 0);
  assert(negativeOutputAngleState.isValid, '4bar remains valid when the coupler output angle is negative');
  assert(negativeOutputAngleState.j2.y > negativeOutputAngleState.p1.y, '4bar assembly branch is independent of output-point angle');
  assert(requiredPartNames('4bar').includes('4bar linkage plate'), '4bar recipe includes its linkage plate');
}

{
  const mechanism = createDefaultMechanism('piston', 'contract-piston-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid, 'piston default has valid slider-crank samples');
    assertDistance(state.p1, state.j1, mechanism.crankLength, 'piston crank length is preserved');
    assertDistance(state.j1, state.j2, mechanism.couplerLength, 'piston connecting rod length is preserved');
    assert(Math.abs(localTrack(mechanism, state.j2).y - mechanism.sliderOffset) < 1e-6, 'piston slider stays on its guide offset');
  });
  assert(requiredPartNames('piston').includes('slider guide'), 'piston recipe includes a slider guide');
}

{
  const mechanism = createDefaultMechanism('yoke', 'contract-yoke-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid, 'scotch yoke default has valid pin-in-slot samples');
    assert(Math.abs(localTrack(mechanism, state.j2).x - localTrack(mechanism, state.j1).x) < 1e-6, 'scotch yoke slider follows crank pin x along the slot');
    assert(Math.abs(localTrack(mechanism, state.j2).y - mechanism.sliderOffset) < 1e-6, 'scotch yoke slider stays on its guide offset');
  });
  assert(requiredPartNames('yoke').includes('slider guide'), 'scotch yoke recipe includes a slider guide');
}

{
  const mechanism = createDefaultMechanism('quick-return', 'contract-quick-return-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid, 'quick-return default has valid sampled poses');
    assertDistance(state.p1, state.j1, mechanism.crankLength, 'quick-return driver crank length is preserved');
    assertDistance(state.p2, state.j2, mechanism.rockerLength, 'quick-return slotted rocker length is preserved');
  });
  assert(requiredPartNames('quick-return').includes('quick-return linkage plate'), 'quick-return recipe includes its linkage plate');
}

{
  const mechanism = createDefaultMechanism('5bar', 'contract-5bar-physical');
  [0, Math.PI / 2].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid && state.aux, '5bar default has valid two-crank sampled poses');
    assertDistance(state.p1, state.j1, mechanism.crankLength, '5bar first crank length is preserved');
    assertDistance(state.p2, state.aux!, mechanism.rockerLength, '5bar second crank length is preserved');
    assertDistance(state.j1, state.j2, mechanism.couplerLength, '5bar first rod length is preserved');
    assertDistance(state.aux!, state.j2, mechanism.rodLength!, '5bar second rod length is preserved');
  });
  assert(requiredPartNames('5bar').includes('matched gear'), '5bar recipe includes matched gears');
}

{
  const mechanism = createDefaultMechanism('cam', 'contract-cam-physical');
  const low = calculateLinkage(mechanism, 0);
  const high = calculateLinkage(mechanism, Math.PI);
  assert(low.isValid && high.isValid, 'cam follower default has valid lift samples');
  assert.deepEqual(low.j2, low.effector, 'cam follower output is the follower block');
  assert.deepEqual(high.j2, high.effector, 'cam follower lifted output remains the follower block');
  const liftLength = Math.max(1, mechanism.rockerLength || mechanism.crankLength);
  assert(Math.abs(camFollowerRise(liftLength, Math.PI) - liftLength) < 1e-6, 'cam follower full lift comes from the shared cam profile');
  assert(camProfileScale(Math.PI) > camProfileScale(0), 'rendered cam profile has the same high-lift lobe used by kinematics');
  assert(localTrack(mechanism, high.j2).x > localTrack(mechanism, low.j2).x, 'cam follower lift increases along the guide');
  assert(requiredPartNames('cam').includes('cam disk'), 'cam recipe includes a cam disk');
  assert(requiredPartNames('cam').includes('follower guide'), 'cam recipe includes a follower guide');
}

{
  const mechanism = createDefaultMechanism('rack-pinion', 'contract-rack-pinion-physical');
  const low = calculateLinkage(mechanism, 0);
  const high = calculateLinkage(mechanism, Math.PI);
  assert(low.isValid && high.isValid, 'rack-pinion default has valid pinion/rack samples');
  assertDistance(low.p1, low.j1, mechanism.crankLength, 'rack-pinion pinion pitch radius is preserved');
  assert(Math.abs(Math.atan2(high.j1.y - high.p1.y, high.j1.x - high.p1.x) - Math.PI) < 1e-6, 'rack-pinion pinion index visibly rotates with input angle');
  assert(Math.abs(localTrack(mechanism, low.j2).y - mechanism.sliderOffset) < 1e-6, 'rack-pinion rack stays on its guide offset');
  assert(Math.abs((localTrack(mechanism, high.j2).x - localTrack(mechanism, low.j2).x) - mechanism.crankLength * Math.PI) < 1e-6, 'rack-pinion rack travel equals pinion arc length');
  const shortRack = { ...mechanism, rockerLength: mechanism.crankLength * 3 };
  assert(sampleFeasibleRange(shortRack).percentValid < 1, 'rack-pinion becomes partial when rack/guide is too short for the stroke');
  assert(requiredPartNames('rack-pinion').includes('pinion gear'), 'rack-pinion recipe includes a pinion gear');
  assert(requiredPartNames('rack-pinion').includes('toothed rack'), 'rack-pinion recipe includes a toothed rack');
}

{
  const mechanism = createDefaultMechanism('gear', 'contract-gear-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid, 'gear train default has valid sampled poses');
    assertDistance(state.p1, state.j1, mechanism.crankLength, 'gear input pitch radius is preserved');
    assertDistance(state.p2, state.j2, mechanism.rockerLength, 'gear output pitch radius is preserved');
    assertDistance(state.p1, state.p2, mechanism.crankLength + mechanism.rockerLength, 'gear pitch circles remain tangent');
  });
  assert.equal(mechanism.crankLength, 50 * SCENE_PX_PER_MM, 'gear train default uses the fabrication G5 drive gear pitch radius');
  assert.equal(mechanism.rockerLength, 30 * SCENE_PX_PER_MM, 'gear train default uses the fabrication G3 output gear pitch radius');
  assert.equal(mechanism.gearRatio, gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength), 'gear train default ratio is derived from meshed pitch radii');
  const unequalGear = { ...mechanism, crankLength: 30, rockerLength: 60, groundLength: 90, gearRatio: -99, speed2: -99 };
  const unequalQuarter = calculateLinkage(unequalGear, Math.PI / 2);
  const outputAngle = Math.atan2(unequalQuarter.j2.y - unequalQuarter.p2.y, unequalQuarter.j2.x - unequalQuarter.p2.x);
  assert(Math.abs(outputAngle - gearPairOutputRatio(30, 60) * Math.PI / 2) < 1e-6, 'gear output rotation follows pitch radii, not stale ratio fields');
  Array.from({ length: 8 }, () => generateSmartConfig(undefined, 'gear')).forEach(config => {
    assert(Math.abs(config.groundLength - (config.crankLength + config.rockerLength)) < 1e-6, 'optimizer keeps generated gear pitch circles tangent');
  });
  const mutatedGear = mutateConfig({ ...mechanism, groundLength: 999 }, 1, true);
  assert(Math.abs(mutatedGear.groundLength - (mutatedGear.crankLength + mutatedGear.rockerLength)) < 1e-6, 'optimizer keeps mutated gear pitch circles tangent');
  assert.equal(mutatedGear.gearRatio, gearPairOutputRatio(mutatedGear.crankLength, mutatedGear.rockerLength), 'optimizer keeps gear ratio derived from pitch radii');
  assert(requiredPartNames('gear').includes('gear pair'), 'gear train recipe includes a gear pair');
  assert(requiredPartNames('gear').includes('gear train linkage rod'), 'gear train recipe includes paired linkage rods');
}

{
  const mechanism = createDefaultMechanism('planetary_gear', 'contract-planetary-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid && state.aux, 'planetary gear default has valid carrier samples');
    assertDistance(state.p1, state.p2, mechanism.groundLength, 'planetary carrier radius is preserved');
    assertDistance(state.p2, state.j2, mechanism.rockerLength, 'planet gear radius is preserved');
    assertDistance(state.p2, state.effector, mechanism.couplerPointDist, 'planetary output arm length is preserved');
  });
  assert.equal(planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength), -(mechanism.crankLength + mechanism.rockerLength) / mechanism.rockerLength, 'planetary spin follows sun+planet pitch radii');
  Array.from({ length: 8 }, () => generateSmartConfig(undefined, 'planetary_gear')).forEach(config => {
    assert(Math.abs(config.groundLength - (config.crankLength + config.rockerLength)) < 1e-6, 'optimizer keeps generated planetary pitch circles tangent');
  });
  assert(requiredPartNames('planetary_gear').some(name => name === 'gear pair'), 'planetary recipe includes gear parts');
}

const gearDefault = createDefaultMechanism('gear', 'contract-gear-mesh');
const gearStart = calculateLinkage(gearDefault, 0);
const gearQuarter = calculateLinkage(gearDefault, Math.PI / 2);
assert(Math.abs(Math.hypot(gearStart.p2.x - gearStart.p1.x, gearStart.p2.y - gearStart.p1.y) - (gearDefault.crankLength + gearDefault.rockerLength)) < 1e-9, 'gear template defaults mesh the two pitch circles');
assert(gearQuarter.j1.y > gearStart.j1.y && gearQuarter.j2.y < gearStart.j2.y, 'gear train reverses output rotation from meshed pitch radii');
let exportedProject = applyProjectAction(sample, { type: 'set_export', fabricationPackage: createFabricationPackage(sample) });
assert(exportedProject.lastExport, 'set_export stores generated fabrication package');
exportedProject = applyProjectAction(exportedProject, { type: 'upsert_mechanism', mechanism: { ...exportedProject.mechanisms[0], enabled: false } });
assert.equal(exportedProject.lastExport, undefined, 'mechanism changes invalidate stale fabrication package download');
const addedPart = applyProjectAction(sample, { type: 'upsert_part', part: { ...sample.parts.head, id: 'head-copy', name: 'Head copy', zIndex: 99 } });
assert(addedPart.parts['head-copy'], 'path editor can add visual layers through state');
const removedPartProject = applyProjectAction({ ...addedPart, paths: { ...addedPart.paths, 'path-head-copy': { ...addedPart.paths['path-right-arm'], id: 'path-head-copy', partId: 'head-copy' } } }, { type: 'delete_part', partId: 'head-copy' });
assert(!removedPartProject.parts['head-copy'] && !removedPartProject.paths['path-head-copy'], 'deleting a visual layer removes its paths');
const deletedPathProject = applyProjectAction(sample, { type: 'delete_path', pathId: 'path-right-arm' });
assert(!deletedPathProject.paths['path-right-arm'], 'path editor delete removes path data instead of leaving an empty path');
assert.equal(deletedPathProject.mechanisms[0].targetPathId, undefined, 'deleting a path detaches mechanisms from stale targetPathId');
assert.equal(sample.settings.timingProfile, 'linear', 'options include a persisted timing profile');
assert.equal(sample.settings.theme, 'light', 'settings default to the light novice UI theme');
assert.equal(sample.settings.performancePreset, 'balanced', 'settings default includes performance preset');
assert.equal(sample.settings.physicsSnapMode, 'balanced', 'settings default includes physics snap mode');
assert.equal(sample.settings.simulationFriction, 0.18, 'settings default includes physical friction coefficient');
assert.equal(sample.settings.simulationMassKg, 1, 'settings default includes mechanism mass');
assert.equal(sample.settings.debugVisuals, false, 'settings default hides debug visuals');
assert.equal(sample.settings.detailedProcessingSteps, false, 'settings default hides detailed processing steps');
assert.equal(sample.settings.autosaveIntervalSeconds, 60, 'settings default includes autosave interval seconds');
assert.equal(sample.settings.fabricationReadyMode, true, 'settings default keeps fabrication validation strict');
assert.equal(sample.settings.gridUnit, 'cm', 'settings default labels grid in centimeters');
assert.equal(sample.settings.physicalKit.exportMode, 'both', 'physical kit default exposes both custom parts and prefab board kit workflows');
assert.equal(sample.settings.physicalKit.cutSheetFileType, 'pdf', 'physical kit default is PDF-first for cut sheets');
assert.equal(animationDeltaRadians(1600, 3200, 1, 'linear'), Math.PI, 'linear animation duration drives playback phase');
assert.equal(animationDeltaRadians(1600, 3200, 1, 'realtime'), Math.PI, 'animation duration drives playback phase');
assert.equal(animationDeltaRadians(1600, 6400, 1, 'realtime'), Math.PI / 2, 'longer duration slows playback phase');
const linearQuarter = animationDeltaRadians(800, 3200, 1, 'linear', 0);
assert(Math.abs(linearQuarter - Math.PI / 2) < 1e-9, 'linear timing advances a quarter cycle after a quarter duration');
assert(animationDeltaRadians(800, 3200, 1, 'ease-in', 0) < linearQuarter, 'ease-in starts slower than linear');
assert(animationDeltaRadians(800, 3200, 1, 'ease-out', 0) > linearQuarter, 'ease-out starts faster than linear');
assert(animationDeltaRadians(800, 3200, 1, 'ease-in-out', 0) < linearQuarter, 'ease-in-out starts with a real eased phase');
const legacySettingsProject = loadProjectSnapshot({
  ...sample,
  settings: {
    animationSpeed: 1,
    animationDurationMs: 3200,
    timingProfile: 'realtime',
    theme: 'blueprint',
    toolbarVisible: true,
    partPanelVisible: true,
    autosave: false,
    physicalKit: { ...sample.settings.physicalKit, cutSheetFileType: undefined }
  }
});
assert.equal(legacySettingsProject.settings.performancePreset, 'balanced', 'legacy snapshots receive M3 performance default');
assert.equal(legacySettingsProject.settings.simulationFriction, 0.18, 'legacy snapshots receive simulation friction default');
assert.equal(legacySettingsProject.settings.simulationMassKg, 1, 'legacy snapshots receive simulation mass default');
assert.equal(legacySettingsProject.settings.autosaveIntervalSeconds, 60, 'legacy snapshots receive M3 autosave interval default');
assert.equal(legacySettingsProject.settings.physicalKit.exportMode, 'both', 'legacy physical kit receives both-workflows default');
assert.equal(legacySettingsProject.settings.physicalKit.cutSheetFileType, 'pdf', 'legacy physical kit receives cut-sheet default');
const optionsRoundTrip = loadProjectSnapshot(JSON.parse(serializeProject({
  ...sample,
  settings: {
    ...sample.settings,
    performancePreset: 'high',
    physicsSnapMode: 'fast',
    simulationFriction: 0.42,
    simulationMassKg: 1.75,
    debugVisuals: true,
    detailedProcessingSteps: true,
    autosave: true,
    autosaveIntervalSeconds: 3,
    gridUnit: 'inch',
    fabricationReadyMode: false,
    physicalKit: { ...sample.settings.physicalKit, exportMode: 'prefab-board', cutSheetFileType: 'svg' }
  }
})));
assert.equal(optionsRoundTrip.settings.performancePreset, 'high', 'M3 performance setting serializes and reloads');
assert.equal(optionsRoundTrip.settings.physicsSnapMode, 'fast', 'physics snap mode round-trips');
assert.equal(optionsRoundTrip.settings.simulationFriction, 0.42, 'simulation friction round-trips');
assert.equal(optionsRoundTrip.settings.simulationMassKg, 1.75, 'simulation mass round-trips');
assert.equal(optionsRoundTrip.settings.debugVisuals, true, 'debug visuals round-trip');
assert.equal(optionsRoundTrip.settings.detailedProcessingSteps, true, 'detailed processing setting round-trips');
assert.equal(optionsRoundTrip.settings.autosaveIntervalSeconds, 3, 'autosave interval round-trips');
assert.equal(optionsRoundTrip.settings.gridUnit, 'inch', 'grid unit setting round-trips');
assert.equal(optionsRoundTrip.settings.fabricationReadyMode, false, 'fabrication-ready mode round-trips');
assert.equal(optionsRoundTrip.settings.physicalKit.exportMode, 'prefab-board', 'blueprint export workflow mode round-trips');
assert.equal(optionsRoundTrip.settings.physicalKit.cutSheetFileType, 'svg', 'cut-sheet file type round-trips');
assert(sample.characterPackage?.partsInfo && sample.characterPackage.charCfg, 'sample project carries character package review artifacts');
const detachedMechanismProject = { ...sample, mechanisms: [createDefaultMechanism('4bar', 'detached')] };
assert(validateForFabrication(detachedMechanismProject).errors.some(e => e.includes('choose a target part and path')), 'fabrication blocks detached visible mechanisms');
const noEnabledMechanismProject = { ...sample, mechanisms: sample.mechanisms.map(m => ({ ...m, enabled: false })) };
assert(validateForFabrication(noEnabledMechanismProject).errors.some(e => e.includes('No enabled mechanism')), 'fabrication blocks zero-recipe blueprint packages');
assert.throws(() => createFabricationPackage(noEnabledMechanismProject), /No enabled mechanism/, 'fabrication package refuses zero-recipe output');
const impossibleMechanismProject = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'impossible'), anchorX: -80, anchorY: -80, groundLength: 10, crankLength: 10, couplerLength: 10, rockerLength: 1000 }] };
assert(validateForFabrication(impossibleMechanismProject).errors.some(e => e.includes('No valid sampled motion')), 'fabrication blocks mechanisms with no valid sampled motion');
const offGridProject = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'off-grid'), anchorX: -70, anchorY: -80 }] };
assert(validateForFabrication(offGridProject).errors.some(e => e.includes('off grid')), 'fabrication blocks off-grid anchors instead of rounding silently');
const simulationOnlyOffGridProject = { ...offGridProject, settings: { ...sample.settings, fabricationReadyMode: false } };
assert(validateForFabrication(simulationOnlyOffGridProject).warnings.some(e => e.includes('off grid')), 'simulation-only mode downgrades board snap issues to warnings');
const recipeWithPath = createFabricationPackage(sample).recipes[0];
assert.equal(recipeWithPath.targetPathId, 'path-right-arm', 'fabrication recipe preserves target path metadata');
assert(recipeWithPath.sceneAnchor && 'x' in recipeWithPath.sceneAnchor, 'fabrication recipe includes explicit scene anchor');
assert(createFabricationPackage(sample).assemblyGuideHtml.includes('assembly guide'), 'fabrication package includes printable assembly guide');
const warningPackage = createFabricationPackage({
  ...sample,
  mechanisms: [{ ...sample.mechanisms[0], warnings: ['project warning should appear in guide'] }]
});
assert(warningPackage.recipes[0].warnings.includes('project warning should appear in guide'), 'fabrication recipe preserves mechanism warnings');
assert(warningPackage.assemblyGuideHtml.includes('project warning should appear in guide'), 'assembly guide preserves mechanism warnings');
const boardCircles = [...pkg.svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="(?:2|5)"/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
assert.equal(boardCircles.length, sample.settings.physicalKit.boardCells ** 2, 'fabrication SVG renders one board hole per cell');
assert(Math.abs(boardCircles[0].x - sceneToSvg(boardToScene(0, 0, sample.settings.physicalKit)).x) < 1e-9, 'fabrication board hole uses shared boardToScene x');
assert(Math.abs(boardCircles[sample.settings.physicalKit.boardCells].x - boardCircles[0].x - sample.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM) < 1e-9, 'fabrication board hole pitch matches grid pitch');
assert.equal(physicalKitPreset('letter-12x12-2cm', sample.settings.physicalKit).boardCells, 12, 'profile selector applies complete physical kit preset');
assert.equal(boardGridLines(sample.settings.physicalKit).length, sample.settings.physicalKit.boardCells * 2, 'UI grid reuses one board grid definition');

const invalid = {
  ...sample,
  mechanisms: [{ ...boundMechanism('4bar', 'off'), anchorX: 9999, anchorY: 9999 }]
};
assert.equal(sceneToBoardRaw({ x: 9999, y: 9999 }, sample.settings.physicalKit).valid, false, 'raw board detects invalid anchor');
assert(validateForFabrication(invalid).errors.some(e => e.includes('outside board')), 'fabrication rejects off-board anchor');
const missingAnchor = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'missing-anchor'), anchorX: undefined, anchorY: undefined }] };
assert(validateForFabrication(missingAnchor).errors.some(e => e.includes('missing board coordinate')), 'fabrication rejects missing board coordinate');
assert.throws(() => createFabricationPackage(missingAnchor), /missing board coordinate/, 'fabrication package does not silently place missing anchors at origin');
const importedMissingAnchor = loadProjectSnapshot(JSON.parse(serializeProject(sample)));
delete (importedMissingAnchor.mechanisms[0] as unknown as Record<string, unknown>).anchorX;
delete (importedMissingAnchor.mechanisms[0] as unknown as Record<string, unknown>).anchorY;
const reloadedMissingAnchor = loadProjectSnapshot(JSON.parse(serializeProject(importedMissingAnchor)));
assert(validateForFabrication(reloadedMissingAnchor).errors.some(e => e.includes('missing board coordinate')), 'imported snapshot with missing anchors remains invalid for fabrication');

const removed = applyProjectAction(sample, { type: 'remove_joint', jointId: 'right_shoulder' });
assert.notEqual(removed.parts.right_arm.anchorJointId, 'right_shoulder', 'joint delete repairs part anchors');
const cycleAttempt = applyProjectAction(sample, { type: 'update_joint', jointId: 'root', updates: { parentId: 'right_hand' } });
assert.equal(cycleAttempt.skeleton?.joints.root.parentId ?? null, sample.skeleton?.joints.root.parentId ?? null, 'joint reparent blocks skeleton cycles');
const movedJoint = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_shoulder', updates: { position: { x: 222, y: 111 } } });
const movedPivot = bodyPartPivotScene(movedJoint.parts.right_arm, movedJoint.skeleton);
assert(Math.hypot(movedPivot.x - 222, movedPivot.y - 111) < 1e-9, 'moving a skeleton joint updates anchored body-part pivot state');

const malicious = loadProjectSnapshot({
  ...sample,
  mechanisms: [{
    ...createDefaultMechanism('4bar', 'bad'),
    color: '#fff\"/><script>alert(1)</script><path stroke=\"#000',
    anchorX: '0" onload="alert(1)'
  }],
  parts: {
    badPart: {
      id: 'badPart',
      name: 'Bad',
      anchorJointId: 'missing_joint',
      transform: { x: '1" onload="alert(1)', y: 0, rotation: 0, scale: 1 },
      bounds: { x: -10, y: -10, width: 20, height: 20 },
      fillColor: 'url(javascript:alert(1))',
      zIndex: 0,
      opacity: 1,
      visible: true,
      locked: false,
      selectable: true
    }
  },
  partOrder: ['badPart']
});
const maliciousSvg = generateSVG({ speed: 1, rotation: 0, mechanisms: malicious.mechanisms }, 0);
const maliciousDxf = generateDXF({ speed: 1, rotation: 0, mechanisms: [{ ...malicious.mechanisms[0], id: 'bad\n0\nSCRIPT' }] }, 0);
assert.equal(malicious.mechanisms[0].color, '#3b82f6', 'import sanitizes mechanism color');
assert.equal(malicious.parts.badPart.fillColor, '#64748b', 'import sanitizes part color');
assert(malicious.skeleton?.joints[malicious.parts.badPart.anchorJointId], 'import repairs missing part anchor');
assert(!/<script|onload|javascript:/i.test(maliciousSvg), 'SVG export rejects imported script injection');
assert(!maliciousDxf.includes('bad\n0\nSCRIPT'), 'DXF export sanitizes imported layer names');

const packageProject = createProjectFromPackageData(
  {
    parts: {
      head: {
        image_path: 'parts/head.png',
        mask_path: 'parts/head-mask.png',
        anchor_joint_id: 'neck',
        original_svg_path: 'parts/head.svg',
        enhanced_svg_path: 'parts/head-enhanced.svg',
        roi: [40, 20, 80, 60],
        z_value: 2,
        local_pivot_offset: [45, 50],
        fill_color: 'rgba(10,20,30,0.5)'
      }
    }
  },
  parseCharConfig(`
skeleton:
- name: root
  loc: [100, 140]
  parent: null
- name: neck
  loc: [80, 50]
  parent: root
  bend_direction: -1
width: 200
height: 160
`),
  { 'parts/head.png': 'data:image/png;base64,head', 'parts/head-mask.png': 'data:image/png;base64,mask' },
  'pkg'
);
assert.equal(packageProject.mechanisms.length, 0, 'plain package import clears stale dummy mechanisms');
assert.equal(packageProject.parts.head.textureUrl, 'data:image/png;base64,head', 'package import resolves part texture');
assert.equal(packageProject.parts.head.maskUrl, 'data:image/png;base64,mask', 'package import resolves part mask');
assert.equal(packageProject.parts.head.originalSvgPath, 'parts/head.svg', 'package import preserves original SVG provenance');
assert.equal(packageProject.parts.head.enhancedSvgPath, 'parts/head-enhanced.svg', 'package import preserves enhanced SVG provenance');
assert(packageProject.skeleton?.joints.neck, 'package import loads char_cfg skeleton');
assert.equal(packageProject.skeleton?.joints.neck.bendDirection, -1, 'package import preserves bend direction');
assert.throws(
  () => createProjectFromPackageData(
    { parts: { head: { image_path: 'parts/missing.png', anchor_joint_id: 'neck', roi: [0, 0, 20, 20] } } },
    parseCharConfig('width: 20\nheight: 20\njoints:\n  neck:\n    position: [10, 10]\n    parent: null\n'),
    {},
    'missing-asset'
  ),
  /missing asset file parts\/missing\.png/,
  'package import blocks referenced missing part assets'
);

const keyedSkeletonProject = createProjectFromPackageData(
  { parts: { torso: { roi: [0, 0, 40, 40], anchor_joint: 'root' } } },
  parseCharConfig(`
width: 120
height: 120
joints:
  root:
    position: [60, 60]
    parent: null
  hand:
    loc: [80, 70]
    parent_id: root
`)
);
assert(keyedSkeletonProject.skeleton?.joints.hand, 'package import supports keyed joints char_cfg');
const foundryPath = generateCurvePoints(createDefaultMechanism('5bar', 'foundry-preserve'), 96).points;
assert.equal(
  mechanismWithGeneratedPath({ ...createDefaultMechanism('5bar', 'foundry-preserve'), generatedPath: foundryPath }, { preserveGeneratedPath: true }).generatedPath?.length,
  foundryPath.length,
  'foundry handoff preserves its exported generated path resolution'
);
const foundryUpsert = applyProjectAction(sample, {
  type: 'upsert_mechanism',
  mechanism: {
    ...createDefaultMechanism('5bar', 'foundry-upsert'),
    generatedPath: foundryPath,
    foundryExport: {
      id: 'foundry-package',
      createdAt: 'now',
      mechanismId: 'foundry-upsert',
      mechanismType: '5bar',
      parameters: createDefaultMechanism('5bar', 'foundry-upsert'),
      pivot: { x: 0, y: 0 },
      generatedPath: foundryPath,
      simulationSummary: 'ok',
      visual: { color: '#000', scale: 1, constraintsVisible: true },
      animation: { duration: 1000, steps: foundryPath.length, loop: true },
      metadata: { sourceTab: 'mechanism-foundry', selectedPreset: 'balanced', recommendation: 'test fixture' },
      targetAnchorJointId: 'right_shoulder',
      warnings: [],
      source: 'mechanism-foundry'
    }
  }
});
assert.equal(foundryUpsert.mechanisms.find(m => m.id === 'foundry-upsert')?.generatedPath?.length, foundryPath.length, 'upserting foundry export preserves package path');
assert.equal(foundryUpsert.mechanisms.find(m => m.id === 'foundry-upsert')?.foundryExport?.metadata.selectedPreset, 'balanced', 'foundry export preserves preset metadata');
const anchorOverride = applyProjectAction(sample, { type: 'upsert_mechanism', mechanism: { ...sample.mechanisms[0], targetAnchorJointId: 'right_elbow' } });
assert.equal(anchorOverride.mechanisms[0].targetAnchorJointId, 'right_elbow', 'mechanism target anchor override survives reducer reconciliation');
const lockedPartProject = { ...sample, parts: { ...sample.parts, right_arm: { ...sample.parts.right_arm, locked: true } } };
assert.equal(
  applyProjectAction(lockedPartProject, { type: 'update_part', partId: 'right_arm', updates: { transform: { ...sample.parts.right_arm.transform, x: 999 } } }).parts.right_arm.transform.x,
  sample.parts.right_arm.transform.x,
  'locked parts reject reducer-level edits'
);
assert.equal(
  applyProjectAction(lockedPartProject, { type: 'delete_part', partId: 'right_arm' }).parts.right_arm.id,
  'right_arm',
  'locked parts reject deletion'
);
const lockedPathAttempt = applyProjectAction(lockedPartProject, { type: 'upsert_path', path: { ...sample.paths['path-right-arm'], points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } });
assert.deepEqual(lockedPathAttempt.paths['path-right-arm'].points, sample.paths['path-right-arm'].points, 'locked parts reject path edits');
assert(applyProjectAction(lockedPartProject, { type: 'delete_path', pathId: 'path-right-arm' }).paths['path-right-arm'], 'locked parts reject path deletion');
const lockedJointProject = { ...sample, skeleton: { ...sample.skeleton!, joints: { ...sample.skeleton!.joints, right_shoulder: { ...sample.skeleton!.joints.right_shoulder, locked: true } } } };
assert.equal(
  applyProjectAction(lockedJointProject, { type: 'update_joint', jointId: 'right_shoulder', updates: { position: { x: 999, y: 999 } } }).skeleton?.joints.right_shoulder.position.x,
  sample.skeleton?.joints.right_shoulder.position.x,
  'locked joints reject reducer-level edits'
);
assert(applyProjectAction(lockedJointProject, { type: 'remove_joint', jointId: 'right_shoulder' }).skeleton?.joints.right_shoulder, 'locked joints reject reducer-level removal');
const wrongTarget = {
  ...sample,
  paths: {
    ...sample.paths,
    'path-left': { ...sample.paths['path-right-arm'], id: 'path-left', partId: 'left_arm' }
  },
  mechanisms: [{ ...sample.mechanisms[0], targetPartId: 'right_arm', targetPathId: 'path-left' }]
};
assert(validateForFabrication(wrongTarget).errors.some(e => e.includes('belongs to left_arm')), 'fabrication rejects mismatched target part/path');
assert.equal(handoffGate({ ...sample, parts: {}, partOrder: [], skeleton: null, paths: {}, mechanisms: [] }, 'path').ok, false, 'stage handoff blocks path work before character data');
assert.equal(handoffGate({ ...sample, mechanisms: [] }, 'design').ok, true, 'stage handoff allows Design to add the first mechanism after character load');
assert.equal(handoffGate(sample, 'blueprint').ok, true, 'stage handoff permits blueprint when mechanisms are valid');
assert.deepEqual(bodyPartPivotScene({ ...sample.parts.right_arm, anchorJointId: 'right_elbow' }, sample.skeleton), sample.skeleton?.joints.right_elbow.position, 'pivot can follow reassigned skeleton anchor');
const placed = placeBodyPartPivotAt({ ...sample.parts.right_arm, anchorJointId: 'right_elbow' }, { x: 12, y: 34 }, sample.skeleton);
assert(Math.abs(bodyPartPivotScene(placed, sample.skeleton).x - 12) < 1e-9 && Math.abs(bodyPartPivotScene(placed, sample.skeleton).y - 34) < 1e-9, 'anchor-aware placement moves visual transform');
const handPart: BodyPartLayer = {
  ...sample.parts.right_arm,
  id: 'right_hand_part',
  name: 'Right hand part',
  anchorJointId: 'right_hand',
  transform: { x: 128, y: -34, rotation: 0, scale: 1 },
  bounds: { x: -15, y: -15, width: 30, height: 30 },
  localPivotOffset: { x: 0, y: 0 },
  localPivotJointId: 'right_hand',
  zIndex: 9
};
const ikProject: ProjectState = {
  ...sample,
  parts: { ...sample.parts, right_hand_part: handPart },
  partOrder: [...sample.partOrder, 'right_hand_part'],
  mechanisms: [{ ...sample.mechanisms[0], targetAnchorJointId: 'right_hand' }]
};
const pathPreview = motionPreviewForPath(ikProject, ikProject.paths['path-right-arm'], 0);
assert(pathPreview.parts.right_arm, 'path editor preview moves selected limb at current frame');
assert.deepEqual(pathPreview.skeleton?.joints.right_shoulder.position, ikProject.skeleton?.joints.right_shoulder.position, 'IK preview keeps the shoulder root attached');
assert(Math.hypot((pathPreview.skeleton?.joints.right_hand.position.x ?? 0) - ikProject.paths['path-right-arm'].points[0].x, (pathPreview.skeleton?.joints.right_hand.position.y ?? 0) - ikProject.paths['path-right-arm'].points[0].y) < 1e-9, 'path editor IK target reaches the path point');
const drivenMechanism = {
  ...createDefaultMechanism('crank', 'drive-effector'),
  anchorX: ikProject.paths['path-right-arm'].points[0].x + 30,
  anchorY: ikProject.paths['path-right-arm'].points[0].y - 20,
  crankLength: 10,
  targetPartId: 'right_arm',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
  activeVisualPartIds: ['right_arm']
};
const drivenProject: ProjectState = { ...ikProject, mechanisms: [drivenMechanism] };
const animated = animatedPartsForProject(drivenProject, drivenProject.mechanisms, 0);
const mechanismPreview = motionPreviewForProject(drivenProject, drivenProject.mechanisms, 0);
const mechanismState = calculateLinkage(drivenMechanism, 0);
assert(animated.right_arm, 'animated preview moves target part at current frame');
assert(animated.right_hand_part, 'animated preview propagates target-anchor motion to descendant parts');
const movedShoulder = bodyPartPivotScene(animated.right_arm, mechanismPreview.skeleton);
assert(Math.hypot(movedShoulder.x - (drivenProject.skeleton?.joints.right_shoulder.position.x ?? 0), movedShoulder.y - (drivenProject.skeleton?.joints.right_shoulder.position.y ?? 0)) < 1e-9, 'mechanism IK keeps limb root attached instead of translating the whole arm');
assert(Math.hypot((mechanismPreview.skeleton?.joints.right_hand.position.x ?? 0) - mechanismState.effector.x, (mechanismPreview.skeleton?.joints.right_hand.position.y ?? 0) - mechanismState.effector.y) < 1e-9, 'mechanism design IK target follows the actual linkage effector');
assert(Math.hypot((mechanismPreview.skeleton?.joints.right_hand.position.x ?? 0) - drivenProject.paths['path-right-arm'].points[0].x, (mechanismPreview.skeleton?.joints.right_hand.position.y ?? 0) - drivenProject.paths['path-right-arm'].points[0].y) > 20, 'mechanism design does not fake success by directly following the target path');
assert.notEqual(animated.right_arm.transform.rotation, drivenProject.parts.right_arm.transform.rotation, 'IK preview rotates the limb instead of only offsetting it');
assert(Math.hypot(bodyPartPivotScene(animated.right_hand_part, mechanismPreview.skeleton).x - (mechanismPreview.skeleton?.joints.right_hand.position.x ?? 0), bodyPartPivotScene(animated.right_hand_part, mechanismPreview.skeleton).y - (mechanismPreview.skeleton?.joints.right_hand.position.y ?? 0)) < 1e-9, 'descendant part anchor follows animated skeleton');
for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
  const state = calculateLinkage(sample.mechanisms[0], phase);
  const preview = motionPreviewForProject(sample, sample.mechanisms, phase);
  const targetJointId = preferredMotionJointId(sample, sample.mechanisms[0].targetPartId, sample.mechanisms[0].targetAnchorJointId)!;
  const targetJoint = preview.skeleton?.joints[targetJointId]?.position;
  assert(state.isValid && targetJoint, 'sample mechanism has a valid driven target joint');
  assert(Math.hypot(targetJoint!.x - state.effector.x, targetJoint!.y - state.effector.y) < 1e-9, 'sample mechanism keeps its driven joint pinned to the linkage effector through the whole scrub range');
}
const conflictProject: ProjectState = { ...drivenProject, mechanisms: [drivenMechanism, { ...drivenMechanism, id: 'second-driver', anchorX: drivenMechanism.anchorX + 8 }] };
const conflicts = mechanismBindingWarnings(conflictProject);
assert(conflicts['drive-effector']?.some(w => w.includes('also drives right_arm:right_hand')), 'first duplicate driver receives explicit conflict warning');
assert(conflicts['second-driver']?.some(w => w.includes('also drives right_arm:right_hand')), 'second duplicate driver receives explicit conflict warning');
assert(validateForFabrication(conflictProject).errors.some(e => e.includes('only one mechanism can own a target anchor')), 'blueprint export blocks ambiguous duplicate target drivers');
const exportedForSettings = applyProjectAction(sample, { type: 'set_export', fabricationPackage: createFabricationPackage(sample) });
const uiSettingsProject = applyProjectAction(exportedForSettings, { type: 'update_settings', settings: { toolbarVisible: !exportedForSettings.settings.toolbarVisible, debugVisuals: true, detailedProcessingSteps: true } });
assert.equal(uiSettingsProject.lastExport, exportedForSettings.lastExport, 'UI-only options do not clear export package');
assert.equal(uiSettingsProject.metadata.updatedAt, exportedForSettings.metadata.updatedAt, 'UI-only options do not mutate project metadata');
const gridSettingsProject = applyProjectAction(exportedForSettings, { type: 'update_settings', settings: { physicalKit: { ...exportedForSettings.settings.physicalKit, gridPitchMm: exportedForSettings.settings.physicalKit.gridPitchMm + 1 } } });
assert.equal(gridSettingsProject.lastExport, undefined, 'physical kit options invalidate export package');
const snapSettingsProject = applyProjectAction(exportedForSettings, { type: 'update_settings', settings: { physicsSnapMode: 'high' } });
assert.equal(snapSettingsProject.lastExport, undefined, 'physics snap settings invalidate fabrication export package');
const simulationSettingsProject = applyProjectAction(exportedForSettings, { type: 'update_settings', settings: { simulationFriction: 0.5, simulationMassKg: 2 } });
assert.equal(simulationSettingsProject.lastExport, undefined, 'simulation physics settings invalidate fabrication export package');
const indexHtml = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
assert(!/https?:\/\//.test(indexHtml), 'index.html has no external CDN URLs');
assert(!/importmap|tailwindcss/i.test(indexHtml), 'index.html does not rely on importmap or Tailwind CDN');
assert(existsSync(join(process.cwd(), 'public/onnx/pose_model.onnx')), 'ONNX model asset is present for web runtime');
if (existsSync(join(process.cwd(), 'dist'))) assert(existsSync(join(process.cwd(), 'dist/onnx/pose_model.onnx')), 'production build copies ONNX model to dist');
const staleExport = loadProjectSnapshot({ ...sample, lastExport: { id: 'stale-export' } });
assert.equal(staleExport.lastExport, undefined, 'imported project snapshots clear stale fabrication exports');
assert(existsSync(join(process.cwd(), 'src-tauri/icons/icon.png')) && existsSync(join(process.cwd(), 'src-tauri/icons/icon.ico')), 'Tauri package icon files exist');
assert.throws(
  () => createProjectFromPackageData({ parts: { p: { roi: [0, 0, 10, 10] } } }, parseCharConfig('width: 1\nheight: 1\nskeleton: []')),
  /missing skeleton\/joints|no valid joints/,
  'empty skeleton import fails instead of fabricating joints'
);

console.log('project contracts ok');
