import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { boardGridLines, boardToScene, bodyPartPivotScene, physicalKitPreset, placeBodyPartPivotAt, SCENE_PX_PER_MM, sceneToBoard, sceneToBoardRaw, sceneToSheetMm, sceneToSvg, sheetMmToScene } from '../utils/coordinates';
import { CLASSROOM_LESSONS, classroomLessonById, createDefaultMechanism, createEmptyProject, createLessonProject, createSampleProject, handoffGate, loadProjectSnapshot, serializeProject, applyProjectAction, projectSelfCheck, mechanismRequiredParts, mechanismWithGeneratedPath, replaceCharacterProject, resetProjectToLessonBaseline } from '../utils/project';
import { createFabricationPackage, FABRICATION_GEAR_SPECS, FABRICATION_HOLE_RADIUS_MM, FABRICATION_LINKAGE_SPECS, FABRICATION_LINKAGE_WIDTH_MM, FABRICATION_RING_GEAR_SPEC, FABRICATION_SOURCE_SSOT, FABRICATION_SPACER_SPEC, fabricationBoardCoordinateCallout, fabricationGearPathD, fabricationGearProfileForPitchRadius, fabricationGearSpecForPitchRadius, fabricationLinkageHoleCountsForMechanism, fabricationLinkageSceneLengthsForMechanism, fabricationLinkageSpecForSceneLength, fabricationPartDisplayLabel, fabricationRingGearPathD, fabricationRenderPlanForMechanism, fabricationStackForMechanism, prefabAssemblySteps, sampleFeasibleRange, validateFabricationStack, validateForFabrication } from '../utils/fabrication';
import { generateDXF, generateSVG } from '../utils/exporter';
import { createProjectFromPackageData, parseCharConfig } from '../utils/packageLoader';
import { animationDeltaRadians, calculateLinkage, camFollowerRise, camProfileScale, gearPairOutputRatio, gearTrainOutputRatio, gearTrainPitchCenterDistance, gearTrainPitchRadii, generateCurvePoints, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio, planetaryRingPitchRadius, sampledCamProfileScale } from '../utils/kinematics';
import { animatedPartsForProject, describeMotionChain, mechanismBindingWarnings, motionAnchorJointIds, motionChainRootJointIds, motionPreviewForPath, motionPreviewForProject, motionPreviewForTarget, preferredMotionJointId } from '../utils/motion';
import { buildToonSceneProjection } from '../utils/sceneProjection';
import { buildFoundryPhysicsOverlay, buildKinematicPhysicsSession, mechanismPhysicsRule } from '../utils/physicsSession';
import { fabricablePartOutlinePoints, partLandmarkJointIds, partLandmarkLocalPoints, partOutlineBounds, pointInsideOutline } from '../utils/partGeometry';
import { MECHANISM_FEATURE_REGISTRY, mechanismFeature, validateMechanismFeatureRegistry, type MechanismDragHandle } from '../utils/mechanismFeatureRegistry';
import { buildMechanismSnapshot, buildMechanismSnapshots } from '../utils/mechanismSnapshot';
import { createMechanismFitContext, fitMechanismSimulation, fitMechanismSimulationWithContext } from '../utils/mechanismPreview';
import { WEBGL_PIXEL_RATIO_CAP } from '../utils/viewport';
import { APP_COMMANDS, APP_MENU_GROUPS, commandById, commandIdForKeyboardEvent, validateAppCommandRegistry } from '../utils/appCommands';
import { HIGH_THROUGHPUT_SCENE_POLICY, PHYSICS_KERNEL_ENGINE, PHYSICS_KERNEL_IMPORT, PHYSICS_RENDER_STACK, PHYSICS_UPDATE_POLICY, physicsKernelCapability, runRapierFrictionProbe } from '../utils/physicsKernel';
import { formatGridLabel, formatGridPitch, formatGridReadout } from '../utils/units';
import { ALL_MECHANISM_TYPES, AUTHORABLE_MECHANISM_TYPES, FOUNDRY_MECHANISM_TYPES, MECHANISM_TEMPLATE_LIBRARY, mechanismTemplateLabel } from '../utils/mechanismTemplates';
import { MECHANISM_TYPES as SANITIZE_MECHANISM_TYPES, sanitizeMechanismRuntime } from '../utils/sanitize';
import { generateSmartConfig, mutateConfig, OPTIMIZER_MECHANISM_TYPES } from '../utils/optimizer';
import { isBoardFixedCoordRole, REFERENCE_DEFAULTS, REFERENCE_EXPORT_READY_TYPES, REFERENCE_FOUNDRY_TYPES, REFERENCE_MECHANISM_RECIPES, referenceRecipeForType } from '../utils/mechanismReference';
import type { BodyPartLayer, MechanismType, ProjectState } from '../types';

projectSelfCheck();

const textExtensions = new Set(['.bat', '.css', '.html', '.js', '.json', '.md', '.mjs', '.py', '.rs', '.sh', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml']);
const ignoredEnglishScanDirs = new Set(['.git', '.omx', 'dist', 'exe build', 'node_modules', 'playwright-report', 'src-tauri/target', 'test-results']);
const filesWithHangul: string[] = [];
const scanEnglishOnlyText = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(process.cwd(), path);
    if (entry.isDirectory()) {
      if (!ignoredEnglishScanDirs.has(rel) && !ignoredEnglishScanDirs.has(entry.name)) scanEnglishOnlyText(path);
    } else if (textExtensions.has(extname(entry.name)) && /[\uac00-\ud7af]/.test(readFileSync(path, 'utf8'))) {
      filesWithHangul.push(rel);
    }
  }
};
scanEnglishOnlyText(process.cwd());
assert.deepEqual(filesWithHangul, [], 'repository text and UI copy stay English-only with no Hangul/Korean strings');

const onnxPath = join(process.cwd(), 'public', 'onnx', 'pose_model.onnx');
assert(existsSync(onnxPath), 'web ONNX asset is present');
assert(statSync(onnxPath).size > 1_000_000, 'web ONNX asset is real model data, not a Git LFS pointer or mock');
assert(!readFileSync(onnxPath).subarray(0, 64).toString('utf8').startsWith('version https://git-lfs'), 'web ONNX asset is checked out from Git LFS before tests run');

const emptyProject = createEmptyProject();
const starterSample = createSampleProject();
const sample = createSampleProject({ includeMechanism: true });
const classroomLesson = createLessonProject('waving-arm');
const expectedCanvasDragHandles: Record<MechanismType, MechanismDragHandle[]> = {
  crank: ['P1', 'J1'],
  '4bar': ['P1', 'J1', 'P2', 'J2', 'Effector'],
  piston: ['P1', 'J1', 'P2', 'J2', 'Effector'],
  yoke: ['P1', 'J1', 'P2', 'J2', 'Effector'],
  'quick-return': ['P1', 'J1', 'P2', 'J2', 'Effector'],
  '5bar': ['P1', 'J1', 'P2', 'J2', 'Aux', 'Effector'],
  '6bar': ['P1', 'J1', 'P2', 'J2', 'Aux', 'Effector'],
  cam: ['P1', 'J1', 'P2'],
  'rack-pinion': ['P1', 'J1', 'Effector'],
  gear: ['P1'],
  gear_linkage: ['P1'],
  planetary_gear: ['P1']
};
assert(existsSync(join(process.cwd(), 'resources/examples/raw/girl.png')), 'girl starter source image is present');
assert(existsSync(join(process.cwd(), 'resources/examples/raw/boy.PNG')), 'boy starter source image is present');
const designContract = readFileSync(join(process.cwd(), 'DESIGN.md'), 'utf8');
const agentsContract = readFileSync(join(process.cwd(), 'AGENTS.md'), 'utf8');
const docsMap = readFileSync(join(process.cwd(), 'docs', 'README.md'), 'utf8');
const noviceUiPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'novice-canva-style-ui-plan.md'), 'utf8');
const classroomFieldPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'classroom-field-support-plan.md'), 'utf8');
const brandStaticFiles = [
  'App.tsx',
  'index.html',
  'package.json',
  'bun.lock',
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
  'docs/prd/classroom-field-support-plan.md',
  'docs/prd/realistic-25d-3d-physics-platform-plan.md',
  'docs/prd/canva-video-editor-workspace-plan.md',
  'docs/prd/toon-25d-main-3d-unlock-plan.md',
  'docs/subsystem-governance-and-mechanism-contracts.md',
  'docs/subsystem-governance-execution-log.md',
  'docs/app-command-shortcuts.md'
];
const brandStaticText = brandStaticFiles.map(file => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');
const subsystemGovernanceContract = readFileSync(join(process.cwd(), 'docs', 'subsystem-governance-and-mechanism-contracts.md'), 'utf8');
const legacyBrand = ['Mech', 'Anim'].join('');
const legacySlug = ['mech', 'anim'].join('');
assert(!brandStaticText.includes(legacyBrand), 'legacy product name is absent from static project files');
assert(!brandStaticText.includes(legacySlug), 'legacy package/storage slug is absent from static project files');
assert(brandStaticText.includes('MotionSmith'), 'MotionSmith appears across static project files');
assert.equal(JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).name, 'motionsmith-character-motion-designer', 'package name uses the MotionSmith slug');
assert.equal(JSON.parse(readFileSync(join(process.cwd(), 'metadata.json'), 'utf8')).name, 'MotionSmith: Character Motion Designer', 'metadata product name uses MotionSmith');
assert(readFileSync(join(process.cwd(), 'index.html'), 'utf8').includes('<title>MotionSmith - Mechanical Character Designer</title>'), 'HTML title uses MotionSmith');
const viteConfigText = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
assert(viteConfigText.includes("const webBase = process.env.VITE_BASE_PATH ?? '/'"), 'web deployment base can be set by VITE_BASE_PATH for project Pages');
assert(viteConfigText.includes("base: isTauri ? './' : webBase"), 'Tauri stays relative while web builds can target /ms/');
assert.equal(JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8')).productName, 'MotionSmith', 'Tauri product name uses MotionSmith');
assert(readFileSync(join(process.cwd(), 'App.tsx'), 'utf8').includes('motionsmith.hideWelcome'), 'local storage namespace uses the MotionSmith slug');
assert.deepEqual(validateAppCommandRegistry(), [], 'application command registry is internally consistent');
const commandIds = new Set(APP_COMMANDS.map(command => command.id));
const expectedAppCommandIds = [
  'project.new',
  'project.open',
  'project.recoverAutosave',
  'project.save',
  'project.saveAs',
  'project.exportCopy',
  'project.exportBlueprint',
  'project.resetLesson',
  'edit.undo',
  'edit.redo',
  'view.zoomIn',
  'view.zoomOut',
  'view.fit',
  'view.reset',
  'workspace.saveLayout',
  'workspace.restoreLayout',
  'workspace.resetLayout',
  'stage.character',
  'stage.path',
  'stage.foundry',
  'stage.design',
  'stage.blueprint',
  'stage.assembly',
  'options.preferences',
  'help.shortcuts',
  'help.about'
] as const;
assert.equal(commandIds.size, APP_COMMANDS.length, 'application command ids are unique');
assert.deepEqual(APP_COMMANDS.map(command => command.id), expectedAppCommandIds, 'app command registry keeps the complete shell command inventory');
assert.deepEqual(APP_MENU_GROUPS.map(group => ({
  id: group.id,
  label: group.label,
  commandIds: [...group.commandIds]
})), [
  { id: 'file', label: 'File', commandIds: ['project.new', 'project.open', 'project.recoverAutosave', 'project.save', 'project.saveAs', 'project.exportCopy', 'project.exportBlueprint', 'project.resetLesson'] },
  { id: 'edit', label: 'Edit', commandIds: ['edit.undo', 'edit.redo'] },
  { id: 'view', label: 'View', commandIds: ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.reset', 'workspace.saveLayout', 'workspace.restoreLayout', 'workspace.resetLayout'] },
  { id: 'go', label: 'Go', commandIds: ['stage.character', 'stage.path', 'stage.foundry', 'stage.design', 'stage.blueprint', 'stage.assembly'] },
  { id: 'options', label: 'Options', commandIds: ['options.preferences'] },
  { id: 'help', label: 'Help', commandIds: ['help.shortcuts', 'help.about'] }
], 'shell menu groups keep the complete command inventory');
assert(APP_MENU_GROUPS.every(group => group.commandIds.length > 0), 'each app menu group has commands');
assert(APP_MENU_GROUPS.flatMap(group => group.commandIds).every(id => commandIds.has(id)), 'all menu command ids resolve to registry commands');
assert(APP_COMMANDS.every(command => APP_MENU_GROUPS.some(group => group.commandIds.some(id => id === command.id))), 'every command is rendered by a menu group');
assert(APP_COMMANDS.some(command => command.id === 'edit.undo' && command.shortcuts?.includes('Mod+Z')), 'undo is a real registered shortcut command');
assert(APP_COMMANDS.some(command => command.id === 'edit.redo' && command.shortcuts?.includes('Mod+Shift+Z')), 'redo is a real registered shortcut command');
assert(APP_COMMANDS.some(command => command.id === 'help.shortcuts' && command.shortcuts?.includes('?')), 'shortcut help command is globally reachable');
assert.equal(commandIdForKeyboardEvent({ key: '=', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }), 'view.zoomIn', 'zoom-in shortcut handles unshifted equals key');
assert.equal(commandIdForKeyboardEvent({ key: '+', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }), 'view.zoomIn', 'zoom-in shortcut handles shifted plus key');
assert.equal(commandIdForKeyboardEvent({ key: '=', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }), 'view.zoomIn', 'zoom-in shortcut handles Playwright/browser shifted equals encoding');
assert.equal(commandIdForKeyboardEvent({ key: '5', ctrlKey: false, metaKey: false, shiftKey: false, altKey: true }), 'stage.blueprint', 'stage shortcuts resolve through the registry');
assert(!APP_COMMANDS.some(command => /exit|updates/i.test(command.label)), 'browser menu omits old placeholder Exit and Check for Updates items');
APP_MENU_GROUPS.forEach(group => group.commandIds.forEach(id => assert.equal(commandById(id).menu, group.id, `${id} belongs to its declared menu group`)));
const appCommandSource = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
assert(appCommandSource.includes('satisfies Record<AppCommandId, () => void>'), 'App command handlers are type-exhaustive against AppCommandId');
const commandHandlerBlock = appCommandSource.match(/const commandHandlers = \{([\s\S]*?)\n\s*\} satisfies Record<AppCommandId, \(\) => void>;/)?.[1] ?? '';
assert(commandHandlerBlock, 'App.tsx exposes the typed command handler map');
assert.deepEqual(
  [...commandHandlerBlock.matchAll(/'([^']+)':/g)].map(match => match[1]).sort(),
  [...commandIds].sort(),
  'every visible shell command has exactly one App.tsx handler'
);
assert(appCommandSource.includes('setShowAbout(true)'), 'About command opens a real modal instead of only writing status text');
assert(!appCommandSource.includes('showDirectoryPicker'), 'browser UI omits fake output-folder selection until downloads can write there');
const visibleUiSource = [
  'App.tsx',
  'components/Canvas.tsx',
  'components/TrackingModal.tsx',
  'components/AppShell.tsx',
  'components/stages/stageLayout.tsx',
  'components/stages/blueprint/BlueprintExport.tsx',
  'components/stages/assembly/AssemblyWorkbench.tsx',
  'utils/fabrication.ts',
  'utils/assemblyPlayback.ts',
  'utils/mechanismTemplates.ts',
  'utils/appCommands.ts'
].map(file => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');
assert(!existsSync(join(process.cwd(), 'components', 'Controls.tsx')), 'runtime-unused legacy Controls component is deleted instead of preserved as dead UI');
assert(!existsSync(join(process.cwd(), 'utils', 'zStack.ts')), 'runtime-unused zStack helper is deleted instead of preserved as dead utility');
assert(!/Easy IK Setup/i.test(visibleUiSource), 'visible UI does not reintroduce sugar text like Easy IK Setup');
assert(!visibleUiSource.includes('Capture Camera'), 'browser hardware camera capture entry point is removed from visible UI');
assert(!visibleUiSource.includes('Choose Save Folder'), 'browser output-folder picker is removed from visible UI because downloads use the browser default location');
assert(!visibleUiSource.includes('CameraCaptureDialog'), 'browser hardware camera dialog component is removed');
assert(!visibleUiSource.includes('getUserMedia'), 'browser hardware camera capture API is not used by the app UI');
assert(existsSync(join(process.cwd(), 'public', 'fonts', 'manrope-800-latin.woff2')), 'Manrope splash font is self-hosted instead of loaded from a runtime CDN');
assert(existsSync(join(process.cwd(), 'resources', 'icons', 'AppIcon.png')) && existsSync(join(process.cwd(), 'resources', 'icons', 'AppIcon.icns')), 'canonical MotionSmith icon assets live under resources/icons');
assert(readFileSync(join(process.cwd(), 'components', 'AppShell.tsx'), 'utf8').includes("../resources/icons/AppIcon.png?url"), 'welcome splash and rail use the canonical resources icon');
assert(readFileSync(join(process.cwd(), 'App.tsx'), 'utf8').includes("./resources/icons/AppIcon.png?url"), 'top app bar uses the canonical resources icon');
assert(!readFileSync(join(process.cwd(), 'components', 'AppShell.tsx'), 'utf8').includes('src-tauri/icons/icon.png'), 'welcome splash does not reuse the old Tauri grid icon path');
assert(!readFileSync(join(process.cwd(), 'components', 'AppShell.tsx'), 'utf8').includes('<svg className="motionsmith-logo-mark"'), 'welcome splash does not keep an inline dummy logo SVG');
assert(readFileSync(join(process.cwd(), 'index.html'), 'utf8').includes("font-family: 'Manrope'") && readFileSync(join(process.cwd(), 'index.html'), 'utf8').includes('fonts/manrope-800-latin.woff2'), 'welcome splash uses a local Manrope wordmark font');
[
  'Add body part',
  'placeholder plates',
  'Mechanism Gallery',
  'Selected part detail',
  'Skeleton anchors',
  'Advanced import tools',
  'Technical checks',
  'review generated package',
  'Warnings: none',
  'Studio settings',
  'Enable Debug Visuals',
  'Show Detailed Processing Steps',
  'Parametric Edit',
  'Build steps',
  'Cut sheet package',
  'Selected blueprint detail',
  'Selected mechanism inspector',
  'Free path workflow',
  'Draw the motion path',
  'Next: choose mechanism',
  'Use this mechanism',
  'Anchor picked visually',
  'Open a small canvas overlay',
  'Tune the image/decal area',
  'Ranked from the current free path',
  'Apply adds a real editable mechanism instance',
  'Draw at least 3 free-path points',
  'Draw at least 3 points for a selected body part',
  'Use or skip the new character first',
  'Skeleton editing is available after package acceptance',
  'Select a point on the canvas for point-level edits',
  'Unlock the selected part before editing',
  'Part properties are hidden from Options',
  'Kinematic estimate',
  'Mechanism library',
  'Feasibility:',
  'Path Preview',
  'One registry drives the menu bar',
  'Cache ONNX model for faster image imports',
  'Static web workbench',
  'scene units from target to nearest board hole',
  'Scrub the mechanism once before cutting extra copies',
  'Collect the mechanism parts before touching the board',
  'Snap the completed mechanism module',
  'Export SVG + JSON',
  'Fast · fewer fit samples',
  'Letter paper · 15×15 board holes',
  'Drag a point, or click the canvas',
  'This exact contour drives',
  'review anchor before cutting',
  'Beginner kit mode',
  'Exploded moving stack order',
  'Run preview once, then cut and assemble',
  'Resolve warning before cutting',
  'sampled motion',
  'valid sampled',
  'general purpose linkage',
  'scene units from target',
  'scene units)',
  'to keep the stack captured',
  'moving parts float',
  'so clips do not bind',
  'Show Sensemaking',
  'Back to Gallery',
  'Start a fresh MotionSmith project',
  'Open a .motionsmith.json project file',
  'Application command menu',
  'Shared animation controls',
  'Replace current character and preserve compatible mechanisms',
  'Draw 3+ path points',
  'Foundry playback controls',
  'Mechanism Foundry true WebGL 3D sandbox preview',
  'Do not show this again',
  'Skip to editor',
  'Skip forever',
  'Rail motion path',
  'Rail mechanism parameters',
  'Rail export package',
  'Workflow and primary actions',
  'simulation only until a mechanism-reference recipe exists',
  'content/simulation only',
  'unsupported until a rack/pinion kit contract is added'
].forEach(phrase => assert(!visibleUiSource.includes(phrase), `visible UI omits over-explaining legacy copy: ${phrase}`));
const appCommandDocs = readFileSync(join(process.cwd(), 'docs', 'app-command-shortcuts.md'), 'utf8');
assert(appCommandDocs.includes('utils/appCommands.ts'), 'command registry documentation points to the executable registry');
assert(appCommandDocs.includes('Reset Lesson') && appCommandDocs.includes('preserving app settings'), 'command docs include the menu-only classroom Reset Lesson contract');
const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const physicsKernel = physicsKernelCapability();
const rapierProbe = await runRapierFrictionProbe({ frictionCoefficient: 0.74, steps: 150 });
const physicsKernelSource = readFileSync(join(process.cwd(), 'utils', 'physicsKernel.ts'), 'utf8');
const dockerfileText = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
const deployWorkflowText = readFileSync(join(process.cwd(), '.github', 'workflows', 'deploy.yml'), 'utf8');
const cargoTomlText = readFileSync(join(process.cwd(), 'src-tauri', 'Cargo.toml'), 'utf8');
const cargoLockText = readFileSync(join(process.cwd(), 'src-tauri', 'Cargo.lock'), 'utf8');
const tauriConfig = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'));
const deploymentDocs = readFileSync(join(process.cwd(), 'docs', 'deployment.md'), 'utf8');
const macosDocs = readFileSync(join(process.cwd(), 'docs', 'macos-distribution.md'), 'utf8');
const playwrightConfigText = readFileSync(join(process.cwd(), 'playwright.config.ts'), 'utf8');
assert(playwrightConfigText.includes('fullyParallel: true'), 'browser tests default to full parallel execution without reducing coverage');
assert(playwrightConfigText.includes('PLAYWRIGHT_WORKERS'), 'browser worker count can be tuned by environment instead of weakening tests');
assert(playwrightConfigText.includes('MAX_BROWSER_WORKERS'), 'browser worker defaults are bounded to avoid local over-parallelization');
assert(playwrightConfigText.includes('Number.isInteger'), 'browser worker override validates positive integer input');
assert(playwrightConfigText.includes('PLAYWRIGHT_SERVER') && playwrightConfigText.includes('preview'), 'browser tests can run against production preview without Vite HMR noise');
assert.equal(packageJson.version, '0.0.2', 'release version is bumped for the LFS-backed GitHub Pages redeploy');
assert.equal(tauriConfig.version, packageJson.version, 'Tauri config version stays aligned with package.json');
assert.deepEqual(tauriConfig.bundle.icon, ['icons/icon.png', 'icons/icon.ico', 'icons/icon.icns'], 'Tauri bundle references the tracked MotionSmith png, ico, and icns icons');
assert(cargoTomlText.includes(`version = "${packageJson.version}"`), 'Cargo.toml version stays aligned with package.json');
assert(cargoLockText.includes('name = "motionsmith"') && cargoLockText.includes(`version = "${packageJson.version}"`), 'Cargo.lock MotionSmith package version stays aligned with package.json');
assert.equal(packageJson.packageManager, 'bun@1.3.14', 'Bun is the canonical package manager');
assert.equal(packageJson.dependencies[PHYSICS_KERNEL_IMPORT], '^0.19.3', 'Rapier 3D compatibility WASM kernel is installed behind the physics subsystem boundary');
assert(!packageJson.dependencies['@react-three/fiber'] && !packageJson.dependencies['@react-three/rapier'] && !packageJson.dependencies['babylonjs'], 'renderer stack avoids extra scene frameworks while the imperative Three boundary is sufficient');
assert.equal(packageJson.scripts.build, 'tsc && vite build', 'browser build keeps Vite as the bundler for Rapier/Vite chunk handling');
assert(!Object.values(packageJson.scripts).some(script => String(script).includes('bun build')), 'browser scripts do not use Bun JS bundling for the Rapier runtime');
assert(physicsKernelSource.includes("import('@dimforge/rapier3d-compat')"), 'Rapier kernel uses a literal dynamic import so Vite emits a lazy Rapier chunk');
assert(!physicsKernelSource.includes('import(PHYSICS_KERNEL_IMPORT)'), 'Rapier kernel does not use a variable dynamic import that browsers cannot resolve after build');
assert.equal(physicsKernel.renderStack, PHYSICS_RENDER_STACK, 'physics capability keeps the imperative Three/WebGL2 renderer as the high-performance viewport stack');
assert.equal(physicsKernel.physicsKernel, PHYSICS_KERNEL_ENGINE, 'physics capability advertises Rapier as the contact/friction solver');
assert.equal(physicsKernel.updatePolicy, PHYSICS_UPDATE_POLICY, 'physics capability keeps mechanism kinematics authoritative while using Rapier for contact validation');
assert.equal(physicsKernel.scenePolicy, HIGH_THROUGHPUT_SCENE_POLICY, 'physics capability locks the Viser-style batching/transform-tree policy');
assert.equal(rapierProbe.engine, PHYSICS_KERNEL_ENGINE, 'Rapier probe runs through the selected physics kernel');
assert.equal(rapierProbe.initialized, true, 'Rapier WASM initializes in the contract harness');
assert.equal(rapierProbe.rigidBodyCount, 2, 'Rapier probe creates a real dynamic body plus ground body');
assert.equal(rapierProbe.colliderCount, 2, 'Rapier probe creates real friction-bearing colliders');
assert(rapierProbe.contactSettled, `Rapier friction probe settles on contact with finite speed: ${JSON.stringify(rapierProbe)}`);
assert(!existsSync(join(process.cwd(), 'package-lock.json')), 'npm lockfile is absent after Bun migration');
assert(packageJson.scripts['test:browser'].includes('bun run build') && packageJson.scripts['test:browser'].includes('PLAYWRIGHT_SERVER=preview'), 'browser test script validates the production build through preview mode');
assert(deployWorkflowText.includes('oven-sh/setup-bun@v2') && deployWorkflowText.includes('bun install --frozen-lockfile') && deployWorkflowText.includes('bun run build'), 'GitHub Pages workflow uses Bun install and build');
assert(deployWorkflowText.includes('lfs: true') && deployWorkflowText.includes('git lfs pull --include="public/onnx/pose_model.onnx"'), 'GitHub Pages workflow fetches real ONNX bytes from Git LFS before build');
assert(deployWorkflowText.includes('Check ONNX LFS asset') && deployWorkflowText.includes('Check built ONNX asset') && deployWorkflowText.includes('version https://git-lfs'), 'GitHub Pages workflow rejects Git LFS pointer files before upload');
assert(deployWorkflowText.includes('tags:') && deployWorkflowText.includes('v*.*.*') && !deployWorkflowText.includes('branches:'), 'GitHub Pages workflow deploys only from version tags');
assert(deployWorkflowText.includes('test "v${VERSION}" = "${GITHUB_REF_NAME}"'), 'GitHub Pages workflow requires the tag to match package.json version');
assert(deployWorkflowText.includes('VITE_BASE_PATH: /ms/'), 'GitHub Pages workflow builds assets under /ms/');
assert(dockerfileText.includes('FROM oven/bun:1.3.14-alpine') && dockerfileText.includes('bun install --frozen-lockfile') && dockerfileText.includes('\"preview\"'), 'Docker image uses Bun install, build, and preview runtime');
assert.equal(tauriConfig.build.beforeDevCommand, 'bun run dev', 'Tauri dev hook uses Bun');
assert.equal(tauriConfig.build.beforeBuildCommand, 'bun run build:tauri-frontend', 'Tauri build hook uses Bun');
assert(deploymentDocs.includes('bun install --frozen-lockfile') && !deploymentDocs.includes('npm '), 'deployment docs use Bun commands');
assert(deploymentDocs.includes('Classroom release checklist') && deploymentDocs.includes('v<package.json version>') && deploymentDocs.includes('VITE_BASE_PATH=/ms/'), 'deployment docs include the classroom /ms release checklist');
assert(deploymentDocs.includes('no `/api/` requests') && deploymentDocs.includes('Teacher pack workflow') && deploymentDocs.includes('no account, no upload'), 'deployment docs lock classroom release to static local-first teacher-pack flow');
assert(macosDocs.includes('bun run build:exe') && !macosDocs.includes('npm '), 'macOS distribution docs use Bun commands');
assert(agentsContract.includes('three` + Rapier WASM'), 'AGENTS.md records the selected high-performance 3D physics stack');
assert(agentsContract.includes('Viser-style transform tree'), 'AGENTS.md records the Viser-inspired batching rule for large scenes');
assert(agentsContract.includes('preserve coverage while optimizing wall time'), 'AGENTS.md requires test speedups to preserve test quality');
assert(agentsContract.includes('bounded Playwright parallel workers'), 'AGENTS.md requires bounded browser test parallelism');
assert(agentsContract.includes('bun run test') && agentsContract.includes('bun run build') && !agentsContract.includes('npm test'), 'AGENTS.md verification gates use Bun commands');
assert(agentsContract.includes('GitHub Pages is the only hosted web release path') && agentsContract.includes('https://alansynn.com/ms/') && agentsContract.includes('VITE_BASE_PATH=/ms/'), 'AGENTS.md locks the /ms GitHub Pages release path');
assert(agentsContract.includes('Deploy only from version tags') && agentsContract.includes('v<package.json version>') && agentsContract.includes('Do not re-enable `main` branch deployment'), 'AGENTS.md locks tag-only release deployment');
assert(agentsContract.includes('package.json') && agentsContract.includes('src-tauri/Cargo.toml') && agentsContract.includes('src-tauri/tauri.conf.json'), 'AGENTS.md requires browser and Tauri version alignment before release');
assert(agentsContract.includes('local-first browser/Tauri'), 'AGENTS.md excludes server scope and locks the app as local-first');
assert(agentsContract.includes('Do not add backend/API server'), 'AGENTS.md explicitly excludes backend/API/auth/cloud work unless reopened');
assert(agentsContract.includes('Guided classroom lesson templates must create real serializable `ProjectState` data') && agentsContract.includes('Blank starters stay mechanism-free'), 'AGENTS.md locks lesson templates to real state and keeps blank starters clean');
assert(agentsContract.includes('`Reset Lesson` must restore a known-good lesson baseline') && agentsContract.includes('preserving app settings'), 'AGENTS.md locks stable lesson reset semantics');
assert(agentsContract.includes('Blueprint owns build files') && agentsContract.includes('Assembly owns animated step-by-step build'), 'AGENTS.md preserves Blueprint versus Assembly role split');
assert(designContract.includes('Shared editor workbench'), 'DESIGN.md documents the shared editor workbench');
assert(designContract.includes('Project governance: `AGENTS.md`'), 'DESIGN.md points contributors at the project agent contract');
assert(designContract.includes('#8b5cf6'), 'DESIGN.md uses the MotionSmith light primary color');
assert(!designContract.includes('Cyber-Industrial Minimalism'), 'DESIGN.md no longer points contributors at the old dark CAD direction');
assert(docsMap.includes('active novice flow and tutorial/help plan'), 'docs map treats the novice tutorial plan as an active implementation plan');
assert(docsMap.includes('classroom field-study gap plan'), 'docs map treats the classroom field support plan as an active implementation plan');
assert(agentsContract.includes('tinkerable workbench'), 'AGENTS.md codifies the tinkerable workbench direction');
assert(agentsContract.includes('direct manipulation'), 'AGENTS.md prioritizes direct manipulation over explanatory text');
assert(agentsContract.includes('Result-first UI copy policy'), 'AGENTS.md locks result-first visible UI copy policy');
assert(agentsContract.includes('Visible runtime copy should be labels, status chips, direct actions, or blockers'), 'AGENTS.md blocks reading-heavy runtime copy');
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
assert(subsystemGovernanceContract.includes('Rapier'), 'subsystem governance records the Rapier contact/friction kernel decision');
assert(subsystemGovernanceContract.includes('Viser-style transform tree'), 'subsystem governance records batching/instancing as the large-scene policy');
assert(subsystemGovernanceContract.includes('Performance governance'), 'subsystem governance includes the performance-governance rules');
assert(subsystemGovernanceContract.includes('production preview build'), 'subsystem governance locks browser QA to shipped production preview evidence');
assert(noviceUiPlan.includes('## Tutorial layer PRD'), 'novice UI plan includes a concrete tutorial layer PRD');
assert(noviceUiPlan.includes('First-run checklist') && noviceUiPlan.includes('Completion derives from current `ProjectState`'), 'tutorial checklist is derived from real project state');
assert(noviceUiPlan.includes('Forbidden:') && noviceUiPlan.includes('tutorial tab') && noviceUiPlan.includes('center-canvas lesson cards'), 'tutorial plan forbids fake tutorial stages and center-canvas lessons');
assert(noviceUiPlan.includes('No new tour dependency') && noviceUiPlan.includes('Plain React state and CSS are enough'), 'tutorial plan avoids extra tour dependencies');
assert(classroomFieldPlan.includes('# Classroom Field Support Plan'), 'classroom field support PRD exists');
assert(classroomFieldPlan.includes('Web is mandatory for classrooms') && classroomFieldPlan.includes('https://alansynn.com/ms/'), 'classroom plan locks the web-first classroom release target');
assert(classroomFieldPlan.includes('Guided entry beats open exploration') && classroomFieldPlan.includes('Waving arm'), 'classroom plan requires guided lesson templates before open exploration');
assert(classroomFieldPlan.includes('Vocabulary must be English-only'), 'classroom plan forbids mixed-language UI vocabulary');
assert(classroomFieldPlan.includes('Details must be visible at the moment of action') && classroomFieldPlan.includes('Details'), 'classroom plan requires compact details without center-canvas teaching panels');
assert(classroomFieldPlan.includes('Stable reset and recovery') && classroomFieldPlan.includes('No rotation possible'), 'classroom plan requires stable reset for mechanism failure recovery');
assert(classroomFieldPlan.includes('Blueprint as build-file screen') && classroomFieldPlan.includes('Assembly as animated build screen'), 'classroom plan preserves Blueprint/Assembly ownership split');
assert(classroomFieldPlan.includes('No backend, auth, roster, analytics, cloud DB, teacher dashboard') && classroomFieldPlan.includes('Teacher pack workflow'), 'classroom plan excludes server scope while defining local teacher pack workflow');
assert(CLASSROOM_LESSONS.some(lesson => lesson.id === 'waving-arm' && lesson.label === 'Waving arm' && lesson.actionLabel === 'Open lesson'), 'guided classroom lesson catalog exposes the waving-arm lesson as an English-only entry point');
assert.equal(classroomLessonById('waving-arm')?.startStage, 'character', 'classroom lesson opens in Character so students inspect/edit the rig before drawing');
assert.equal(classroomLesson.metadata.classroomLessonId, 'waving-arm', 'lesson ProjectState carries resettable classroom lesson metadata');
assert.equal(classroomLesson.metadata.classroomLessonLabel, 'Waving arm', 'lesson ProjectState keeps the English-only classroom label');
assert.equal(classroomLesson.mechanisms.length, 1, 'waving-arm lesson includes one real fitted mechanism instead of a mock recommendation card');
assert.equal(classroomLesson.selectedPathId, 'path-right-arm', 'waving-arm lesson selects the editable hand path');
assert.equal(classroomLesson.selectedMechanismId, 'mech-1', 'waving-arm lesson selects the fitted four-bar mechanism');
assert.equal(classroomLesson.mechanisms[0].targetAnchorJointId, 'right_hand', 'waving-arm lesson drives the hand end-effector');
assert((classroomLesson.mechanisms[0].generatedPath?.length ?? 0) >= 3, 'waving-arm lesson mechanism has generated motion samples for simulation and fit checks');
const classroomLessonRoundTrip = loadProjectSnapshot(JSON.parse(serializeProject(classroomLesson)));
assert.equal(classroomLessonRoundTrip.mechanisms[0].groundLength, classroomLesson.mechanisms[0].groundLength, 'lesson load preserves fitted mechanism geometry');
assert(!validateForFabrication(classroomLessonRoundTrip).errors.some(error => error.includes('path outside sheet')), 'lesson load stays blueprint-ready');
assert.throws(() => createLessonProject('missing' as never), /Unknown classroom lesson/, 'invalid classroom lesson IDs fail loudly instead of silently creating blank projects');
const resetLessonState = resetProjectToLessonBaseline({
  ...classroomLesson,
  selectedPartId: 'head',
  mechanisms: [],
  settings: { ...classroomLesson.settings, animationSpeed: 1.7 }
});
assert(resetLessonState, 'classroom lesson can reset to a durable baseline');
assert.equal(resetLessonState?.settings.animationSpeed, 1.7, 'lesson reset preserves app settings while restoring lesson content');
assert.equal(resetLessonState?.mechanisms.length, 1, 'lesson reset restores the fitted mechanism');
assert.equal(resetLessonState?.selectedPartId, 'right_arm_lower', 'lesson reset restores the lesson selection baseline');
assert.equal(emptyProject.partOrder.length, 0, 'empty project starts with no preloaded character parts');
assert.equal(emptyProject.mechanisms.length, 0, 'empty project starts with no hidden mechanism');
assert.equal(emptyProject.selectedMechanismId, undefined, 'empty project starts with no selected mechanism');
assert.equal(starterSample.mechanisms.length, 0, 'default starter character opens clean with no demo mechanism');
assert(Object.keys(sample.skeleton?.joints ?? {}).length >= 17, 'sample placeholder exposes the full editable joint set');
for (const requiredPartId of ['left_arm_upper', 'left_arm_lower', 'left_hand_part', 'right_arm_upper', 'right_arm_lower', 'right_hand_part', 'left_leg_upper', 'left_leg_lower', 'left_foot_part', 'right_leg_upper', 'right_leg_lower', 'right_foot_part']) {
  assert(requiredPartId in sample.parts, `humanoid starter includes ${requiredPartId}`);
}
assert(sample.partOrder.every(id => ['#cbd5e1', '#e2e8f0', '#b6c2d2', '#d1d5db', '#94a3b8'].includes(sample.parts[id].fillColor)), 'sample character uses muted placeholder part colors');
assert.equal(sample.mechanisms[0].targetAnchorJointId, 'right_hand', 'sample waving arm drives the hand, not the shoulder root');
assert.deepEqual(motionAnchorJointIds(sample, 'right_arm_lower'), ['right_elbow', 'right_hand'], 'IK handle choices stay inside the selected lower-limb part');
assert.deepEqual(motionChainRootJointIds(sample, 'right_arm_lower', 'right_hand'), ['right_shoulder', 'right_elbow', 'right_hand'], 'IK chain root choices expose every ancestor from part root to handle');
assert.equal(preferredMotionJointId(sample, 'right_arm_lower', 'left_hand'), 'right_elbow', 'invalid IK anchor falls back to the target part root');

const replacementBase = createSampleProject({ includeMechanism: true });
const coarsePrevious: ProjectState = {
  ...replacementBase,
  parts: {
    ...replacementBase.parts,
    right_arm: {
      ...replacementBase.parts.right_arm_lower,
      id: 'right_arm',
      name: 'Right arm legacy',
      anchorJointId: 'right_shoulder',
      bounds: { x: -21, y: -75, width: 42, height: 150 },
      transform: { x: 98, y: 24, rotation: 18, scale: 1 }
    }
  },
  partOrder: [...replacementBase.partOrder.filter(id => !id.startsWith('right_arm_')), 'right_arm'],
  paths: {
    'legacy-wave': {
      ...replacementBase.paths['path-right-arm'],
      id: 'legacy-wave',
      partId: 'right_arm',
      targetAnchorJointId: undefined,
      chainRootJointId: undefined
    }
  },
  mechanisms: [{
    ...replacementBase.mechanisms[0],
    id: 'legacy-mech',
    targetPartId: 'right_arm',
    targetPathId: 'legacy-wave',
    targetAnchorJointId: 'right_hand',
    activeVisualPartIds: ['right_arm']
  }]
};
const retargetedReplacement = replaceCharacterProject(replacementBase, coarsePrevious, 'character');
assert.equal(retargetedReplacement.paths['legacy-wave'].partId, 'right_arm_lower', 'character replacement retargets legacy whole-arm paths to the reachable lower-arm part');
assert.equal(retargetedReplacement.paths['legacy-wave'].targetAnchorJointId, 'right_hand', 'character replacement backfills path handles from the mechanism target anchor');
assert.equal(retargetedReplacement.paths['legacy-wave'].chainRootJointId, 'right_shoulder', 'character replacement preserves legacy part root as expanded IK chain root when new skeleton supports it');
assert.equal(retargetedReplacement.mechanisms[0].targetPartId, 'right_arm_lower', 'character replacement retargets existing mechanisms by target joint, not exact old part id');
assert.equal(retargetedReplacement.mechanisms[0].targetPathId, 'legacy-wave', 'character replacement keeps compatible mechanism-path binding');
assert.equal(retargetedReplacement.mechanisms[0].targetAnchorJointId, 'right_hand', 'character replacement preserves driven handle joint');
assert(Math.abs((retargetedReplacement.mechanisms[0].groundLength ?? 0) - coarsePrevious.mechanisms[0].groundLength) < 1e-9, 'same-size replacement keeps mechanism dimensions stable');
assert(retargetedReplacement.characterPackage?.replacementContext?.rebindingSummary.includes('1/1 mechanisms rebound'), 'character replacement records a concrete rebinding summary');
const enlargedReplacement: ProjectState = {
  ...replacementBase,
  skeleton: replacementBase.skeleton ? {
    ...replacementBase.skeleton,
    joints: Object.fromEntries(Object.entries(replacementBase.skeleton.joints).map(([id, joint]) => [id, {
      ...joint,
      position: { x: joint.position.x * 1.5, y: joint.position.y * 1.5 }
    }]))
  } : null,
  parts: Object.fromEntries(Object.entries(replacementBase.parts).map(([id, part]) => [id, {
    ...part,
    transform: { ...part.transform, x: part.transform.x * 1.5, y: part.transform.y * 1.5 },
    bounds: { ...part.bounds, width: part.bounds.width * 1.5, height: part.bounds.height * 1.5 }
  }]))
};
const scaledReplacement = replaceCharacterProject(enlargedReplacement, coarsePrevious, 'path');
assert(Math.abs((scaledReplacement.mechanisms[0].groundLength ?? 0) - (coarsePrevious.mechanisms[0].groundLength ?? 0) * 1.5) < 1e-9, 'larger replacement scales mechanism link dimensions');
assert(Math.abs((scaledReplacement.mechanisms[0].anchorX ?? 0) - ((coarsePrevious.mechanisms[0].anchorX ?? 0) * 1.5)) < 1e-9, 'larger replacement repositions mechanism anchors with character scale');
assert(Math.abs(scaledReplacement.paths['legacy-wave'].points[0].x - (coarsePrevious.paths['legacy-wave'].points[0].x * 1.5)) < 1e-9, 'larger replacement scales retained path points around matching joints');
assert.deepEqual(SANITIZE_MECHANISM_TYPES, [...ALL_MECHANISM_TYPES], 'import sanitizer accepts every low-level mechanism template including crank');
const expectedReferenceAuthorableTypes: MechanismType[] = ['4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear'];
const expectedReferenceFoundryTypes: MechanismType[] = ['4bar', 'cam', 'gear', 'gear_linkage', 'planetary_gear'];
const unsupportedLegacyMechanismTypes: MechanismType[] = ['yoke', 'quick-return', 'rack-pinion', '5bar', '6bar'];
assert.deepEqual(AUTHORABLE_MECHANISM_TYPES, expectedReferenceAuthorableTypes, 'authorable mechanism types are exactly export-ready mechanism-reference recipes');
assert.deepEqual(REFERENCE_EXPORT_READY_TYPES, expectedReferenceAuthorableTypes, 'mechanism-reference export-ready types match the authoring contract');
assert.deepEqual(OPTIMIZER_MECHANISM_TYPES, expectedReferenceAuthorableTypes, 'optimizer searches export-ready mechanism-reference templates only');
assert.deepEqual(FOUNDRY_MECHANISM_TYPES, expectedReferenceFoundryTypes, 'Foundry exposes only visible mechanism-reference recipes');
assert.deepEqual(REFERENCE_FOUNDRY_TYPES, expectedReferenceFoundryTypes, 'mechanism-reference Foundry-visible types match the gallery contract');
assert(!AUTHORABLE_MECHANISM_TYPES.includes('crank'), 'bare crank stays a low-level driver, not a novice authoring template');
assert.equal(REFERENCE_MECHANISM_RECIPES.piston.canonicalKey, 'slider_crank', 'piston maps to the mechanism-reference slider_crank recipe');
unsupportedLegacyMechanismTypes.forEach(type => {
  const recipe = referenceRecipeForType(type);
  assert.equal(recipe.exportReady, false, `${type} is not export-ready in mechanism-reference`);
  assert.equal(recipe.foundryVisible, false, `${type} is hidden from Foundry until a physical recipe exists`);
  assert.deepEqual(recipe.requiredParts, [], `${type} has no required fabrication parts without a reference recipe`);
});
REFERENCE_EXPORT_READY_TYPES.forEach(type => {
  const recipe = referenceRecipeForType(type);
  recipe.assemblySteps.forEach(step => {
    assert.equal(step.coordRoles.length, step.coords.length, `${type} step ${step.index} keeps coord_roles aligned with coords`);
    const firstBoardIndex = step.coordRoles.findIndex(isBoardFixedCoordRole);
    const expectedBoardCoordinate = step.coords[firstBoardIndex >= 0 ? firstBoardIndex : 0] ?? '';
    assert.equal(step.boardCoordinate, expectedBoardCoordinate, `${type} step ${step.index} boardCoordinate follows the first board role, not a moving reference`);
    assert(step.stack.some(layer => layer.role === 'paper-fastener'), `${type} step ${step.index} stack includes a paper fastener`);
    const orders = step.stack.map(layer => layer.order);
    assert.deepEqual(orders, [...new Set(orders)].sort((a, b) => a - b), `${type} step ${step.index} stack orders are strictly increasing`);
    step.stack
      .filter(layer => layer.role === 'spacer' || layer.role === 'top-spacer')
      .forEach(layer => assert.equal(layer.part, 'spacers:s10', `${type} step ${step.index} spacer layer uses S10`));
  });
  assert.deepEqual(
    prefabAssemblySteps(createDefaultMechanism(type, `prefab-${type}-contract`), 'H8').map(step => step.boardCoordinate),
    recipe.assemblySteps.map(step => step.boardCoordinate),
    `${type} prefab assembly keeps mechanism-reference board/moving coordinate semantics`
  );
});
assert(isBoardFixedCoordRole('board'), 'mechanism-reference board role is board-fixed');
assert(isBoardFixedCoordRole('board_axle'), 'mechanism-reference compatibility board_axle role is board-fixed');
assert(!isBoardFixedCoordRole('link_joint_reference'), 'mechanism-reference floating link joints are not board-fixed');
assert(!isBoardFixedCoordRole('gear_handle_reference'), 'mechanism-reference gear handle references are not board-fixed');
assert.equal(referenceRecipeForType('4bar').assemblySteps.find(step => step.label === 'Close output link')?.boardCoordinate, 'I9', '4bar output link closes on board pivot I9, not floating G10');
assert.equal(referenceRecipeForType('4bar').assemblySteps.find(step => step.label === 'Add coupler')?.stack[0]?.role, 'link-joint-hole', '4bar G6 coupler joint is a floating link joint');
assert.equal(referenceRecipeForType('4bar').assemblySteps.find(step => step.label === 'Join output to coupler')?.stack[0]?.role, 'link-joint-hole', '4bar G10 output/coupler joint remains floating');
assert.equal(referenceRecipeForType('gear').title, 'Gear train', 'gear recipe title matches the visible gear-only Foundry label');
assert.equal(referenceRecipeForType('gear_linkage').assemblySteps.find(step => step.label === 'Add linkage output')?.stack[0]?.role, 'gear-handle-hole', 'gear-linkage output arm starts at an off-centre gear handle hole');
assert.equal(referenceRecipeForType('gear_linkage').assemblySteps.find(step => step.label === 'Add output connector')?.stack[0]?.role, 'link-end-hole', 'gear-linkage output connector is a moving link-end reference');
assert.equal(referenceRecipeForType('planetary_gear').assemblySteps.find(step => step.label === 'Add G3 moving planet gear')?.stack[0]?.role, 'carrier-hole', 'planetary planet axle sits on the moving carrier, not the board');
assert.equal(referenceRecipeForType('piston').assemblySteps.find(step => step.label === 'Add connecting rod')?.stack[0]?.role, 'link-joint-hole', 'slider-crank G6 rod joint is a floating link joint');
assert.equal(referenceRecipeForType('piston').assemblySteps.find(step => step.label === 'Add slider block')?.stack[0]?.role, 'link-end-hole', 'slider-crank block is a moving slider/link reference');
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
    targetPartId: 'right_arm_lower',
    targetPathId: 'path-right-arm',
    targetAnchorJointId: 'right_hand',
    activeVisualPartIds: ['right_arm_lower']
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
const gearMetadataMechanism = {
  ...createDefaultMechanism('gear', 'snapshot-gear-metadata'),
  crankLength: 50,
  rockerLength: 30,
  gearTrainRadii: [50, 20, 35, 30],
  driverGroupId: 'main-drive',
  driverPhaseOffset: 0.45
};
gearMetadataMechanism.groundLength = gearTrainPitchCenterDistance(gearMetadataMechanism);
gearMetadataMechanism.gearRatio = gearTrainOutputRatio(gearMetadataMechanism);
const sanitizedGearMetadata = sanitizeMechanismRuntime(gearMetadataMechanism);
assert.deepEqual(sanitizedGearMetadata.gearTrainRadii, [50, 20, 35, 30], 'sanitize preserves ordered gear train radii for multi-idler trains');
assert.equal(sanitizedGearMetadata.driverGroupId, 'main-drive', 'sanitize preserves driver group id');
assert.equal(sanitizedGearMetadata.driverPhaseOffset, 0.45, 'sanitize preserves CDMC-style driver phase offset');
const gearMetadataSnapshot = buildMechanismSnapshot({
  ...sample,
  mechanisms: [gearMetadataMechanism]
}, gearMetadataMechanism.id);
assert.deepEqual(gearMetadataSnapshot?.mechanism.gearTrainRadii, [50, 20, 35, 30], 'snapshot preserves multi-idler gear train radii');
assert.equal(gearMetadataSnapshot?.mechanism.driverGroupId, 'main-drive', 'snapshot preserves driver grouping metadata');
assert.equal(gearMetadataSnapshot?.mechanism.driverPhaseOffset, 0.45, 'snapshot preserves driver phase metadata');
assert.equal(buildMechanismSnapshot(sample, 'missing-mechanism'), null, 'missing mechanism snapshot returns null instead of fabricating data');
type FabricationManifest = {
  generated_by: string;
  source_ssot: string;
  grid_pitch_mm: number;
  hole_diameter_mm: number;
  managed_files: string[];
  parts: {
  gears: Array<{ key: string; teeth: number; pitch_radius_mm: number; root_radius_mm: number; outer_radius_mm: number; hole_diameter_mm: number; path: string; attachment_hole_centers_mm: number[][] }>;
  linkages: Array<{ key: string; label: string; path: string; cells: number; length_mm: number; pitch_mm: number; hole_count: number; hole_diameter_mm: number }>;
  ring_gears: Array<{ key: string; pitch_radius_mm: number; inner_tip_radius_mm: number; inner_root_radius_mm: number; outer_radius_mm: number; mount_radius_mm: number; mount_hole_centers_mm: number[][]; hole_diameter_mm: number; teeth: number }>;
  cams: unknown[];
  followers: unknown[];
  spacers: Array<{ key: string; label: string; path: string; outer_diameter_mm: number; inner_diameter_mm: number; hole_diameter_mm: number; hole_centers_mm: number[][]; stackable: boolean }>;
  };
};
const fabricationManifest = JSON.parse(readFileSync(join(process.cwd(), 'fabrication', 'manifest.json'), 'utf8')) as FabricationManifest;
const fabricationGeneratorPath = join(process.cwd(), 'fabrication', 'generate_fabrication_templates.py');
assert(existsSync(fabricationGeneratorPath), 'fabrication generator lives beside the generated package');
const fabricationGeneratorText = readFileSync(fabricationGeneratorPath, 'utf8');
assert(fabricationGeneratorText.includes('DEFAULT_GRID_PITCH_MM = 20.0'), 'fabrication generator owns the 20 mm board pitch convention');
assert(fabricationGeneratorText.includes('hole_diameter_mm=4.0'), 'fabrication generator owns the 4 mm hole convention');
assert(fabricationGeneratorText.includes('GearPreset("g24", "G3 / 3-space gear", 24)'), 'fabrication generator owns the G24 gear preset used by renderers');
assert(fabricationGeneratorText.includes('FollowerPreset("f4-roller"'), 'fabrication generator owns the roller follower preset used by Foundry');
assert(fabricationGeneratorText.includes('SOURCE_SSOT = "fabrication/generate_fabrication_templates.py"'), 'fabrication manifest source points at the checked-in generator');
const fabricationRuntimeText = readFileSync(join(process.cwd(), 'utils', 'fabrication.ts'), 'utf8');
const fabricationContractText = readFileSync(join(process.cwd(), 'utils', 'fabricationContract.ts'), 'utf8');
assert(fabricationContractText.includes(FABRICATION_SOURCE_SSOT), 'runtime fabrication contract declares the Python generator as source of truth');
assert(fabricationContractText.includes('FABRICATION_GEAR_RADIUS_PER_TOOTH_MM = 1.25'), 'runtime fabrication contract keeps the generator gear radius/tooth rule centralized');
assert(fabricationContractText.includes('FABRICATION_LINKAGE_WIDTH_MM = 14'), 'runtime fabrication contract keeps the generator linkage width centralized');
assert(fabricationContractText.includes("key: 's10'"), 'runtime fabrication contract keeps the S10 spacer centralized');
assert(fabricationRuntimeText.includes("from './fabricationContract'"), 'fabrication runtime consumes centralized fabricationContract instead of hardcoded primitive tables');
assert(!fabricationRuntimeText.includes("rootRadiusMm: 28.438"), 'runtime gear constants are no longer duplicated outside the centralized contract');
assert.equal(fabricationManifest.generated_by, 'fabrication/generate_fabrication_templates.py', 'fabrication manifest generated_by matches the checked-in generator');
assert.equal(fabricationManifest.source_ssot, 'fabrication/generate_fabrication_templates.py', 'fabrication manifest source_ssot matches the checked-in generator');
const generatedFabricationDir = mkdtempSync(join(tmpdir(), 'motionsmith-fabrication-'));
try {
  execFileSync('python3', [fabricationGeneratorPath, '--output', generatedFabricationDir], { cwd: process.cwd(), stdio: 'pipe' });
  const generatedManifest = JSON.parse(readFileSync(join(generatedFabricationDir, 'manifest.json'), 'utf8')) as FabricationManifest;
  assert.equal(generatedManifest.grid_pitch_mm, fabricationManifest.grid_pitch_mm, 'generator reproduces the committed grid pitch');
  assert.equal(generatedManifest.hole_diameter_mm, fabricationManifest.hole_diameter_mm, 'generator reproduces the committed hole diameter');
  assert.equal(generatedManifest.generated_by, 'fabrication/generate_fabrication_templates.py', 'regenerated manifest keeps the checked-in generator path');
  assert.equal(generatedManifest.source_ssot, 'fabrication/generate_fabrication_templates.py', 'regenerated manifest keeps the checked-in source-of-truth path');
  (['gears', 'linkages', 'cams', 'followers', 'spacers'] as const).forEach(category => {
    assert.deepEqual(generatedManifest.parts[category], fabricationManifest.parts[category], `regenerated ${category} primitives match the committed fabrication contract`);
  });
  assert.deepEqual(generatedManifest.managed_files, fabricationManifest.managed_files, 'regenerated fabrication package contains the committed managed-file set');
  fabricationManifest.managed_files.forEach(relPath => {
    assert.equal(
      readFileSync(join(generatedFabricationDir, relPath), 'utf8'),
      readFileSync(join(process.cwd(), 'fabrication', relPath), 'utf8'),
      `generator emits committed fabrication asset ${relPath}`
    );
  });
} finally {
  rmSync(generatedFabricationDir, { recursive: true, force: true });
}
assert.deepEqual(FABRICATION_GEAR_SPECS.map(spec => ({ key: spec.key, teeth: spec.teeth, pitchRadiusMm: spec.pitchRadiusMm, rootRadiusMm: spec.rootRadiusMm, outerRadiusMm: spec.outerRadiusMm, holeDiameterMm: spec.holeDiameterMm, path: spec.path, attachmentHoleCentersMm: spec.attachmentHoleCentersMm.map(point => [point.x, point.y]) })), fabricationManifest.parts.gears.map(spec => ({ key: spec.key, teeth: spec.teeth, pitchRadiusMm: spec.pitch_radius_mm, rootRadiusMm: spec.root_radius_mm, outerRadiusMm: spec.outer_radius_mm, holeDiameterMm: spec.hole_diameter_mm, path: spec.path, attachmentHoleCentersMm: spec.attachment_hole_centers_mm })), 'runtime gear primitives mirror fabrication/manifest.json');
assert.deepEqual(FABRICATION_LINKAGE_SPECS.map(spec => ({ key: spec.key, label: spec.label, path: spec.path, cells: spec.cells, lengthMm: spec.lengthMm, pitchMm: spec.pitchMm, holeCount: spec.holeCentersMm.length, holeDiameterMm: spec.holeDiameterMm })), fabricationManifest.parts.linkages.map(spec => ({ key: spec.key, label: spec.label, path: spec.path, cells: spec.cells, lengthMm: spec.length_mm, pitchMm: spec.pitch_mm, holeCount: spec.hole_count, holeDiameterMm: spec.hole_diameter_mm })), 'runtime linkage primitives mirror fabrication/manifest.json');
assert.deepEqual(FABRICATION_LINKAGE_SPECS.find(spec => spec.cells === 4)?.holeCentersMm, [{ x: 14, y: 14 }, { x: 34, y: 14 }, { x: 54, y: 14 }, { x: 74, y: 14 }, { x: 94, y: 14 }], 'runtime linkage holes follow generator capsule margin and pitch');
assert.equal(FABRICATION_LINKAGE_WIDTH_MM, 14, 'runtime linkage width is centralized from the Python generator convention');
assert.equal(FABRICATION_HOLE_RADIUS_MM, 2, 'runtime hole radius is centralized from the Python generator convention');
assert.deepEqual(FABRICATION_SPACER_SPEC, {
  source: FABRICATION_SOURCE_SSOT,
  key: fabricationManifest.parts.spacers[0].key,
  label: fabricationManifest.parts.spacers[0].label,
  path: fabricationManifest.parts.spacers[0].path,
  outerDiameterMm: fabricationManifest.parts.spacers[0].outer_diameter_mm,
  innerDiameterMm: fabricationManifest.parts.spacers[0].inner_diameter_mm,
  holeDiameterMm: fabricationManifest.parts.spacers[0].hole_diameter_mm,
  holeCentersMm: fabricationManifest.parts.spacers[0].hole_centers_mm.map(point => ({ x: point[0], y: point[1] })),
  stackable: fabricationManifest.parts.spacers[0].stackable
}, 'runtime S10 spacer primitive mirrors fabrication/manifest.json');
assert.deepEqual({ key: FABRICATION_RING_GEAR_SPEC.key, pitchRadiusMm: FABRICATION_RING_GEAR_SPEC.pitchRadiusMm, innerTipRadiusMm: FABRICATION_RING_GEAR_SPEC.innerTipRadiusMm, innerRootRadiusMm: FABRICATION_RING_GEAR_SPEC.innerRootRadiusMm, outerRadiusMm: FABRICATION_RING_GEAR_SPEC.outerRadiusMm, mountRadiusMm: FABRICATION_RING_GEAR_SPEC.mountRadiusMm, holeDiameterMm: FABRICATION_RING_GEAR_SPEC.holeDiameterMm, mountHoleCentersMm: FABRICATION_RING_GEAR_SPEC.mountHoleCentersMm.map(point => [point.x, point.y]) }, { key: fabricationManifest.parts.ring_gears[0].key, pitchRadiusMm: fabricationManifest.parts.ring_gears[0].pitch_radius_mm, innerTipRadiusMm: fabricationManifest.parts.ring_gears[0].inner_tip_radius_mm, innerRootRadiusMm: fabricationManifest.parts.ring_gears[0].inner_root_radius_mm, outerRadiusMm: fabricationManifest.parts.ring_gears[0].outer_radius_mm, mountRadiusMm: fabricationManifest.parts.ring_gears[0].mount_radius_mm, holeDiameterMm: fabricationManifest.parts.ring_gears[0].hole_diameter_mm, mountHoleCentersMm: fabricationManifest.parts.ring_gears[0].mount_hole_centers_mm }, 'runtime ring gear primitive mirrors fabrication/manifest.json');
assert.equal(fabricationGearSpecForPitchRadius(27).key, 'g24', 'gear display chooses the nearest fabrication preset by physical pitch radius');
const g24Profile = fabricationGearProfileForPitchRadius(60, 30);
assert.equal(g24Profile.source, FABRICATION_SOURCE_SSOT, 'gear profile declares the Python generator source');
assert.equal(g24Profile.preset.key, 'g24', 'gear profile preserves fabrication preset key');
assert.equal(g24Profile.outlinePoints.length, 96, 'G24 profile uses fabrication tooth segmentation, not sparse saw teeth');
assert.equal(g24Profile.attachmentHoleCenters.length, 4, 'G24 profile carries grid attachment holes into shared renderers');
assert(fabricationGearPathD(30, 30).startsWith('M 28.44 0 L 31.43 2.06 L 31.23 4.11'), 'shared SVG gear path matches fabrication gear outline convention');
assert(fabricationRingGearPathD(70).includes('M 90 0 A 90 90'), 'shared SVG ring gear path carries fabrication outer ring geometry');
assert(fabricationRingGearPathD(70).includes('68.54'), 'shared SVG ring gear path carries internal tooth geometry');
const defaultPlanetary = createDefaultMechanism('planetary_gear');
const planetaryLinkLengths = fabricationLinkageSceneLengthsForMechanism(defaultPlanetary);
assert.equal(planetaryLinkLengths.driver, defaultPlanetary.groundLength, 'planetary carrier linkage blank uses carrier radius, not short sun or planet radius');
assert.equal(
  fabricationLinkageHoleCountsForMechanism(defaultPlanetary).driver,
  fabricationLinkageSpecForSceneLength(defaultPlanetary.groundLength).holeCentersMm.length,
  'planetary carrier blank drills the nearest generator linkage for its actual carrier radius'
);
const couplerSpecForNonExactSpan = fabricationLinkageSpecForSceneLength(3 * 20 * SCENE_PX_PER_MM, 20, 4);
assert.equal(couplerSpecForNonExactSpan.cells, 4, 'min-hole linkage selection snaps non-exact spans to a generator-supported physical blank');
couplerSpecForNonExactSpan.holeCentersMm.slice(1).forEach((point, index) => {
  assert.equal(point.x - couplerSpecForNonExactSpan.holeCentersMm[index].x, 20, 'linkage hole spacing stays on the fabrication generator pitch');
});
const canvasText = readFileSync(join(process.cwd(), 'components', 'Canvas.tsx'), 'utf8');
const assemblyWorkbenchText = readFileSync(join(process.cwd(), 'components', 'stages', 'assembly', 'AssemblyWorkbench.tsx'), 'utf8');
const blueprintExportText = readFileSync(join(process.cwd(), 'components', 'stages', 'blueprint', 'BlueprintExport.tsx'), 'utf8');
const assemblyPlaybackText = readFileSync(join(process.cwd(), 'utils', 'assemblyPlayback.ts'), 'utf8');
const threePreviewText = readFileSync(join(process.cwd(), 'components', 'ThreePuppetPreview.tsx'), 'utf8');
const exporterText = readFileSync(join(process.cwd(), 'utils', 'exporter.ts'), 'utf8');
const physicsSessionText = readFileSync(join(process.cwd(), 'utils', 'physicsSession.ts'), 'utf8');
const mechanismPreviewText = readFileSync(join(process.cwd(), 'utils', 'mechanismPreview.ts'), 'utf8');
const viewportText = readFileSync(join(process.cwd(), 'utils', 'viewport.ts'), 'utf8');
const viewer3dText = readFileSync(join(process.cwd(), 'utils', 'viewer3d.ts'), 'utf8');
const webOnnxText = readFileSync(join(process.cwd(), 'utils', 'webOnnx.ts'), 'utf8');
const appText = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
const appShellText = readFileSync(join(process.cwd(), 'components', 'AppShell.tsx'), 'utf8');
const appUiText = `${appText}
${appShellText}`;
const typesText = readFileSync(join(process.cwd(), 'types.ts'), 'utf8');
const indexText = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
assert(canvasText.includes('fabricationGearPathD'), '2D canvas gear rendering uses shared fabrication gear geometry');
assert(canvasText.includes('data-reference-topology={referenceTopologySummary(m.type)}'), '2D design canvas exposes mechanism-reference topology telemetry');
assert(canvasText.includes('data-reference-coord-roles={coordRoleSummary}'), '2D design canvas exposes mechanism-reference coordinate role telemetry');
assert(canvasText.includes('const showCrankDriver = !hasNoCrankDriverInCanvas(m.type)'), '2D design canvas does not draw generic crank rods over gear/cam/planetary mechanisms');
assert(canvasText.includes("if (type === 'gear') return 'fixed gear centers only; no rods; external mesh sequence'"), '2D design canvas labels gear trains as gears-only mechanisms');
assert(canvasText.includes("if (type === 'cam') return 'rotating cam profile; guided follower block; no linkage rods'"), '2D design canvas labels cam followers as cam-plus-follower mechanisms');
assert(canvasText.includes('RingGearPath') && canvasText.includes('planetaryPlanetSpinRatio'), '2D design canvas renders planetary gears as ring/sun/planet/carrier geometry');
assert(assemblyWorkbenchText.includes('isBoardFixedCoordRole') && assemblyWorkbenchText.includes('data-floating-reference-coords'), 'assembly workbench separates board-fixed holes from moving reference coordinates');
assert(assemblyWorkbenchText.includes('assembly-floating-references') && assemblyWorkbenchText.includes('readableCoordRole'), 'assembly workbench visualizes moving references without turning them into board holes');
assert(threePreviewText.includes('fabricationGearProfileForPitchRadius'), '3D foundry gear rendering uses shared fabrication gear geometry');
assert(threePreviewText.includes('FABRICATION_LINKAGE_WIDTH_3D') && threePreviewText.includes('FABRICATION_HOLE_RADIUS_3D'), '3D puppet mechanism links use centralized fabrication linkage and hole dimensions');
assert(threePreviewText.includes('sharedGeometryCache') && threePreviewText.includes('sharedFabricationGeometry'), '3D puppet preview caches fabrication geometry instead of rebuilding primitive meshes every frame');
assert(threePreviewText.includes('const renderedMechanisms = useMemo(() => selectedMechanism ? [selectedMechanism] : []'), 'Design 3D preview renders the selected mechanism geometry while inventory telemetry covers the full project');
assert(!threePreviewText.includes('scene.traverse(child =>'), '3D puppet preview does not traverse the whole scene every animation frame for telemetry');
assert(threePreviewText.includes('fabricationRenderPlanForMechanism'), 'Mechanism Design 3D preview uses the same fabrication stack plan as Foundry');
assert(threePreviewText.includes('data-three-stack-source'), 'Mechanism Design exposes fabrication stack provenance for browser verification');
assert(exporterText.includes('fabricationGearPathD'), 'SVG export gear rendering uses shared fabrication gear geometry');
assert(appText.includes('fabricationGearProfileForPitchRadius'), 'Foundry gear helper uses shared fabrication gear holes/profile');
assert(appText.includes('FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM') && appText.includes('FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM'), 'Foundry 2D mechanism plates use centralized fabrication linkage and hole dimensions');
assert(appText.includes('fabricationRingGearPathD'), '2D Foundry planetary preview uses shared ring gear geometry');
assert(appText.includes('fabricationRingGearProfileForPitchRadius'), '3D Foundry ring uses shared fabrication ring gear geometry');
assert(appText.includes('SHARED_PLAYBACK_STAGES') && appText.includes('!SHARED_PLAYBACK_STAGES.includes(stage)'), 'shared playback rAF only runs on stages that actually consume the animated angle');
assert(appText.includes('FOUNDRY_ANIMATION_COMMIT_MS') && appText.includes('data-three-animation-commit-ms'), 'Foundry exposes a bounded animation commit budget for browser perf tests');
assert(appText.includes('time - (elapsed % FOUNDRY_ANIMATION_COMMIT_MS)'), 'Foundry playback carries requestAnimationFrame remainder instead of dropping animation time under load');
assert(appText.includes("scene.remove(old)") && appText.includes("disposeThreeObject(old)"), 'Foundry disposes noncached dynamic resources when replacing animation groups');
assert(appText.includes('geometryCacheRef') && appText.includes('materialCacheRef'), 'Foundry caches reusable Three geometry/material resources during playback');
assert(appText.includes('foundryCached') && appText.includes('data-three-geometry-cache-size'), 'Foundry tags cached resources and exposes cache size for browser perf tests');
assert(appText.includes('const geom = new THREE.BufferGeometry().setFromPoints(points.map(point => to3(point, z)))'), 'Foundry path/trail line geometry is intentionally not long-cached because it can be phase-dependent');
assert(mechanismPreviewText.includes('sweepBounds') && appText.includes('data-three-fit-bounds=\"phase-invariant-sweep\"'), 'Foundry fitting bounds are sampled in the shared preview utility instead of jittering per animation frame');
assert(appText.includes('data-three-static-grid-mode=\"persistent-scene-layer\"'), 'Foundry grid and plane live in a persistent scene layer, not the per-frame dynamic group');
assert(mechanismPreviewText.includes('export const fitMechanismSimulation'), 'Foundry fitting/sweep simulation lives in the mechanism preview utility, not as stage-local UI code');
assert(mechanismPreviewText.includes('createMechanismFitContext') && appText.includes('createMechanismFitContext(landedFoundry, 360, 240, 96)'), 'Foundry caches phase-invariant fit bounds instead of resampling the sweep every animation tick');
assert(appText.includes('buildFoundryPhysicsOverlay') && physicsSessionText.includes('export const buildFoundryPhysicsOverlay'), 'Foundry force/velocity/constraint overlay math lives in PhysicsSession, not the React stage');
assert(appText.includes('useMemo(() => sampleFeasibleRange(landedFoundry), [landedFoundry])'), 'Foundry feasible-range sampling is memoized by mechanism, not re-run on every animation render');
assert(viewportText.includes('WEBGL_PIXEL_RATIO_CAP') && appText.includes('WEBGL_PIXEL_RATIO_CAP') && threePreviewText.includes('WEBGL_PIXEL_RATIO_CAP'), 'WebGL renderer pixel ratio cap is shared across Foundry and puppet previews');
assert(threePreviewText.includes("const PUPPET_CAMERA_PRESETS: Viewer3DCameraPreset[] = ['front', 'iso']"), 'puppet viewer toolbar exposes only the fixed 2D and orbitable 3D modes');
assert(threePreviewText.includes('onWheel={handleViewerWheel}') && threePreviewText.includes('data-camera-yaw'), 'puppet 3D canvas exposes direct wheel zoom and orbit state for browser verification');
const pathStageStart = appText.indexOf('stage="path"');
const pathCanvasStart = appText.indexOf('canvas: canvasPane', pathStageStart);
const pathInspectorStart = appText.indexOf('inspector: inspectorPane', pathCanvasStart);
const pathCanvasBlock = appText.slice(pathCanvasStart, pathInspectorStart);
assert(pathCanvasBlock.includes('path-view-2d') && pathCanvasBlock.includes('path-view-3d'), 'Path Editor exposes a persistent 2D/3D Path view switch');
assert(pathCanvasBlock.includes("pathViewMode === '2d' ? <SceneSketch"), 'Path Editor 2D view uses editable SceneSketch for viewing, drawing, and point editing');
assert(pathCanvasBlock.includes('<ThreePuppetPreview') && pathCanvasBlock.includes('testId="path-three-puppet"'), 'Path Editor 3D view uses ThreePuppetPreview');
assert(pathCanvasBlock.includes("cameraPresets={['iso']}"), 'Path Editor 3D preview hides the preview-only 2D camera preset so editable 2D has one owner');
assert(!pathCanvasBlock.includes('drawMode ? <SceneSketch'), 'Draw mode does not mount a special duplicate drawing canvas; it only forces the 2D Path view');
assert(appText.includes("setPathViewMode('2d')"), 'Starting free-path drawing forces Path view back to 2D');
assert(indexText.includes('bottom: calc(var(--ms-bottom-bars-height) + 10px)') && !indexText.includes('--ms-status-bar-height'), 'character import status dock floats 10px above the bottom status area instead of covering the canvas');
assert(indexText.includes('.stage-player-row { position: absolute;') && appUiText.includes('data-testid="workspace-player-drag-handle"'), 'shared animation dock is an overlay with a draggable handle instead of a layout row');
assert(appText.includes('data-three-pixel-ratio-cap') && threePreviewText.includes('data-three-pixel-ratio-cap'), '3D previews expose the pixel-ratio cap for browser performance checks');
assert.equal(WEBGL_PIXEL_RATIO_CAP, 1.5, 'WebGL pixel-ratio cap avoids high-DPI overdraw while preserving sharp CAD-style previews');
assert(!appText.includes('starShape'), 'Foundry sandbox no longer carries saw-tooth star gears');
assert(!appText.includes('teeth * 2'), 'Foundry sandbox no longer carries sparse saw-tooth gear implementation');
assert(appText.includes("if (key === 'gearRatio') return false"), 'Foundry hides stale gear-ratio controls when physical pitch radii define rotation');
const fitContext = createMechanismFitContext(sample.mechanisms[0], 360, 240, 96);
const directFit = fitMechanismSimulation(sample.mechanisms[0], 1.234, 360, 240, 96);
const cachedFit = fitMechanismSimulationWithContext(sample.mechanisms[0], 1.234, fitContext);
assert.deepEqual(cachedFit.pathPoints, directFit.pathPoints, 'cached Foundry fit preserves the direct preview path exactly');
assert(Math.hypot(cachedFit.state.effector.x - directFit.state.effector.x, cachedFit.state.effector.y - directFit.state.effector.y) < 1e-9, 'cached Foundry fit maps the live effector exactly like direct fit');
assert(!canvasText.includes('toothWidth'), '2D canvas no longer carries a separate saw-tooth gear implementation');
assert(!threePreviewText.includes('teeth * 2'), '3D preview no longer carries a separate saw-tooth gear implementation');
assert(threePreviewText.includes('fabricablePartOutlinePoints'), '3D puppet preview uses shared model/user contour outlines instead of raw image crop rectangles');
assert(webOnnxText.includes('contourFromCropMask') && webOnnxText.includes("contourSource: crop.contourPoints.length >= 3 ? 'onnx-mask'"), 'browser ONNX preserves mask-derived part contours for fabrication plates');
assert(webOnnxText.includes('MODEL_CACHE_NAME') && webOnnxText.includes('caches.open') && webOnnxText.includes('warmWebOnnxCache'), 'browser ONNX model can be separately downloaded and cached');
assert(webOnnxText.includes('GIT_LFS_POINTER_PREFIX') && webOnnxText.includes('deleteCachedModel') && webOnnxText.includes("cache: 'reload'"), 'browser ONNX rejects stale Git LFS pointer caches and refetches model bytes');
assert(webOnnxText.includes('MODEL_BYTES_HEADER') && webOnnxText.includes('x-motionsmith-model-bytes'), 'browser ONNX marks valid cached model bytes to avoid treating pointer files as ready');
assert(webOnnxText.includes('InferenceSession.create(new Uint8Array(modelBuffer)'), 'browser ONNX creates sessions from cached model bytes');
assert(webOnnxText.includes("import('onnxruntime-web')") && !webOnnxText.includes("import * as ort from 'onnxruntime-web'"), 'ONNX Runtime JS is lazy-loaded outside the initial editor shell bundle');
assert(appUiText.includes('data-testid="onnx-cache-status"') && appText.includes('checkWebOnnxCache'), 'status bar exposes ONNX cache/download status');
assert(indexText.includes('id="boot-loader"') && indexText.includes('Loading…'), 'static boot loader covers slow startup');
assert(viewer3dText.includes('VIEWER3D_CAMERA_PRESETS') && threePreviewText.includes('three-puppet-view-toolbar') && appText.includes('foundryPreset'), '3D puppet and foundry previews share one viewer camera preset contract');
assert(viewer3dText.includes('type Viewer3DContract') && viewer3dText.includes('createViewer3DContract'), '3D viewers expose one shared OOP-style contract object for tab adapters');
assert(threePreviewText.includes('DEFAULT_PUPPET_VIEWER_LAYERS') && threePreviewText.includes('data-testid={`${testId}-toggle-${layer}`}') && appText.includes('foundry-toggle-grid'), '3D viewer top overlay toolbar wires shared layer toggles instead of decorative buttons');
assert(appText.includes('data-viewer-contract={VIEWER3D_CONTRACT_VERSION}') && threePreviewText.includes('data-viewer-contract={VIEWER3D_CONTRACT_VERSION}'), '3D viewer state exposes a shared contract marker across tabs');
assert(appText.includes('data-viewer-contract-state={JSON.stringify(viewerContract)}') && threePreviewText.includes('data-viewer-contract-state={JSON.stringify(viewerContract)}'), '3D viewer state exposes the normalized tab/layer contract payload for browser checks');
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
assert(appUiText.includes('splash-dialog') && appShellText.includes('MOTIONSMITH'), 'first-run welcome is a compact MotionSmith wordmark splash dialog');
assert(appShellText.includes('MotionSmithLogoMark') && appShellText.includes('../resources/icons/AppIcon.png?url') && !appShellText.includes('../src-tauri/icons/icon.png?url'), 'first-run welcome uses the canonical MotionSmith app icon instead of the old blue grid path');
assert(appText.includes('./resources/icons/AppIcon.png?url') && indexText.includes('.app-header-icon'), 'top bar renders the canonical MotionSmith app icon with dedicated sizing');
assert(indexText.includes("font-family: 'Manrope'") && indexText.includes('fonts/manrope-800-latin.woff2'), 'first-run welcome uses self-hosted Manrope wordmark styling');
assert(appShellText.includes('window.setTimeout') && appShellText.includes('5000') && appShellText.includes('window.clearTimeout'), 'first-run welcome auto-dismisses after five seconds');
assert(!appShellText.includes('Skip forever') && !appShellText.includes('>Start<'), 'first-run welcome is logo-only without persistence/start controls');
assert(indexText.includes('--ms-font-sans') && indexText.includes('font-family: var(--ms-font-sans)') && indexText.includes('.brand-title'), 'global typography uses the shared modern MotionSmith font stack');
assert(appText.includes('app-header-brand') && appText.includes('app-header-actions') && appText.includes('quick-toolbar'), 'top app bar separates brand, menus, and quick actions into compact zones');
assert(indexText.includes('.app-header-brand') && indexText.includes('.app-header-actions') && indexText.includes('border-radius: 999px'), 'top app bar keeps the brand and current stage in one slick editor row');
assert(!appText.includes('flex flex-col items-end gap-2'), 'top app bar does not stack menu and quick actions vertically');
assert(appText.includes('readStorageWithLegacy') && appText.includes('migrateStorageValue'), 'MotionSmith storage rename keeps legacy autosave/workspace migration hooks');
assert(!appUiText.includes('MOTIONSMITH_VIDEO_URL'), 'welcome splash does not embed the old preview video');
assert(appUiText.includes('getting-started-dialog') && appUiText.includes('getting-started-gallery'), 'Getting Started is an explicit compact starter dialog');
assert(appUiText.includes('Start a character.'), 'Getting Started uses a short result-oriented heading');
assert(appUiText.includes('getting-started-card-humanoid') && appUiText.includes('getting-started-card-image') && appUiText.includes('getting-started-card-package') && appUiText.includes('getting-started-card-${template.id}') && appText.includes("id: 'girl'") && appText.includes("id: 'boy'"), 'Getting Started exposes compact starter/result choices including Girl and Boy');
assert(!appUiText.includes('Local browser processing') && !appUiText.includes('Load art + skeleton') && !appUiText.includes('Full body rig') && !appUiText.includes('Browser ONNX rigging'), 'Getting Started avoids process/explanation copy');
assert(!appUiText.includes('lesson-template-'), 'Getting Started does not show lesson cards in the first screen');
assert(indexText.includes('.starter-thumb { width: 2.25rem; height: 2.25rem;'), 'Girl/Boy starter thumbnails stay compact');
assert(appText.includes('return { present: createEmptyProject(), past: [], future: [] }'), 'App initializes an empty project instead of preloading a character');
assert(appText.includes('setProject(createEmptyProject(), { resetHistory: true })'), 'New Project resets to an empty project instead of a starter character');
assert(appText.includes("returnStage: 'character'"), 'Accepted character loads stay in the Character tab instead of jumping to Path');
assert(appText.includes('setShowGettingStarted(!hideNextTime)'), 'Splash close opens Getting Started unless a legacy hide flag is present');
assert(appText.includes('onOpenGettingStarted'), 'Character tab can reopen Getting Started without owning its starter gallery');
assert(!appText.includes('Start with character art'), 'Character tab no longer carries the old hero/onboarding copy');
assert(!indexText.includes('.onboarding-page'), 'CSS no longer keeps a full-screen onboarding page mode');
assert(!indexText.includes('.welcome-simple'), 'CSS no longer keeps the old welcome video layout');
assert(appText.includes('character-setup-panel'), 'Character tab exposes direct part settings instead of only getting-started cards');
assert(appText.includes('character-part-list') && appText.includes('character-part-item-${part.id}'), 'Character tab owns body-part selection in the left workflow pane');
assert(appText.includes('viewport={viewport} setViewport={setViewport} inputMode="always" testId="character-three-puppet"'), 'Character preview uses the shared canvas viewport and direct 2D/3D input instead of a detached default viewport');
assert(appText.includes("setStage('character')"), 'Character edit controls stay in the functional Character tab');
assert(appText.includes('Art width') && appText.includes('Art offset X'), 'Character part inspector exposes artwork extent and offset controls');
assert(appText.includes('data-testid="part-cut-controls"') && appText.includes('Cut point X') && appText.includes('Edit current cut'), 'Character part inspector exposes detailed editable cut-outline controls');
assert(appText.includes("contourSource: 'user'") && appText.includes('Use joint-chain cut') && appText.includes('Add midpoint'), 'Character cut editor writes user contours and can bake/add contour points');
assert(appText.includes('data-testid={`path-part-art-${part.id}`}') && appText.includes('part.bounds.x * part.transform.scale'), 'Path Editor renders artwork from the editable part bounds offset');
assert(canvasText.includes('data-testid={`design-part-art-${part.id}`}') && canvasText.includes('part.bounds.x * part.transform.scale'), 'Mechanism Design renders artwork from the same editable part bounds offset');
assert(appText.includes('partOutlinePathD(part, landmarks') && appText.includes('path-part-surface-mask'), 'Path Editor clips part art to the shared fabrication outline and hole mask');
assert(canvasText.includes('partOutlinePathD(part, landmarks') && canvasText.includes('design-part-surface-mask'), 'Mechanism Design clips part art to the shared fabrication outline and hole mask');
assert(appText.includes('Choose new character.'), 'Character tab disables active-project artwork edits while a package review is pending');
assert(appText.includes('disabled={partPanelDisabled} onClick={onEditCharacter}'), 'Pending package review disables active-character edit buttons');
assert(appText.includes('disabled={partPanelDisabled} onClick={onSaveSkeleton}'), 'Pending package review disables active skeleton save controls');
assert(appText.includes('stage-body editor-workbench relative min-h-0 flex-1 overflow-hidden'), 'shared workbench prevents right-pane scroll from moving the center canvas');
assert(appText.includes('const [showSensemaking, setShowSensemaking] = useState(false)'), 'Foundry starts in compact tinkerable mode with sensemaking collapsed');
assert(appText.includes('compact-fabrication-stack') && appText.includes('data-testid="foundry-fabrication-stack"'), 'Foundry keeps fabrication stack visible as a compact action datum');
assert(typesText.includes("'assembly'"), 'AppStage includes a dedicated Assembly tab');
assert(appUiText.includes("{ id: 'assembly', label: 'Assembly' }"), 'workflow rail exposes Assembly as a separate stage');
const blueprintCanvasStart = blueprintExportText.indexOf('canvas: canvasPane(<div className="blueprint-document-preview canvas-workspace" data-testid="blueprint-canvas-preview">');
const blueprintInspectorStart = blueprintExportText.indexOf('inspector: inspectorPane(<section className="stage-pane-stack" data-testid="blueprint-detail-preview">', blueprintCanvasStart);
assert(blueprintCanvasStart >= 0 && blueprintInspectorStart > blueprintCanvasStart, 'Blueprint layout exposes printable 2D canvas and cut-sheet inspector slots');
const blueprintCanvasBlock = blueprintExportText.slice(blueprintCanvasStart, blueprintInspectorStart);
const blueprintInspectorBlock = blueprintExportText.slice(blueprintInspectorStart, blueprintExportText.indexOf('        }}', blueprintInspectorStart));
assert(blueprintCanvasBlock.includes('blueprint-svg-preview'), 'Blueprint center canvas previews the printable SVG cut sheet');
assert(!blueprintCanvasBlock.includes('<Canvas project={project}'), 'Blueprint center canvas is a static output sheet, not the animated 3D/2.5D workbench');
assert(!blueprintCanvasBlock.includes('assembly-guide-web-preview') && !blueprintInspectorBlock.includes('assembly-guide-web-preview'), 'Blueprint no longer embeds the assembly guide document');
const assemblyStart = appText.indexOf('const AssemblyGuide =');
assert(assemblyStart >= 0, 'AssemblyGuide component owns the assembly document workflow');
const assemblyBlock = appText.slice(assemblyStart, appText.indexOf('const Options =', assemblyStart));
assert(assemblyBlock.includes('data-testid="assembly-canvas-preview"') && assemblyBlock.includes('<AssemblyWorkbench'), 'Assembly tab renders the interactive stepper in the center canvas');
assert(assemblyWorkbenchText.includes('data-testid="assembly-stepper-workbench"'), 'Assembly workbench exposes a testable interactive stepper surface');
assert(assemblyPlaybackText.includes('export const pendingRecipeForMechanism') && assemblyPlaybackText.includes('buildAssemblyPlaybackSteps'), 'Assembly recipe/playback derivation lives outside App.tsx');
assert(assemblyPlaybackText.includes("motion: 'stack-layer'") && assemblyPlaybackText.includes("motion: 'move-to-board'") && assemblyPlaybackText.includes("motion: 'connect-character'") && assemblyPlaybackText.includes("motion: 'test-motion'"), 'Assembly playback declares a visual motion mode for every build phase');
assert(appText.includes('stepProgressRef') && appText.includes('window.requestAnimationFrame(tick)'), 'Assembly playback advances with rAF progress instead of only jumping static steps');
assert(assemblyWorkbenchText.includes('progress = 0') && assemblyWorkbenchText.includes('data-step-progress') && assemblyWorkbenchText.includes('moduleTranslate'), 'Assembly workbench receives live progress and moves the mechanism module per step');
assert(assemblyWorkbenchText.includes('data-testid="assembly-parts-tray"') && assemblyWorkbenchText.includes('data-testid="assembly-mount-motion"') && assemblyWorkbenchText.includes('data-testid="assembly-character-connect"') && assemblyWorkbenchText.includes('data-testid="assembly-motion-dot"'), 'Assembly workbench visualizes parts, mounting, character connection, and test motion as step-specific simulation states');
assert(!assemblyBlock.includes('data-testid="assembly-guide-preview-frame"'), 'Assembly center no longer defaults to an iframe document preview');
assert(assemblyBlock.includes('data-testid="assembly-guide-preview"'), 'Assembly tab keeps selected recipe detail in the right inspector');
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
const userContourPart: BodyPartLayer = {
  ...oversizedCutPart,
  contourSource: 'user',
  contourPoints: [{ x: -12, y: -18 }, { x: 30, y: -10 }, { x: 20, y: 28 }, { x: -22, y: 18 }]
};
assert.deepEqual(fabricablePartOutlinePoints(userContourPart, oversizedLocalJoints), userContourPart.contourPoints, 'user/model contour overrides fallback joint-chain plate generation');
const invalidContourPart: BodyPartLayer = {
  ...oversizedCutPart,
  contourSource: 'user',
  contourPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]
};
const invalidFallbackBounds = partOutlineBounds(fabricablePartOutlinePoints(invalidContourPart, oversizedLocalJoints));
assert(invalidFallbackBounds.width > 20 && invalidFallbackBounds.height > 100, 'degenerate imported contours fall back to the joint-chain plate instead of creating invisible geometry');
const contourRoundTripProject = loadProjectSnapshot(JSON.parse(serializeProject({
  ...sample,
  parts: { ...sample.parts, head: { ...sample.parts.head, contourSource: 'user', contourPoints: userContourPart.contourPoints } }
})));
assert.deepEqual(contourRoundTripProject.parts.head.contourPoints, userContourPart.contourPoints, 'project save/load preserves user-defined part contour points');
const editedContourProject = applyProjectAction(sample, { type: 'update_part', partId: 'head', updates: { contourSource: 'user', contourPoints: [{ x: -18, y: -24 }, { x: 24, y: -18 }, { x: 30, y: 28 }, { x: -20, y: 30 }] } });
assert.deepEqual(fabricablePartOutlinePoints(editedContourProject.parts.head, partLandmarkLocalPoints(editedContourProject.parts.head, editedContourProject.skeleton)), editedContourProject.parts.head.contourPoints, 'character cut editor updates the shared fabrication outline used by every renderer/exporter');
const packageContourProject = createProjectFromPackageData(
  { parts: { head: { name: 'Head', roi: [0, 0, 80, 80], anchor_joint_id: 'neck', contour_points: userContourPart.contourPoints, contour_source: 'user' } } },
  { width: 160, height: 160, joints: sample.skeleton!.joints, bones: sample.skeleton!.bones, root_joint_ids: sample.skeleton!.rootJointIds },
  {},
  'contour package'
);
assert.deepEqual(packageContourProject.parts.head.contourPoints, userContourPart.contourPoints, 'package import preserves explicit contour points from parts_info');
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
assert.equal(describeMotionChain(sample, 'right_arm_lower', 'right_elbow').kind, 'root-only', 'root anchor is labeled as a root-only chain');
assert.equal(describeMotionChain(sample, 'right_arm_lower', 'right_hand').kind, 'two-joint-direct', 'hand handle is labeled as a 2-joint direct chain by default');
assert.equal(describeMotionChain(sample, 'right_arm_lower', 'right_hand', { rootJointId: 'right_shoulder' }).kind, 'three-joint-ik', 'expanded shoulder root enables 3-joint IK');
assert.equal(describeMotionChain(sample, 'right_arm_lower', 'right_hand', { rootJointId: 'right_elbow' }).kind, 'two-joint-direct', 'path-specific chain roots shorten the solver chain');
assert.equal(describeMotionChain(sample, 'right_arm_lower', 'right_elbow', { rootJointId: 'right_elbow' }).kind, 'root-only', 'path-specific root equal to handle is explicitly root-only');
const directPinnedPreview = motionPreviewForTarget(sample, 'right_arm_lower', 'right_hand', { x: 210, y: 40 }, { parts: {}, skeleton: sample.skeleton }, { pinTarget: true });
const directPinnedHand = directPinnedPreview.skeleton?.joints.right_hand.position;
assert(directPinnedHand && Math.hypot(directPinnedHand.x - 210, directPinnedHand.y - 40) < 1e-9, '2-joint direct mechanism drive pins the handle exactly');
const directPreview = motionPreviewForTarget(sample, 'right_arm_lower', 'right_hand', { x: 210, y: 40 }, { parts: {}, skeleton: sample.skeleton }, { pinTarget: false });
const directPreviewHand = directPreview.skeleton?.joints.right_hand.position;
assert(directPreviewHand && Math.hypot(directPreviewHand.x - 210, directPreviewHand.y - 40) > 1, '2-joint direct path preview preserves non-pinned limb length');
const rightBendProject = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_elbow', updates: { bendDirection: 1 } });
const leftBendProject = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_elbow', updates: { bendDirection: -1 } });
const rightBendPreview = motionPreviewForTarget(rightBendProject, 'right_arm_lower', 'right_hand', { x: 180, y: 90 }, { parts: {}, skeleton: rightBendProject.skeleton }, { rootJointId: 'right_shoulder', pinTarget: true });
const leftBendPreview = motionPreviewForTarget(leftBendProject, 'right_arm_lower', 'right_hand', { x: 180, y: 90 }, { parts: {}, skeleton: leftBendProject.skeleton }, { rootJointId: 'right_shoulder', pinTarget: true });
const rightBendElbow = rightBendPreview.skeleton?.joints.right_elbow.position;
const leftBendElbow = leftBendPreview.skeleton?.joints.right_elbow.position;
assert(rightBendElbow && leftBendElbow && Math.hypot(rightBendElbow.x - leftBendElbow.x, rightBendElbow.y - leftBendElbow.y) > 1, '3-joint IK fold direction changes elbow/knee side');
const multiJointProject = applyProjectAction(sample, { type: 'add_joint', joint: { id: 'right_finger_tip', name: 'right finger tip', position: { x: 174, y: 30 }, parentId: 'right_hand', locked: false, bendDirection: 1 } });
assert.equal(describeMotionChain(multiJointProject, 'right_arm_lower', 'right_finger_tip', { rootJointId: 'right_shoulder' }).kind, 'multi-joint', '4+ joint limbs are labeled as multi-joint IK');
const multiPreview = motionPreviewForTarget(multiJointProject, 'right_arm_lower', 'right_finger_tip', { x: 205, y: 84 }, { parts: {}, skeleton: multiJointProject.skeleton }, { rootJointId: 'right_shoulder', pinTarget: true });
assert(Number.isFinite(multiPreview.skeleton?.joints.right_finger_tip.position.x) && Number.isFinite(multiPreview.skeleton?.joints.right_finger_tip.position.y), 'multi-joint IK preview stays finite');
assert(Math.hypot((multiPreview.skeleton?.joints.right_elbow.position.x ?? 0) - (multiJointProject.skeleton?.joints.right_elbow.position.x ?? 0), (multiPreview.skeleton?.joints.right_elbow.position.y ?? 0) - (multiJointProject.skeleton?.joints.right_elbow.position.y ?? 0)) > 1, 'multi-joint IK updates intermediate body-chain joints instead of only moving the distal handle');
const boundMechanism = (type: Parameters<typeof createDefaultMechanism>[0], id: string) => ({
  ...createDefaultMechanism(type, id),
  targetPartId: 'right_arm_lower',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
  activeVisualPartIds: ['right_arm_lower']
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
assert(pkg.recipes[0].assemblySteps.some(step => step.label === 'Set ground pivots' || step.instruction.includes('Pin ground pivots')), 'prefab board workflow uses mechanism-reference assembly steps');
assert(pkg.recipes[0].assemblySteps.some(step => step.stack?.some(item => item.label === FABRICATION_SPACER_SPEC.label)), 'prefab board workflow calls out S10 spacer layers in the reference stack');
assert(pkg.metadataJson.includes('assemblySteps'), 'fabrication metadata includes structured kit assembly steps');
assert.equal(fabricationPartDisplayLabel('G3 / 3-space gear'), 'Gear with 24 teeth', 'builder-facing gear labels name teeth count instead of G-codes');
assert.equal(fabricationPartDisplayLabel('L4 linkage'), '4-cell linkage (5 holes)', 'builder-facing linkage labels name cell and hole count instead of L-codes');
assert.equal(fabricationPartDisplayLabel('S10 spacer'), 'Spacer 10mm OD / 4mm hole', 'builder-facing spacer labels name physical dimensions instead of S-codes');
assert.equal(fabricationBoardCoordinateCallout('H8'), 'H8 · row 8, column 8', 'board coordinates include row and column callouts for assembly');
assert(pkg.svg.includes('>C1<') && pkg.svg.includes('>R1<'), 'blueprint SVG labels pegboard columns and rows');
assert(pkg.svg.includes('row') && pkg.svg.includes('column'), 'blueprint SVG recipe anchors include row/column callouts');
assert(pkg.assemblyGuideHtml.includes('2-cell linkage (3 holes)'), 'assembly guide uses readable linkage names');
assert(pkg.assemblyGuideHtml.includes('Spacer 10mm OD / 4mm hole'), 'assembly guide uses readable spacer names');
assert(pkg.assemblyGuideHtml.includes('row') && pkg.assemblyGuideHtml.includes('column'), 'assembly guide includes row/column callouts');

AUTHORABLE_MECHANISM_TYPES.forEach(type => {
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
assert.equal(physicsSession.summary.physicsKernel, PHYSICS_KERNEL_ENGINE, 'PhysicsSession summary declares the selected Rapier kernel');
assert.equal(physicsSession.summary.renderStack, PHYSICS_RENDER_STACK, 'PhysicsSession summary declares the selected Three/WebGL render stack');
assert.equal(physicsSession.summary.updatePolicy, PHYSICS_UPDATE_POLICY, 'PhysicsSession summary declares the kinematic-authority physics update policy');
assert.equal(physicsSession.summary.scenePolicy, HIGH_THROUGHPUT_SCENE_POLICY, 'PhysicsSession summary declares the high-throughput scene policy');
assert(physicsSession.summary.maxConstraintError >= 0, 'physics session reports mechanism constraint error');
assertFiniteDeep(physicsSession, 'physicsSession');

const foundryOverlayMechanism = createDefaultMechanism('4bar', 'contract-foundry-overlay');
const foundryOverlaySimulation = {
  state: calculateLinkage(foundryOverlayMechanism, Math.PI / 3),
  scale: 1,
  pathPoints: generateCurvePoints(foundryOverlayMechanism, 96).points
};
const foundryOverlay = buildFoundryPhysicsOverlay(foundryOverlayMechanism, foundryOverlaySimulation, Math.PI / 3, sample.settings);
assert.equal(foundryOverlay.rule, mechanismPhysicsRule('4bar'), 'Foundry overlay uses the same type-specific PhysicsSession rule text');
assert(foundryOverlay.playhead && foundryOverlay.velocityTip && foundryOverlay.forceTip && foundryOverlay.driveTip, 'Foundry overlay derives visible playhead, velocity, force, and drive vectors from sampled kinematics');
assert(Math.abs(foundryOverlay.velocityMagnitude - Math.hypot(foundryOverlay.velocityRaw.x, foundryOverlay.velocityRaw.y)) < 1e-9, 'Foundry velocity readout matches the displayed velocity vector');
assert(Math.abs(foundryOverlay.forceMagnitude - Math.hypot(foundryOverlay.forceRaw.x, foundryOverlay.forceRaw.y)) < 1e-9, 'Foundry force readout matches the displayed total force vector');
assert(foundryOverlay.playhead && foundryOverlay.forceTip && ((foundryOverlay.forceTip.x - foundryOverlay.playhead.x) * foundryOverlay.forceRaw.x + (foundryOverlay.forceTip.y - foundryOverlay.playhead.y) * foundryOverlay.forceRaw.y) > 0, 'Foundry force arrow points along the live total force vector');
assert(foundryOverlay.constraintError < 1e-6, 'Foundry overlay constraint error matches the sampled 4-bar pose');
assertFiniteDeep(foundryOverlay, 'foundryPhysicsOverlay');
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
  targetPartId: 'right_arm_lower',
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
      targetPartId: 'right_arm_lower',
      targetPathId: 'path-right-arm',
      targetAnchorJointId: 'right_hand',
      activeVisualPartIds: ['right_arm_lower']
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
    gear_linkage: 'L4 linkage output arm',
    planetary_gear: 'planet gear mesh',
    piston: 'slider guide',
    yoke: 'pin-in-slot guide',
    'quick-return': 'slotted-arm guide',
    '5bar': 'right crank phase rod',
    '6bar': 'six-bar dyad link length',
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
const requiredParts = (type: Parameters<typeof createDefaultMechanism>[0]) =>
  mechanismRequiredParts(createDefaultMechanism(type, `parts-${type}`));
const requiredPartNames = (type: Parameters<typeof createDefaultMechanism>[0]) =>
  requiredParts(type).map(part => part.name);
const requiredPartQuantities = (type: Parameters<typeof createDefaultMechanism>[0]) =>
  Object.fromEntries(requiredParts(type).map(part => [part.name, part.quantity]));

{
  const mechanism = createDefaultMechanism('4bar', 'contract-4bar-physical');
  const state = calculateLinkage(mechanism, 0);
  assert(state.isValid, '4bar default has a valid sampled assembly pose');
  assertDistance(state.p1, state.j1, mechanism.crankLength, '4bar crank length is preserved');
  assertDistance(state.j1, state.j2, mechanism.couplerLength, '4bar coupler length is preserved');
  assertDistance(state.p2, state.j2, mechanism.rockerLength, '4bar rocker length is preserved');
  assertDistance(state.p1, state.p2, mechanism.groundLength, '4bar A-D ground link is fixed while A-B, B-C, C-D move');
  assert(state.j2.y >= state.p1.y, '4bar default uses the front/open assembly branch instead of the crossed underside branch');
  const negativeOutputAngleState = calculateLinkage({ ...mechanism, couplerPointAngle: -40 }, 0);
  assert(negativeOutputAngleState.isValid, '4bar remains valid when the coupler output angle is negative');
  assert(negativeOutputAngleState.j2.y >= negativeOutputAngleState.p1.y, '4bar assembly branch is independent of output-point angle');
  assert.deepEqual(requiredPartQuantities('4bar'), { 'L2 linkage': 2, 'L4 linkage': 1, [FABRICATION_SPACER_SPEC.label]: 8 }, '4bar recipe uses L2/L4/S10 required parts from mechanism-reference');
  assert.deepEqual(
    fabricationStackForMechanism(mechanism).filter(layer => layer.role === 'linkage').map(layer => layer.label),
    ['Input L2 linkage', 'Coupler L4 linkage', 'Output L2 linkage'],
    '4bar fabrication stack exposes exactly L2/L4/L2 moving bars around the A-D ground link'
  );
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
  assert.equal(referenceRecipeForType('piston').canonicalKey, 'slider_crank', 'piston recipe is normalized to slider_crank in mechanism-reference');
  assert(requiredPartNames('piston').includes('3-hole bracket'), 'piston slider_crank recipe includes a fixed guide bracket');
  assert(requiredPartNames('piston').includes('2-hole bracket'), 'piston slider_crank recipe includes a moving slider block');
}

{
  const mechanism = createDefaultMechanism('yoke', 'contract-yoke-unsupported');
  assert.deepEqual(requiredParts('yoke'), [], 'scotch yoke has no required parts until a mechanism-reference recipe exists');
  assert(fabricationRenderPlanForMechanism(mechanism).validationErrors.some(error => error.includes('Scotch yoke needs recipe')), 'scotch yoke produces a fabrication validation error instead of pretending to be ready');
}

{
  const mechanism = createDefaultMechanism('quick-return', 'contract-quick-return-unsupported');
  assert.deepEqual(requiredParts('quick-return'), [], 'quick-return has no required parts until a mechanism-reference recipe exists');
  assert(fabricationRenderPlanForMechanism(mechanism).validationErrors.some(error => error.includes('Quick-return needs recipe')), 'quick-return produces a fabrication validation error instead of pretending to be ready');
}

{
  const mechanism = createDefaultMechanism('5bar', 'contract-5bar-simulation-only');
  assert.deepEqual(requiredParts('5bar'), [], '5bar has no required parts until synchronized dual-driver fabrication is specified');
  assert(fabricationRenderPlanForMechanism(mechanism).validationErrors.some(error => error.includes('Five-bar needs recipe')), '5bar produces a fabrication validation error instead of pretending to be ready');
  const topology = {
    ...mechanism,
    anchorX: 0,
    anchorY: 0,
    groundAngle: 0,
    groundLength: 120,
    crankLength: 40,
    rockerLength: 40,
    couplerLength: 70,
    rodLength: 70,
    speed1: 1,
    speed2: 0,
    phase: Math.PI,
    assemblyMode: 'open' as const
  };
  const pose = calculateLinkage(topology, 0);
  assert(pose.isValid && pose.aux, '5bar A-B-C-D-E topology closes with A-E as ground');
  assertDistance(pose.p1, pose.j1, topology.crankLength, '5bar A-B input crank length is preserved');
  assertDistance(pose.j1, pose.j2, topology.couplerLength, '5bar B-C left floating rod length is preserved');
  assertDistance(pose.j2, pose.aux, topology.rodLength, '5bar C-D right floating rod length is preserved');
  assertDistance(pose.aux, pose.p2, topology.rockerLength, '5bar D-E right crank length is preserved');
  assertDistance(pose.p1, pose.p2, topology.groundLength, '5bar A-E ground linkage length is preserved');
}

{
  const mechanism = createDefaultMechanism('6bar', 'contract-6bar-simulation-only');
  assert.deepEqual(requiredParts('6bar'), [], '6bar has no required parts until a real board/part/stack recipe is specified');
  assert(fabricationRenderPlanForMechanism(mechanism).validationErrors.some(error => error.includes('Six-bar needs recipe')), '6bar produces a fabrication validation error instead of pretending to be ready');
  assert.deepEqual(fabricationStackForMechanism(mechanism), [], '6bar has no fabrication stack without a mechanism-reference recipe');
}

{
  const mechanism = createDefaultMechanism('cam', 'contract-cam-physical');
  const low = calculateLinkage(mechanism, 0);
  const high = calculateLinkage(mechanism, Math.PI);
  assert(low.isValid && high.isValid, 'cam follower default has valid lift samples');
  assert.deepEqual(low.j2, low.effector, 'cam follower output is the follower block');
  assert.deepEqual(high.j2, high.effector, 'cam follower lifted output remains the follower block');
  const liftLength = Math.max(1, mechanism.rockerLength || mechanism.crankLength);
  const maxDefaultCamSampleIndex = mechanism.camProfileSamples?.reduce((best, value, index, list) => value > list[best] ? index : best, 0) ?? 0;
  const maxDefaultCamAngle = ((maxDefaultCamSampleIndex / Math.max(1, mechanism.camProfileSamples?.length ?? 1)) * Math.PI * 2);
  assert(Math.abs(camFollowerRise(liftLength, maxDefaultCamAngle, mechanism.camProfileSamples) - liftLength) < 1e-6, 'cam follower full lift comes from the shared cam profile');
  assert(camProfileScale(Math.PI) > camProfileScale(0), 'rendered cam profile has the same high-lift lobe used by kinematics');
  const customProfile = [0.7, 1.45, 0.7, 0.55, 0.7, 0.95, 0.7, 0.65];
  const custom = { ...mechanism, camProfileSamples: customProfile };
  assert.equal(sampledCamProfileScale(Math.PI / 4, customProfile), 1.45, 'editable cam profile samples are angle-indexed and round-trip into shared geometry');
  assert(localTrack(custom, calculateLinkage(custom, Math.PI / 4).j2).x > localTrack(mechanism, calculateLinkage(mechanism, Math.PI / 4).j2).x, 'edited cam lobe changes the follower lift used by simulation');
  const defaultCamExportPath = generateSVG({ speed: 1, rotation: 0, mechanisms: [mechanism] }, 0).match(/data-export-kind="cam-profile" d="([^"]+)"/)?.[1];
  const customCamExportPath = generateSVG({ speed: 1, rotation: 0, mechanisms: [custom] }, 0).match(/data-export-kind="cam-profile" d="([^"]+)"/)?.[1];
  assert(defaultCamExportPath && customCamExportPath && defaultCamExportPath !== customCamExportPath, 'cam SVG export uses edited cam profile samples');
  assert(generateDXF({ speed: 1, rotation: 0, mechanisms: [custom] }, 0).includes('CONTRACT-CAM-PHYSICAL_CAM'), 'cam DXF export includes an explicit sampled cam profile layer');
  assert(localTrack(mechanism, high.j2).x > localTrack(mechanism, low.j2).x, 'cam follower lift increases along the guide');
  assert.deepEqual(requiredPartQuantities('cam'), { 'Eccentric cam': 1, 'Round follower': 1, '2-hole bracket': 1, [FABRICATION_SPACER_SPEC.label]: 8 }, 'cam recipe uses eccentric cam, round follower, bracket, and S10 from mechanism-reference');
}

{
  const mechanism = createDefaultMechanism('rack-pinion', 'contract-rack-pinion-unsupported');
  assert.deepEqual(requiredParts('rack-pinion'), [], 'rack-pinion has no required parts until a kit part contract exists');
  assert(fabricationRenderPlanForMechanism(mechanism).validationErrors.some(error => error.includes('Rack-pinion has no mechanism-reference recipe')), 'rack-pinion produces a fabrication validation error instead of pretending to be ready');
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
  assert.equal(mechanism.crankLength, REFERENCE_DEFAULTS.gearTrain.driveRadius, 'gear train default uses the fabrication G3 drive gear pitch radius');
  assert.equal(mechanism.rockerLength, REFERENCE_DEFAULTS.gearTrain.outputRadius, 'gear train default uses the fabrication G3 output gear pitch radius');
  assert.equal(mechanism.groundLength, REFERENCE_DEFAULTS.gearTrain.centerDistance, 'gear train default uses the G3/G3 60 mm center distance');
  assert.equal(mechanism.gearRatio, gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength), 'gear train default ratio is derived from meshed pitch radii');
  assert.deepEqual(gearTrainPitchRadii(mechanism), [mechanism.crankLength, mechanism.rockerLength], 'gear train default stores the legacy two-gear pair as the ordered pitch-radius train');
  assert.equal(gearTrainOutputRatio(mechanism), gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength), 'two-gear train helper preserves legacy reverse rotation');
  const unequalGear = { ...mechanism, crankLength: 30, rockerLength: 60, groundLength: 90, gearRatio: -99, speed2: -99 };
  const unequalQuarter = calculateLinkage(unequalGear, Math.PI / 2);
  const outputAngle = Math.atan2(unequalQuarter.j2.y - unequalQuarter.p2.y, unequalQuarter.j2.x - unequalQuarter.p2.x);
  assert(Math.abs(outputAngle - gearPairOutputRatio(30, 60) * Math.PI / 2) < 1e-6, 'gear output rotation follows pitch radii, not stale ratio fields');
  const compoundGear = { ...mechanism, crankLength: 100, rockerLength: 60, gearTrainRadii: [100, 40, 60], groundLength: gearTrainPitchCenterDistance({ crankLength: 100, rockerLength: 60, gearTrainRadii: [100, 40, 60] }) };
  const compoundQuarter = calculateLinkage(compoundGear, Math.PI / 2);
  const compoundOutputAngle = Math.atan2(compoundQuarter.j2.y - compoundQuarter.p2.y, compoundQuarter.j2.x - compoundQuarter.p2.x);
  assertDistance(compoundQuarter.p1, compoundQuarter.p2, 100 + 40 + 40 + 60, 'compound gear train pitch centers accumulate adjacent meshed radii');
  assert(Math.abs(compoundOutputAngle - gearTrainOutputRatio(compoundGear) * Math.PI / 2) < 1e-6, 'compound gear train output follows idler parity and endpoint pitch-radius ratio');
  assert.equal(gearTrainOutputRatio(compoundGear), 100 / 60, 'three-gear train has same output direction because the idler flips twice');
  assert(fabricationStackForMechanism(compoundGear).some(layer => layer.label === 'Idler G3 / 3-space gear 1'), 'compound gear fabrication stack inserts reference G3 idler layers between drive and output');
  assert.equal(mechanismRequiredParts(compoundGear).find(part => part.name === 'G3 / 3-space gear')?.quantity, 3, 'compound gear train parts scale with reference G3 gear count');
  const driverOffsetState = calculateLinkage({ ...mechanism, driverPhaseOffset: Math.PI / 4 }, 0);
  assert(Math.abs(Math.atan2(driverOffsetState.j1.y - driverOffsetState.p1.y, driverOffsetState.j1.x - driverOffsetState.p1.x) - Math.PI / 4) < 1e-6, 'driver phase offset rotates the input driver before downstream constraints solve');
  Array.from({ length: 8 }, () => generateSmartConfig(undefined, 'gear')).forEach(config => {
    assert(Math.abs(config.groundLength - gearTrainPitchCenterDistance(config)) < 1e-6, 'optimizer keeps generated gear train pitch circles tangent');
  });
  const mutatedGear = mutateConfig({ ...mechanism, groundLength: 999 }, 1, true);
  assert(Math.abs(mutatedGear.groundLength - gearTrainPitchCenterDistance(mutatedGear)) < 1e-6, 'optimizer keeps mutated gear train pitch circles tangent');
  assert.equal(mutatedGear.gearRatio, gearTrainOutputRatio(mutatedGear), 'optimizer keeps gear ratio derived from ordered pitch radii');
  const gearOnlySvg = generateSVG({ speed: 1, rotation: 0, mechanisms: [mechanism] }, 0);
  const gearOnlyDxf = generateDXF({ speed: 1, rotation: 0, mechanisms: [mechanism] }, 0);
  assert(!gearOnlySvg.includes('<line'), 'gear train SVG export is gears-only without fake linkage rods');
  assert(!gearOnlyDxf.includes('\nLINE\n'), 'gear train DXF export is gears-only without fake linkage rods');
  assert((gearOnlySvg.match(/<path d="/g) ?? []).length >= 2, 'gear train SVG export still carries meshed gear outlines');
  assert.deepEqual(requiredPartQuantities('gear'), { 'G3 / 3-space gear': 2, [FABRICATION_SPACER_SPEC.label]: 8 }, 'gear train recipe uses two G3 gears and S10 spacers from mechanism-reference');
}

{
  const mechanism = createDefaultMechanism('gear_linkage', 'contract-gear-linkage-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid, 'gear-linkage default has valid sampled poses');
    assertDistance(state.p1, state.j1, mechanism.crankLength, 'gear-linkage input G3 handle radius is preserved');
    assertDistance(state.p1, state.p2, mechanism.groundLength, 'gear-linkage G3 centers stay at meshed pitch distance');
    assertDistance(state.p2, state.j2, mechanism.couplerPointDist, 'gear-linkage output gear off-center handle radius is preserved');
    assertDistance(state.j2, state.effector, mechanism.couplerLength, 'gear-linkage L4 output linkage length is preserved');
  });
  assert.equal(mechanism.crankLength, REFERENCE_DEFAULTS.gearLinkage.driveRadius, 'gear-linkage drive radius uses the reference G3 pitch radius');
  assert.equal(mechanism.rockerLength, REFERENCE_DEFAULTS.gearLinkage.outputRadius, 'gear-linkage output gear radius uses the reference G3 pitch radius');
  assert.equal(mechanism.groundLength, REFERENCE_DEFAULTS.gearLinkage.centerDistance, 'gear-linkage centers use the G3/G3 60 mm pitch distance');
  assert.equal(mechanism.couplerPointDist, REFERENCE_DEFAULTS.gearLinkage.handleRadius, 'gear-linkage output handle uses the reference one-cell offset');
  assert.equal(mechanism.couplerLength, REFERENCE_DEFAULTS.gearLinkage.outputLinkage, 'gear-linkage output rod uses the reference L4 linkage');
  assert.deepEqual(requiredPartQuantities('gear_linkage'), { 'G3 / 3-space gear': 2, 'L4 linkage': 1, '2-hole bracket': 1, [FABRICATION_SPACER_SPEC.label]: 8 }, 'gear-linkage recipe uses two G3 gears, L4, output bracket, and S10 spacers');
  assert.equal(mechanismRequiredParts({ ...mechanism, gearTrainRadii: [60, 40, 60] }).find(part => part.name === 'G3 / 3-space gear')?.quantity, 2, 'gear-linkage stays the exact two-G3 + L4 reference recipe instead of inheriting compound gear-train idlers');
  const compoundGearLinkage = {
    ...mechanism,
    crankLength: 100,
    rockerLength: 60,
    couplerPointDist: 55,
    couplerLength: 140,
    gearTrainRadii: [100, 40, 60],
    groundLength: 999
  };
  const compoundGearLinkageState = calculateLinkage(compoundGearLinkage, Math.PI / 2);
  assertDistance(compoundGearLinkageState.p1, compoundGearLinkageState.p2, REFERENCE_DEFAULTS.gearLinkage.centerDistance, 'gear-linkage ignores stale crank/rocker/idler dimensions and keeps the two-G3 center distance');
  assertDistance(compoundGearLinkageState.p2, compoundGearLinkageState.j2, REFERENCE_DEFAULTS.gearLinkage.handleRadius, 'gear-linkage ignores stale handle radius and uses the reference off-center gear hole');
  assertDistance(compoundGearLinkageState.j2, compoundGearLinkageState.effector, REFERENCE_DEFAULTS.gearLinkage.outputLinkage, 'gear-linkage ignores stale output linkage length and uses the reference L4 linkage');
  assert.equal(compoundGearLinkageState.aux, undefined, 'gear-linkage does not expose idler gear centers');
  Array.from({ length: 8 }, () => generateSmartConfig(undefined, 'gear_linkage')).forEach(config => {
    assert.deepEqual(config.gearTrainRadii, [REFERENCE_DEFAULTS.gearLinkage.driveRadius, REFERENCE_DEFAULTS.gearLinkage.outputRadius], 'optimizer generates gear-linkage as the exact two-G3 reference recipe');
    assert.equal(config.groundLength, REFERENCE_DEFAULTS.gearLinkage.centerDistance, 'optimizer generates gear-linkage at the reference G3/G3 center distance');
    assert.equal(config.couplerPointDist, REFERENCE_DEFAULTS.gearLinkage.handleRadius, 'optimizer generates gear-linkage with the reference output gear handle radius');
    assert.equal(config.couplerLength, REFERENCE_DEFAULTS.gearLinkage.outputLinkage, 'optimizer generates gear-linkage with the reference L4 output linkage');
  });
  const mutatedGearLinkage = mutateConfig(compoundGearLinkage, 1, true);
  assert.deepEqual(mutatedGearLinkage.gearTrainRadii, [REFERENCE_DEFAULTS.gearLinkage.driveRadius, REFERENCE_DEFAULTS.gearLinkage.outputRadius], 'optimizer mutates gear-linkage back to the exact two-G3 reference recipe');
  assert.equal(mutatedGearLinkage.groundLength, REFERENCE_DEFAULTS.gearLinkage.centerDistance, 'optimizer mutation preserves the gear-linkage reference center distance');
  assert.equal(mutatedGearLinkage.couplerLength, REFERENCE_DEFAULTS.gearLinkage.outputLinkage, 'optimizer mutation preserves the L4 output linkage');
  assert.deepEqual(
    fabricationStackForMechanism(mechanism).filter(layer => ['gear', 'linkage', 'guide'].includes(layer.role)).map(layer => layer.label),
    ['Drive G3 / 3-space gear', 'Output G3 / 3-space gear', 'L4 linkage', '2-hole bracket'],
    'gear-linkage fabrication stack exposes G3→G3→L4→bracket in mechanism-reference order'
  );
}

{
  const mechanism = createDefaultMechanism('planetary_gear', 'contract-planetary-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid && state.aux, 'planetary gear default has valid carrier samples');
    assertDistance(state.p1, state.p2, mechanism.groundLength, 'planetary carrier radius is preserved');
    assertDistance(state.p2, state.j2, mechanism.rockerLength, 'planet gear radius is preserved');
    assertDistance(state.p1, state.effector, mechanism.couplerPointDist, 'planetary carrier output radius is preserved');
  });
  assert.equal(mechanism.gearRatio, planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength), 'planetary gear ratio is ring-fixed sun-input carrier-output');
  assert.equal(planetaryRingPitchRadius(mechanism.crankLength, mechanism.rockerLength), mechanism.crankLength + 2 * mechanism.rockerLength, 'planetary ring pitch radius follows sun plus two planets');
  assert.equal(planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength), planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength) - (mechanism.crankLength / mechanism.rockerLength) * (1 - planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength)), 'planet spin is derived from ring-fixed carrier motion');
  Array.from({ length: 8 }, () => generateSmartConfig(undefined, 'planetary_gear')).forEach(config => {
    assert(Math.abs(config.groundLength - (config.crankLength + config.rockerLength)) < 1e-6, 'optimizer keeps generated planetary pitch circles tangent');
  });
  assert.deepEqual(requiredPartQuantities('planetary_gear'), { 'R56 internal ring gear': 1, 'G1 / 1-space gear': 1, 'G3 / 3-space gear': 1, 'L2 linkage': 1, [FABRICATION_SPACER_SPEC.label]: 8 }, 'planetary recipe uses R56 ring, G1 sun, G3 planet, L2 carrier, and S10 from mechanism-reference');
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
assert.equal(sample.settings.toolbarVisible, false, 'settings default hides duplicate quick toolbar chrome');
assert.equal(sample.settings.debugVisuals, false, 'settings default hides debug visuals');
assert.equal(sample.settings.detailedProcessingSteps, false, 'settings default hides detailed processing steps');
assert.equal(sample.settings.autosaveIntervalSeconds, 60, 'settings default includes autosave interval seconds');
assert.equal(sample.settings.fabricationReadyMode, true, 'settings default keeps fabrication validation strict');
assert.equal(sample.settings.gridUnit, 'cm', 'settings default labels grid in centimeters');
assert.equal(formatGridPitch(20, 'cm'), '2cm', 'grid pitch formatter keeps compact cm labels');
assert.equal(formatGridLabel({ gridPitchMm: 25 }, 'inch'), 'Letter sheet · 0.98 in grid', 'grid label formatter applies inch units across canvases');
assert.equal(formatGridReadout({ gridPitchMm: 20 }, 'px'), '40 scene px between board holes', 'grid readout formatter applies scene-pixel units');
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
assert(validateForFabrication(detachedMechanismProject).errors.some(e => e.includes('choose target + path')), 'fabrication blocks detached visible mechanisms');
const noEnabledMechanismProject = { ...sample, mechanisms: sample.mechanisms.map(m => ({ ...m, enabled: false })) };
assert(validateForFabrication(noEnabledMechanismProject).errors.some(e => e.includes('No enabled mechanism')), 'fabrication blocks zero-recipe blueprint packages');
assert.throws(() => createFabricationPackage(noEnabledMechanismProject), /No enabled mechanism/, 'fabrication package refuses zero-recipe output');
const impossibleMechanismProject = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'impossible'), anchorX: -80, anchorY: -80, groundLength: 10, crankLength: 10, couplerLength: 10, rockerLength: 1000 }] };
assert(validateForFabrication(impossibleMechanismProject).errors.some(e => e.includes('No motion')), 'fabrication blocks mechanisms with no motion');
const offGridProject = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'off-grid'), anchorX: -70, anchorY: -80 }] };
assert(validateForFabrication(offGridProject).errors.some(e => e.includes('off grid')), 'fabrication blocks off-grid anchors instead of rounding silently');
const simulationOnlyOffGridProject = { ...offGridProject, settings: { ...sample.settings, fabricationReadyMode: false } };
assert(validateForFabrication(simulationOnlyOffGridProject).warnings.some(e => e.includes('off grid')), 'simulation-only mode downgrades board snap issues to warnings');
const recipeWithPath = createFabricationPackage(sample).recipes[0];
assert.equal(recipeWithPath.targetPathId, 'path-right-arm', 'fabrication recipe preserves target path metadata');
assert(recipeWithPath.sceneAnchor && 'x' in recipeWithPath.sceneAnchor, 'fabrication recipe includes explicit scene anchor');
const sampleAssemblyGuideHtml = createFabricationPackage(sample).assemblyGuideHtml;
assert(sampleAssemblyGuideHtml.includes('assembly guide'), 'fabrication package includes printable assembly guide');
assert(sampleAssemblyGuideHtml.includes('<strong>Board:</strong>'), 'assembly guide labels the mechanism board explicitly');
assert(!sampleAssemblyGuideHtml.includes('Board coordinate:'), 'assembly guide does not label moving-reference callouts as board coordinates');
assert(sampleAssemblyGuideHtml.includes('link joint reference') || sampleAssemblyGuideHtml.includes('gear handle reference') || sampleAssemblyGuideHtml.includes('carrier reference'), 'assembly guide surfaces moving-reference coord roles instead of board-only labels');
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
assert(validateForFabrication(invalid).errors.some(e => e.includes('off board')), 'fabrication rejects off-board anchor');
const missingAnchor = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'missing-anchor'), anchorX: undefined, anchorY: undefined }] };
assert(validateForFabrication(missingAnchor).errors.some(e => e.includes('missing board anchor')), 'fabrication rejects missing board coordinate');
assert.throws(() => createFabricationPackage(missingAnchor), /missing board anchor/, 'fabrication package does not silently place missing anchors at origin');
const importedMissingAnchor = loadProjectSnapshot(JSON.parse(serializeProject(sample)));
delete (importedMissingAnchor.mechanisms[0] as unknown as Record<string, unknown>).anchorX;
delete (importedMissingAnchor.mechanisms[0] as unknown as Record<string, unknown>).anchorY;
const reloadedMissingAnchor = loadProjectSnapshot(JSON.parse(serializeProject(importedMissingAnchor)));
assert(validateForFabrication(reloadedMissingAnchor).errors.some(e => e.includes('missing board anchor')), 'imported snapshot with missing anchors remains invalid for fabrication');

const removed = applyProjectAction(sample, { type: 'remove_joint', jointId: 'right_elbow' });
assert.notEqual(removed.parts.right_arm_lower.anchorJointId, 'right_elbow', 'joint delete repairs part anchors');
const cycleAttempt = applyProjectAction(sample, { type: 'update_joint', jointId: 'root', updates: { parentId: 'right_hand' } });
assert.equal(cycleAttempt.skeleton?.joints.root.parentId ?? null, sample.skeleton?.joints.root.parentId ?? null, 'joint reparent blocks skeleton cycles');
const movedJoint = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_elbow', updates: { position: { x: 222, y: 111 } } });
const movedPivot = bodyPartPivotScene(movedJoint.parts.right_arm_lower, movedJoint.skeleton);
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
      targetAnchorJointId: 'right_hand',
      warnings: [],
      source: 'mechanism-foundry'
    }
  }
});
assert.equal(foundryUpsert.mechanisms.find(m => m.id === 'foundry-upsert')?.generatedPath?.length, foundryPath.length, 'upserting foundry export preserves package path');
assert.equal(foundryUpsert.mechanisms.find(m => m.id === 'foundry-upsert')?.foundryExport?.metadata.selectedPreset, 'balanced', 'foundry export preserves preset metadata');
const anchorOverride = applyProjectAction(sample, { type: 'upsert_mechanism', mechanism: { ...sample.mechanisms[0], targetAnchorJointId: 'right_elbow' } });
assert.equal(anchorOverride.mechanisms[0].targetAnchorJointId, 'right_elbow', 'mechanism target anchor override survives reducer reconciliation');
const lockedPartProject = { ...sample, parts: { ...sample.parts, right_arm_lower: { ...sample.parts.right_arm_lower, locked: true } } };
assert.equal(
  applyProjectAction(lockedPartProject, { type: 'update_part', partId: 'right_arm_lower', updates: { transform: { ...sample.parts.right_arm_lower.transform, x: 999 } } }).parts.right_arm_lower.transform.x,
  sample.parts.right_arm_lower.transform.x,
  'locked parts reject reducer-level edits'
);
assert.equal(
  applyProjectAction(lockedPartProject, { type: 'delete_part', partId: 'right_arm_lower' }).parts.right_arm_lower.id,
  'right_arm_lower',
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
    'path-left': { ...sample.paths['path-right-arm'], id: 'path-left', partId: 'left_arm_lower' }
  },
  mechanisms: [{ ...sample.mechanisms[0], targetPartId: 'right_arm_lower', targetPathId: 'path-left' }]
};
assert(validateForFabrication(wrongTarget).errors.some(e => e.includes('belongs to left_arm_lower')), 'fabrication rejects mismatched target part/path');
assert.equal(handoffGate({ ...sample, parts: {}, partOrder: [], skeleton: null, paths: {}, mechanisms: [] }, 'path').ok, false, 'stage handoff blocks path work before character data');
assert.equal(handoffGate({ ...sample, mechanisms: [] }, 'design').ok, true, 'stage handoff allows Design to add the first mechanism after character load');
assert.equal(handoffGate(sample, 'blueprint').ok, true, 'stage handoff permits blueprint when mechanisms are valid');
assert.equal(handoffGate(sample, 'assembly').ok, true, 'stage handoff permits assembly guide when mechanisms are valid');
const reassignedElbowPivot = bodyPartPivotScene({ ...sample.parts.right_arm_lower, anchorJointId: 'right_elbow' }, sample.skeleton);
assert(Math.hypot(reassignedElbowPivot.x - (sample.skeleton?.joints.right_elbow.position.x ?? 0), reassignedElbowPivot.y - (sample.skeleton?.joints.right_elbow.position.y ?? 0)) < 1e-9, 'pivot can follow reassigned skeleton anchor');
const placed = placeBodyPartPivotAt({ ...sample.parts.right_arm_lower, anchorJointId: 'right_elbow' }, { x: 12, y: 34 }, sample.skeleton);
assert(Math.abs(bodyPartPivotScene(placed, sample.skeleton).x - 12) < 1e-9 && Math.abs(bodyPartPivotScene(placed, sample.skeleton).y - 34) < 1e-9, 'anchor-aware placement moves visual transform');
const handPart: BodyPartLayer = {
  ...sample.parts.right_arm_lower,
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
assert(pathPreview.parts.right_arm_lower, 'path editor preview moves selected limb at current frame');
assert(pathPreview.parts.right_arm_upper, 'path editor preview includes the upper arm when the hand path uses a shoulder-root chain');
assert.deepEqual(pathPreview.skeleton?.joints.right_shoulder.position, ikProject.skeleton?.joints.right_shoulder.position, 'IK preview keeps the shoulder root attached');
assert(Math.hypot((pathPreview.skeleton?.joints.right_hand.position.x ?? 0) - ikProject.paths['path-right-arm'].points[0].x, (pathPreview.skeleton?.joints.right_hand.position.y ?? 0) - ikProject.paths['path-right-arm'].points[0].y) < 1e-9, 'path editor IK target reaches the path point');
assert(distance(bodyPartPivotScene(pathPreview.parts.right_arm_upper, pathPreview.skeleton), pathPreview.skeleton!.joints.right_shoulder.position) < 1e-9, 'upper arm visual stays pinned to the shoulder root during hand IK');
assert(distance(bodyPartPivotScene(pathPreview.parts.right_arm_lower, pathPreview.skeleton), pathPreview.skeleton!.joints.right_elbow.position) < 1e-9, 'lower arm visual stays pinned to the solved elbow during hand IK');
assert.notEqual(pathPreview.parts.right_arm_upper.transform.rotation, ikProject.parts.right_arm_upper.transform.rotation, 'hand IK rotates the upper-arm body component as part of the same chain');
assert.notEqual(pathPreview.parts.right_arm_lower.transform.rotation, ikProject.parts.right_arm_lower.transform.rotation, 'hand IK rotates the lower-arm body component as part of the same chain');
const elbowRootPath = { ...ikProject.paths['path-right-arm'], chainRootJointId: 'right_elbow', targetAnchorJointId: 'right_hand' };
const elbowRootPreview = motionPreviewForPath(ikProject, elbowRootPath, 0);
assert.deepEqual(elbowRootPreview.skeleton?.joints.right_elbow.position, ikProject.skeleton?.joints.right_elbow.position, 'path-specific IK root keeps the chosen elbow/knee joint attached');
assert(Math.hypot((elbowRootPreview.skeleton?.joints.right_hand.position.x ?? 0) - elbowRootPath.points[0].x, (elbowRootPreview.skeleton?.joints.right_hand.position.y ?? 0) - elbowRootPath.points[0].y) > 1, 'non-pinned path preview with shortened chain preserves segment length instead of teleporting');
const rootOnlyPath = { ...ikProject.paths['path-right-arm'], chainRootJointId: 'right_elbow', targetAnchorJointId: 'right_elbow' };
const rootOnlyPreview = motionPreviewForPath(ikProject, rootOnlyPath, 0);
assert(Math.hypot((rootOnlyPreview.skeleton?.joints.right_elbow.position.x ?? 0) - rootOnlyPath.points[0].x, (rootOnlyPreview.skeleton?.joints.right_elbow.position.y ?? 0) - rootOnlyPath.points[0].y) < 1e-9, 'root-only IK translates the selected whole part so its handle follows the path point');
assert(rootOnlyPreview.parts.right_arm_lower && rootOnlyPreview.parts.right_arm_lower.transform.x !== ikProject.parts.right_arm_lower.transform.x, 'root-only IK preview moves the visible whole part instead of returning a static preview');
const drivenMechanism = {
  ...createDefaultMechanism('crank', 'drive-effector'),
  anchorX: ikProject.paths['path-right-arm'].points[0].x + 30,
  anchorY: ikProject.paths['path-right-arm'].points[0].y - 20,
  crankLength: 10,
  targetPartId: 'right_arm_lower',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
  activeVisualPartIds: ['right_arm_lower']
};
const drivenProject: ProjectState = { ...ikProject, mechanisms: [drivenMechanism] };
const animated = animatedPartsForProject(drivenProject, drivenProject.mechanisms, 0);
const mechanismPreview = motionPreviewForProject(drivenProject, drivenProject.mechanisms, 0);
const mechanismState = calculateLinkage(drivenMechanism, 0);
assert(animated.right_arm_lower, 'animated preview moves target part at current frame');
assert(animated.right_arm_upper, 'animated preview moves parent limb parts in the same IK chain');
assert(animated.right_hand_part, 'animated preview propagates target-anchor motion to descendant parts');
const movedUpperArmPivot = bodyPartPivotScene(animated.right_arm_upper, mechanismPreview.skeleton);
assert(distance(movedUpperArmPivot, mechanismPreview.skeleton!.joints.right_shoulder.position) < 1e-9, 'mechanism IK keeps the upper arm attached to the shoulder root');
const movedLowerArmPivot = bodyPartPivotScene(animated.right_arm_lower, mechanismPreview.skeleton);
assert(distance(movedLowerArmPivot, mechanismPreview.skeleton!.joints.right_elbow.position) < 1e-9, 'mechanism IK keeps the lower arm attached to the solved elbow instead of snapping it to the shoulder');
assert(Math.hypot((mechanismPreview.skeleton?.joints.right_hand.position.x ?? 0) - mechanismState.effector.x, (mechanismPreview.skeleton?.joints.right_hand.position.y ?? 0) - mechanismState.effector.y) < 1e-9, 'mechanism design IK target follows the actual linkage effector');
assert(Math.hypot((mechanismPreview.skeleton?.joints.right_hand.position.x ?? 0) - drivenProject.paths['path-right-arm'].points[0].x, (mechanismPreview.skeleton?.joints.right_hand.position.y ?? 0) - drivenProject.paths['path-right-arm'].points[0].y) > 20, 'mechanism design does not fake success by directly following the target path');
assert.notEqual(animated.right_arm_upper.transform.rotation, drivenProject.parts.right_arm_upper.transform.rotation, 'IK preview rotates the upper arm instead of leaving the parent component static');
assert.notEqual(animated.right_arm_lower.transform.rotation, drivenProject.parts.right_arm_lower.transform.rotation, 'IK preview rotates the limb instead of only offsetting it');
assert(Math.hypot(bodyPartPivotScene(animated.right_hand_part, mechanismPreview.skeleton).x - (mechanismPreview.skeleton?.joints.right_hand.position.x ?? 0), bodyPartPivotScene(animated.right_hand_part, mechanismPreview.skeleton).y - (mechanismPreview.skeleton?.joints.right_hand.position.y ?? 0)) < 1e-9, 'descendant part anchor follows animated skeleton');
const sampleMechanism = sample.mechanisms[0];
assert(sampleMechanism, 'sample has a mechanism for driven-target checks');
for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
  const state = calculateLinkage(sampleMechanism, phase);
  const preview = motionPreviewForProject(sample, sample.mechanisms, phase);
  const targetJointId: string = preferredMotionJointId(sample, sampleMechanism.targetPartId, sampleMechanism.targetAnchorJointId)!;
  const targetJoint = preview.skeleton?.joints[targetJointId]?.position;
  assert(state.isValid && targetJoint, 'sample mechanism has a valid driven target joint');
  assert(Math.hypot(targetJoint!.x - state.effector.x, targetJoint!.y - state.effector.y) < 1e-9, 'sample mechanism keeps its driven joint pinned to the linkage effector through the whole scrub range');
}
const conflictProject: ProjectState = { ...drivenProject, mechanisms: [drivenMechanism, { ...drivenMechanism, id: 'second-driver', anchorX: drivenMechanism.anchorX + 8 }] };
const conflicts = mechanismBindingWarnings(conflictProject);
assert(conflicts['drive-effector']?.some(w => w.includes('also drives right_arm_lower:right_shoulder:right_hand')), 'first duplicate driver receives explicit conflict warning');
assert(conflicts['second-driver']?.some(w => w.includes('also drives right_arm_lower:right_shoulder:right_hand')), 'second duplicate driver receives explicit conflict warning');
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
if (existsSync(join(process.cwd(), 'dist'))) {
  const distOnnxPath = join(process.cwd(), 'dist/onnx/pose_model.onnx');
  assert(existsSync(distOnnxPath), 'production build copies ONNX model to dist');
  assert(statSync(distOnnxPath).size > 1_000_000 && !readFileSync(distOnnxPath).subarray(0, 64).toString('utf8').startsWith('version https://git-lfs'), 'production ONNX build output is real model bytes, not a Git LFS pointer');
}
const staleExport = loadProjectSnapshot({ ...sample, lastExport: { id: 'stale-export' } });
assert.equal(staleExport.lastExport, undefined, 'imported project snapshots clear stale fabrication exports');
assert(existsSync(join(process.cwd(), 'src-tauri/icons/icon.png')) && existsSync(join(process.cwd(), 'src-tauri/icons/icon.ico')) && existsSync(join(process.cwd(), 'src-tauri/icons/icon.icns')), 'Tauri package icon files exist for png, ico, and macOS icns targets');
assert(statSync(join(process.cwd(), 'src-tauri/icons/icon.png')).size > 20_000 && statSync(join(process.cwd(), 'src-tauri/icons/icon.ico')).size > 20_000 && statSync(join(process.cwd(), 'src-tauri/icons/icon.icns')).size > 100_000, 'Tauri package icons use real MotionSmith artwork bytes, not tiny dummy grid placeholders');
assert.throws(
  () => createProjectFromPackageData({ parts: { p: { roi: [0, 0, 10, 10] } } }, parseCharConfig('width: 1\nheight: 1\nskeleton: []')),
  /missing skeleton\/joints|no valid joints/,
  'empty skeleton import fails instead of fabricating joints'
);

console.log('project contracts ok');
