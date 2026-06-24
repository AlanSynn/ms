import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { boardGridLines, boardToScene, bodyPartPivotScene, physicalKitPreset, placeBodyPartPivotAt, SCENE_PX_PER_MM, sceneToBoard, sceneToBoardRaw, sceneToSheetMm, sceneToSvg, sheetMmToScene } from '../utils/coordinates';
import { createDefaultMechanism, createSampleProject, handoffGate, loadProjectSnapshot, serializeProject, applyProjectAction, projectSelfCheck, mechanismRequiredParts, mechanismWithGeneratedPath } from '../utils/project';
import { createFabricationPackage, validateForFabrication } from '../utils/fabrication';
import { generateDXF, generateSVG } from '../utils/exporter';
import { createProjectFromPackageData, parseCharConfig } from '../utils/packageLoader';
import { animationDeltaRadians, calculateLinkage, generateCurvePoints } from '../utils/kinematics';
import { animatedPartsForProject, mechanismBindingWarnings, motionAnchorJointIds, motionPreviewForPath, motionPreviewForProject, preferredMotionJointId } from '../utils/motion';
import type { BodyPartLayer, MechanismType, ProjectState } from '../types';

projectSelfCheck();

const onnxPath = join(process.cwd(), 'public', 'onnx', 'pose_model.onnx');
assert(existsSync(onnxPath), 'web ONNX asset is present');
assert(statSync(onnxPath).size > 1_000_000, 'web ONNX asset is real model data, not a Git LFS pointer or mock');
assert(!readFileSync(onnxPath).subarray(0, 64).toString('utf8').startsWith('version https://git-lfs'), 'web ONNX asset is checked out from Git LFS before tests run');

const sample = createSampleProject();
assert.equal(sample.mechanisms[0].targetAnchorJointId, 'right_hand', 'sample waving arm drives the hand, not the shoulder root');
assert.deepEqual(motionAnchorJointIds(sample, 'right_arm'), ['right_shoulder', 'right_elbow', 'right_hand'], 'IK anchor choices stay within the target limb chain');
assert.equal(preferredMotionJointId(sample, 'right_arm', 'left_hand'), 'right_shoulder', 'invalid IK anchor falls back to the target part root');
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
assert(pkg.metadataJson.includes('validationIssues'), 'fabrication metadata includes structured validation issues');
assert(pkg.recipes.every(r => r.requiredParts.length > 0), 'fabrication recipes include explicit required parts');
assert.deepEqual(pkg.recipes[0].requiredParts, mechanismRequiredParts(twoFourBars.mechanisms[0]), 'recipe required parts mirror mechanism metadata defaults');
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
const mechanismTypes: MechanismType[] = ['crank', '4bar', 'piston', 'yoke', 'quick-return', '5bar', 'cam', 'gear', 'planetary_gear'];
mechanismTypes.forEach(type => {
  const mechanism = createDefaultMechanism(type, `contract-${type}`);
  [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    [state.p1, state.p2, state.j1, state.j2, state.aux, state.effector].filter(Boolean).forEach(point => {
      assert(Number.isFinite(point!.x) && Number.isFinite(point!.y), `${type} animation keeps finite coordinates`);
    });
  });
  assert(generateCurvePoints(mechanism, 24).points.length > 0, `${type} generates an output motion path`);
});
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
assert.equal(sample.settings.debugVisuals, false, 'settings default hides debug visuals');
assert.equal(sample.settings.detailedProcessingSteps, false, 'settings default hides detailed processing steps');
assert.equal(sample.settings.autosaveIntervalSeconds, 60, 'settings default includes autosave interval seconds');
assert.equal(sample.settings.fabricationReadyMode, true, 'settings default keeps fabrication validation strict');
assert.equal(sample.settings.gridUnit, 'cm', 'settings default labels grid in centimeters');
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
assert.equal(legacySettingsProject.settings.autosaveIntervalSeconds, 60, 'legacy snapshots receive M3 autosave interval default');
assert.equal(legacySettingsProject.settings.physicalKit.cutSheetFileType, 'pdf', 'legacy physical kit receives cut-sheet default');
const optionsRoundTrip = loadProjectSnapshot(JSON.parse(serializeProject({
  ...sample,
  settings: {
    ...sample.settings,
    performancePreset: 'high',
    physicsSnapMode: 'fast',
    debugVisuals: true,
    detailedProcessingSteps: true,
    autosave: true,
    autosaveIntervalSeconds: 3,
    gridUnit: 'inch',
    fabricationReadyMode: false,
    physicalKit: { ...sample.settings.physicalKit, cutSheetFileType: 'svg' }
  }
})));
assert.equal(optionsRoundTrip.settings.performancePreset, 'high', 'M3 performance setting serializes and reloads');
assert.equal(optionsRoundTrip.settings.physicsSnapMode, 'fast', 'physics snap mode round-trips');
assert.equal(optionsRoundTrip.settings.debugVisuals, true, 'debug visuals round-trip');
assert.equal(optionsRoundTrip.settings.detailedProcessingSteps, true, 'detailed processing setting round-trips');
assert.equal(optionsRoundTrip.settings.autosaveIntervalSeconds, 3, 'autosave interval round-trips');
assert.equal(optionsRoundTrip.settings.gridUnit, 'inch', 'grid unit setting round-trips');
assert.equal(optionsRoundTrip.settings.fabricationReadyMode, false, 'fabrication-ready mode round-trips');
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
