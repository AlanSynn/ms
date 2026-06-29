import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from './components/Canvas';
import { AssemblyWorkbench } from './components/stages/assembly/AssemblyWorkbench';
import { BlueprintExport } from './components/stages/blueprint/BlueprintExport';
import { EditorStageFrame, StageLeftSummary, canvasPane, inspectorPane, workflowPane } from './components/stages/stageLayout';
import { ThreePuppetPreview } from './components/ThreePuppetPreview';
import { TrackingModal } from './components/TrackingModal';
import { AboutDialog, CanvasZoomToolbar, GettingStartedDialog, OnnxCacheStatusPill, SHARED_PLAYBACK_STAGES, STAGES, ShortcutHelpDialog, TopCommandBar, WelcomeDialog, WorkflowRail, WorkflowStatusStrip, WorkspacePlayerDock, type StarterImageTemplate } from './components/AppShell';
import {
    AppStage,
    BodyPartLayer,
    CanvasViewport,
    CharacterPackageArtifact,
    FoundryExportPackage,
    GlobalConfig,
    MechanismConfig,
    MechanismType,
    PhysicalKitSettings,
    Point,
    ProjectMotionPath,
    ProjectState,
    ProjectAction
} from './types';
import { gearPathD, generateDXF, generateSVG } from './utils/exporter';
import { animationDeltaRadians, calculateLinkage, defaultCamProfileSamples, generateCurvePoints, gearPairOutputRatio, gearTrainCenters, gearTrainOutputRatio, gearTrainPitchCenterDistance, gearTrainPitchRadii, normalizeCamProfileSamples, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio, sampledCamProfileScale } from './utils/kinematics';
import { evaluateFitness, generateSmartConfig, mutateConfig } from './utils/optimizer';
import {
    applyProjectAction,
    CLASSROOM_LESSONS,
    classroomLessonById,
    createDefaultMechanism,
    createEmptyProject,
    createLessonProject,
    createProjectFromProcessed,
    createSampleProject,
    downloadText,
    handoffGate,
    loadProjectSnapshot,
    mechanismRequiredParts,
    mechanismWithGeneratedPath,
    projectSelfCheck,
    replaceCharacterProject,
    resetProjectToLessonBaseline,
    serializeProject,
    uid,
    validatePath
} from './utils/project';
import { checkWebOnnxCache, processImageWithWebOnnx, warmWebOnnxCache, type WebOnnxCacheStatus } from './utils/webOnnx';
import { buildFoundryPhysicsOverlay } from './utils/physicsSession';
import { HIGH_THROUGHPUT_SCENE_POLICY, PHYSICS_KERNEL_ENGINE, PHYSICS_RENDER_STACK, PHYSICS_UPDATE_POLICY, loadRapierPhysicsKernel, physicsKernelErrorMessage } from './utils/physicsKernel';
import { createFabricationPackage, FABRICATION_HOLE_RADIUS_MM, FABRICATION_LINKAGE_WIDTH_MM, FABRICATION_SPACER_SPEC, fabricationBoardCoordinateCallout, fabricationGearProfileForPitchRadius, fabricationLinkageSpecForSceneLength, fabricationPartDisplayLabel, fabricationRingGearPathD, fabricationRingGearProfileForPitchRadius, fabricationRingInnerGearOutlinePoints, fabricationRenderPlanForMechanism, fabricationStackSummary, planetaryGearConventionForMechanism, planetaryGearRadii, planetaryPlanetCenters, planetaryRingPitchRadius, readableFabricationStackSummary, sampleFeasibleRange, validateForFabrication } from './utils/fabrication';
import { boardGridLines, boardToScene, bodyPartPivotScene, localPivotOffsetForScene, pathFromPoints, physicalKitPreset, sceneBoundsForSheet, sceneToBoard, sceneToSvg, svgPointerToScene, SCENE_PX_PER_MM, SCENE_VIEW } from './utils/coordinates';
import { loadCharacterPackage } from './utils/packageLoader';
import { describeMotionChain, mechanismBindingWarnings, motionAnchorJointIds, motionChainOptionLabel, motionChainRootJointIds, motionPreviewForPath, preferredMotionJointId } from './utils/motion';
import { fabricablePartOutlinePoints, isUsableContourPoints, partLandmarkLocalPoints, partOutlineBounds, partOutlinePathD, pointInsideOutline } from './utils/partGeometry';
import { clampCanvasZoom, DEFAULT_CANVAS_VIEWPORT, normalizeCanvasViewport, WEBGL_PIXEL_RATIO_CAP } from './utils/viewport';
import { formatGridLabel, formatGridReadout } from './utils/units';
import { VIEWER3D_CAMERA_PRESETS, VIEWER3D_CONTRACT_VERSION, createViewer3DContract, viewer3DLayerDataValue, type Viewer3DCameraPreset } from './utils/viewer3d';
import { assemblyLaneForExportMode, buildAssemblyPlaybackSteps, pendingRecipeForMechanism, type AssemblyLane } from './utils/assemblyPlayback';
import { commandIdForKeyboardEvent, type AppCommandId } from './utils/appCommands';
import { AUTHORABLE_MECHANISM_TYPES, FOUNDRY_MECHANISM_TYPES, FOUNDRY_PRESETS, MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY, mechanismTemplateLabel } from './utils/mechanismTemplates';
import { normalizeMechanismToReference, referenceRecipeForType, referenceRequiredPartsHoleCount } from './utils/mechanismReference';
import { createMechanismFitContext, fitMechanismSimulation, fitMechanismSimulationWithContext, fitPathToBox, fitPointsToBox, pointsToSvgPath } from './utils/mechanismPreview';
import { AlertCircle, Boxes, BrainCircuit, CheckCircle2, Download, FileJson, Loader2, Play, Plus, Route, Sparkles, Trash2, Upload } from 'lucide-react';
import motionSmithIconUrl from './resources/icons/AppIcon.png?url';
import girlStarterUrl from './resources/examples/raw/girl.png?url';
import boyStarterUrl from './resources/examples/raw/boy.PNG?url';

type FoundryState = MechanismConfig;
type FoundryViewPreset = Viewer3DCameraPreset | 'side' | 'custom';
type FoundryCamera = { yaw: number; pitch: number; zoom: number; preset: FoundryViewPreset; pan: Point };
type FoundryCameraPreset = { label: string; yaw: number; pitch: number; zoom: number };
const foundryPreset = (preset: Viewer3DCameraPreset): FoundryCameraPreset => ({
    label: VIEWER3D_CAMERA_PRESETS[preset].foundryLabel,
    ...VIEWER3D_CAMERA_PRESETS[preset].foundry
});

const FOUNDRY_VIEW_PRESETS: Record<Exclude<FoundryViewPreset, 'custom'>, FoundryCameraPreset> = {
    front: foundryPreset('front'),
    iso: foundryPreset('iso'),
    side: { label: 'Side', yaw: 64, pitch: 12, zoom: 0.86 },
    top: foundryPreset('top')
};

const clampFoundryPitch = (value: number) => Math.max(-64, Math.min(68, value));
const clampFoundryZoom = (value: number) => Math.max(0.45, Math.min(2.4, value));
const degToRad = (deg: number) => (deg * Math.PI) / 180;
const foundryCameraDistance = (camera: FoundryCamera) => 17 / clampFoundryZoom(camera.zoom);
type FoundryOverlaySize = { width: number; height: number };
const FOUNDRY_OVERLAY_SIZE: FoundryOverlaySize = { width: 360, height: 240 };
const FOUNDRY_ANIMATION_COMMIT_MS = 1000 / 30;
const FOUNDRY_CAMERA_TARGET_Z = 0.25;
const foundryCameraTarget = (camera: FoundryCamera) =>
    new THREE.Vector3(camera.pan?.x ?? 0, camera.pan?.y ?? 0, FOUNDRY_CAMERA_TARGET_Z);

const foundryCameraPosition = (camera: FoundryCamera) => {
    const { yaw, pitch } = camera;
    const distance = foundryCameraDistance(camera);
    const yawRad = yaw * Math.PI / 180;
    const pitchRad = pitch * Math.PI / 180;
    const target = foundryCameraTarget(camera);
    return target.clone().add(new THREE.Vector3(
        Math.sin(yawRad) * Math.cos(pitchRad) * distance,
        Math.sin(pitchRad) * distance,
        Math.cos(yawRad) * Math.cos(pitchRad) * distance
    ));
};

const projectFoundryOverlayPoint = (point: Point | undefined, camera: FoundryCamera, size: FoundryOverlaySize = FOUNDRY_OVERLAY_SIZE, z = 0): Point | undefined => {
    if (!point) return undefined;
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    const cam = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    cam.position.copy(foundryCameraPosition(camera));
    cam.lookAt(foundryCameraTarget(camera));
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const projected = new THREE.Vector3((point.x - 180) / 18, (120 - point.y) / 18, z).project(cam);
    return {
        x: ((projected.x + 1) / 2) * width,
        y: ((1 - projected.y) / 2) * height
    };
};

const unprojectFoundryOverlayPoint = (point: Point, camera: FoundryCamera, size: FoundryOverlaySize = FOUNDRY_OVERLAY_SIZE, z = 0): Point | undefined => {
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    const cam = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    cam.position.copy(foundryCameraPosition(camera));
    cam.lookAt(foundryCameraTarget(camera));
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const ndc = new THREE.Vector2((point.x / width) * 2 - 1, 1 - (point.y / height) * 2);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cam);
    const dz = ray.ray.direction.z;
    if (!Number.isFinite(dz) || Math.abs(dz) < 1e-5) return undefined;
    const t = (z - ray.ray.origin.z) / dz;
    if (!Number.isFinite(t)) return undefined;
    const hit = ray.ray.origin.clone().add(ray.ray.direction.clone().multiplyScalar(t));
    return { x: hit.x * 18 + 180, y: 120 - hit.y * 18 };
};


const foundryLayerGeometryContract = (type: MechanismType, label: string, renderKind: string) => {
    if (type === '4bar' && renderKind === 'linkage') {
        if (/input|crank/i.test(label)) return `${label}:A-B`;
        if (/coupler/i.test(label)) return `${label}:B-C`;
        if (/output|rocker/i.test(label)) return `${label}:C-D`;
    }
    if (type === 'gear' && renderKind === 'gear') return `${label}:fixed-board-gear`;
    if (type === 'gear_linkage') {
        if (renderKind === 'gear') return `${label}:fixed-board-gear`;
        if (/L4|linkage/i.test(label)) return `${label}:P-R`;
        if (/2-hole|bracket/i.test(label)) return `${label}:R-connector`;
    }
    if (type === 'planetary_gear') {
        if (/ring/i.test(label)) return `${label}:fixed-ring`;
        if (/sun/i.test(label)) return `${label}:sun-input`;
        if (/planet/i.test(label)) return `${label}:planet-on-carrier`;
        if (/carrier/i.test(label)) return `${label}:sun-planet-carrier`;
    }
    if (type === 'cam') {
        if (renderKind === 'cam') return `${label}:rotating-cam`;
        if (renderKind === 'follower') return `${label}:guided-follower`;
        if (renderKind === 'guide') return `${label}:fixed-guide`;
    }
    return `${label}:${renderKind}`;
};

const mechanismReferenceTopologySummary = (type: MechanismType) => {
    if (type === '4bar') return 'A-B input; B-C coupler; C-D output; D-A board-ground';
    if (type === 'gear') return 'fixed gear centers only; no rods; external mesh sequence';
    if (type === 'gear_linkage') return 'fixed gear centers; driven gear handle P; P-R L4 linkage; R bracket';
    if (type === 'cam') return 'rotating cam profile; guided follower block; no linkage rods';
    if (type === 'planetary_gear') return 'fixed ring; sun input; planet on carrier; carrier output';
    if (type === '5bar') return 'A-B-C-D-E closed chain; A-E board-ground; simulation-only';
    if (type === '6bar') return 'A-B-C-D four-bar plus C-E-D dyad; simulation-only';
    if (type === 'piston') return 'crank-slider guide; slider-crank fabrication recipe';
    return `${type} simulation topology`;
};

const STARTER_IMAGE_TEMPLATES: StarterImageTemplate[] = [
    { id: 'girl', label: 'Girl starter', fileName: 'girl.png', description: 'Flat vector pose from resources/examples/raw/girl.png.', url: girlStarterUrl },
    { id: 'boy', label: 'Boy starter', fileName: 'boy.PNG', description: 'Textured pose from resources/examples/raw/boy.PNG.', url: boyStarterUrl }
];

const OPTIONS_SECTION_MANIFEST = [
    { id: 'appearance', label: 'Appearance', description: 'Keep the interface light and show only the panels you need.' },
    { id: 'simulation', label: 'Simulation', description: 'Timing plus the physical mass/friction used by force previews.' },
    { id: 'performance', label: 'Performance', description: 'Choose how hard path fitting and snap checks work.' },
    { id: 'debugging', label: 'Debugging', description: 'Turn on labels when something feels off.' },
    { id: 'workflow', label: 'Workflow', description: 'Autosave is local to this browser.' },
    { id: 'fabrication', label: 'Fabrication / Blueprint export', description: 'Match the preview grid to the physical sheet and board holes.' },
    { id: 'units', label: 'Units', description: 'Viewport labels change; fabrication geometry still stores millimeters.' }
] as const;

type OptionsSectionMeta = typeof OPTIONS_SECTION_MANIFEST[number];
const optionSection = (id: OptionsSectionMeta['id']) => OPTIONS_SECTION_MANIFEST.find(section => section.id === id)!;
const PARAMS: Array<{ key: keyof MechanismConfig; label: string; min: number; max: number; step?: number }> = [
    { key: 'anchorX', label: 'anchor X', min: -260, max: 260, step: 40 },
    { key: 'anchorY', label: 'anchor Y', min: -260, max: 260, step: 40 },
    { key: 'groundAngle', label: 'ground angle', min: -180, max: 180 },
    { key: 'crankLength', label: 'crank', min: 10, max: 180 },
    { key: 'groundLength', label: 'ground', min: 0, max: 280 },
    { key: 'couplerLength', label: 'coupler', min: 0, max: 320 },
    { key: 'rockerLength', label: 'rocker / gear', min: 0, max: 220 },
    { key: 'sliderOffset', label: 'slider offset', min: -120, max: 120 },
    { key: 'couplerPointDist', label: 'output dist', min: 0, max: 220 },
    { key: 'couplerPointAngle', label: 'output angle', min: -180, max: 180 },
    { key: 'gearRatio', label: 'gear ratio', min: -6, max: 6, step: 0.1 },
    { key: 'rodLength', label: 'rod length', min: 10, max: 260 },
    { key: 'speed2', label: 'second speed', min: -5, max: 5, step: 0.1 },
    { key: 'phase', label: 'phase', min: -3.14, max: 3.14, step: 0.01 }
];

const isAppStage = (value: unknown): value is AppStage => typeof value === 'string' && STAGES.some(stage => stage.id === value);
const projectHasUserWork = (project: ProjectState) => project.partOrder.length > 0 || Object.keys(project.paths).length > 0 || project.mechanisms.length > 0;
const STORAGE_KEYS = {
    hideWelcome: 'motionsmith.hideWelcome',
    autosave: 'motionsmith.autosave',
    workspace: 'motionsmith.workspace'
} as const;
const LEGACY_STORAGE_PREFIX = ['mech', 'anim'].join('');
const LEGACY_STORAGE_KEYS = {
    hideWelcome: `${LEGACY_STORAGE_PREFIX}.hideWelcome`,
    autosave: `${LEGACY_STORAGE_PREFIX}.autosave`,
    workspace: `${LEGACY_STORAGE_PREFIX}.workspace`
} as const;
const readStorageWithLegacy = (key: string, legacyKey: string) => {
    const current = localStorage.getItem(key);
    if (current !== null) return { value: current, fromLegacy: false };
    const legacy = localStorage.getItem(legacyKey);
    return { value: legacy, fromLegacy: legacy !== null };
};
const migrateStorageValue = (key: string, value: string) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // ponytail: migration is best-effort; legacy read fallback still works.
    }
};
const shouldHideWelcome = () => {
    const stored = readStorageWithLegacy(STORAGE_KEYS.hideWelcome, LEGACY_STORAGE_KEYS.hideWelcome);
    if (stored.fromLegacy && stored.value !== null) migrateStorageValue(STORAGE_KEYS.hideWelcome, stored.value);
    return stored.value === '1';
};

const initialOnnxCacheStatus = (): WebOnnxCacheStatus => ({ stage: 'checking', label: 'AI pose model', progress: 0 });
const processingLabel = (stage: ProjectState['processing']['stage'], message: string) => {
    if (stage === 'error') return message || 'Fix needed';
    if (stage === 'ready') return 'Ready';
    if (stage === 'downloading-model') return 'Getting AI…';
    if (stage === 'loading-model') return 'Opening…';
    if (stage === 'running-onnx') return 'Finding joints…';
    if (stage === 'extracting-parts') return 'Cutting parts…';
    if (stage === 'normalizing') return 'Fitting sheet…';
    return message || 'Pick file';
};

const compactPackageSummary = (summary: string) =>
    summary.replace(/ready to review/gi, 'ready');

const workflowStatusFor = (stage: AppStage, project: ProjectState, selectedPart?: BodyPartLayer, selectedPath?: ProjectMotionPath) => {
    const stageLabel = STAGES.find(item => item.id === stage)?.label ?? stage;
    const validation = validateForFabrication(project);
    const enabledMechanisms = project.mechanisms.filter(m => m.visible && m.enabled !== false);
    let blocker = 'OK';
    let nextAction = 'Keep going';
    if (!project.partOrder.length) {
        blocker = 'No character';
        nextAction = 'Load character.';
    } else if (stage === 'path') {
        blocker = selectedPart?.locked ? `${selectedPart.name} locked` : (selectedPath && selectedPath.points.length >= 3 ? 'OK' : 'Need 3 dots');
        nextAction = selectedPath && selectedPath.points.length >= 3 ? 'Open Foundry.' : 'Draw path.';
    } else if (stage === 'foundry') {
        blocker = selectedPath && selectedPath.points.length >= 3 ? 'OK' : 'No path';
        nextAction = selectedPath && selectedPath.points.length >= 3 ? 'Pick one.' : 'Draw path.';
    } else if (stage === 'design') {
        blocker = enabledMechanisms.length ? 'OK' : 'No mechanism';
        nextAction = enabledMechanisms.length ? 'Check target.' : 'Pick mechanism.';
    } else if (stage === 'blueprint') {
        blocker = validation.errors[0] ?? validation.warnings[0] ?? 'OK';
        nextAction = validation.errors.length ? 'Fix.' : 'Make sheets.';
    } else if (stage === 'assembly') {
        blocker = validation.errors[0] ?? validation.warnings[0] ?? 'OK';
        nextAction = validation.errors.length ? 'Fix blueprint.' : 'Build.';
    } else if (stage === 'options') {
        nextAction = 'Tune settings.';
    } else {
        nextAction = 'Choose starter.';
    }
    return { stageLabel, blocker, nextAction };
};

const PROJECT_HISTORY_LIMIT = 80;
type ProjectHistoryState = { present: ProjectState; past: ProjectState[]; future: ProjectState[] };
const isUndoableProjectAction = (action: ProjectAction) => !['set_processing', 'select_part', 'set_export', 'set_foundry_export'].includes(action.type);
const projectFileStem = (name: string) => (name.trim() || 'MotionSmith-project').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'MotionSmith-project';
const isTypingShortcutTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const App: React.FC = () => {
    const [projectHistory, setProjectHistory] = useState<ProjectHistoryState>(() => {
        projectSelfCheck();
        return { present: createEmptyProject(), past: [], future: [] };
    });
    const project = projectHistory.present;
    const setProject = (update: React.SetStateAction<ProjectState>, options: { history?: boolean; resetHistory?: boolean } = {}) => {
        setProjectHistory(prev => {
            const next = typeof update === 'function' ? (update as (previous: ProjectState) => ProjectState)(prev.present) : update;
            if (next === prev.present) return prev;
            if (options.resetHistory) return { present: next, past: [], future: [] };
            if (options.history) return { present: next, past: [...prev.past.slice(-(PROJECT_HISTORY_LIMIT - 1)), prev.present], future: [] };
            return { ...prev, present: next };
        });
    };
    const [stage, setStage] = useState<AppStage>('character');
    const [showWelcome, setShowWelcome] = useState(() => !shouldHideWelcome());
    const [showGettingStarted, setShowGettingStarted] = useState(false);
    const [angle, setAngle] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);
    const [showTrace, setShowTrace] = useState(true);
    const [drawMode, setDrawMode] = useState(false);
    const [showTracking, setShowTracking] = useState(false);
    const [showRecommendations, setShowRecommendations] = useState(false);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [showAbout, setShowAbout] = useState(false);
    const modalOpen = showWelcome || showGettingStarted || showShortcuts || showAbout;
    const [foundry, setFoundry] = useState<FoundryState>(() => createDefaultMechanism('4bar', 'foundry-preview'));
    const [pendingCharacter, setPendingCharacter] = useState<{ project: ProjectState; summary: string; returnStage: AppStage } | null>(null);
    const [replaceCharacter, setReplaceCharacter] = useState(false);
    const [optimizerBusy, setOptimizerBusy] = useState(false);
    const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>(DEFAULT_CANVAS_VIEWPORT);
    const [commandStatus, setCommandStatus] = useState('Ready');
    const [onnxCacheStatus, setOnnxCacheStatus] = useState<WebOnnxCacheStatus>(initialOnnxCacheStatus);
    const projectInputRef = useRef<HTMLInputElement>(null);
    const latestProjectRef = useRef<ProjectState | null>(null);
    const appShellRef = useRef<HTMLDivElement>(null);
    const commandHandlersRef = useRef<Record<AppCommandId, () => void> | null>(null);

    useEffect(() => {
        document.body.classList.add('app-ready');
        const bootTimer = window.setTimeout(() => document.getElementById('boot-loader')?.remove(), 320);
        let active = true;
        checkWebOnnxCache().then(status => { if (active) setOnnxCacheStatus(status); });
        return () => {
            active = false;
            window.clearTimeout(bootTimer);
        };
    }, []);

    const cacheOnnxModel = async () => {
        setCommandStatus('Getting AI…');
        const result = await warmWebOnnxCache(setOnnxCacheStatus);
        setCommandStatus(result.stage === 'cached' ? 'AI ready' : `AI failed: ${result.error ?? 'download error'}`);
    };

    const dispatch = (action: ProjectAction) => setProject(prev => applyProjectAction(prev, action), { history: isUndoableProjectAction(action) });
    const goStage = (target: AppStage) => {
        const gate = handoffGate(project, target);
        if (!gate.ok && 'recoveryStage' in gate) {
            dispatch({ type: 'set_processing', processing: { stage: 'error', message: gate.message, progress: 0, error: gate.message } });
            setCommandStatus(gate.message);
            setStage(gate.recoveryStage);
        } else {
            setCommandStatus(`Opened ${STAGES.find(s => s.id === target)?.label ?? target}`);
            setStage(target);
        }
    };
    const sortedParts = useMemo(() => project.partOrder.map(id => project.parts[id]).filter(Boolean), [project.parts, project.partOrder]);
    const selectedPart = project.selectedPartId ? project.parts[project.selectedPartId] : sortedParts[0];
    const selectedPath = useMemo(() => {
        if (!selectedPart) return undefined;
        const current = project.selectedPathId ? project.paths[project.selectedPathId] : undefined;
        return current?.partId === selectedPart.id ? current : (Object.values(project.paths) as ProjectMotionPath[]).find(path => path.partId === selectedPart.id);
    }, [project.paths, project.selectedPathId, selectedPart]);
    const selectedMechanism = project.mechanisms.find(m => m.id === project.selectedMechanismId) ?? project.mechanisms[0];
    const playbackDurationMs = selectedMechanism?.targetPathId && project.paths[selectedMechanism.targetPathId]
        ? project.paths[selectedMechanism.targetPathId].duration
        : selectedPath?.duration ?? project.settings.animationDurationMs;

    useEffect(() => {
        if (!isPlaying || drawMode || optimizerBusy || showWelcome || showGettingStarted || !SHARED_PLAYBACK_STAGES.includes(stage)) return;
        let frame = 0;
        let last = performance.now();
        const tick = (time: number) => {
            const dt = Math.min(64, time - last);
            last = time;
            setAngle(prev => (prev + animationDeltaRadians(dt, playbackDurationMs, project.settings.animationSpeed, project.settings.timingProfile, prev)) % (Math.PI * 2));
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [isPlaying, drawMode, optimizerBusy, showWelcome, showGettingStarted, stage, playbackDurationMs, project.settings.animationSpeed, project.settings.timingProfile]);

    useEffect(() => {
        if (stage !== 'path' && drawMode) setDrawMode(false);
    }, [stage, drawMode]);

    const mechanismConfig: GlobalConfig = useMemo(() => ({
        speed: project.settings.animationSpeed,
        rotation: 0,
        mechanisms: project.mechanisms
    }), [project.settings.animationSpeed, project.mechanisms]);

    const setMechanismConfig: React.Dispatch<React.SetStateAction<GlobalConfig>> = update => {
        setProject(prev => {
            const current = { speed: prev.settings.animationSpeed, rotation: 0, mechanisms: prev.mechanisms };
            const next = typeof update === 'function' ? update(current) : update;
            return applyProjectAction(prev, {
                type: 'set_mechanisms',
                mechanisms: next.mechanisms,
                selectedMechanismId: prev.selectedMechanismId ?? next.mechanisms[0]?.id
            });
        }, { history: true });
    };

    const updateMechanism = (id: string, updates: Partial<MechanismConfig>) => {
        const mechanism = project.mechanisms.find(m => m.id === id);
        if (!mechanism) return;
        const nextUpdates = { ...updates };
        if (updates.targetPathId) {
            const path = project.paths[updates.targetPathId];
            if (path) {
                nextUpdates.targetPartId = path.partId;
                nextUpdates.targetAnchorJointId = path.targetAnchorJointId ?? preferredMotionJointId(project, path.partId, mechanism.targetAnchorJointId, { preferDistalWhenRoot: !mechanism.targetAnchorJointId });
            }
        }
        if (updates.targetPartId !== undefined) {
            const pathId = updates.targetPathId ?? mechanism.targetPathId;
            if (pathId && project.paths[pathId]?.partId !== updates.targetPartId) nextUpdates.targetPathId = undefined;
            nextUpdates.targetAnchorJointId = updates.targetPartId
                ? preferredMotionJointId(project, updates.targetPartId, undefined, { preferDistalWhenRoot: true })
                : undefined;
        }
        const next = { ...mechanism, ...nextUpdates };
        const normalized = normalizeGearMeshMechanism(next);
        const fitted = nextUpdates.targetPathId && (updates.targetPathId !== undefined || updates.targetPartId !== undefined)
            ? fitMechanismToTargetPath(project, normalized, nextUpdates.targetPathId)
            : mechanismWithGeneratedPath({ ...normalized, activeVisualPartIds: normalized.targetPartId ? [normalized.targetPartId] : [] });
        dispatch({ type: 'upsert_mechanism', mechanism: fitted });
    };

    const setPathPoints = (points: Point[], source: ProjectMotionPath['source'] = 'drawn') => {
        const partId = selectedPart?.id;
        if (!partId || project.parts[partId]?.locked) return;
        const existing = (Object.values(project.paths) as ProjectMotionPath[]).find(path => path.partId === partId);
        const id = project.selectedPathId && project.paths[project.selectedPathId]?.partId === partId ? project.selectedPathId : existing?.id ?? `path-${partId}`;
        const current = project.paths[id];
        dispatch({
            type: 'upsert_path',
            path: validatePath({
                id,
                partId,
                targetAnchorJointId: current?.targetAnchorJointId,
                chainRootJointId: current?.chainRootJointId,
                smoothness: current?.smoothness ?? 0,
                points,
                timedPoints: points.map((p, i) => ({ ...p, time: points.length <= 1 ? 0 : (i / (points.length - 1)) * (current?.duration ?? project.settings.animationDurationMs) })),
                duration: current?.duration ?? project.settings.animationDurationMs,
                closed: current?.closed ?? false,
                enabled: current?.enabled ?? true,
                visible: current?.visible ?? true,
                source,
                warnings: []
            })
        });
    };

    const queueCharacterReview = (next: ProjectState, summary: string) => {
        const reviewed = replaceCharacter ? replaceCharacterProject(next, project, stage) : next;
        setPendingCharacter({ project: reviewed, summary, returnStage: 'character' });
        dispatch({ type: 'set_processing', processing: { stage: 'ready', message: 'Check character', progress: 100 } });
        setShowWelcome(false);
        setStage('character');
    };

    const runWebOnnx = async (file: File) => {
        dispatch({ type: 'set_processing', processing: { stage: 'loading-model', message: 'Reading picture…', progress: 10 } });
        try {
            const result = await processImageWithWebOnnx(file, (stageName, progress) => {
                if (stageName === 'downloading-model') setOnnxCacheStatus(prev => ({ ...prev, stage: 'downloading', progress }));
                if (stageName === 'loading-model') setOnnxCacheStatus(prev => ({ ...prev, stage: 'cached', progress: 100 }));
                const stageId = stageName as ProjectState['processing']['stage'];
                dispatch({ type: 'set_processing', processing: { stage: stageId, message: processingLabel(stageId, ''), progress } });
            });
            const next = createProjectFromProcessed({
                name: file.name.replace(/\.[^.]+$/, '') || 'Processed character',
                sourceImageName: file.name,
                skeleton: result.skeleton,
                parts: result.parts,
                textureUrl: result.textureUrl,
                maskUrl: result.maskUrl,
                keypoints: result.keypoints,
                replacementContext: {
                    mode: replaceCharacter ? 'replace-character' : 'plain-load',
                    previousStage: stage,
                    rebindingSummary: replaceCharacter ? 'Check before preserving mechanisms.' : 'Clean start.'
                }
            });
            queueCharacterReview(next, `${next.partOrder.length} parts · ${Object.keys(next.skeleton?.joints ?? {}).length} joints · ready`);
        } catch (error) {
            dispatch({
                type: 'set_processing',
                processing: {
                    stage: 'error',
                    message: 'Image processing failed',
                    progress: 0,
                    error: error instanceof Error ? error.message : String(error)
                }
            });
        }
    };

    const loadStarterImage = async (template: StarterImageTemplate) => {
        setCommandStatus(`Opening ${template.label}`);
        dispatch({ type: 'set_processing', processing: { stage: 'loading-model', message: `Opening ${template.label}`, progress: 8 } });
        try {
            const response = await fetch(template.url);
            if (!response.ok) throw new Error(`Could not load ${template.fileName}`);
            const blob = await response.blob();
            await runWebOnnx(new File([blob], template.fileName, { type: blob.type || 'image/png' }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dispatch({ type: 'set_processing', processing: { stage: 'error', message: 'Starter image failed', progress: 0, error: message } });
            setCommandStatus(`Starter failed: ${message}`);
        }
    };

    const importCharacterPackage = async (files: FileList | File[]) => {
        dispatch({ type: 'set_processing', processing: { stage: 'loading-model', message: 'Loading character…', progress: 20 } });
        try {
            queueCharacterReview(await loadCharacterPackage(files), 'Ready to use.');
        } catch (error) {
            dispatch({
                type: 'set_processing',
                processing: {
                    stage: 'error',
                    message: 'Couldn’t load character',
                    progress: 0,
                    error: error instanceof Error ? error.message : String(error)
                }
            });
            setStage('character');
        }
    };

    const importProject = async (file: File) => {
        try {
            const raw = JSON.parse(await file.text());
            setProject(loadProjectSnapshot(raw), { resetHistory: true });
            setCommandStatus(`Loaded project ${file.name}`);
            setShowWelcome(false);
            setStage('path');
        } catch (error) {
            dispatch({
                type: 'set_processing',
                processing: {
                    stage: 'error',
                    message: 'Project import failed',
                    progress: 0,
                    error: error instanceof Error ? error.message : String(error)
                }
            });
            setCommandStatus(`Project import failed: ${error instanceof Error ? error.message : String(error)}`);
            setShowWelcome(false);
            setShowGettingStarted(false);
            setStage('character');
        }
    };

    const editCharacterParts = () => {
        setCommandStatus('Opened Character part, outline, and skeleton tools');
        setShowWelcome(false);
        setStage('character');
    };

    const saveSkeleton = () => {
        if (!project.skeleton) {
            setCommandStatus('No skeleton to save');
            return;
        }
        const charCfg = project.characterPackage?.charCfg ?? { joints: project.skeleton.joints, bones: project.skeleton.bones, root_joint_ids: project.skeleton.rootJointIds, metadata: project.skeleton.metadata };
        downloadText('char_cfg.json', JSON.stringify(charCfg, null, 2));
        setCommandStatus('Saved skeleton config');
    };

    const optimizeSelectedMechanism = async () => {
        if (!selectedMechanism || !selectedPath || selectedPath.points.length < 3) return;
        setOptimizerBusy(true);
        await new Promise(r => setTimeout(r, 16));
        let best = generateSmartConfig(selectedPath.points, selectedMechanism.type);
        let bestScore = evaluateFitness(best, selectedPath.points);
        const iterations = project.settings.performancePreset === 'fast' ? 120 : project.settings.performancePreset === 'high' ? 520 : 260;
        for (let i = 0; i < iterations; i++) {
            const candidate = i < 80 ? generateSmartConfig(selectedPath.points, selectedMechanism.type) : mutateConfig(best, 0.45, true);
            const score = evaluateFitness(candidate, selectedPath.points);
            if (score < bestScore) {
                best = candidate;
                bestScore = score;
            }
        }
        updateMechanism(selectedMechanism.id, {
            ...best,
            id: selectedMechanism.id,
            color: selectedMechanism.color,
            visible: true,
            targetPartId: selectedPart?.id,
            targetPathId: selectedPath.id,
            source: 'optimized',
            warnings: bestScore > 350 ? [`Loose fit score ${Math.round(bestScore)}`] : []
        });
        setOptimizerBusy(false);
    };

    useEffect(() => {
        latestProjectRef.current = project;
    }, [project]);

    useEffect(() => {
        if (!project.settings.autosave) return;
        const writeAutosave = () => {
            try {
                localStorage.setItem(STORAGE_KEYS.autosave, serializeProject(latestProjectRef.current ?? project));
            } catch {
                // ponytail: browser autosave is best-effort; manual snapshot download stays available.
            }
        };
        writeAutosave();
        const intervalMs = Math.max(1000, project.settings.autosaveIntervalSeconds * 1000);
        const interval = window.setInterval(writeAutosave, intervalMs);
        return () => window.clearInterval(interval);
    }, [project.settings.autosave, project.settings.autosaveIntervalSeconds]);

    const exportMechanismSvg = () => {
        downloadText(`mechanisms-${Date.now()}.svg`, generateSVG(mechanismConfig, angle), 'image/svg+xml');
        setCommandStatus('Exported mechanism SVG');
    };
    const exportMechanismDxf = () => {
        downloadText(`mechanisms-${Date.now()}.dxf`, generateDXF(mechanismConfig, angle), 'application/dxf');
        setCommandStatus('Exported mechanism DXF');
    };
    const downloadProjectSnapshot = (suffix: string, status: string) => {
        const stem = projectFileStem(project.metadata.name);
        downloadText(`${stem}${suffix}.motionsmith.json`, serializeProject(project));
        setCommandStatus(status);
    };
    const saveProject = () => downloadProjectSnapshot('', 'Downloaded local project snapshot');
    const saveProjectAs = () => downloadProjectSnapshot(`-${Date.now()}`, 'Downloaded timestamped project snapshot');
    const exportProjectCopy = () => downloadProjectSnapshot('-copy', 'Downloaded portable project copy');
    const newProject = () => {
        if (projectHasUserWork(project) && !window.confirm('Start a new project? Unsaved paths, mechanisms, and blueprint work will be discarded.')) {
            setCommandStatus('New project cancelled');
            return;
        }
        setPendingCharacter(null);
        setProject(createEmptyProject(), { resetHistory: true });
        setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
        setCommandStatus('Started a fresh empty project');
        setShowWelcome(!shouldHideWelcome());
        setShowGettingStarted(false);
        setStage('character');
    };
    const foundryPreviewFromProject = (lessonProject: ProjectState) => {
        const mechanism = lessonProject.mechanisms[0];
        return mechanism ? { ...mechanism, id: 'foundry-preview' } : createDefaultMechanism('4bar', 'foundry-preview');
    };
    const openLessonTemplate = (lessonId: string) => {
        const lesson = classroomLessonById(lessonId);
        if (!lesson) {
            setCommandStatus('Lesson not available');
            return;
        }
        const lessonProject = createLessonProject(lesson.id);
        setPendingCharacter(null);
        setProject(lessonProject, { resetHistory: true });
        setFoundry(foundryPreviewFromProject(lessonProject));
        setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
        setShowWelcome(false);
        setShowGettingStarted(false);
        setStage(lesson.startStage);
        setCommandStatus(`Opened ${lesson.label}`);
    };
    const resetLesson = () => {
        const lesson = classroomLessonById(project.metadata.classroomLessonId);
        const resetProject = resetProjectToLessonBaseline(project);
        if (!lesson || !resetProject) {
            setCommandStatus('No lesson baseline to reset');
            return;
        }
        setPendingCharacter(null);
        setProject(resetProject, { resetHistory: true });
        setFoundry(foundryPreviewFromProject(resetProject));
        setAngle(0);
        setIsPlaying(false);
        setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
        setStage(lesson.startStage);
        setCommandStatus(`Reset ${lesson.label}`);
    };
    const recoverAutosave = () => {
        try {
            const stored = readStorageWithLegacy(STORAGE_KEYS.autosave, LEGACY_STORAGE_KEYS.autosave);
            if (!stored.value) {
                setCommandStatus('No autosave snapshot found');
                return;
            }
            setProject(loadProjectSnapshot(JSON.parse(stored.value)), { resetHistory: true });
            if (stored.fromLegacy) migrateStorageValue(STORAGE_KEYS.autosave, stored.value);
            setCommandStatus('Recovered browser autosave snapshot');
            setStage('path');
        } catch (error) {
            setCommandStatus(`Autosave recovery failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const saveWorkspaceLayout = () => {
        localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify({ stage, viewport: canvasViewport, toolbarVisible: project.settings.toolbarVisible, partPanelVisible: project.settings.partPanelVisible }));
        setCommandStatus('Workspace layout saved');
    };
    const restoreWorkspaceLayout = () => {
        try {
            const stored = readStorageWithLegacy(STORAGE_KEYS.workspace, LEGACY_STORAGE_KEYS.workspace);
            if (!stored.value) {
                setCommandStatus('No workspace layout saved');
                return;
            }
            const layout = JSON.parse(stored.value) as Partial<{ stage: unknown; viewport: unknown; toolbarVisible: unknown; partPanelVisible: unknown }>;
            if (stored.fromLegacy) migrateStorageValue(STORAGE_KEYS.workspace, stored.value);
            const warnings: string[] = [];
            if (layout.viewport !== undefined) {
                const viewport = normalizeCanvasViewport(layout.viewport);
                if (viewport) setCanvasViewport(viewport);
                else warnings.push('ignored invalid workspace viewport');
            }
            if (layout.toolbarVisible !== undefined || layout.partPanelVisible !== undefined) {
                const toolbarVisible = typeof layout.toolbarVisible === 'boolean' ? layout.toolbarVisible : project.settings.toolbarVisible;
                const partPanelVisible = typeof layout.partPanelVisible === 'boolean' ? layout.partPanelVisible : project.settings.partPanelVisible;
                if (layout.toolbarVisible !== undefined && typeof layout.toolbarVisible !== 'boolean') warnings.push('ignored invalid toolbar visibility');
                if (layout.partPanelVisible !== undefined && typeof layout.partPanelVisible !== 'boolean') warnings.push('ignored invalid panel visibility');
                dispatch({ type: 'update_settings', settings: { toolbarVisible, partPanelVisible } });
            }
            if (layout.stage !== undefined) {
                if (isAppStage(layout.stage)) goStage(layout.stage);
                else warnings.push('ignored invalid workspace stage');
            }
            setCommandStatus(warnings.length ? `Workspace layout restored; ${warnings.join('; ')}` : 'Workspace layout restored');
        } catch (error) {
            setCommandStatus(`Workspace restore failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const resetWorkspaceLayout = () => {
        setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
        dispatch({ type: 'update_settings', settings: { toolbarVisible: true, partPanelVisible: true } });
        setCommandStatus('Workspace layout reset');
    };
    const zoomCanvas = (factor: number) => {
        const nextZoom = clampCanvasZoom(canvasViewport.zoom * factor);
        setCanvasViewport(prev => ({ ...prev, zoom: clampCanvasZoom(prev.zoom * factor) }));
        setCommandStatus(`Canvas zoom ${Math.round(nextZoom * 100)}%`);
    };
    const fitCanvas = () => {
        setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
        setCommandStatus('Canvas fitted to sheet');
    };
    const undoProject = () => {
        if (!projectHistory.past.length) {
            setCommandStatus('Nothing to undo');
            return;
        }
        setProjectHistory(prev => {
            if (!prev.past.length) return prev;
            const previous = prev.past[prev.past.length - 1];
            return { present: previous, past: prev.past.slice(0, -1), future: [prev.present, ...prev.future].slice(0, PROJECT_HISTORY_LIMIT) };
        });
        setCommandStatus('Undo applied');
    };
    const redoProject = () => {
        if (!projectHistory.future.length) {
            setCommandStatus('Nothing to redo');
            return;
        }
        setProjectHistory(prev => {
            if (!prev.future.length) return prev;
            const [next, ...future] = prev.future;
            return { present: next, past: [...prev.past.slice(-(PROJECT_HISTORY_LIMIT - 1)), prev.present], future };
        });
        setCommandStatus('Redo applied');
    };
    const aboutMotionSmith = () => setShowAbout(true);
    const commandHandlers = {
        'project.new': newProject,
        'project.open': () => projectInputRef.current?.click(),
        'project.recoverAutosave': recoverAutosave,
        'project.save': saveProject,
        'project.saveAs': saveProjectAs,
        'project.exportCopy': exportProjectCopy,
        'project.exportBlueprint': () => goStage('blueprint'),
        'project.resetLesson': resetLesson,
        'edit.undo': undoProject,
        'edit.redo': redoProject,
        'view.zoomIn': () => zoomCanvas(1.2),
        'view.zoomOut': () => zoomCanvas(1 / 1.2),
        'view.fit': fitCanvas,
        'view.reset': fitCanvas,
        'workspace.saveLayout': saveWorkspaceLayout,
        'workspace.restoreLayout': restoreWorkspaceLayout,
        'workspace.resetLayout': resetWorkspaceLayout,
        'stage.character': () => goStage('character'),
        'stage.path': () => goStage('path'),
        'stage.foundry': () => goStage('foundry'),
        'stage.design': () => goStage('design'),
        'stage.blueprint': () => goStage('blueprint'),
        'stage.assembly': () => goStage('assembly'),
        'options.preferences': () => goStage('options'),
        'help.shortcuts': () => setShowShortcuts(true),
        'help.about': aboutMotionSmith
    } satisfies Record<AppCommandId, () => void>;
    commandHandlersRef.current = commandHandlers;
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (modalOpen) return;
            if (isTypingShortcutTarget(event.target)) return;
            const commandId = commandIdForKeyboardEvent(event);
            if (!commandId) return;
            event.preventDefault();
            commandHandlersRef.current?.[commandId]?.();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [modalOpen]);
    const themeClass = project.settings.theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-950';
    const editorStage: AppStage = stage;
    const closeWelcome = (hideNextTime = false) => {
        if (hideNextTime) localStorage.setItem(STORAGE_KEYS.hideWelcome, '1');
        setShowWelcome(false);
        setShowGettingStarted(!hideNextTime);
        setStage('character');
    };
    const closeGettingStarted = () => {
        setShowGettingStarted(false);
        setStage('character');
    };
    const stageMeta = STAGES.find(s => s.id === stage);
    const playerDock = !modalOpen && editorStage !== 'foundry' && editorStage !== 'character'
        ? <WorkspacePlayerDock isPlaying={isPlaying} setIsPlaying={setIsPlaying} angle={angle} setAngle={setAngle} speed={project.settings.animationSpeed} drawMode={drawMode} />
        : null;

    useEffect(() => {
        const shell = appShellRef.current;
        if (modalOpen) {
            shell?.setAttribute('inert', '');
            shell?.setAttribute('aria-hidden', 'true');
            document.documentElement.classList.add('welcome-modal-open');
            document.body.classList.add('welcome-modal-open');
        } else {
            shell?.removeAttribute('inert');
            shell?.removeAttribute('aria-hidden');
            document.documentElement.classList.remove('welcome-modal-open');
            document.body.classList.remove('welcome-modal-open');
        }
        return () => {
            shell?.removeAttribute('inert');
            shell?.removeAttribute('aria-hidden');
            document.documentElement.classList.remove('welcome-modal-open');
            document.body.classList.remove('welcome-modal-open');
        };
    }, [modalOpen]);

    return (
        <main className={`min-h-screen overflow-hidden ${themeClass}`} data-theme={project.settings.theme}>
            <div className="pointer-events-none fixed inset-0 opacity-70" style={{ background: 'radial-gradient(circle at 15% 10%, rgba(90,108,255,.12), transparent 28%), radial-gradient(circle at 85% 20%, rgba(90,108,255,.08), transparent 24%), linear-gradient(120deg, rgba(8,10,18,.04), transparent)' }} />
            <div ref={appShellRef} className="relative grid min-h-screen app-shell">
                <WorkflowRail stage={stage} goStage={goStage} />
                <section className="relative flex min-w-0 flex-col">
                    <header className="app-header border-b border-slate-300/70 bg-white/50 backdrop-blur-xl">
                        <div className="app-header-brand">
                            <img className="brand-kicker app-header-icon" src={motionSmithIconUrl} alt="" aria-hidden="true" decoding="async" draggable={false}/>
                            <h1 className="brand-title">MotionSmith</h1>
                            <h2 className="current-stage-title">{stageMeta?.label}</h2>
                        </div>
                        <div className="app-header-actions">
                            <TopCommandBar commandHandlers={commandHandlers} />
                            {project.settings.toolbarVisible && <div className="quick-toolbar" data-testid="quick-toolbar">
                                <label className="btn-secondary cursor-pointer"><Upload size={16}/> Import<input hidden type="file" accept="application/json,.json" onChange={e => e.target.files?.[0] && importProject(e.target.files[0])}/></label>
                                <button className="btn-secondary" onClick={saveProject}><Download size={16}/> Snapshot</button>
                                <button className="btn-primary" onClick={() => goStage('blueprint')}><Download size={16}/> Export</button>
                            </div>}
                        </div>
                    </header>
                    <input ref={projectInputRef} data-testid="project-file-input" hidden type="file" accept="application/json,.motionsmith.json,.json" onChange={e => e.target.files?.[0] && importProject(e.target.files[0])}/>

                    <div className="stage-body editor-workbench relative min-h-0 flex-1 overflow-hidden p-7" data-testid="shared-workbench">
                        {editorStage === 'character' && <CharacterSelection project={project} dispatch={dispatch} pendingCharacter={pendingCharacter} replaceCharacter={replaceCharacter} setReplaceCharacter={setReplaceCharacter} onOpenGettingStarted={() => setShowGettingStarted(true)} onAccept={() => { if (!pendingCharacter) return; setProject(pendingCharacter.project, { resetHistory: true }); setPendingCharacter(null); setShowWelcome(false); setShowGettingStarted(false); setStage(pendingCharacter.returnStage); }} onDiscard={() => setPendingCharacter(null)} onProcess={runWebOnnx} onPackage={importCharacterPackage} onImport={importProject} onEditCharacter={editCharacterParts} onSaveSkeleton={saveSkeleton} goStage={goStage} viewport={canvasViewport} setViewport={setCanvasViewport} />}
                        {editorStage === 'path' && <PathEditor project={project} sortedParts={sortedParts} selectedPart={selectedPart} selectedPath={selectedPath} drawMode={drawMode} setDrawMode={setDrawMode} dispatch={dispatch} setPathPoints={setPathPoints} openTracking={() => setShowTracking(true)} isPlaying={isPlaying} setIsPlaying={setIsPlaying} angle={angle} setAngle={setAngle} onNext={() => goStage('foundry')} goStage={goStage} viewport={canvasViewport} setViewport={setCanvasViewport} />}
                        {editorStage === 'foundry' && <MechanismFoundry project={project} foundry={foundry} setFoundry={setFoundry} selectedPart={selectedPart} selectedPath={selectedPath} goStage={goStage} onExport={(pkg) => {
                            const existingTarget = project.mechanisms.find(m =>
                                m.targetPartId === pkg.targetPartId &&
                                m.targetPathId === pkg.targetPathId &&
                                preferredMotionJointId(project, m.targetPartId, m.targetAnchorJointId) === pkg.targetAnchorJointId
                            );
                            const rawMechanism = mechanismWithGeneratedPath({
                                ...foundry,
                                id: existingTarget?.id ?? pkg.mechanismId,
                                anchorX: pkg.pivot.x,
                                anchorY: pkg.pivot.y,
                                targetPartId: pkg.targetPartId,
                                targetPathId: pkg.targetPathId,
                                targetAnchorJointId: pkg.targetAnchorJointId,
                                presetId: pkg.metadata.selectedPreset,
                                recommendation: pkg.metadata.recommendation,
                                source: 'foundry',
                                foundryExport: pkg,
                                generatedPath: pkg.generatedPath,
                                warnings: pkg.warnings,
                                activeVisualPartIds: selectedPart ? [selectedPart.id] : []
                            }, { preserveGeneratedPath: true });
                            const fittedMechanism = pkg.targetPathId
                                ? fitMechanismToTargetPath(project, rawMechanism, pkg.targetPathId)
                                : fitRecommendedMechanismToSheet(project, rawMechanism);
                            const generatedPath = fittedMechanism.generatedPath ?? rawMechanism.generatedPath ?? pkg.generatedPath;
                            const mech = mechanismWithGeneratedPath({
                                ...fittedMechanism,
                                foundryExport: {
                                    ...pkg,
                                    parameters: { ...fittedMechanism },
                                    pivot: { x: fittedMechanism.anchorX ?? pkg.pivot.x, y: fittedMechanism.anchorY ?? pkg.pivot.y },
                                    outputPoint: generatedPath[0] ?? pkg.outputPoint,
                                    generatedPath
                                },
                                generatedPath,
                                warnings: [...new Set([...(fittedMechanism.warnings ?? []), ...(pkg.warnings ?? [])])],
                                activeVisualPartIds: selectedPart ? [selectedPart.id] : []
                            }, { preserveGeneratedPath: true });
                            dispatch({ type: 'set_foundry_export', foundryExport: pkg });
                            dispatch({ type: 'upsert_mechanism', mechanism: mech });
                            setStage('design');
                        }} />}
                        {editorStage === 'design' && <MechanismDesign project={project} selectedMechanism={selectedMechanism} mechanismConfig={mechanismConfig} setMechanismConfig={setMechanismConfig} updateMechanism={updateMechanism} dispatch={dispatch} isPlaying={isPlaying} setIsPlaying={setIsPlaying} showTrace={showTrace} setShowTrace={setShowTrace} angle={angle} setAngle={setAngle} onOptimize={optimizeSelectedMechanism} onRecommendations={() => setShowRecommendations(true)} optimizerBusy={optimizerBusy} exportSvg={exportMechanismSvg} exportDxf={exportMechanismDxf} onBlueprint={() => goStage('blueprint')} goStage={goStage} viewport={canvasViewport} setViewport={setCanvasViewport} />}
                        {editorStage === 'blueprint' && <BlueprintExport project={project} dispatch={dispatch} goStage={goStage} />}
                        {editorStage === 'assembly' && <AssemblyGuide project={project} dispatch={dispatch} goStage={goStage} />}
                        {editorStage === 'options' && <Options project={project} dispatch={dispatch} goStage={goStage} />}
                        {playerDock && <div className="stage-player-row" data-testid="stage-player-row" aria-label="Shared playback controls">{playerDock}</div>}
                    </div>
                    <WorkflowStatusStrip {...workflowStatusFor(editorStage, project, selectedPart, selectedPath)} />
                    <footer className="status-bar" data-testid="status-bar"><span>{commandStatus}</span><OnnxCacheStatusPill status={onnxCacheStatus} onDownload={cacheOnnxModel} /></footer>
                </section>
            </div>
            {showWelcome && <WelcomeDialog onClose={closeWelcome} />}
            {!showWelcome && showGettingStarted && <GettingStartedDialog lessonTemplates={CLASSROOM_LESSONS} starterTemplates={STARTER_IMAGE_TEMPLATES} replaceCharacter={replaceCharacter} setReplaceCharacter={setReplaceCharacter} onLesson={openLessonTemplate} onStarterImage={template => { setShowGettingStarted(false); loadStarterImage(template); }} onSample={() => { setPendingCharacter(null); setProject(createSampleProject(), { resetHistory: true }); setShowWelcome(false); setShowGettingStarted(false); setStage('character'); }} onPackage={files => { setShowGettingStarted(false); importCharacterPackage(files); }} onProcess={file => { setShowGettingStarted(false); runWebOnnx(file); }} onImport={file => { setShowGettingStarted(false); importProject(file); }} onClose={closeGettingStarted} />}
            {showShortcuts && <ShortcutHelpDialog onClose={() => setShowShortcuts(false)} />}
            {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
            <MechanismRecommendationSheet isOpen={showRecommendations} project={project} selectedPart={selectedPart} selectedPath={selectedPath} onClose={() => setShowRecommendations(false)} onApply={mechanism => { dispatch({ type: 'upsert_mechanism', mechanism }); setShowRecommendations(false); setStage('design'); }} />
            <TrackingModal isOpen={showTracking} onClose={() => setShowTracking(false)} onTransfer={path => { setPathPoints(path, 'tracked'); setShowTracking(false); setStage('path'); }} />
        </main>
    );
};

const CharacterSelection = ({ project, dispatch, pendingCharacter, replaceCharacter, setReplaceCharacter, onOpenGettingStarted, onAccept, onDiscard, onProcess, onPackage, onImport, onEditCharacter, onSaveSkeleton, goStage, viewport, setViewport }: {
    project: ProjectState;
    dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void;
    pendingCharacter: { project: ProjectState; summary: string; returnStage: AppStage } | null;
    replaceCharacter: boolean;
    setReplaceCharacter: (v: boolean) => void;
    onOpenGettingStarted: () => void;
    onAccept: () => void;
    onDiscard: () => void;
    onProcess: (file: File) => void;
    onPackage: (files: FileList | File[]) => void;
    onImport: (file: File) => void;
    onEditCharacter: () => void;
    onSaveSkeleton: () => void;
    goStage: (stage: AppStage) => void;
    viewport: CanvasViewport;
    setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
}) => {
    const reviewedProject = pendingCharacter?.project ?? project;
    const artifact = reviewedProject.characterPackage;
    const isPlainReview = artifact?.replacementContext?.mode !== 'replace-character';
    const isReplacementReview = artifact?.replacementContext?.mode === 'replace-character';
    const statusOpen = Boolean(pendingCharacter || project.settings.detailedProcessingSteps || ['downloading-model', 'loading-model', 'running-onnx', 'extracting-parts', 'normalizing', 'error'].includes(project.processing.stage));
    const checks = [
        { label: 'parts_info.json package artifact', ok: Boolean(artifact?.partsInfo) },
        { label: 'char_cfg.yaml skeleton artifact', ok: Boolean(artifact?.charCfg && reviewedProject.skeleton) },
        { label: 'mask + texture', ok: reviewedProject.partOrder.some(id => Boolean(reviewedProject.parts[id]?.textureUrl || reviewedProject.parts[id]?.maskUrl)) },
        { label: 'SVG provenance metadata present', ok: reviewedProject.partOrder.some(id => Boolean(reviewedProject.parts[id]?.originalSvgPath || reviewedProject.parts[id]?.enhancedSvgPath)) },
        { label: 'plain load clears stale mechanisms', ok: Boolean(artifact && isPlainReview && reviewedProject.mechanisms.length === 0) },
        { label: 'replacement preserves compatible mechanisms', ok: Boolean(artifact && isReplacementReview && reviewedProject.mechanisms.length > 0 && artifact.replacementContext?.rebindingSummary.includes('preserved')) }
    ];
    const packageInputRef = useRef<HTMLInputElement>(null);
    const onnxInputRef = useRef<HTMLInputElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const partPanelProject = pendingCharacter ? reviewedProject : project;
    const partPanelDisabled = Boolean(pendingCharacter);
    const editableParts = partPanelProject.partOrder.map(id => partPanelProject.parts[id]).filter((part): part is BodyPartLayer => Boolean(part));
    const selectedEditablePart = (!partPanelDisabled && project.selectedPartId ? project.parts[project.selectedPartId] : undefined) ?? editableParts[0];
    const selectedPartId = selectedEditablePart?.id ?? '';
    const pendingStats = pendingCharacter
        ? `${pendingCharacter.project.partOrder.length} parts · ${Object.keys(pendingCharacter.project.skeleton?.joints ?? {}).length} joints`
        : '';
    const importStatusPanel = (
        <details className="advanced-panel import-status" open={statusOpen}>
            <summary>Import</summary>
            <div className="mt-3"><ProgressBlock project={project} /></div>
            {pendingCharacter && <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Use?</div>
                <div className="mt-1 font-bold">{pendingCharacter.project.metadata.name}</div>
                <div className="text-sm text-slate-600">{pendingStats || compactPackageSummary(pendingCharacter.summary)}</div>
                <div className="mt-2 text-xs text-slate-500" title={pendingCharacter.project.characterPackage?.replacementContext?.rebindingSummary}>{pendingCharacter.project.characterPackage?.replacementContext?.mode === 'replace-character' ? 'Preserve matches.' : 'Clean start.'}</div>
                <div className="mt-4 flex gap-2"><button className="btn-primary" onClick={onAccept}>Use it</button><button className="btn-secondary" onClick={onDiscard}>Skip</button></div>
            </div>}
            <details className="advanced-panel mt-6">
                <summary>Checks</summary>
                <div className="mt-3 grid gap-3 text-sm text-slate-600">
                    {checks.map(item => <div key={item.label} className="flex items-center gap-2">
                        {item.ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-amber-600" />}
                        <span className={item.ok ? '' : 'font-bold text-amber-700'}>{item.label}</span>
                    </div>)}
                </div>
            </details>
        </details>
    );

    return <>
        <section className="character-stage animate-rise" data-testid="character-screen">
        <EditorStageFrame stage="character" className="character-editor-frame" layout={{
            workflow: workflowPane(<StageLeftSummary project={project} title="Character" stage="character" goStage={goStage}>
                <div className="compact-workflow-row" data-testid="character-workflow-summary">
                    <span>{editableParts.length} parts</span>
                    <span>{Object.keys(project.skeleton?.joints ?? {}).length} joints</span>
                    <span>{reviewedProject.partOrder.some(id => Boolean(reviewedProject.parts[id]?.textureUrl)) ? 'art on plates' : 'gray plates'}</span>
                </div>
                <div className="mt-4 grid gap-2">
                    <button className="btn-primary" aria-label="Open Getting Started" onClick={onOpenGettingStarted}><Sparkles size={16}/> Starters</button>
                    <button type="button" className="btn-secondary cursor-pointer" aria-label="Load character package" onClick={() => packageInputRef.current?.click()}><FileJson size={16}/> Load package</button><input ref={packageInputRef} data-testid="blank-package-input" hidden type="file" multiple accept=".json,.yaml,.yml,image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => {
                        const files = e.currentTarget.files ? Array.from(e.currentTarget.files) as File[] : [];
                        e.currentTarget.value = '';
                        if (files.length) onPackage(files);
                    }}/>
                    <button className="btn-secondary" onClick={() => onnxInputRef.current?.click()}><BrainCircuit size={16}/> Create from image</button><input ref={onnxInputRef} data-testid="onnx-input" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
                        const file = e.currentTarget.files?.[0];
                        e.currentTarget.value = '';
                        if (file) onProcess(file);
                    }}/>
                    <button type="button" className="btn-secondary cursor-pointer" onClick={() => importInputRef.current?.click()}><Upload size={16}/> Import project</button><input ref={importInputRef} data-testid="onboarding-import-input" hidden type="file" accept="application/json,.json" onChange={e => {
                        const file = e.currentTarget.files?.[0];
                        e.currentTarget.value = '';
                        if (file) onImport(file);
                    }}/>
                    <label className="replace-toggle"><input aria-label="Replace current character and preserve compatible mechanisms" type="checkbox" checked={replaceCharacter} onChange={e => setReplaceCharacter(e.target.checked)} /> Preserve compatible mechanisms</label>
                </div>
                <details className="advanced-panel mt-4" data-testid="character-processing-panel">
                    <summary>Import tools</summary>
                    {partPanelDisabled && <p className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">Use or skip the new character first.</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button className="btn-secondary" aria-label="Edit Parts / Skeleton / Boxes" disabled={partPanelDisabled} onClick={onEditCharacter}>Edit rig</button>
                        <button className="btn-secondary" disabled={partPanelDisabled} onClick={onSaveSkeleton}>Save Skeleton</button>
                    </div>
                </details>
                <section className="character-part-list mt-4" data-testid="character-part-list" aria-label="Character body part list">
                    <div className="section-title">Body parts</div>
                    <div className="mt-2 grid gap-2">
                        {editableParts.map(part => {
                            const isActive = part.id === selectedPartId;
                            const joints = partLandmarkLocalPoints(part, partPanelProject.skeleton);
                            const outline = fabricablePartOutlinePoints(part, joints);
                            return <button
                                key={part.id}
                                type="button"
                                data-testid={`character-part-item-${part.id}`}
                                className={`character-part-list-item ${isActive ? 'active' : ''}`}
                                disabled={partPanelDisabled}
                                aria-pressed={isActive}
                                onClick={() => dispatch({ type: 'select_part', partId: part.id })}
                            >
                                <span className="part-list-dot" aria-hidden="true" style={{ background: part.fillColor }} />
                                <span className="min-w-0">
                                    <strong>{part.name}</strong>
                                    <small>{part.anchorJointId} · {outline.length} outline pts</small>
                                </span>
                                <span className="part-list-badges">
                                    {part.textureUrl ? <b>art</b> : <b>plate</b>}
                                    {part.locked && <b>lock</b>}
                                </span>
                            </button>;
                        })}
                    </div>
                </section>
            </StageLeftSummary>),
            canvas: canvasPane(<div className="character-preview-pane canvas-workspace" data-testid="character-preview-pane">
                <CanvasZoomToolbar viewport={viewport} setViewport={setViewport} />
                <ThreePuppetPreview project={project} skeleton={project.skeleton} angle={0} viewport={viewport} setViewport={setViewport} inputMode="always" testId="character-three-puppet" />
            </div>),
            inspector: inspectorPane(<div className="stage-pane-stack character-inspector">
                <section className="character-setup-panel" data-testid="character-setup-panel" aria-label="Character part settings">
                    <div className="section-title">Part</div>
                    <div className="mt-1 text-sm font-extrabold text-slate-800">{selectedEditablePart?.name ?? 'No part selected'}</div>
                    {partPanelDisabled
                        ? <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">Use or skip the new character first.</div>
                        : selectedEditablePart && <PartInspector part={selectedEditablePart} skeleton={partPanelProject.skeleton} dispatch={dispatch} compact />}
                    <details className="advanced-panel mt-3" open={!partPanelDisabled}>
                        <summary>Anchors</summary>
                        {partPanelDisabled ? <div className="mt-2 text-xs font-bold text-slate-500">Skeleton editing is available after package acceptance.</div> : <SkeletonInspector project={project} dispatch={dispatch} />}
                    </details>
                </section>
            </div>)
        }}/>
        </section>
        {statusOpen && <aside className="character-status-dock" data-testid="character-status-dock" role="dialog" aria-label="Import" aria-live="polite">
            {importStatusPanel}
        </aside>}
    </>;
};

const ProgressBlock = ({ project }: { project: ProjectState }) => {
    const p = project.processing;
    const steps: Array<{ stage: ProjectState['processing']['stage']; label: string }> = [
        { stage: 'selecting', label: 'Pick file' },
        { stage: 'downloading-model', label: 'Get AI' },
        { stage: 'loading-model', label: 'Open' },
        { stage: 'running-onnx', label: 'Find joints' },
        { stage: 'extracting-parts', label: 'Cut parts' },
        { stage: 'normalizing', label: 'Fit sheet' },
        { stage: 'ready', label: 'Ready' }
    ];
    const activeIndex = Math.max(0, steps.findIndex(step => step.stage === p.stage));
    return <div className="progress-card rounded-3xl p-5">
        <div className="flex items-center gap-3">
            {p.stage === 'error' ? <AlertCircle className="text-red-400"/> : p.stage === 'ready' ? <CheckCircle2 className="text-emerald-400"/> : <Loader2 className="progress-icon animate-spin"/>}
            <div>
                <div className="font-bold">{processingLabel(p.stage, p.message)}</div>
                <div className="progress-stage text-xs" title={p.stage}>{p.progress}%</div>
            </div>
        </div>
        <div className="progress-track mt-4 h-2 rounded-full"><div className="progress-bar h-2 rounded-full transition-all" style={{ width: `${p.progress}%` }}/></div>
        {project.settings.detailedProcessingSteps && <ol className="mt-4 grid gap-2 text-xs text-slate-600" data-testid="processing-step-details">
            {steps.map((step, index) => <li key={step.stage} className={`flex items-center gap-2 ${index <= activeIndex || p.stage === 'error' ? 'font-bold text-slate-800' : ''}`}>
                <span className={`h-2 w-2 rounded-full ${index <= activeIndex ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                <span>{step.label}</span>
            </li>)}
        </ol>}
        {p.error && <pre className="mt-4 max-h-32 overflow-auto whitespace-pre-wrap rounded-2xl bg-red-950/60 p-3 text-xs text-red-100">{p.error}</pre>}
    </div>;
};

const PathEditor = ({ project, sortedParts, selectedPart, selectedPath, drawMode, setDrawMode, dispatch, setPathPoints, openTracking, isPlaying, setIsPlaying, angle, setAngle, onNext, goStage, viewport, setViewport }: {
    project: ProjectState;
    sortedParts: BodyPartLayer[];
    selectedPart?: BodyPartLayer;
    selectedPath?: ProjectMotionPath;
    drawMode: boolean;
    setDrawMode: (v: boolean) => void;
    dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void;
    setPathPoints: (points: Point[], source?: ProjectMotionPath['source']) => void;
    openTracking: () => void;
    isPlaying: boolean;
    setIsPlaying: (v: boolean) => void;
    angle: number;
    setAngle: React.Dispatch<React.SetStateAction<number>>;
    onNext: () => void;
    goStage: (stage: AppStage) => void;
    viewport: CanvasViewport;
    setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const freeDraftRef = useRef<Point[] | null>(null);
    const [dragPoint, setDragPoint] = useState<number | null>(null);
    const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
    const [isFreeDrawing, setIsFreeDrawing] = useState(false);
    const [pathViewMode, setPathViewMode] = useState<'2d' | '3d'>('3d');
    const pathLocked = Boolean(selectedPart?.locked);
    const pointCount = selectedPath?.points.length ?? 0;
    const jointOptions = selectedPart ? motionAnchorJointIds(project, selectedPart.id) : [];
    const selectedIkJointId = selectedPart
        ? preferredMotionJointId(project, selectedPart.id, selectedPath?.targetAnchorJointId, { preferDistalWhenRoot: !selectedPath?.targetAnchorJointId })
        : undefined;
    const chainRootOptions = selectedPart ? motionChainRootJointIds(project, selectedPart.id, selectedIkJointId) : [];
    const selectedChainRootId = selectedPath?.chainRootJointId && chainRootOptions.includes(selectedPath.chainRootJointId)
        ? selectedPath.chainRootJointId
        : selectedPart?.anchorJointId;
    const ikDescriptor = selectedPart ? describeMotionChain(project, selectedPart.id, selectedIkJointId, { rootJointId: selectedChainRootId }) : undefined;
    const bendJoint = ikDescriptor?.foldJointId ? project.skeleton?.joints[ikDescriptor.foldJointId] : undefined;
    const jointLabel = (id?: string) => id ? id.replaceAll('_', ' ') : 'none';
    useEffect(() => {
        freeDraftRef.current = null;
        setIsFreeDrawing(false);
        setDragPoint(null);
        setSelectedPoint(null);
    }, [selectedPart?.id]);
    const appendFreePoint = (point: Point, seed = false) => {
        const base = seed || !freeDraftRef.current ? [...(selectedPath?.points ?? [])] : freeDraftRef.current;
        const last = base.at(-1);
        if (last && Math.hypot(last.x - point.x, last.y - point.y) < 5) return;
        const next = [...base, point].slice(-2000);
        freeDraftRef.current = next;
        setPathPoints(next, 'drawn');
    };
    const onCanvasDown = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!drawMode || !svgRef.current || pathLocked || e.button !== 0) return;
        const p = svgPointerToScene(svgRef.current, e.clientX, e.clientY);
        setSelectedPoint(null);
        setIsFreeDrawing(true);
        appendFreePoint(p, true);
    };
    const updatePath = (updates: Partial<ProjectMotionPath>) => selectedPath && !pathLocked && dispatch({ type: 'upsert_path', path: { ...selectedPath, ...updates } });
    const updateChainRoot = (chainRootJointId: string) => updatePath({ chainRootJointId });
    const updateIkHandle = (targetAnchorJointId: string) => {
        if (!selectedPart) return;
        const roots = motionChainRootJointIds(project, selectedPart.id, targetAnchorJointId);
        updatePath({ targetAnchorJointId, chainRootJointId: selectedPath?.chainRootJointId && roots.includes(selectedPath.chainRootJointId) ? selectedPath.chainRootJointId : selectedPart.anchorJointId });
    };
    const pickIkJoint = (jointId: string) => {
        if (!selectedPath || !selectedPart || pathLocked) return;
        if (selectedIkJointId && jointId !== selectedIkJointId && chainRootOptions.includes(jointId)) updateChainRoot(jointId);
        else updateIkHandle(jointId);
    };
    const setBendDirection = (bendDirection: number) => bendJoint && dispatch({ type: 'update_joint', jointId: bendJoint.id, updates: { bendDirection } });
    const addJointAtIkHandle = () => {
        if (!project.skeleton || !selectedPart || !selectedIkJointId) return;
        const parent = project.skeleton.joints[selectedIkJointId];
        if (!parent) return;
        const id = uid('joint');
        dispatch({ type: 'add_joint', joint: { id, name: 'new IK handle', position: { x: parent.position.x + 34, y: parent.position.y - 34 }, parentId: parent.id, locked: false, bendDirection: 1 } });
        if (selectedPath && !pathLocked) dispatch({ type: 'upsert_path', path: { ...selectedPath, targetAnchorJointId: id } });
    };
    const movePoint = (e: React.MouseEvent<SVGSVGElement>) => {
        if (isFreeDrawing && svgRef.current && !pathLocked) {
            appendFreePoint(svgPointerToScene(svgRef.current, e.clientX, e.clientY));
            return;
        }
        if (dragPoint === null || !svgRef.current || !selectedPath || pathLocked) return;
        const points = [...selectedPath.points];
        points[dragPoint] = svgPointerToScene(svgRef.current, e.clientX, e.clientY);
        setPathPoints(points, selectedPath.source);
    };
    const stopDrawing = () => {
        setDragPoint(null);
        setIsFreeDrawing(false);
        freeDraftRef.current = null;
    };
    const deletePoint = () => {
        if (selectedPoint === null || !selectedPath || pathLocked) return;
        setPathPoints(selectedPath.points.filter((_, i) => i !== selectedPoint), selectedPath.source);
        setSelectedPoint(null);
    };
    const clearPath = () => selectedPath && !pathLocked && dispatch({ type: 'delete_path', pathId: selectedPath.id });
    const switchPathView = (mode: '2d' | '3d') => {
        setPathViewMode(mode);
        if (mode === '3d' && drawMode) {
            stopDrawing();
            setDrawMode(false);
        }
    };
    const togglePathDrawing = () => {
        setPathViewMode('2d');
        if (drawMode) stopDrawing();
        setDrawMode(!drawMode);
    };
    const addLayer = () => {
        const base = selectedPart;
        const id = uid('part');
        const anchorJointId = base?.anchorJointId ?? project.skeleton?.rootJointIds[0] ?? Object.keys(project.skeleton?.joints ?? {})[0] ?? 'root';
        dispatch({
            type: 'upsert_part',
            part: base ? { ...base, id, name: `${base.name} copy`, transform: { ...base.transform, x: base.transform.x + 24, y: base.transform.y - 24 }, zIndex: Math.max(0, ...sortedParts.map(p => p.zIndex)) + 1 } : {
                id,
                name: 'New layer',
                anchorJointId,
                transform: { x: 0, y: 0, rotation: 0, scale: 1 },
                zIndex: sortedParts.length,
                opacity: 0.9,
                visible: true,
                locked: false,
                selectable: true,
                bounds: { x: -40, y: -40, width: 80, height: 80 },
                fillColor: '#64748b'
            }
        });
    };
    const pathMechanism = selectedPath ? project.mechanisms.find(m => m.targetPathId === selectedPath.id && m.targetPartId === selectedPath.partId) : undefined;
    const previewTargetJointId = selectedPath
        ? preferredMotionJointId(project, selectedPath.partId, pathMechanism?.targetAnchorJointId ?? selectedPath.targetAnchorJointId, { preferDistalWhenRoot: !selectedPath.targetAnchorJointId })
        : undefined;
    const previewAngle = isPlaying ? angle : 0;
    const pathPreview = selectedPath?.visible && selectedPath.enabled && selectedPath.points.length > 1
        ? motionPreviewForPath(project, selectedPath, previewAngle, previewTargetJointId)
        : undefined;
    return <EditorStageFrame
        stage="path"
        className="path-stage-frame"
        layout={{
            workflow: workflowPane(<div className="path-panel stage-pane-stack" data-testid="novice-path-panel">
            <StageLeftSummary project={project} title="Path" stage="path" goStage={goStage}>
                <h3>Draw path</h3>
                <select aria-label="Selected body part" className="field mt-2" value={selectedPart?.id ?? ''} onChange={e => dispatch({ type: 'select_part', partId: e.target.value })}>
                    {sortedParts.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
                </select>
                <div className="mt-3 flex flex-col gap-2">
                    <button className={drawMode ? 'btn-primary active' : 'btn-secondary'} aria-label={drawMode ? 'Drawing free path' : 'Draw free path'} disabled={pathLocked} onClick={togglePathDrawing}><Route size={16}/>{drawMode ? 'Drawing' : 'Draw'}</button>
                    <button className="btn-secondary" disabled={!selectedPath || pathLocked} onClick={clearPath}><Trash2 size={16}/> Clear path</button>
                    <button className="btn-secondary" disabled={pointCount < 3 || pathLocked} onClick={onNext}>Foundry</button>
                </div>
                <div className="free-draw-status" data-testid="free-draw-status">{selectedPath ? `${pointCount} points · ${selectedPath.id}` : '0 points · none'}{pathLocked ? ' · locked part' : ''}</div>
                {selectedPath && <div className="mt-3 space-y-3" data-testid="path-shape-controls">
                    <div className="flex gap-2">
                        <button className={`btn-secondary ${!selectedPath.closed ? 'active' : ''}`} disabled={pathLocked} onClick={() => updatePath({ closed: false })}>Open</button>
                        <button className={`btn-secondary ${selectedPath.closed ? 'active' : ''}`} disabled={pathLocked} onClick={() => updatePath({ closed: true })}>Closed</button>
                    </div>
                    <MiniNumber label="Smoothness" value={selectedPath.smoothness ?? 0} min={0} max={100} step={1} disabled={pathLocked} onChange={smoothness => updatePath({ smoothness })}/>
                </div>}
                {!selectedPath && <div className="warning">Draw or track a path.</div>}
                {selectedPath && selectedPath.points.length < 3 && <div className="warning">Need 3+ points.</div>}
                {pathLocked && <div className="warning">Unlock the selected part before editing, deleting, drawing, or tracking its path.</div>}
                {selectedPath?.warnings.map((w, i) => <div key={`${w}-${i}`} className="warning">{w}</div>)}
                <details className="advanced-panel mt-4">
                    <summary>More</summary>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button className="btn-secondary" disabled={pathLocked} onClick={openTracking}><Route size={16}/> Trace media path</button>
                        <button className="btn-secondary" aria-label={isPlaying ? 'Play / Stop' : 'Play'} onClick={() => setIsPlaying(!isPlaying)}><Play size={16}/>{isPlaying ? 'Stop' : 'Play'}</button>
                        <button className="btn-secondary" onClick={() => setAngle(0)}>Reset</button>
                        {selectedPath && <button className="btn-secondary" disabled={pathLocked} onClick={() => updatePath({ visible: !selectedPath.visible })}>{selectedPath.visible ? 'Hide path' : 'Show path'}</button>}
                        {selectedPath && <button className="btn-secondary" disabled={pathLocked} onClick={() => updatePath({ enabled: !selectedPath.enabled })}>{selectedPath.enabled ? 'Disable' : 'Enable'}</button>}
                        {selectedPoint !== null && <button className="btn-secondary" disabled={pathLocked} onClick={deletePoint}>Delete point</button>}
                    </div>
                    <div className="mt-3 text-sm text-slate-600">{selectedPath ? `${selectedPath.source} · ${selectedPath.duration} ms · ${selectedPath.timedPoints?.length ?? 0} timed samples` : 'No timing yet'}</div>
                </details>
                {project.settings.partPanelVisible ? <details className="advanced-panel mt-4" data-testid="rig-structure-drawer">
                    <summary>Rig setup</summary>
                    <div className="mt-3 space-y-3">
                        <div>
                            <h4 className="section-title">Rig</h4>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button className="btn-secondary" onClick={addLayer}><Plus size={16}/> Add layer</button>
                            {selectedPart && <button className="btn-secondary" disabled={selectedPart.locked} onClick={() => dispatch({ type: 'delete_part', partId: selectedPart.id })}><Trash2 size={16}/> Remove layer</button>}
                            <button className="btn-secondary" disabled={!selectedPart || pathLocked} onClick={addJointAtIkHandle}><Plus size={16}/> New IK handle</button>
                        </div>
                        {selectedPart && <PartInspector part={selectedPart} dispatch={dispatch} />}
                        <div className="divider mt-4" />
                        <SkeletonInspector project={project} dispatch={dispatch} />
                    </div>
                </details> : <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-500" data-testid="rig-structure-hidden">Part properties are hidden from Options. Free drawing stays available.</div>}
            </StageLeftSummary>
        </div>),
            canvas: canvasPane(<div className="path-canvas-shell canvas-workspace overflow-hidden p-0">
            <CanvasZoomToolbar viewport={viewport} setViewport={setViewport} />
            <div className="path-view-switch" data-testid="path-view-switch" aria-label="Path view mode" onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
                <button type="button" data-testid="path-view-2d" className={pathViewMode === '2d' ? 'active' : ''} aria-pressed={pathViewMode === '2d'} onClick={() => switchPathView('2d')}>2D</button>
                <button type="button" data-testid="path-view-3d" className={pathViewMode === '3d' ? 'active' : ''} aria-pressed={pathViewMode === '3d'} onClick={() => switchPathView('3d')}>3D</button>
            </div>
            {pathViewMode === '2d' ? <SceneSketch svgRef={svgRef} project={project} selectedPath={selectedPath} dragPoint={dragPoint} selectedPoint={selectedPoint} setDragPoint={setDragPoint} setSelectedPoint={setSelectedPoint} onPointMove={movePoint} onPointUp={stopDrawing} onCanvasDown={onCanvasDown} onJointPick={pickIkJoint} dispatch={dispatch} drawMode={drawMode} pathLocked={pathLocked} isPlaying={isPlaying} angle={angle} viewport={viewport} setViewport={setViewport}/> : <ThreePuppetPreview project={project} animatedParts={pathPreview?.parts ?? {}} skeleton={pathPreview?.skeleton ?? project.skeleton} angle={angle} viewport={viewport} setViewport={setViewport} inputMode="always" testId="path-three-puppet" cameraPresets={['iso']} />}
        </div>),
            inspector: inspectorPane(<div className="path-inspector stage-pane-stack">
            <div>
                <div className="section-title">Selected inspector</div>
                <h3>{selectedPart?.name ?? 'No body part selected'}</h3>
            </div>
            {selectedPath && <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
                <div className="font-bold text-slate-800">Path detail</div>
                <div>{selectedPath.id} · {pointCount} points · {selectedPath.closed ? 'closed' : 'open'}</div>
                <div>{selectedPoint !== null && selectedPath.points[selectedPoint] ? `Point ${selectedPoint + 1}: ${selectedPath.points[selectedPoint].x.toFixed(0)}, ${selectedPath.points[selectedPoint].y.toFixed(0)}` : 'Select a point on the canvas for point-level edits.'}</div>
            </div>}
            <div className="rig-helper" data-testid="quick-rig-helper">
                <h4 className="section-title">Bones</h4>
                <h3>Move joint</h3>
                {selectedPart && <label className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${pathLocked || !selectedPath ? 'opacity-50' : ''}`}>Start<select aria-label="IK chain root" className="field mt-1" disabled={pathLocked || !selectedPath} value={selectedChainRootId ?? ''} onChange={e => updateChainRoot(e.target.value)}>
                    {chainRootOptions.map(id => <option key={id} value={id}>{jointLabel(id)}</option>)}
                </select></label>}
                {selectedPart && selectedPath && <div className="flex flex-wrap gap-2" data-testid="ik-chain-root-options">
                    {chainRootOptions.map(id => <button type="button" key={id} className={`btn-secondary ${id === selectedChainRootId ? 'active' : ''}`} disabled={pathLocked} onClick={() => updateChainRoot(id)}>{jointLabel(id)}</button>)}
                </div>}
                {selectedPart && <label className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${pathLocked || !selectedPath ? 'opacity-50' : ''}`}>Handle<select aria-label="IK handle" className="field mt-1" disabled={pathLocked || !selectedPath} value={selectedIkJointId ?? ''} onChange={e => updateIkHandle(e.target.value)}>
                    {jointOptions.map(id => <option key={id} value={id}>{motionChainOptionLabel(project, selectedPart.id, id)}</option>)}
                </select></label>}
                {selectedPart && <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-slate-600" data-testid="ik-chain-summary" title={ikDescriptor?.helper ?? 'Pick handle.'}>
                    <div className="font-bold text-slate-800">{ikDescriptor?.label ?? 'No limb'}</div>
                </div>}
                <div className="fold-picker" data-testid="fold-direction-control">
                    <div>
                        <div className="text-xs font-black uppercase tracking-wider text-slate-500">Bend</div>
                        <div className="text-sm text-slate-600">{bendJoint ? `${jointLabel(bendJoint.id)} → ${bendJoint.bendDirection < 0 ? 'left' : 'right'}` : ikDescriptor?.kind === 'two-joint-direct' ? 'No bend' : 'Pick elbow/knee'}</div>
                    </div>
                    <div className="flex gap-2">
                        <button aria-label="Fold left" className={`btn-secondary ${bendJoint && bendJoint.bendDirection < 0 ? 'active' : ''}`} disabled={!bendJoint || bendJoint.locked} onClick={() => setBendDirection(-1)}>Left</button>
                        <button aria-label="Fold right" className={`btn-secondary ${bendJoint && bendJoint.bendDirection >= 0 ? 'active' : ''}`} disabled={!bendJoint || bendJoint.locked} onClick={() => setBendDirection(1)}>Right</button>
                    </div>
                </div>
            </div>
        </div>)
        }}
    />;
};

const SceneSketch = ({ project, svgRef, selectedPath, dragPoint, selectedPoint, setDragPoint, setSelectedPoint, onPointMove, onPointUp, onCanvasDown, onJointPick, dispatch, drawMode, pathLocked, isPlaying, angle, viewport, setViewport }: { project: ProjectState; svgRef: React.RefObject<SVGSVGElement | null>; selectedPath?: ProjectMotionPath; dragPoint: number | null; selectedPoint: number | null; setDragPoint: (i: number | null) => void; setSelectedPoint: (i: number | null) => void; onPointMove: (e: React.MouseEvent<SVGSVGElement>) => void; onPointUp: () => void; onCanvasDown: (e: React.MouseEvent<SVGSVGElement>) => void; onJointPick: (jointId: string) => void; dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void; drawMode?: boolean; pathLocked?: boolean; isPlaying: boolean; angle: number; viewport: CanvasViewport; setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>> }) => {
    const kit = project.settings.physicalKit;
    const sheet = sceneBoundsForSheet(kit);
    const pathMechanism = selectedPath ? project.mechanisms.find(m => m.targetPathId === selectedPath.id && m.targetPartId === selectedPath.partId) : undefined;
    const requestedTargetJointId = pathMechanism?.targetAnchorJointId ?? selectedPath?.targetAnchorJointId;
    const targetJointId = selectedPath ? preferredMotionJointId(project, selectedPath.partId, requestedTargetJointId, { preferDistalWhenRoot: !requestedTargetJointId }) : undefined;
    const previewAngle = isPlaying ? angle : 0;
    const pathPreview = selectedPath?.visible && selectedPath.enabled && selectedPath.points.length > 1
        ? motionPreviewForPath(project, selectedPath, previewAngle, targetJointId)
        : undefined;
    const previewSkeleton = pathPreview?.skeleton ?? project.skeleton;
    const previewParts = pathPreview?.parts ?? {};
    const sheetSvg = { x: SCENE_VIEW.width / 2 + sheet.x, y: SCENE_VIEW.height / 2 - sheet.y - sheet.height, width: sheet.width, height: sheet.height };
    const gridLines = boardGridLines(kit).map(line => {
        const a = sceneToSvg(line.a);
        const b = sceneToSvg(line.b);
        return <line key={line.key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e5e8f0" strokeWidth="1"/>;
    });
    const viewWidth = SCENE_VIEW.width / viewport.zoom;
    const viewHeight = SCENE_VIEW.height / viewport.zoom;
    const viewX = (SCENE_VIEW.width - viewWidth) / 2 - viewport.offset.x / viewport.zoom;
    const viewY = (SCENE_VIEW.height - viewHeight) / 2 - viewport.offset.y / viewport.zoom;
    const [panStart, setPanStart] = useState<{ x: number; y: number; offset: Point } | null>(null);
    const scalePan = (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = svgRef.current?.getBoundingClientRect();
        return rect ? { x: (e.clientX - (panStart?.x ?? e.clientX)) * SCENE_VIEW.width / rect.width, y: (e.clientY - (panStart?.y ?? e.clientY)) * SCENE_VIEW.height / rect.height } : { x: 0, y: 0 };
    };
    const handlePanOrDrawDown = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!drawMode && e.button === 0 && !(e.target instanceof Element && e.target.closest('[data-canvas-interactive="true"]'))) {
            setPanStart({ x: e.clientX, y: e.clientY, offset: viewport.offset });
            e.preventDefault();
            return;
        }
        onCanvasDown(e);
    };
    const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (panStart) {
            const delta = scalePan(e);
            setViewport(prev => ({ ...prev, offset: { x: panStart.offset.x + delta.x, y: panStart.offset.y + delta.y } }));
            return;
        }
        onPointMove(e);
    };
    const finishInteraction = () => {
        setPanStart(null);
        onPointUp();
    };
    const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        e.stopPropagation();
        const nextZoom = clampCanvasZoom(viewport.zoom * (1 - e.deltaY * 0.001));
        const fx = (e.clientX - rect.left) / rect.width;
        const fy = (e.clientY - rect.top) / rect.height;
        const worldX = viewX + fx * viewWidth;
        const worldY = viewY + fy * viewHeight;
        const nextViewWidth = SCENE_VIEW.width / nextZoom;
        const nextViewHeight = SCENE_VIEW.height / nextZoom;
        const nextViewX = worldX - fx * nextViewWidth;
        const nextViewY = worldY - fy * nextViewHeight;
        setViewport({
            zoom: nextZoom,
            offset: {
                x: ((SCENE_VIEW.width - nextViewWidth) / 2 - nextViewX) * nextZoom,
                y: ((SCENE_VIEW.height - nextViewHeight) / 2 - nextViewY) * nextZoom
            }
        });
    };
    return <svg ref={svgRef} aria-label="Path editor canvas" data-testid="path-canvas" viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} className={`h-[calc(100vh-160px)] min-h-[560px] w-full bg-[#f8fbff] ${drawMode ? 'cursor-crosshair' : panStart ? 'cursor-grabbing' : 'cursor-grab'}`} onMouseDown={handlePanOrDrawDown} onMouseMove={handleMove} onMouseUp={finishInteraction} onMouseLeave={finishInteraction} onWheel={handleWheel}>
        <defs><filter id="soft"><feDropShadow dx="0" dy="10" stdDeviation="10" floodOpacity="0.13"/></filter></defs>
        <rect x={sheetSvg.x} y={sheetSvg.y} width={sheetSvg.width} height={sheetSvg.height} rx="18" fill="white" stroke="#d6dbe8" strokeWidth="1.5"/>
        {gridLines}
        <text x={sheetSvg.x + 16} y={sheetSvg.y + 28} className="fill-slate-400 text-[12px] font-bold" data-testid="scene-grid-label">{formatGridLabel(kit, project.settings.gridUnit)}</text>
        {project.settings.debugVisuals && <g data-testid="canvas-debug-visuals" pointerEvents="none">
            <rect x={sheetSvg.x + sheetSvg.width - 178} y={sheetSvg.y + 14} width="160" height="72" rx="12" fill="#0f172a" opacity="0.78"/>
            <text x={sheetSvg.x + sheetSvg.width - 164} y={sheetSvg.y + 38} fill="white" fontSize="12" fontWeight="800">Debug visuals</text>
            <text x={sheetSvg.x + sheetSvg.width - 164} y={sheetSvg.y + 57} fill="#cbd5e1" fontSize="11">{project.partOrder.length} parts · {Object.keys(project.skeleton?.joints ?? {}).length} joints</text>
            <text x={sheetSvg.x + sheetSvg.width - 164} y={sheetSvg.y + 75} fill="#cbd5e1" fontSize="11">snap {project.settings.physicsSnapMode} · fab {project.settings.fabricationReadyMode ? 'on' : 'off'}</text>
        </g>}
        {previewSkeleton?.bones.map(([a, b]) => {
            const ja = previewSkeleton?.joints[a]; const jb = previewSkeleton?.joints[b];
            if (!ja || !jb) return null;
            const pa = sceneToSvg(ja.position); const pb = sceneToSvg(jb.position);
            return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#434a59" strokeWidth="2" opacity="0.12"/>;
        })}
        {project.partOrder.map(id => previewParts[id] ?? project.parts[id]).filter(Boolean).map(part => <React.Fragment key={part.id}><PartShape part={part} skeleton={previewSkeleton} selected={project.selectedPartId === part.id} drawMode={drawMode} onSelect={() => dispatch({ type: 'select_part', partId: part.id })}/></React.Fragment>) }
        {previewSkeleton && Object.values(previewSkeleton.joints).map(j => {
            const p = sceneToSvg(j.position);
            const pickable = Boolean(selectedPath && !pathLocked && !drawMode);
            return <g key={j.id} data-canvas-interactive={pickable ? 'true' : undefined} className={pickable ? 'cursor-pointer' : undefined} onClick={e => {
                if (!pickable) return;
                e.stopPropagation();
                onJointPick(j.id);
            }}>
                <circle data-testid={`skeleton-joint-${j.id}`} cx={p.x} cy={p.y} r={j.locked ? 6 : 4.5} fill={j.locked ? '#64748b' : '#94a3b8'} stroke="white" strokeWidth="2" opacity={pickable ? 0.85 : 0.3}/>
                <title>{j.id} bend {j.bendDirection}</title>
            </g>;
        })}
        {Object.values(project.paths).filter(p => p.visible).map(path => <path key={path.id} d={pathFromPoints(path.points, path.closed, path.smoothness)} fill="none" stroke={path.enabled ? '#5a6cff' : '#94a3b8'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/>)}
        {selectedPath?.visible && selectedPath.points.map((pt, i) => {
            const p = sceneToSvg(pt);
            const active = dragPoint === i || selectedPoint === i;
            return <circle data-canvas-interactive="true" key={`${selectedPath.id}-${i}`} cx={p.x} cy={p.y} r={active ? 8 : 6} fill={active ? '#5a6cff' : '#fff'} stroke="#5a6cff" strokeWidth="3" className={pathLocked ? 'cursor-not-allowed' : 'cursor-grab'} onClick={e => e.stopPropagation()} onMouseDown={e => { e.stopPropagation(); if (!pathLocked) { setSelectedPoint(i); setDragPoint(i); } }} />;
        })}
        {pathPreview?.target && (() => {
            const target = pathPreview.target;
            const p = sceneToSvg(target);
            return <g pointerEvents="none">
                <circle cx={p.x} cy={p.y} r="10" fill="#5a6cff" stroke="white" strokeWidth="3"/><text x={p.x + 14} y={p.y - 10} className="body-preview-label text-[12px] font-black">IK target</text>
            </g>;
        })()}
    </svg>;
};

const PartShape = ({ part, skeleton, selected, drawMode, onSelect }: { part: BodyPartLayer; skeleton?: ProjectState['skeleton']; selected: boolean; drawMode?: boolean; onSelect: () => void }) => {
    if (!part.visible) return null;
    const p = sceneToSvg(part.transform);
    const w = part.bounds.width * part.transform.scale;
    const h = part.bounds.height * part.transform.scale;
    const artX = part.bounds.x * part.transform.scale;
    const artY = -(part.bounds.y + part.bounds.height) * part.transform.scale;
    const landmarks = partLandmarkLocalPoints(part, skeleton);
    const outline = fabricablePartOutlinePoints(part, landmarks);
    const outlineD = partOutlinePathD(part, landmarks, { scale: part.transform.scale, flipY: true });
    const localHoles = landmarks.filter(local => pointInsideOutline(local, outline, 0.5));
    const holeRadius = Math.max(5, 7.2 * part.transform.scale);
    const maskId = `path-part-surface-mask-${part.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const stroke = selected ? '#5a6cff' : '#94a3b8';
    return <g data-canvas-interactive="true" data-testid={`path-part-${part.id}`} data-assembly-underlay="plate-art-layer" transform={`translate(${p.x} ${p.y}) rotate(${-part.transform.rotation})`} onClick={e => { if (!drawMode) { e.stopPropagation(); onSelect(); } }} className={`${drawMode ? 'cursor-crosshair' : 'cursor-pointer'} transition-opacity`} opacity={part.opacity} filter="url(#soft)">
        <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse">
                <rect x="-1000" y="-1000" width="2000" height="2000" fill="black" />
                <path d={outlineD} fill="white" />
                {localHoles.map((local, index) => <circle key={index} cx={local.x * part.transform.scale} cy={-local.y * part.transform.scale} r={holeRadius} fill="black" />)}
            </mask>
        </defs>
        <rect x={artX} y={artY} width={w} height={h} fill="#eef2f7" opacity=".72" mask={`url(#${maskId})`} />
        {part.textureUrl ? <image data-testid={`path-part-art-${part.id}`} href={part.textureUrl} x={artX} y={artY} width={w} height={h} preserveAspectRatio="xMidYMid meet" opacity=".52" mask={`url(#${maskId})`} style={{ filter: 'saturate(0.82) contrast(0.96)' }}/> : <rect data-testid={`path-part-art-${part.id}`} x={artX} y={artY} width={w} height={h} rx="22" fill={part.fillColor} opacity=".52" mask={`url(#${maskId})`}/>}
        <path data-testid={`path-part-plate-${part.id}`} data-art-offset-x={artX} d={outlineD} fill="none" stroke={stroke} strokeWidth={selected ? 3 : 1.2} strokeDasharray={selected ? '0' : '5 5'} opacity={selected ? 0.72 : 0.28}/>
        {part.localPivotOffset && <circle cx={part.localPivotOffset.x * part.transform.scale} cy={-part.localPivotOffset.y * part.transform.scale} r={5} fill="#64748b" stroke="white" strokeWidth="2"><title>local pivot</title></circle>}
    </g>;
};

const contourCentroid = (points: Point[]): Point => {
    if (!points.length) return { x: 0, y: 0 };
    return points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
};

const scaleContour = (points: Point[], factor: number): Point[] => {
    const center = contourCentroid(points);
    return points.map(point => ({ x: center.x + (point.x - center.x) * factor, y: center.y + (point.y - center.y) * factor }));
};

const contourPathD = (points: Point[]) => points.length ? `M ${points.map(point => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')} Z` : '';

const CutOutlineEditorDialog = ({ part, points, autoPoints, selectedIndex, selectedPoint, setSelectedIndex, updatePoint, updatePointAt, addPoint, removePoint, onUseAuto, onExpand, onShrink, onClose }: {
    part: BodyPartLayer;
    points: Point[];
    autoPoints: Point[];
    selectedIndex: number;
    selectedPoint: Point;
    setSelectedIndex: (index: number) => void;
    updatePoint: (updates: Partial<Point>) => void;
    updatePointAt: (index: number, updates: Partial<Point>) => void;
    addPoint: () => void;
    removePoint: () => void;
    onUseAuto: () => void;
    onExpand: () => void;
    onShrink: () => void;
    onClose: () => void;
}) => {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const dragIndexRef = useRef<number | null>(null);
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
    const viewport = useMemo(() => {
        const merged = [...autoPoints, ...points].filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
        if (!merged.length) return { minX: -80, minY: -80, width: 160, height: 160 };
        const bounds = partOutlineBounds(merged);
        const pad = Math.max(24, Math.min(64, Math.max(bounds.width, bounds.height) * 0.12));
        return {
            minX: bounds.minX - pad,
            minY: bounds.minY - pad,
            width: Math.max(90, bounds.width + pad * 2),
            height: Math.max(90, bounds.height + pad * 2)
        };
    }, [autoPoints, points]);
    const cutMinX = Math.floor(part.bounds.x - 120);
    const cutMaxX = Math.ceil(part.bounds.x + part.bounds.width + 120);
    const cutMinY = Math.floor(part.bounds.y - 120);
    const cutMaxY = Math.ceil(part.bounds.y + part.bounds.height + 120);
    const pointFromPointer = (event: React.PointerEvent<SVGSVGElement>): Point | undefined => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
        return {
            x: Number((viewport.minX + ((event.clientX - rect.left) / rect.width) * viewport.width).toFixed(1)),
            y: Number((viewport.minY + ((event.clientY - rect.top) / rect.height) * viewport.height).toFixed(1))
        };
    };
    const movePointFromPointer = (event: React.PointerEvent<SVGSVGElement>, index = selectedIndex) => {
        if (part.locked || !points.length) return;
        const point = pointFromPointer(event);
        if (!point) return;
        updatePointAt(index, point);
    };
    const stopDrag = (event?: React.PointerEvent<SVGSVGElement>) => {
        if (event && svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
        dragIndexRef.current = null;
        setDraggingIndex(null);
    };
    return <div className="modal-backdrop cut-outline-backdrop" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
        <section className="modal-sheet cut-outline-dialog" role="dialog" aria-modal="true" aria-labelledby="cut-outline-title" data-testid="cut-outline-dialog">
            <div className="cut-outline-head">
                <div>
                    <div className="section-title">Cut outline canvas</div>
                    <h3 id="cut-outline-title">Edit {part.name}</h3>
                    <p>Drag a point, or click the canvas to move the selected point. This exact contour drives 2D preview, 3D plates, and exported cut sheets.</p>
                </div>
                <button type="button" className="btn-secondary" data-testid="cut-outline-close" onClick={onClose}>Done</button>
            </div>
            <svg
                ref={svgRef}
                className="cut-outline-canvas"
                data-testid="cut-outline-canvas"
                viewBox={`${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`}
                role="img"
                aria-label="Cut outline editing canvas"
                onPointerDown={event => {
                    const target = event.target as Element;
                    if (target.closest('[data-cut-point]')) return;
                    movePointFromPointer(event);
                }}
                onPointerMove={event => {
                    const index = dragIndexRef.current;
                    if (index === null) return;
                    movePointFromPointer(event, index);
                }}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
                onPointerLeave={stopDrag}
            >
                <defs>
                    <pattern id={`cut-grid-${part.id}`} width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#d8dfec" strokeWidth="0.7" opacity="0.9"/>
                    </pattern>
                </defs>
                <rect x={viewport.minX} y={viewport.minY} width={viewport.width} height={viewport.height} fill={`url(#cut-grid-${part.id})`}/>
                {autoPoints.length >= 3 && <path className="cut-outline-auto" d={contourPathD(autoPoints)}/>}
                {points.length >= 3 && <path className="cut-outline-user" d={contourPathD(points)}/>}
                {points.map((point, index) => <circle
                    key={`${index}-${point.x}-${point.y}`}
                    data-cut-point="true"
                    data-testid={`cut-outline-point-${index}`}
                    className={`cut-outline-point ${index === selectedIndex ? 'active' : ''} ${draggingIndex === index ? 'dragging' : ''}`}
                    cx={point.x}
                    cy={point.y}
                    r={index === selectedIndex ? 5.8 : 4.8}
                    onPointerDown={event => {
                        event.stopPropagation();
                        setSelectedIndex(index);
                        dragIndexRef.current = index;
                        setDraggingIndex(index);
                        svgRef.current?.setPointerCapture(event.pointerId);
                    }}
                />)}
            </svg>
            <div className="cut-outline-tools">
                <div className="cut-outline-actions">
                    <button type="button" data-testid="part-cut-auto" className="btn-secondary" disabled={part.locked} onClick={onUseAuto}>Use joint-chain cut</button>
                    <button type="button" data-testid="part-cut-expand" className="btn-secondary" disabled={part.locked} onClick={onExpand}>Expand</button>
                    <button type="button" data-testid="part-cut-shrink" className="btn-secondary" disabled={part.locked} onClick={onShrink}>Shrink</button>
                </div>
                <label className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${part.locked ? 'opacity-50' : ''}`}>Cut point<select data-testid="part-cut-point-select" className="field mt-1" disabled={part.locked || !points.length} value={selectedIndex} onChange={event => setSelectedIndex(Number(event.currentTarget.value))}>
                    {points.map((point, index) => <option key={index} value={index}>{index + 1}: {point.x.toFixed(0)}, {point.y.toFixed(0)}</option>)}
                </select></label>
                <div className="grid grid-cols-2 gap-3">
                    <MiniNumber label="Cut point X" value={selectedPoint.x} min={cutMinX} max={cutMaxX} step={0.5} disabled={part.locked || !points.length} onChange={x => updatePoint({ x })}/>
                    <MiniNumber label="Cut point Y" value={selectedPoint.y} min={cutMinY} max={cutMaxY} step={0.5} disabled={part.locked || !points.length} onChange={y => updatePoint({ y })}/>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" data-testid="part-cut-add-point" className="btn-secondary" disabled={part.locked || points.length < 2} onClick={addPoint}>Add midpoint</button>
                    <button type="button" data-testid="part-cut-remove-point" className="btn-secondary" disabled={part.locked || points.length <= 3} onClick={removePoint}>Remove point</button>
                </div>
            </div>
        </section>
    </div>;
};

const PartInspector = ({ part, skeleton, dispatch, compact = false }: { part: BodyPartLayer; skeleton?: ProjectState['skeleton']; dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void; compact?: boolean }) => {
    const updateTransform = (updates: Partial<BodyPartLayer['transform']>) => dispatch({ type: 'update_part', partId: part.id, updates: { transform: { ...part.transform, ...updates } } });
    const updateBounds = (updates: Partial<BodyPartLayer['bounds']>) => dispatch({ type: 'update_part', partId: part.id, updates: { bounds: { ...part.bounds, ...updates } } });
    const landmarks = useMemo(() => partLandmarkLocalPoints(part, skeleton), [part, skeleton]);
    const autoCutPoints = useMemo(() => fabricablePartOutlinePoints({ ...part, contourPoints: undefined, contourSource: undefined }, landmarks), [part, landmarks]);
    const activeContourPoints = part.contourPoints?.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) ?? [];
    const editableCutPoints = isUsableContourPoints(activeContourPoints) ? activeContourPoints : fabricablePartOutlinePoints(part, landmarks);
    const [selectedCutPointIndex, setSelectedCutPointIndex] = useState(0);
    const selectedIndex = editableCutPoints.length ? Math.min(selectedCutPointIndex, editableCutPoints.length - 1) : 0;
    const selectedCutPoint = editableCutPoints[selectedIndex] ?? { x: 0, y: 0 };
    const [cutEditorOpen, setCutEditorOpen] = useState(false);
    useEffect(() => {
        if (selectedCutPointIndex >= editableCutPoints.length) setSelectedCutPointIndex(Math.max(0, editableCutPoints.length - 1));
    }, [editableCutPoints.length, selectedCutPointIndex]);
    const commitCut = (points: Point[]) => dispatch({ type: 'update_part', partId: part.id, updates: { contourPoints: points, contourSource: 'user' } });
    const updateCutPointAt = (targetIndex: number, updates: Partial<Point>) => commitCut(editableCutPoints.map((point, index) => index === targetIndex ? { ...point, ...updates } : point));
    const updateCutPoint = (updates: Partial<Point>) => updateCutPointAt(selectedIndex, updates);
    const openCutEditor = () => {
        commitCut(editableCutPoints);
        setCutEditorOpen(true);
    };
    const addCutPoint = () => {
        if (editableCutPoints.length < 2) return;
        const nextIndex = (selectedIndex + 1) % editableCutPoints.length;
        const a = editableCutPoints[selectedIndex];
        const b = editableCutPoints[nextIndex];
        const point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        commitCut([...editableCutPoints.slice(0, selectedIndex + 1), point, ...editableCutPoints.slice(selectedIndex + 1)]);
        setSelectedCutPointIndex(selectedIndex + 1);
    };
    const removeCutPoint = () => {
        if (editableCutPoints.length <= 3) return;
        commitCut(editableCutPoints.filter((_, index) => index !== selectedIndex));
        setSelectedCutPointIndex(Math.max(0, selectedIndex - 1));
    };
    const cutSource = part.contourSource === 'user' ? 'user cut' : part.contourSource === 'onnx-mask' ? 'ONNX cut' : part.contourSource === 'imported' ? 'imported cut' : 'auto joint cut';
    return <div className={`${compact ? 'mt-3' : 'mt-4'} space-y-3`}>
        <Toggle label="Visible" checked={part.visible} disabled={part.locked} onChange={visible => dispatch({ type: 'update_part', partId: part.id, updates: { visible } })}/>
        <Toggle label="Locked" checked={part.locked} onChange={locked => dispatch({ type: 'update_part', partId: part.id, updates: { locked } })}/>
        <div className="part-art-controls" data-testid="part-cut-controls">
            <div className="section-title">Cut outline</div>
            <div className="mt-2 text-xs font-black uppercase tracking-wider text-slate-500" data-testid="part-cut-summary">{cutSource} · {editableCutPoints.length} pts · selected {selectedIndex + 1}</div>
            <button type="button" data-testid="part-cut-bake" className="btn-secondary mt-3" disabled={part.locked} onClick={openCutEditor}>Edit current cut</button>
        </div>
        {cutEditorOpen && <CutOutlineEditorDialog
            part={part}
            points={editableCutPoints}
            autoPoints={autoCutPoints}
            selectedIndex={selectedIndex}
            selectedPoint={selectedCutPoint}
            setSelectedIndex={setSelectedCutPointIndex}
            updatePoint={updateCutPoint}
            updatePointAt={updateCutPointAt}
            addPoint={addCutPoint}
            removePoint={removeCutPoint}
            onUseAuto={() => commitCut(autoCutPoints)}
            onExpand={() => commitCut(scaleContour(editableCutPoints, 1.06))}
            onShrink={() => commitCut(scaleContour(editableCutPoints, 0.94))}
            onClose={() => setCutEditorOpen(false)}
        />}
        <div className="part-art-controls" data-testid="part-art-controls">
            <div className="section-title">Artwork surface</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
                <MiniNumber label="Art opacity" value={part.opacity} min={0.15} max={1} step={0.05} disabled={part.locked} onChange={opacity => dispatch({ type: 'update_part', partId: part.id, updates: { opacity } })}/>
                <MiniNumber label="Scale" value={part.transform.scale} min={0.2} max={2.5} step={0.05} disabled={part.locked} onChange={scale => updateTransform({ scale })}/>
                <MiniNumber label="Art width" value={part.bounds.width} min={8} max={520} disabled={part.locked} onChange={width => updateBounds({ width })}/>
                <MiniNumber label="Art height" value={part.bounds.height} min={8} max={520} disabled={part.locked} onChange={height => updateBounds({ height })}/>
                <MiniNumber label="Art offset X" value={part.bounds.x} min={-260} max={260} disabled={part.locked} onChange={x => updateBounds({ x })}/>
                <MiniNumber label="Art offset Y" value={part.bounds.y} min={-260} max={260} disabled={part.locked} onChange={y => updateBounds({ y })}/>
            </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
            <MiniNumber label="X" value={part.transform.x} min={-320} max={320} disabled={part.locked} onChange={x => updateTransform({ x })}/>
            <MiniNumber label="Y" value={part.transform.y} min={-320} max={320} disabled={part.locked} onChange={y => updateTransform({ y })}/>
            <MiniNumber label="Rotation" value={part.transform.rotation} min={-180} max={180} disabled={part.locked} onChange={rotation => updateTransform({ rotation })}/>
        </div>
        <div className="flex gap-2"><button className="btn-secondary" disabled={part.locked} onClick={() => dispatch({ type: 'reorder_part', partId: part.id, direction: -1 })}>Back</button><button className="btn-secondary" disabled={part.locked} onClick={() => dispatch({ type: 'reorder_part', partId: part.id, direction: 1 })}>Front</button></div>
    </div>;
};

const SkeletonInspector = ({ project, dispatch }: { project: ProjectState; dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void }) => {
    const joints = Object.values(project.skeleton?.joints ?? {});
    const selected = project.selectedPartId ? project.parts[project.selectedPartId] : undefined;
    const [selectedJointId, setSelectedJointId] = useState(selected?.anchorJointId ?? joints[0]?.id ?? '');
    useEffect(() => {
        if (!project.skeleton?.joints[selectedJointId]) setSelectedJointId(selected?.anchorJointId ?? joints[0]?.id ?? '');
    }, [joints, project.skeleton, selected?.anchorJointId, selectedJointId]);
    const anchorJoint = selected ? project.skeleton?.joints[selected.anchorJointId] : undefined;
    const joint = project.skeleton?.joints[selectedJointId] ?? anchorJoint ?? joints[0];
    return <div>
        <h4 className="section-title">Skeleton joints</h4>
        {joint && <div className="mt-3 space-y-3">
            {selected && <label className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${selected.locked ? 'opacity-50' : ''}`}>Selected part anchor<select className="field mt-1" disabled={selected.locked} value={selected.anchorJointId} onChange={e => {
                const anchor = project.skeleton?.joints[e.target.value]?.position;
                dispatch({ type: 'update_part', partId: selected.id, updates: { anchorJointId: e.target.value, localPivotOffset: anchor ? localPivotOffsetForScene(selected, anchor) : selected.localPivotOffset, localPivotJointId: e.target.value } });
            }}>
                {joints.map(j => <option key={j.id} value={j.id}>{j.id}</option>)}
            </select></label>}
            <label className="block text-xs font-black uppercase tracking-wider text-slate-500">Edit joint<select className="field mt-1" value={joint.id} onChange={e => setSelectedJointId(e.target.value)}>
                {joints.map(j => <option key={j.id} value={j.id}>{j.id}</option>)}
            </select></label>
            <label className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${joint.locked ? 'opacity-50' : ''}`}>Parent joint<select className="field mt-1" disabled={joint.locked} value={joint.parentId ?? ''} onChange={e => dispatch({ type: 'update_joint', jointId: joint.id, updates: { parentId: e.target.value || null } })}>
                <option value="">Root</option>
                {joints.filter(j => j.id !== joint.id).map(j => <option key={j.id} value={j.id}>{j.id}</option>)}
            </select></label>
            <MiniNumber label="Joint X" value={joint.position.x} min={-320} max={320} disabled={joint.locked} onChange={x => dispatch({ type: 'update_joint', jointId: joint.id, updates: { position: { ...joint.position, x } } })}/>
            <MiniNumber label="Joint Y" value={joint.position.y} min={-320} max={320} disabled={joint.locked} onChange={y => dispatch({ type: 'update_joint', jointId: joint.id, updates: { position: { ...joint.position, y } } })}/>
            <Toggle label="Locked" checked={joint.locked} onChange={locked => dispatch({ type: 'update_joint', jointId: joint.id, updates: { locked } })}/>
            <div className="flex gap-2"><button className={`btn-secondary ${joint.bendDirection < 0 ? 'active' : ''}`} disabled={joint.locked} onClick={() => dispatch({ type: 'update_joint', jointId: joint.id, updates: { bendDirection: -1 } })}>Fold left</button><button className={`btn-secondary ${joint.bendDirection >= 0 ? 'active' : ''}`} disabled={joint.locked} onClick={() => dispatch({ type: 'update_joint', jointId: joint.id, updates: { bendDirection: 1 } })}>Fold right</button></div>
            <MiniNumber label="Bend direction" value={joint.bendDirection} min={-1} max={1} step={0.1} disabled={joint.locked} onChange={bendDirection => dispatch({ type: 'update_joint', jointId: joint.id, updates: { bendDirection } })}/>
            <button className="btn-secondary" disabled={joint.locked || project.skeleton?.rootJointIds.includes(joint.id)} onClick={() => dispatch({ type: 'remove_joint', jointId: joint.id })}><Trash2 size={16}/> Remove joint</button>
        </div>}
        <button className="btn-secondary mt-4" onClick={() => dispatch({ type: 'add_joint', joint: { id: uid('joint'), name: 'new joint', position: { x: 0, y: 0 }, parentId: joint?.id ?? null, locked: false, bendDirection: 1 } })}><Plus size={16}/> Add joint</button>
    </div>;
};

type MechanismRecommendation = {
    type: MechanismType;
    label: string;
    score: number;
    reason: string;
    mechanism: MechanismConfig;
    previewPath: string;
    feasibility: string;
    fabricationErrors: string[];
};

const pathMetrics = (path: ProjectMotionPath) => {
    const xs = path.points.map(p => p.x);
    const ys = path.points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const direct = Math.hypot(path.points.at(-1)!.x - path.points[0].x, path.points.at(-1)!.y - path.points[0].y);
    const length = path.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path.points[i].x, p.y - path.points[i].y), 0) || 1;
    const closure = Math.hypot(path.points[0].x - path.points.at(-1)!.x, path.points[0].y - path.points.at(-1)!.y) / Math.max(width, height, 1);
    return { width, height, aspect: width / height, directness: direct / length, closure, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, length };
};

const generatedBounds = (mechanism: MechanismConfig) => {
    const points = generateCurvePoints(mechanism, 72).points;
    if (!points.length) return null;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys)
    };
};

const snapMechanismAnchor = (mechanism: MechanismConfig, project: ProjectState) => {
    const board = sceneToBoard({ x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }, project.settings.physicalKit);
    const anchor = boardToScene(board.col, board.row, project.settings.physicalKit);
    return mechanismWithGeneratedPath({ ...mechanism, anchorX: anchor.x, anchorY: anchor.y, sceneAnchor: anchor, transform: { ...(mechanism.transform ?? { x: anchor.x, y: anchor.y, rotation: mechanism.groundAngle ?? 0, scale: 1 }), x: anchor.x, y: anchor.y } });
};

const generatedPathCenter = (mechanism: MechanismConfig): Point | undefined => {
    const points = mechanism.generatedPath?.length ? mechanism.generatedPath : generateCurvePoints(mechanism, 72).points;
    if (!points.length) return undefined;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};

const fitMechanismGeneratedPathToPath = (mechanism: MechanismConfig, path: ProjectMotionPath) => {
    const center = generatedPathCenter(mechanism);
    if (!center || path.points.length < 3) return mechanism;
    const metrics = pathMetrics(path);
    const dx = metrics.cx - center.x;
    const dy = metrics.cy - center.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return mechanism;
    const anchor = { x: (mechanism.anchorX ?? 0) + dx, y: (mechanism.anchorY ?? 0) + dy };
    return mechanismWithGeneratedPath({
        ...mechanism,
        anchorX: anchor.x,
        anchorY: anchor.y,
        sceneAnchor: anchor,
        transform: { ...(mechanism.transform ?? { x: anchor.x, y: anchor.y, rotation: mechanism.groundAngle ?? 0, scale: 1 }), x: anchor.x, y: anchor.y }
    });
};

const fitRecommendedMechanismToSheet = (project: ProjectState, mechanism: MechanismConfig) => {
    const sheet = sceneBoundsForSheet(project.settings.physicalKit);
    const margin = Math.max(10, project.settings.physicalKit.gridPitchMm * 0.35 * SCENE_PX_PER_MM);
    let fitted = snapMechanismAnchor(mechanism, project);
    let moved = false;
    for (let i = 0; i < 4; i++) {
        const bounds = generatedBounds(fitted);
        if (!bounds) return fitted;
        let dx = 0;
        let dy = 0;
        if (bounds.minX < sheet.x + margin) dx = sheet.x + margin - bounds.minX;
        if (bounds.maxX > sheet.x + sheet.width - margin) dx = sheet.x + sheet.width - margin - bounds.maxX;
        if (bounds.minY < sheet.y + margin) dy = sheet.y + margin - bounds.minY;
        if (bounds.maxY > sheet.y + sheet.height - margin) dy = sheet.y + sheet.height - margin - bounds.maxY;
        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fitted;
        moved = true;
        fitted = snapMechanismAnchor({ ...fitted, anchorX: (fitted.anchorX ?? 0) + dx, anchorY: (fitted.anchorY ?? 0) + dy }, project);
    }
    return moved
        ? { ...fitted, warnings: [...(fitted.warnings ?? []), 'Auto-positioned inside the printable sheet; review anchor before cutting.'] }
        : fitted;
};

const fabricationErrorsForCandidate = (project: ProjectState, mechanism: MechanismConfig) => {
    const baseline = new Set(validateForFabrication(project).errors);
    const candidateProject: ProjectState = { ...project, mechanisms: [...project.mechanisms, mechanism] };
    return validateForFabrication(candidateProject).errors.filter(error => !baseline.has(error));
};

const normalizeGearMeshMechanism = (mechanism: MechanismConfig): MechanismConfig => {
    if (mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear') return normalizeMechanismToReference(mechanism);
    return mechanism;
};

const availableMotionAnchorForRecommendation = (project: ProjectState, partId: string) => {
    const anchors = motionAnchorJointIds(project, partId);
    const occupied = new Set(project.mechanisms
        .filter(m => m.visible && m.enabled !== false && m.targetPartId === partId)
        .map(m => preferredMotionJointId(project, partId, m.targetAnchorJointId))
        .filter(Boolean));
    return [...anchors].reverse().find(anchor => !occupied.has(anchor)) ?? preferredMotionJointId(project, partId, undefined, { preferDistalWhenRoot: true });
};

const recommendationTargetAnchor = (project: ProjectState, selectedPart: BodyPartLayer, selectedPath: ProjectMotionPath) => {
    const anchors = motionAnchorJointIds(project, selectedPart.id);
    const pathAnchor = selectedPath.targetAnchorJointId && anchors.includes(selectedPath.targetAnchorJointId)
        ? selectedPath.targetAnchorJointId
        : undefined;
    const occupied = new Set(project.mechanisms
        .filter(m => m.visible && m.enabled !== false && m.targetPartId === selectedPart.id)
        .map(m => preferredMotionJointId(project, selectedPart.id, m.targetAnchorJointId ?? (m.targetPathId ? project.paths[m.targetPathId]?.targetAnchorJointId : undefined)))
        .filter(Boolean));
    if (pathAnchor && !occupied.has(pathAnchor)) return pathAnchor;
    return availableMotionAnchorForRecommendation(project, selectedPart.id) ?? pathAnchor ?? preferredMotionJointId(project, selectedPart.id, undefined, { preferDistalWhenRoot: true });
};

const createRecommendedMechanism = (project: ProjectState, selectedPart: BodyPartLayer, selectedPath: ProjectMotionPath, type: MechanismType, reason: string, score: number): MechanismConfig => {
    const metrics = pathMetrics(selectedPath);
    const landingBoard = sceneToBoard(selectedPath.points[0], project.settings.physicalKit);
    const landing = boardToScene(landingBoard.col, landingBoard.row, project.settings.physicalKit);
    const first = selectedPath.points[0];
    const last = selectedPath.points.at(-1) ?? first;
    const travelAngle = Math.atan2(last.y - first.y, last.x - first.x) * 180 / Math.PI;
    const span = Math.max(metrics.width, metrics.height, 40);
    const base = createDefaultMechanism(type, `recommend-${type}`);
    const smart = generateSmartConfig(selectedPath.points, type);
    const tunedCrankLength = Math.max(20, Math.min(90, span * 0.24));
    const tunedRockerLength = type === 'cam'
        ? Math.max(36, Math.min(130, metrics.height * 0.9))
        : type === 'rack-pinion'
            ? Math.max(tunedCrankLength * (2 * Math.PI + 2.2), Math.min(420, Math.max(180, metrics.length * 0.95)))
            : Math.max(40, Math.min(180, span * 0.55));
    const tunedGroundLength = type === 'cam' || type === 'yoke' || type === 'rack-pinion'
        ? 0
        : type === 'gear' || type === 'gear_linkage' || type === 'planetary_gear'
            ? tunedCrankLength + tunedRockerLength
            : Math.max(60, Math.min(220, span * 0.85));
    const tunedGearRatio = type === 'gear' || type === 'gear_linkage'
        ? gearTrainOutputRatio([tunedCrankLength, tunedRockerLength])
        : type === 'planetary_gear'
            ? planetaryCarrierOutputRatio(tunedCrankLength, tunedRockerLength)
            : undefined;
    const tuned: MechanismConfig = {
        ...base,
        ...smart,
        id: `recommend-${type}`,
        type,
        visible: true,
        enabled: true,
        color: base.color,
        anchorX: landing.x,
        anchorY: landing.y,
        groundAngle: Number.isFinite(travelAngle) ? travelAngle : base.groundAngle,
        crankLength: tunedCrankLength,
        groundLength: tunedGroundLength,
        couplerLength: type === 'gear' || type === 'planetary_gear' || type === 'cam' || type === 'yoke' || type === 'rack-pinion' ? 0 : Math.max(70, Math.min(260, type === '6bar' ? span * 0.78 : metrics.length * 0.55)),
        rockerLength: tunedRockerLength,
        sliderOffset: type === 'piston' || type === 'yoke' ? Math.max(-80, Math.min(80, metrics.height * 0.2)) : type === 'rack-pinion' ? Math.max(30, Math.min(100, span * 0.28)) : base.sliderOffset,
        couplerPointDist: Math.max(35, Math.min(190, span * 0.72)),
        couplerPointAngle: type === 'piston' || type === 'rack-pinion' ? 0 : base.couplerPointAngle,
        gearRatio: tunedGearRatio,
        gearTrainRadii: type === 'gear' || type === 'gear_linkage' ? [tunedCrankLength, tunedRockerLength] : undefined,
        speed2: type === 'planetary_gear' ? planetaryPlanetSpinRatio(tunedCrankLength, tunedRockerLength) : tunedGearRatio ?? base.speed2,
        rodLength: type === '6bar' ? Math.max(55, Math.min(180, span * 0.52)) : (smart.rodLength ?? base.rodLength),
        assemblyMode: type === '6bar' ? 'open' : base.assemblyMode,
        phase: 0,
        targetPartId: selectedPart.id,
        targetPathId: selectedPath.id,
        targetAnchorJointId: recommendationTargetAnchor(project, selectedPart, selectedPath),
        activeVisualPartIds: [selectedPart.id],
        source: 'optimized',
        presetId: `recommendation-${type}`,
        recommendation: reason,
        warnings: score < 55 ? ['Low-confidence recommendation; review in Foundry before fabrication.'] : []
    };
    const normalized = mechanismWithGeneratedPath(normalizeMechanismToReference(tuned));
    return fitRecommendedMechanismToSheet(project, fitMechanismGeneratedPathToPath(normalized, selectedPath));
};

const fitMechanismToTargetPath = (project: ProjectState, mechanism: MechanismConfig, targetPathId?: string): MechanismConfig => {
    const path = targetPathId ? project.paths[targetPathId] : undefined;
    const part = path ? project.parts[path.partId] : undefined;
    if (!path || !part || path.points.length < 3) return snapMechanismAnchor(normalizeGearMeshMechanism(mechanism), project);
    const fitted = createRecommendedMechanism(project, part, path, mechanism.type, mechanism.recommendation ?? 'Fit to current path.', 80);
    return mechanismWithGeneratedPath({
        ...fitted,
        id: mechanism.id,
        color: mechanism.color ?? fitted.color,
        visible: mechanism.visible,
        enabled: mechanism.enabled,
        source: mechanism.source ?? fitted.source,
        presetId: mechanism.presetId ?? fitted.presetId,
        recommendation: mechanism.recommendation ?? fitted.recommendation,
        warnings: mechanism.warnings ?? fitted.warnings,
        targetPartId: path.partId,
        targetPathId: path.id,
        targetAnchorJointId: mechanism.targetAnchorJointId ?? path.targetAnchorJointId ?? fitted.targetAnchorJointId,
        activeVisualPartIds: [path.partId]
    });
};

const buildMechanismRecommendations = (project: ProjectState, selectedPart?: BodyPartLayer, selectedPath?: ProjectMotionPath): MechanismRecommendation[] => {
    if (!selectedPart || !selectedPath || selectedPath.points.length < 3) return [];
    const metrics = pathMetrics(selectedPath);
    const compact = Math.max(metrics.width, metrics.height) < 120;
    const linear = metrics.directness > 0.72;
    const closed = selectedPath.closed || metrics.closure < 0.35;
    const candidates: Array<{ type: MechanismType; score: number; reason: string }> = [
        { type: '4bar', score: 78 + (linear ? -6 : 8) + (metrics.aspect > 0.7 && metrics.aspect < 2.6 ? 8 : 0), reason: 'Best novice fit for an arcing limb path with printable bars.' },
        { type: 'piston', score: 62 + (linear ? 22 : 0) + (metrics.aspect > 2.0 || metrics.aspect < 0.5 ? 8 : 0), reason: 'Good when the drawn motion reads as push-pull travel.' },
        { type: 'cam', score: 57 + (metrics.height > metrics.width * 0.75 ? 12 : 0) + (compact ? 8 : 0), reason: 'Useful for repeated lifts and bouncy offsets.' },
        { type: 'gear_linkage', score: 61 + (closed ? 8 : 0) + (linear ? 5 : 12), reason: 'Reference gear-linkage recipe: two G3 gears drive an off-center L4 output crank.' },
        { type: 'gear', score: 48 + (closed ? 20 : 0), reason: 'Use when the output should stay rotational or reverse direction.' },
        { type: 'planetary_gear', score: 45 + (closed && compact ? 28 : 6), reason: 'Dense rotary recipe for small circular or loopy paths.' }
    ];
    return candidates
        .map(candidate => {
            const mechanism = createRecommendedMechanism(project, selectedPart, selectedPath, candidate.type, candidate.reason, candidate.score);
            const range = sampleFeasibleRange(mechanism);
            const fabricationErrors = fabricationErrorsForCandidate(project, mechanism);
            return {
                type: candidate.type,
                label: MECHANISM_LIBRARY[candidate.type].label,
                score: Math.max(1, Math.min(99, Math.round(candidate.score - (range.percentValid < 1 ? 12 : 0) - (fabricationErrors.length ? 35 : 0)))),
                reason: candidate.reason,
                mechanism,
                previewPath: fitPathToBox(mechanism.generatedPath ?? [], 220, 120),
                feasibility: fabricationErrors.length ? `Blueprint blocked: ${fabricationErrors[0]}` : range.warning ?? '360° valid sampled motion',
                fabricationErrors
            };
        })
        .sort((a, b) => b.score - a.score);
};

const MechanismRecommendationSheet = ({ isOpen, project, selectedPart, selectedPath, onClose, onApply }: {
    isOpen: boolean;
    project: ProjectState;
    selectedPart?: BodyPartLayer;
    selectedPath?: ProjectMotionPath;
    onClose: () => void;
    onApply: (mechanism: MechanismConfig) => void;
}) => {
    const recommendations = useMemo(() => buildMechanismRecommendations(project, selectedPart, selectedPath), [project, selectedPart, selectedPath]);
    const apply = (option: MechanismRecommendation) => {
        onApply(mechanismWithGeneratedPath({
            ...option.mechanism,
            id: uid('mech'),
            presetId: `recommendation-${option.type}`,
            recommendation: `${option.reason} Score ${option.score}/100.`,
            warnings: option.mechanism.warnings
        }));
    };
    if (!isOpen) return null;
    return <div className="modal-backdrop" role="presentation">
        <section className="modal-sheet recommendation-dialog" role="dialog" aria-modal="true" aria-labelledby="recommendation-dialog-title" data-testid="recommendation-sheet">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="section-title">Mechanism Recommendations</div>
                    <h3 id="recommendation-dialog-title">Mechanism Recommendations for {selectedPart?.name ?? 'selected part'}</h3>
                    <p className="mt-1 text-sm text-slate-600">Ranked from the current free path. Apply adds a real editable mechanism instance and blueprint recipe.</p>
                </div>
                <button className="btn-secondary" onClick={onClose}>Close</button>
            </div>
            {!recommendations.length ? <div className="recommendation-empty" data-testid="recommendation-empty">
                Draw at least 3 free-path points for a selected body part, then return here for mechanism cards.
            </div> : <div className="recommendation-grid mt-5">
                {recommendations.map(option => <article key={option.type} className="recommendation-card recommendation-option" data-testid={`recommendation-card-${option.type}`}>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="font-bold text-slate-800">{option.label}</div>
                            <div className="text-xs font-black uppercase tracking-wider text-slate-500">{option.type} · score {option.score}/100</div>
                        </div>
                        <span className="recommendation-score">{option.score}</span>
                    </div>
                    <svg viewBox="0 0 220 120" className="recommendation-preview mt-3" aria-hidden="true">
                        <path d={option.previewPath} fill="none" stroke={option.mechanism.color} strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    <p className="mt-3">{option.reason}</p>
                    <p className={`mt-2 text-xs ${option.fabricationErrors.length ? 'font-bold text-amber-700' : 'text-slate-500'}`}>Feasibility: {option.feasibility}</p>
                    <button className="btn-primary mt-4" disabled={!!option.fabricationErrors.length} onClick={() => apply(option)}>Apply this</button>
                </article>)}
            </div>}
        </section>
    </div>;
};

const MechanismFoundry = ({ project, foundry, setFoundry, selectedPart, selectedPath, goStage, onExport }: { project: ProjectState; foundry: FoundryState; setFoundry: (m: FoundryState) => void; selectedPart?: BodyPartLayer; selectedPath?: ProjectMotionPath; goStage: (stage: AppStage) => void; onExport: (pkg: FoundryExportPackage) => void }) => {
    const [foundryPlaying, setFoundryPlaying] = useState(false);
    const [foundryPhase, setFoundryPhase] = useState(0);
    const [isPickingAnchor, setIsPickingAnchor] = useState(false);
    const [manualAnchor, setManualAnchor] = useState<Point | null>(null);
    const [showForces, setShowForces] = useState(true);
    const [showVelocity, setShowVelocity] = useState(true);
    const [showTrail, setShowTrail] = useState(false);
    const [showPathPreview, setShowPathPreview] = useState(false);
    const [showFoundryGrid, setShowFoundryGrid] = useState(true);
    const [showSensemaking, setShowSensemaking] = useState(false);
    const [foundryCamera, setFoundryCamera] = useState<FoundryCamera>({ ...FOUNDRY_VIEW_PRESETS.iso, preset: 'iso', pan: { x: 0, y: 0 } });
    const [foundryRigOpacity, setFoundryRigOpacity] = useState(85);
    const [foundryProjectionSize, setFoundryProjectionSize] = useState<FoundryOverlaySize>(FOUNDRY_OVERLAY_SIZE);
    const [isOrbitingFoundry, setIsOrbitingFoundry] = useState(false);
    const [isZoomingFoundry, setIsZoomingFoundry] = useState(false);
    const [isPanningFoundry, setIsPanningFoundry] = useState(false);
    const foundryOrbitStartRef = useRef<{ pointerId: number; x: number; y: number; yaw: number; pitch: number; zoom: number; pan: Point; mode: 'orbit' | 'zoom' | 'pan' } | null>(null);
    const foundryParamDragRef = useRef<{ pointerId: number; handle: 'B' | 'C' | 'D' } | null>(null);
    const targetReady = Boolean(selectedPart && selectedPath && selectedPath.enabled && selectedPath.points.length >= 3);
    const rawLanding = manualAnchor ?? selectedPath?.points[0] ?? (selectedPart ? bodyPartPivotScene(selectedPart, project.skeleton) : { x: foundry.anchorX ?? 0, y: foundry.anchorY ?? 0 });
    const landingBoard = sceneToBoard(rawLanding, project.settings.physicalKit);
    const landing = boardToScene(landingBoard.col, landingBoard.row, project.settings.physicalKit);
    const snapDistance = Math.hypot(rawLanding.x - landing.x, rawLanding.y - landing.y);
    const landedFoundry = useMemo(() => ({ ...foundry, anchorX: landing.x, anchorY: landing.y, sceneAnchor: landing }), [foundry, landing.x, landing.y]);
    const anchorMarker = { x: 180 + (landing.x / SCENE_VIEW.width) * 360, y: 120 - (landing.y / SCENE_VIEW.height) * 240 };
    const preview = useMemo(() => generateCurvePoints(landedFoundry, 96).points, [landedFoundry]);
    const range = useMemo(() => sampleFeasibleRange(landedFoundry), [landedFoundry]);
    const library = MECHANISM_LIBRARY[foundry.type];
    const targetIkJointId = selectedPart ? preferredMotionJointId(project, selectedPart.id, selectedPath?.targetAnchorJointId, { preferDistalWhenRoot: !selectedPath?.targetAnchorJointId }) : undefined;
    const targetChainRootJointId = selectedPath?.chainRootJointId ?? selectedPart?.anchorJointId;
    const feasibilityText = range.warning ?? '360° valid sampled motion';
    const foundryFitContext = useMemo(() => createMechanismFitContext(landedFoundry, 360, 240, 96), [landedFoundry]);
    const selectedSimulation = useMemo(() => fitMechanismSimulationWithContext(landedFoundry, foundryPhase, foundryFitContext), [landedFoundry, foundryPhase, foundryFitContext]);
    const previewPoints = selectedSimulation.pathPoints.length ? selectedSimulation.pathPoints : fitPointsToBox(preview, 360, 240);
    const previewPath = selectedSimulation.pathD || pointsToSvgPath(previewPoints);
    const physicsOverlay = useMemo(
        () => buildFoundryPhysicsOverlay(landedFoundry, selectedSimulation, foundryPhase, project.settings, previewPoints),
        [landedFoundry, selectedSimulation, foundryPhase, project.settings, previewPoints]
    );
    const { playhead, playheadSource, velocityRaw, forceRaw, velocityTip, forceTip, frictionTip, driveTip, velocityMagnitude, frictionMagnitude, forceMagnitude, constraintError, rule: physicsRule } = physicsOverlay;
    const foundryOverlayZ = (fabricationRenderPlanForMechanism(landedFoundry).layers.at(-1)?.z ?? 0.22) + 0.34;
    const projectOverlay = (point: Point | undefined) => projectFoundryOverlayPoint(point, foundryCamera, foundryProjectionSize, foundryOverlayZ);
    const projectedPlayhead = projectOverlay(playhead);
    const projectedVelocityTip = projectOverlay(velocityTip);
    const projectedForceTip = projectOverlay(forceTip);
    const projectedFrictionTip = projectOverlay(frictionTip);
    const projectedDriveOrigin = projectOverlay(selectedSimulation.state.j1);
    const projectedDriveTip = projectOverlay(driveTip);
    const projectedAnchorMarker = projectFoundryOverlayPoint(anchorMarker, foundryCamera, foundryProjectionSize, 0);
    const foundryParamHandles = landedFoundry.type === '4bar'
        ? ([
            { id: 'A', label: 'A fixed', point: selectedSimulation.state.p1, draggable: false },
            { id: 'B', label: 'B crank', point: selectedSimulation.state.j1, draggable: true },
            { id: 'C', label: 'C output', point: selectedSimulation.state.j2, draggable: true },
            { id: 'D', label: 'D ground', point: selectedSimulation.state.p2, draggable: true }
        ] as const).map(handle => ({ ...handle, screen: projectOverlay(handle.point) })).filter(handle => handle.screen)
        : [];
    const hardBlocked = !targetReady || range.percentValid === 0 || !Number.isFinite(landing.x) || !Number.isFinite(landing.y);
    const foundryCameraLabel = foundryCamera.preset === 'custom' ? 'Custom view' : FOUNDRY_VIEW_PRESETS[foundryCamera.preset].label;
    const foundryPhaseDegrees = Math.round(((((foundryPhase / (Math.PI * 2)) % 1) + 1) % 1) * 360);
    const applyAnchor = (point: Point) => {
        const board = sceneToBoard(point, project.settings.physicalKit);
        const snapped = boardToScene(board.col, board.row, project.settings.physicalKit);
        setManualAnchor(snapped);
        setFoundry({
            ...foundry,
            anchorX: snapped.x,
            anchorY: snapped.y,
            sceneAnchor: snapped,
            transform: { ...(foundry.transform ?? { x: snapped.x, y: snapped.y, rotation: foundry.groundAngle ?? 0, scale: 1 }), x: snapped.x, y: snapped.y }
        });
    };
    const updateFoundryProjectionSize = (size: FoundryOverlaySize) => setFoundryProjectionSize(prev => (
        Math.abs(prev.width - size.width) < 1 && Math.abs(prev.height - size.height) < 1 ? prev : size
    ));
    const handleAnchorPick = (point: Point) => {
        if (!isPickingAnchor) return;
        applyAnchor(point);
        setIsPickingAnchor(false);
    };
    const setCameraPreset = (preset: Exclude<FoundryViewPreset, 'custom'>) => setFoundryCamera({ ...FOUNDRY_VIEW_PRESETS[preset], preset, pan: { x: 0, y: 0 } });
    const handleFoundryPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (isPickingAnchor || (event.button !== 0 && event.button !== 1 && event.button !== 2)) return;
        const mode = event.altKey ? 'zoom' : event.shiftKey || event.button === 1 || event.button === 2 ? 'pan' : 'orbit';
        foundryOrbitStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: foundryCamera.yaw, pitch: foundryCamera.pitch, zoom: foundryCamera.zoom, pan: foundryCamera.pan ?? { x: 0, y: 0 }, mode };
        setIsOrbitingFoundry(mode === 'orbit');
        setIsZoomingFoundry(mode === 'zoom');
        setIsPanningFoundry(mode === 'pan');
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const handleFoundryPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const start = foundryOrbitStartRef.current;
        if (!start || start.pointerId !== event.pointerId) return;
        event.preventDefault();
        if (start.mode === 'zoom') {
            setFoundryCamera({
                yaw: start.yaw,
                pitch: start.pitch,
                zoom: clampFoundryZoom(start.zoom + (start.y - event.clientY) * 0.006),
                preset: 'custom',
                pan: start.pan
            });
            return;
        }
        if (start.mode === 'pan') {
            const scale = 0.018 / Math.max(0.45, start.zoom);
            setFoundryCamera({
                yaw: start.yaw,
                pitch: start.pitch,
                zoom: start.zoom,
                preset: 'custom',
                pan: { x: start.pan.x - (event.clientX - start.x) * scale, y: start.pan.y + (event.clientY - start.y) * scale }
            });
            return;
        }
        setFoundryCamera({
            yaw: start.yaw + (event.clientX - start.x) * 0.45,
            pitch: clampFoundryPitch(start.pitch - (event.clientY - start.y) * 0.45),
            zoom: start.zoom,
            preset: 'custom',
            pan: start.pan
        });
    };
    const finishFoundryOrbit = (event: React.PointerEvent<HTMLDivElement>) => {
        if (foundryOrbitStartRef.current?.pointerId === event.pointerId) {
            foundryOrbitStartRef.current = null;
            setIsOrbitingFoundry(false);
            setIsZoomingFoundry(false);
            setIsPanningFoundry(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };
    const handleFoundryWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        if (isPickingAnchor) return;
        event.preventDefault();
        event.stopPropagation();
        setFoundryCamera(prev => ({
            ...prev,
            zoom: clampFoundryZoom(prev.zoom * (event.deltaY < 0 ? 1.1 : 0.9)),
            preset: 'custom'
        }));
    };
    const updateFoundryParam = (key: keyof MechanismConfig, value: number) => {
        if (key === 'anchorX' || key === 'anchorY') {
            const anchor = {
                x: key === 'anchorX' ? value : (foundry.anchorX ?? landing.x),
                y: key === 'anchorY' ? value : (foundry.anchorY ?? landing.y)
            };
            setManualAnchor(anchor);
            setFoundry(normalizeGearMeshMechanism({
                ...foundry,
                [key]: value,
                sceneAnchor: anchor,
                transform: { ...(foundry.transform ?? { x: anchor.x, y: anchor.y, rotation: foundry.groundAngle ?? 0, scale: 1 }), x: anchor.x, y: anchor.y }
            }));
            return;
        }
        setFoundry(normalizeGearMeshMechanism({ ...foundry, [key]: value }));
    };
    const clampFoundryParam = (key: keyof MechanismConfig, value: number) => {
        const param = PARAMS.find(item => item.key === key);
        if (!param) return value;
        return Math.max(param.min, Math.min(param.max, value));
    };
    const updateFoundryParams = (updates: Partial<MechanismConfig>) => {
        setFoundry(normalizeGearMeshMechanism({ ...foundry, ...updates }));
    };
    const foundryPointFromOverlayEvent = (event: React.PointerEvent<SVGCircleElement>) => {
        const svg = event.currentTarget.ownerSVGElement;
        if (!svg) return undefined;
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return undefined;
        return unprojectFoundryOverlayPoint({
            x: ((event.clientX - rect.left) / rect.width) * foundryProjectionSize.width,
            y: ((event.clientY - rect.top) / rect.height) * foundryProjectionSize.height
        }, foundryCamera, foundryProjectionSize, foundryOverlayZ);
    };
    const applyFoundryParamHandleDrag = (handle: 'B' | 'C' | 'D', point: Point) => {
        const s = selectedSimulation.state;
        const scale = Math.max(0.001, selectedSimulation.scale);
        const sceneDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) / scale;
        if (handle === 'B') {
            updateFoundryParam('crankLength', clampFoundryParam('crankLength', sceneDistance(s.p1, point)));
            return;
        }
        if (handle === 'D') {
            updateFoundryParams({
                groundLength: clampFoundryParam('groundLength', sceneDistance(s.p1, point)),
                groundAngle: Math.atan2(point.y - s.p1.y, point.x - s.p1.x) * 180 / Math.PI
            });
            return;
        }
        updateFoundryParams({
            couplerLength: clampFoundryParam('couplerLength', sceneDistance(s.j1, point)),
            rockerLength: clampFoundryParam('rockerLength', sceneDistance(s.p2, point))
        });
    };
    const handleFoundryParamPointerDown = (handle: 'B' | 'C' | 'D') => (event: React.PointerEvent<SVGCircleElement>) => {
        event.preventDefault();
        event.stopPropagation();
        foundryParamDragRef.current = { pointerId: event.pointerId, handle };
        setFoundryPlaying(false);
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const handleFoundryParamPointerMove = (event: React.PointerEvent<SVGCircleElement>) => {
        const drag = foundryParamDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const point = foundryPointFromOverlayEvent(event);
        if (point) applyFoundryParamHandleDrag(drag.handle, point);
    };
    const handleFoundryParamPointerUp = (event: React.PointerEvent<SVGCircleElement>) => {
        if (foundryParamDragRef.current?.pointerId === event.pointerId) {
            foundryParamDragRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };
    const keepCurrentAnchor = (mechanism: MechanismConfig): MechanismConfig => ({
        ...mechanism,
        anchorX: landing.x,
        anchorY: landing.y,
        sceneAnchor: landing,
        transform: { ...(mechanism.transform ?? { x: landing.x, y: landing.y, rotation: mechanism.groundAngle ?? 0, scale: 1 }), x: landing.x, y: landing.y }
    });
    const setAnchoredFoundry = (mechanism: MechanismConfig) => setFoundry(normalizeGearMeshMechanism(keepCurrentAnchor(mechanism)));
    const resetFoundryPreview = () => {
        setFoundryPlaying(false);
        setFoundryPhase(0);
        setManualAnchor(null);
        setIsPickingAnchor(false);
        setShowForces(true);
        setShowVelocity(true);
        setShowTrail(false);
        setShowPathPreview(false);
        setFoundryCamera({ ...FOUNDRY_VIEW_PRESETS.iso, preset: 'iso', pan: { x: 0, y: 0 } });
        setAnchoredFoundry({ ...createDefaultMechanism(foundry.type, 'foundry-preview'), color: foundry.color, presetId: 'balanced', recommendation: FOUNDRY_PRESETS.balanced.recommendation });
    };
    useEffect(() => {
        if (!foundryPlaying) return;
        let frame = 0;
        let last = performance.now();
        const tick = (time: number) => {
            const elapsed = time - last;
            if (elapsed >= FOUNDRY_ANIMATION_COMMIT_MS) {
                last = time - (elapsed % FOUNDRY_ANIMATION_COMMIT_MS);
                setFoundryPhase(prev => (prev + Math.min(96, elapsed) * 0.0025 * project.settings.animationSpeed) % (Math.PI * 2));
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [foundryPlaying, project.settings.animationSpeed]);
    const makePackage = (): FoundryExportPackage => {
        const mechanismId = uid('mech');
        const state = calculateLinkage(landedFoundry, 0);
        const physicalOutputPoint = landedFoundry.type === '4bar' || landedFoundry.type === '5bar' || landedFoundry.type === '6bar'
            ? state.j2
            : (state.effector ?? state.j2);
        const preset = foundry.presetId ?? 'balanced';
        return {
            id: `foundry-${Date.now().toString(36)}`,
            createdAt: new Date().toISOString(),
            mechanismId,
            mechanismType: landedFoundry.type,
            parameters: { ...landedFoundry, id: mechanismId },
            pivot: landing,
            outputPoint: state.isValid ? physicalOutputPoint : undefined,
            generatedPath: preview,
            simulationSummary: feasibilityText,
            visual: { color: landedFoundry.color, scale: landedFoundry.transform?.scale ?? 1, constraintsVisible: true },
            animation: { duration: selectedPath?.duration ?? 3200, steps: preview.length, loop: true },
            targetPartId: selectedPart?.id,
            targetPathId: selectedPath?.id,
            targetAnchorJointId: targetIkJointId,
            metadata: { sourceTab: 'mechanism-foundry', selectedPreset: preset, recommendation: foundry.recommendation ?? FOUNDRY_PRESETS[preset]?.recommendation, simulationFriction: project.settings.simulationFriction, simulationMassKg: project.settings.simulationMassKg },
            warnings: range.warning ? [range.warning] : [],
            source: 'mechanism-foundry'
        };
    };
    return <EditorStageFrame
        stage="foundry"
        className="foundry-stage-frame"
        layout={{
            workflow: workflowPane(<div className="stage-pane-stack">
            <StageLeftSummary project={project} title="Foundry" stage="foundry" goStage={goStage}>
                <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600" data-testid="foundry-target-summary">
                    <div className="font-bold text-slate-800">Target {selectedPart?.name ?? 'none'} · {selectedPath?.points.length ?? 0} pts</div>
                    <div>Board hole {landingBoard.label} · chain {targetChainRootJointId ?? 'none'} → {targetIkJointId ?? 'none'}</div>
                    {snapDistance > 0.5 && <div>Snapped {snapDistance.toFixed(0)} scene units from target to nearest board hole for fabrication.</div>}
                    <div><strong>Range:</strong> {range.percentValid === 1 ? '360° valid' : feasibilityText}</div>
                    <div data-testid="foundry-feasibility"><strong>Status:</strong> {feasibilityText}</div>
                    <div data-testid="foundry-anchor-status">{isPickingAnchor ? 'Pick board hole.' : (manualAnchor ? 'Anchor picked.' : (foundry.recommendation ?? FOUNDRY_PRESETS.balanced.recommendation))}</div>
                </div>
                <button type="button" data-testid="foundry-pick-anchor" className={`btn-secondary w-full ${isPickingAnchor ? 'active' : ''}`} onClick={() => setIsPickingAnchor(value => !value)}>{isPickingAnchor ? 'Cancel anchor pick' : 'Pick anchor on canvas'}</button>
                <button className="btn-primary w-full" aria-label="Use mechanism" disabled={hardBlocked} onClick={() => onExport(makePackage())}><Boxes size={16}/> Use mechanism</button>
                {!targetReady && <div className="warning">Draw at least 3 points for a selected body part before exporting a mechanism.</div>}
                {range.warning && <div className="warning">{range.warning}</div>}
                <div className="compact-fabrication-stack" data-testid="foundry-fabrication-stack">
                    <strong>Stack</strong>
                    <span>{fabricationStackSummary(foundry)}</span>
                </div>
                <h4 className="section-title mt-4">Templates</h4>
                <div className="mechanism-choice-grid" data-testid="foundry-mechanism-gallery">
                    {FOUNDRY_MECHANISM_TYPES.map(type => {
                        const item = MECHANISM_LIBRARY[type];
                        const cardMechanism = { ...createDefaultMechanism(type, `foundry-card-${type}`), color: foundry.color };
                        const cardSimulation = fitMechanismSimulation(cardMechanism, foundryPhase, 180, 96, 48);
                        return <button key={type} type="button" className={`recommendation-card mechanism-choice ${foundry.type === type ? 'active' : ''}`} onClick={() => setAnchoredFoundry({ ...createDefaultMechanism(type, 'foundry-preview'), color: foundry.color, presetId: 'balanced', recommendation: FOUNDRY_PRESETS.balanced.recommendation })}>
                            <svg viewBox="0 0 180 96" className="mechanism-choice-sim" data-testid={`foundry-mini-simulation-${type}`} aria-hidden="true">
                                <path d={cardSimulation.pathD} fill="none" stroke={foundry.color} strokeWidth="2.5" strokeLinecap="round" opacity="0.45"/>
                                <MechanismLinkagePreview mechanism={cardMechanism} simulation={cardSimulation} kit={project.settings.physicalKit} testId={`foundry-mini-linkage-${type}`} compact />
                            </svg>
                            <div className="font-bold text-slate-800">{item.label}</div>
                            <div>{item.goodFor}</div>
                        </button>;
                    })}
                </div>
                {showSensemaking && <div className="recommendation-card" data-testid="foundry-mechanism-library">
                    <div className="font-bold text-slate-800">Selected: {library.label}</div>
                    <div>Use: {library.sense}.</div>
                    <div>Rule: {library.constraint}.</div>
                    <div>Estimate: {physicsRule}.</div>
                    <div>Stack: {fabricationStackSummary(foundry)}.</div>
                    <div>Feasibility: {feasibilityText}</div>
                </div>}
            </StageLeftSummary>
        </div>),
            canvas: canvasPane(<section className="path-canvas-shell foundry-canvas-shell canvas-workspace p-0">
            <div className="foundry-sim-badge" data-testid="foundry-sim-badge"><span className={foundryPlaying ? 'status-pulse' : ''} />{foundryPlaying ? 'Active Sim' : 'Paused'}</div>
            <div className="foundry-camera-hud" data-testid="foundry-camera-controls" aria-label="Shared 3D viewer toolbar" data-viewer-contract={VIEWER3D_CONTRACT_VERSION}>
                <span className="foundry-camera-readout" data-testid="foundry-camera-readout">3D {foundryCameraLabel} · {Math.round(foundryCamera.zoom * 100)}%</span>
                {(Object.entries(FOUNDRY_VIEW_PRESETS) as Array<[Exclude<FoundryViewPreset, 'custom'>, FoundryCameraPreset]>).map(([preset, view]) =>
                    <button key={preset} type="button" data-testid={`foundry-camera-preset-${preset}`} className={foundryCamera.preset === preset ? 'active' : ''} aria-pressed={foundryCamera.preset === preset} onClick={() => setCameraPreset(preset)}>{view.label}</button>
                )}
                <span className="viewer-toolbar-divider" aria-hidden="true" />
                <button type="button" data-testid="foundry-toggle-grid" className={showFoundryGrid ? 'active' : ''} aria-label="Grid layer" aria-pressed={showFoundryGrid} onClick={() => setShowFoundryGrid(!showFoundryGrid)}>Grid</button>
                <button type="button" data-testid="foundry-toggle-paths" className={showPathPreview ? 'active' : ''} aria-label="Path layer" aria-pressed={showPathPreview} onClick={() => setShowPathPreview(!showPathPreview)}>Path</button>
                <button type="button" data-testid="foundry-toggle-forces" className={showForces ? 'active' : ''} aria-label="Force vector layer" aria-pressed={showForces} onClick={() => setShowForces(!showForces)}>Force</button>
                <button type="button" data-testid="foundry-toggle-velocity" className={showVelocity ? 'active' : ''} aria-label="Speed vector layer" aria-pressed={showVelocity} onClick={() => setShowVelocity(!showVelocity)}>v</button>
                <button type="button" data-testid="foundry-toggle-trail" className={showTrail ? 'active' : ''} aria-label="Motion trace layer" aria-pressed={showTrail} onClick={() => setShowTrail(!showTrail)}>Trace</button>
            </div>
            <div className="foundry-playback-hud foundry-toolbar" data-testid="foundry-toolbar" aria-label="Foundry playback controls">
                <button className={`btn-secondary ${foundryPlaying ? 'active' : ''}`} onClick={() => setFoundryPlaying(!foundryPlaying)}>{foundryPlaying ? 'Pause' : 'Play'}</button>
                <button className="btn-secondary" onClick={resetFoundryPreview}>Reset</button>
                <input aria-label="Foundry phase" type="range" min="0" max="360" value={foundryPhaseDegrees} onChange={event => { setFoundryPlaying(false); setFoundryPhase(Number(event.target.value) * Math.PI / 180); }} />
                <span>{foundryPhaseDegrees}°</span>
            </div>
            <ThreeFoundryPreview
                mechanism={landedFoundry}
                simulation={selectedSimulation}
                kit={project.settings.physicalKit}
                camera={foundryCamera}
                rigOpacity={foundryRigOpacity / 100}
                color={foundry.color}
                pathPoints={previewPoints}
                showGrid={showFoundryGrid}
                showPathPreview={showPathPreview}
                showTrail={showTrail}
                showForces={showForces}
                showVelocity={showVelocity}
                physicsRule={physicsRule}
                velocityMagnitude={velocityMagnitude}
                forceMagnitude={forceMagnitude}
                frictionCoefficient={project.settings.simulationFriction}
                frictionMagnitude={frictionMagnitude}
                constraintError={constraintError}
                cameraLabel={foundryCameraLabel}
                isPickingAnchor={isPickingAnchor}
                isOrbiting={isOrbitingFoundry}
                isZooming={isZoomingFoundry}
                isPanning={isPanningFoundry}
                onAnchorPick={handleAnchorPick}
                onPointerDown={handleFoundryPointerDown}
                onPointerMove={handleFoundryPointerMove}
                onPointerUp={finishFoundryOrbit}
                onPointerCancel={finishFoundryOrbit}
                onWheel={handleFoundryWheel}
                onProjectionSizeChange={updateFoundryProjectionSize}
            >
                <svg data-testid="foundry-preview-overlay" viewBox={`0 0 ${foundryProjectionSize.width} ${foundryProjectionSize.height}`} className="foundry-preview-overlay" aria-label="Foundry physical joint overlay" data-projection-aspect={(foundryProjectionSize.width / Math.max(1, foundryProjectionSize.height)).toFixed(3)}>
                    {showForces && projectedPlayhead && projectedForceTip && projectedDriveOrigin && projectedDriveTip && <g data-testid="foundry-forces-overlay" className="physics-vector physics-force" data-projection="three-camera" data-origin-source={playheadSource} data-physics-rule={physicsRule} data-fx={forceRaw.x.toFixed(3)} data-fy={forceRaw.y.toFixed(3)} data-force-magnitude={forceMagnitude.toFixed(3)} data-friction-magnitude={frictionMagnitude.toFixed(3)} data-constraint-error={constraintError.toFixed(3)} stroke="#ef4444" strokeWidth="3" strokeLinecap="round">
                        <defs><marker id="foundry-arrow-force-overlay" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="#ef4444" /></marker></defs>
                        <defs><marker id="foundry-arrow-friction-overlay" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="#f59e0b" /></marker></defs>
                        <line data-testid="foundry-force-vector" x1={projectedPlayhead.x} y1={projectedPlayhead.y} x2={projectedForceTip.x} y2={projectedForceTip.y} markerEnd="url(#foundry-arrow-force-overlay)" />
                        <line data-testid="foundry-drive-force-vector" x1={projectedDriveOrigin.x} y1={projectedDriveOrigin.y} x2={projectedDriveTip.x} y2={projectedDriveTip.y} opacity="0.68" markerEnd="url(#foundry-arrow-force-overlay)" />
                        {projectedFrictionTip && <line data-testid="foundry-friction-vector" x1={projectedPlayhead.x} y1={projectedPlayhead.y} x2={projectedFrictionTip.x} y2={projectedFrictionTip.y} stroke="#f59e0b" markerEnd="url(#foundry-arrow-friction-overlay)" />}
                        <text x={projectedForceTip.x + 5} y={projectedForceTip.y - 3}>F / a</text>
                        <text x={projectedDriveTip.x + 5} y={projectedDriveTip.y + 9}>drive τ</text>
                        {projectedFrictionTip && <text x={projectedFrictionTip.x + 5} y={projectedFrictionTip.y + 9} fill="#92400e">μ</text>}
                    </g>}
                    {showVelocity && projectedPlayhead && projectedVelocityTip && <g data-testid="foundry-velocity-overlay" className="physics-vector physics-velocity" data-projection="three-camera" data-origin-source={playheadSource} data-vx={velocityRaw.x.toFixed(3)} data-vy={velocityRaw.y.toFixed(3)} data-speed={velocityMagnitude.toFixed(3)} stroke="#10b981" strokeWidth="4" strokeLinecap="round">
                        <defs><marker id="foundry-arrow-velocity-overlay" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="#10b981" /></marker></defs>
                        <line data-testid="foundry-velocity-vector" x1={projectedPlayhead.x} y1={projectedPlayhead.y} x2={projectedVelocityTip.x} y2={projectedVelocityTip.y} markerEnd="url(#foundry-arrow-velocity-overlay)" />
                        <text x={projectedVelocityTip.x + 5} y={projectedVelocityTip.y - 3}>v</text>
                    </g>}
                    {projectedPlayhead && <circle data-testid="foundry-playhead" data-projection="three-camera" data-origin-source={playheadSource} cx={projectedPlayhead.x} cy={projectedPlayhead.y} r="7" fill="#f472b6" stroke="white" strokeWidth="3" />}
                    {foundryParamHandles.length > 0 && <g data-testid="foundry-param-handles" data-handle-contract="4bar-A-B-C-D" data-projection="three-camera">
                        {foundryParamHandles.map(handle => <g key={handle.id} transform={`translate(${handle.screen!.x} ${handle.screen!.y})`} data-testid={`foundry-param-handle-group-${handle.id}`}>
                            <circle
                                data-testid={`foundry-param-handle-${handle.id}`}
                                className={`foundry-param-handle ${handle.draggable ? 'is-draggable' : 'is-locked'}`}
                                data-param-handle={handle.id}
                                data-param-role={handle.label}
                                data-draggable={String(handle.draggable)}
                                r={handle.draggable ? 8 : 6}
                                fill={handle.draggable ? '#ffffff' : '#e2e8f0'}
                                stroke={handle.draggable ? '#4f46e5' : '#64748b'}
                                strokeWidth="3"
                                onPointerDown={handle.draggable ? handleFoundryParamPointerDown(handle.id as 'B' | 'C' | 'D') : undefined}
                                onPointerMove={handle.draggable ? handleFoundryParamPointerMove : undefined}
                                onPointerUp={handle.draggable ? handleFoundryParamPointerUp : undefined}
                                onPointerCancel={handle.draggable ? handleFoundryParamPointerUp : undefined}
                            />
                            <text className="foundry-param-label" x="10" y="-8">{handle.id}</text>
                        </g>)}
                    </g>}
                    {(isPickingAnchor || manualAnchor) && projectedAnchorMarker && <g data-testid="foundry-anchor-marker" data-projection="three-camera" transform={`translate(${projectedAnchorMarker.x} ${projectedAnchorMarker.y})`}>
                        <circle r="8" fill="#ffffff" stroke="#8b5cf6" strokeWidth="3" />
                        <path d="M -13 0 H 13 M 0 -13 V 13" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" />
                        <text x="12" y="-10" fill="#5b21b6" fontSize="8" fontWeight="900">{landingBoard.label}</text>
                    </g>}
                </svg>
            </ThreeFoundryPreview>
            <div hidden data-testid="foundry-toolbar-state">Toolbar: {foundryPlaying ? 'playing' : 'paused'} · grid {showFoundryGrid ? 'shown' : 'hidden'} · path {showPathPreview ? 'shown' : 'hidden'} · camera {foundryCameraLabel} · phase {Math.round(foundryPhase * 180 / Math.PI)}°</div>
        </section>),
            inspector: inspectorPane(<div className="stage-pane-stack">
            <div>
                <div className="section-title">Selected mechanism</div>
                <h3>{library.label}</h3>
                <div className="physics-readout mt-3" data-testid="foundry-physics-readout">
                    <strong>Kinematic estimate</strong>
                    <span>{physicsRule}</span>
                    <span>v {velocityMagnitude.toFixed(1)} · F {forceMagnitude.toFixed(1)} · μ {project.settings.simulationFriction.toFixed(2)}</span>
                    <span>constraint err {constraintError.toFixed(2)} · mass {project.settings.simulationMassKg.toFixed(1)}kg</span>
                </div>
            </div>
            <div className="foundry-opacity-panel inspector-control-card" data-testid="foundry-opacity-panel">
                <div><span>Rig Opacity</span><strong>{foundryRigOpacity}%</strong></div>
                <input aria-label="Rig opacity" type="range" min="35" max="100" value={foundryRigOpacity} onChange={event => setFoundryRigOpacity(Number(event.target.value))} />
            </div>
            <details className="advanced-panel">
                <summary>Mechanism options</summary>
                <div className="mt-3 space-y-3">
                    <select aria-label="Foundry mechanism type" className="field" value={foundry.type} onChange={e => setAnchoredFoundry({ ...createDefaultMechanism(e.target.value as MechanismType, 'foundry-preview'), color: foundry.color, presetId: 'balanced', recommendation: FOUNDRY_PRESETS.balanced.recommendation })}>{FOUNDRY_MECHANISM_TYPES.map(t => <option key={t} value={t}>{mechanismTemplateLabel(t)}</option>)}</select>
                    <select aria-label="Foundry preset" className="field" value={foundry.presetId ?? 'balanced'} onChange={e => {
                        const presetId = e.target.value;
                        const preset = FOUNDRY_PRESETS[presetId];
                        const { label: _label, ...updates } = preset;
                        const base = presetId === 'balanced' ? createDefaultMechanism(foundry.type, 'foundry-preview') : foundry;
                        setAnchoredFoundry({ ...base, color: foundry.color, ...updates, presetId, recommendation: preset.recommendation });
                    }}>{Object.entries(FOUNDRY_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}</select>
                    {PARAMS.filter(p => showParam(foundry.type, p.key)).map(p => <React.Fragment key={String(p.key)}><MiniNumber label={p.label} value={Number(foundry[p.key] ?? 0)} min={p.min} max={p.max} step={p.step} onChange={value => updateFoundryParam(p.key, value)}/></React.Fragment>) }
                    {foundry.type === 'cam' && <CamProfileEditor samples={foundry.camProfileSamples} onChange={camProfileSamples => setFoundry({ ...foundry, camProfileSamples })} />}
                </div>
            </details>
            <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
                <div className="font-bold text-slate-800">Preview overlays</div>
                <div className="foundry-toolbar mt-2">
                    <button type="button" className={`btn-secondary ${showForces ? 'active' : ''}`} aria-pressed={showForces} onClick={() => setShowForces(!showForces)}>Forces</button>
                    <button type="button" className={`btn-secondary ${showVelocity ? 'active' : ''}`} aria-pressed={showVelocity} onClick={() => setShowVelocity(!showVelocity)}>Velocity</button>
                    <button type="button" className={`btn-secondary ${showTrail ? 'active' : ''}`} aria-pressed={showTrail} onClick={() => setShowTrail(!showTrail)}>Trail</button>
                    <button type="button" className={`btn-secondary ${showPathPreview ? 'active' : ''}`} aria-pressed={showPathPreview} onClick={() => setShowPathPreview(!showPathPreview)}>Path Preview</button>
                    <button type="button" className={`btn-secondary ${showSensemaking ? 'active' : ''}`} aria-label="Show Sensemaking" aria-pressed={showSensemaking} onClick={() => setShowSensemaking(!showSensemaking)}>Details</button>
                    <button type="button" className="btn-secondary" aria-label="Back to Gallery" onClick={() => setShowSensemaking(false)}>Hide details</button>
                </div>
            </div>
        </div>)
        }}
    />;
};

const MechanismDesign = ({ project, selectedMechanism, mechanismConfig, setMechanismConfig, updateMechanism, dispatch, isPlaying, setIsPlaying, showTrace, setShowTrace, angle, setAngle, onOptimize, onRecommendations, optimizerBusy, exportSvg, exportDxf, onBlueprint, goStage, viewport, setViewport }: {
    project: ProjectState;
    selectedMechanism?: MechanismConfig;
    mechanismConfig: GlobalConfig;
    setMechanismConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>;
    updateMechanism: (id: string, updates: Partial<MechanismConfig>) => void;
    dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void;
    isPlaying: boolean;
    setIsPlaying: (v: boolean) => void;
    showTrace: boolean;
    setShowTrace: (v: boolean) => void;
    angle: number;
    setAngle: React.Dispatch<React.SetStateAction<number>>;
    onOptimize: () => void;
    onRecommendations: () => void;
    optimizerBusy: boolean;
    exportSvg: () => void;
    exportDxf: () => void;
    onBlueprint: () => void;
    goStage: (stage: AppStage) => void;
    viewport: CanvasViewport;
    setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
}) => {
    const selectedLibrary = selectedMechanism ? MECHANISM_LIBRARY[selectedMechanism.type] : undefined;
    const selectedRange = selectedMechanism ? sampleFeasibleRange(selectedMechanism) : undefined;
    const bindingWarnings = mechanismBindingWarnings(project);
    const selectedBindingWarnings = selectedMechanism ? bindingWarnings[selectedMechanism.id] ?? [] : [];
    const targetAnchorOptions = selectedMechanism?.targetPartId ? motionAnchorJointIds(project, selectedMechanism.targetPartId) : [];
    const selectedTargetAnchor = selectedMechanism?.targetPartId
        ? preferredMotionJointId(project, selectedMechanism.targetPartId, selectedMechanism.targetAnchorJointId)
        : undefined;
    const selectedTargetPath = selectedMechanism?.targetPathId ? project.paths[selectedMechanism.targetPathId] : undefined;
    const selectedTargetChain = selectedMechanism?.targetPartId
        ? describeMotionChain(project, selectedMechanism.targetPartId, selectedTargetAnchor, { rootJointId: selectedTargetPath?.chainRootJointId })
        : undefined;
    const updateTargetPart = (partId: string) => {
        if (!selectedMechanism) return;
        const targetPartId = partId || undefined;
        const targetPath = targetPartId ? Object.values(project.paths).find(path => path.partId === targetPartId) : undefined;
        updateMechanism(selectedMechanism.id, {
            targetPartId,
            targetPathId: targetPath?.id,
            targetAnchorJointId: targetPath?.targetAnchorJointId ?? (targetPartId ? preferredMotionJointId(project, targetPartId, selectedMechanism.targetAnchorJointId, { preferDistalWhenRoot: true }) : undefined)
        });
    };
    const addLibraryMechanism = (type: MechanismType) => {
        const base = createDefaultMechanism(type, uid('mech'));
        const path = project.selectedPathId ? project.paths[project.selectedPathId] : undefined;
        const mechanism = path && path.points.length >= 3
            ? fitMechanismToTargetPath(project, { ...base, targetPathId: path.id, targetPartId: path.partId }, path.id)
            : mechanismWithGeneratedPath(base);
        dispatch({ type: 'upsert_mechanism', mechanism });
    };
    return <EditorStageFrame
        stage="design"
        className="design-stage-frame"
        layout={{
            workflow: workflowPane(<div className="stage-pane-stack">
            <StageLeftSummary project={project} title="Design" stage="design" goStage={goStage}>
                <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary" aria-label={isPlaying ? 'Play / Pause' : 'Play'} onClick={() => setIsPlaying(!isPlaying)}><Play size={16}/>{isPlaying ? 'Pause' : 'Play'}</button>
                    <button className={`btn-secondary ${showTrace ? 'active' : ''}`} onClick={() => setShowTrace(!showTrace)}>Trace</button>
                    <button className="btn-primary" onClick={onRecommendations}><Sparkles size={16}/> Recommend</button>
                </div>
                <h4 className="section-title mt-4">Mechanisms</h4>
                <select aria-label="Mechanism instance" className="field" value={selectedMechanism?.id ?? ''} onChange={e => dispatch({ type: 'set_mechanisms', mechanisms: project.mechanisms, selectedMechanismId: e.target.value })}>{project.mechanisms.map(m => <option key={m.id} value={m.id}>{m.id} · {m.type}</option>)}</select>
                <div className="mt-3 flex flex-wrap gap-2">
                    {AUTHORABLE_MECHANISM_TYPES.map(type => <button key={type} className="chip" title={mechanismTemplateLabel(type)} onClick={() => addLibraryMechanism(type)}>{type}</button>)}
                </div>
                {selectedLibrary && <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600" data-testid="design-mechanism-library">
                    <div className="font-bold text-slate-800">Mechanism library</div>
                    <div>{selectedLibrary.label}</div>
                    <div data-testid="design-feasibility">Feasibility: {selectedRange?.warning ?? '360° valid sampled motion'}</div>
                </div>}
                {Object.entries(bindingWarnings).map(([id, warnings]) => warnings.length ? <div className="warning" key={id}>{id}: {warnings.join('; ')}</div> : null)}
                <button className="btn-primary w-full" onClick={onBlueprint}>Blueprint</button>
            </StageLeftSummary>
        </div>),
            canvas: canvasPane(<div className="path-canvas-shell canvas-workspace overflow-hidden p-0">
            <CanvasZoomToolbar viewport={viewport} setViewport={setViewport} />
            <Canvas project={project} config={mechanismConfig} setConfig={setMechanismConfig} selectedId={project.selectedMechanismId ?? null} setSelectedId={id => dispatch({ type: 'set_mechanisms', mechanisms: project.mechanisms, selectedMechanismId: id ?? undefined })} isPlaying={isPlaying} showTrace={showTrace} isDrawMode={false} userPath={[]} setUserPath={() => {}} angle={angle} setAngle={setAngle} viewport={viewport} setViewport={setViewport}/>
        </div>),
            inspector: inspectorPane(<div className="stage-pane-stack">
            <div>
                <div className="section-title">Mechanism</div>
                <h3>{selectedMechanism ? `${selectedMechanism.id} · ${mechanismTemplateLabel(selectedMechanism.type)}` : 'No mechanism selected'}</h3>
            </div>
            {selectedMechanism && <>
                <Toggle label="Visible" checked={selectedMechanism.visible} onChange={visible => updateMechanism(selectedMechanism.id, { visible })}/>
                <Toggle label="Enabled" checked={selectedMechanism.enabled !== false} onChange={enabled => updateMechanism(selectedMechanism.id, { enabled })}/>
                <div className="section-title">Target</div>
                <select aria-label="Mechanism target part" className="field" value={selectedMechanism.targetPartId ?? ''} onChange={e => updateTargetPart(e.target.value)}><option value="">No target part</option>{project.partOrder.map(id => <option key={id} value={id}>{project.parts[id].name}</option>)}</select>
                <select aria-label="Mechanism target path" className="field" value={selectedMechanism.targetPathId ?? ''} onChange={e => updateMechanism(selectedMechanism.id, { targetPathId: e.target.value || undefined })}><option value="">No target path</option>{Object.values(project.paths).filter(p => !selectedMechanism.targetPartId || p.partId === selectedMechanism.targetPartId).map(p => <option key={p.id} value={p.id}>{p.id} · {p.points.length} pts</option>)}</select>
                {selectedMechanism.targetPartId && project.skeleton && <select aria-label="Mechanism target anchor" className="field" value={selectedTargetAnchor ?? ''} onChange={e => updateMechanism(selectedMechanism.id, { targetAnchorJointId: e.target.value || undefined })}>
                    <option value="">Part anchor default</option>
                    {targetAnchorOptions.map(id => <option key={id} value={id}>{motionChainOptionLabel(project, selectedMechanism.targetPartId, id)}</option>)}
                </select>}
                {selectedTargetChain && <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-slate-600" data-testid="mechanism-ik-chain-summary" title={selectedTargetChain.helper}>
                    <div className="font-bold text-slate-800">{selectedTargetChain.label}</div>
                </div>}
                <div className="section-title">Parameters</div>
                {PARAMS.filter(p => showParam(selectedMechanism.type, p.key)).map(p => <React.Fragment key={String(p.key)}><MiniNumber label={p.label} value={Number(selectedMechanism[p.key] ?? 0)} min={p.min} max={p.max} step={p.step} onChange={value => updateMechanism(selectedMechanism.id, { [p.key]: value } as Partial<MechanismConfig>)}/></React.Fragment>) }
                {selectedBindingWarnings.map((w, i) => <div className="warning" key={`binding-${w}-${i}`}>{w}</div>)}
                {selectedRange?.warning && <div className="warning">{selectedRange.warning}</div>}
                {selectedMechanism.warnings?.map((w, i) => <div className="warning" key={`${w}-${i}`}>{w}</div>)}
                <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={optimizerBusy} onClick={onOptimize}>{optimizerBusy ? <Loader2 className="animate-spin" size={16}/> : <Sparkles size={16}/>} Fit path</button><button className="btn-secondary" onClick={() => dispatch({ type: 'delete_mechanism', mechanismId: selectedMechanism.id })}><Trash2 size={16}/> Delete</button></div>
                <div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={exportSvg}>SVG</button><button className="btn-secondary" onClick={exportDxf}>DXF</button><button className="btn-primary" aria-label="Export Blueprint" onClick={onBlueprint}>Blueprint</button></div>
            </>}
        </div>)
        }}
    />;
};

const AssemblyGuide = ({ project, dispatch, goStage }: {
    project: ProjectState;
    dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void;
    goStage: (stage: AppStage) => void;
}) => {
    const validation = validateForFabrication(project);
    const create = () => dispatch({ type: 'set_export', fabricationPackage: createFabricationPackage(project) });
    const pkg = project.lastExport;
    const activeMechanisms = project.mechanisms.filter(m => m.visible && m.enabled !== false);
    const recipes = pkg?.recipes ?? activeMechanisms.map(mechanism => pendingRecipeForMechanism(project, mechanism));
    const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
    const selectedRecipe = recipes.find(recipe => recipe.mechanismId === selectedRecipeId) ?? recipes[0];
    const [lane, setLane] = useState<AssemblyLane>(() => assemblyLaneForExportMode(project.settings.physicalKit.exportMode));
    const [stepIndex, setStepIndex] = useState(0);
    const [stepProgress, setStepProgress] = useState(0);
    const stepProgressRef = useRef(0);
    const [playing, setPlaying] = useState(false);
    const playbackSteps = selectedRecipe ? buildAssemblyPlaybackSteps(selectedRecipe, lane) : [];
    const currentStep = playbackSteps[Math.min(stepIndex, Math.max(0, playbackSteps.length - 1))];
    const goAssemblyStep = (next: number | ((index: number) => number)) => {
        stepProgressRef.current = 0;
        setStepProgress(0);
        setStepIndex(index => typeof next === 'function' ? next(index) : next);
    };
    useEffect(() => {
        stepProgressRef.current = 0;
        setStepIndex(0);
        setStepProgress(0);
        setPlaying(false);
    }, [selectedRecipe?.mechanismId, lane]);
    useEffect(() => {
        if (!playing || playbackSteps.length < 2) return;
        let frame = 0;
        let last = performance.now();
        const stepMs = 1400;
        const tick = (time: number) => {
            const delta = Math.min(120, time - last);
            last = time;
            const next = stepProgressRef.current + delta / stepMs;
            if (next >= 1) {
                stepProgressRef.current = 0;
                setStepProgress(0);
                setStepIndex(index => index >= playbackSteps.length - 1 ? 0 : index + 1);
            } else {
                stepProgressRef.current = next;
                setStepProgress(next);
            }
            frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [playing, playbackSteps.length]);
    const downloadAssemblyPdf = () => pkg && downloadText(`${pkg.id}-assembly.pdf`, pkg.assemblyGuidePdf, 'application/pdf');
    const printGuide = () => {
        if (!pkg) return;
        const popup = window.open('', '_blank');
        if (popup) {
            popup.document.write(pkg.assemblyGuideHtml);
            popup.document.close();
            popup.focus();
            popup.print();
            return;
        }
        downloadText(`${pkg.id}-assembly.html`, pkg.assemblyGuideHtml, 'text/html');
    };
    return <EditorStageFrame
        stage="assembly"
        className="assembly-stage-frame"
        layout={{
            workflow: workflowPane(<div className="stage-pane-stack" data-testid="assembly-control-panel">
            <StageLeftSummary project={project} title="Assembly" stage="assembly" goStage={goStage}>
                <h3>Build</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                    <button className="btn-secondary" onClick={() => goStage('blueprint')}>Blueprint</button>
                    <button className="btn-primary" aria-label={pkg ? 'Print guide' : 'Generate package'} disabled={!!validation.errors.length} onClick={pkg ? printGuide : create}>{pkg ? 'Print guide' : 'Generate'}</button>
                    {pkg && <button className="btn-secondary" onClick={downloadAssemblyPdf}>PDF</button>}
                </div>
                <div className="mt-4 flex flex-wrap gap-2" data-testid="assembly-lane-switch">
                    <button className={lane === 'kit' ? 'chip active' : 'chip'} disabled={project.settings.physicalKit.exportMode === 'custom-parts'} onClick={() => setLane('kit')}>Kit board</button>
                    <button className={lane === 'custom' ? 'chip active' : 'chip'} disabled={project.settings.physicalKit.exportMode === 'prefab-board'} onClick={() => setLane('custom')}>Custom parts</button>
                </div>
                <div className="mt-5 grid gap-2">
                    {recipes.map(recipe => <button key={recipe.mechanismId} type="button" className={`assembly-recipe-card text-left ${selectedRecipe?.mechanismId === recipe.mechanismId ? 'ring-2 ring-inset' : ''}`} onClick={() => setSelectedRecipeId(recipe.mechanismId)}>
                        <div className="font-bold text-slate-800">{recipe.mechanismId} · {referenceRecipeForType(recipe.type).title}</div>
                        <div className="text-sm text-slate-600">Board {fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board)}</div>
                    </button>)}
                </div>
                {playbackSteps.length > 0 && <div className="mt-4 rounded-2xl bg-white p-3 shadow-sm" data-testid="assembly-step-list">
                    <div className="section-title">Steps</div>
                    <div className="mt-2 grid gap-1">
                        {playbackSteps.map((step, index) => <button key={`${step.phase}-${step.index}`} className={`assembly-step-button ${index === stepIndex ? 'active' : ''}`} onClick={() => goAssemblyStep(index)}>
                            <span>{step.index}</span>{step.label}
                        </button>)}
                    </div>
                </div>}
            </StageLeftSummary>
        </div>),
            canvas: canvasPane(<div className="assembly-canvas-document canvas-workspace" data-testid="assembly-canvas-preview">
            {pkg && selectedRecipe && currentStep ? <>
                <AssemblyWorkbench recipe={selectedRecipe} lane={lane} step={currentStep} kit={project.settings.physicalKit} progress={stepProgress}/>
                <aside className="assembly-player-overlay" data-testid="assembly-player-overlay">
                    <button aria-label={playing ? 'Pause assembly' : 'Play assembly'} onClick={() => setPlaying(!playing)}>{playing ? 'Ⅱ' : '▶'}</button>
                    <button aria-label="Previous assembly step" onClick={() => goAssemblyStep(index => Math.max(0, index - 1))}>←</button>
                    <button aria-label="Next assembly step" data-testid="assembly-next-step" onClick={() => goAssemblyStep(index => Math.min(playbackSteps.length - 1, index + 1))}>→</button>
                    <input aria-label="Assembly scrubber" type="range" min={0} max={Math.max(0, playbackSteps.length - 1)} value={stepIndex} onChange={event => goAssemblyStep(Number(event.currentTarget.value))}/>
                    <span>{currentStep.index}/{playbackSteps.length}</span>
                </aside>
            </> : <div className="blueprint-empty-state">Generate first.</div>}
        </div>),
            inspector: inspectorPane(<section className="stage-pane-stack" data-testid="assembly-guide-preview">
            <div>
                <div className="section-title">Assembly step</div>
                <h3>{currentStep?.label ?? 'Assembly'}</h3>
            </div>
            {selectedRecipe ? <article className="assembly-recipe-card" data-testid={`assembly-recipe-${selectedRecipe.mechanismId}`}>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="font-bold text-slate-800">{selectedRecipe.mechanismId} · {referenceRecipeForType(selectedRecipe.type).title}</div>
                        <div className="text-sm text-slate-600">Board {fabricationBoardCoordinateCallout(selectedRecipe.boardCoordinate, selectedRecipe.board)}</div>
                        <div className="text-xs text-slate-500">Target {selectedRecipe.targetPartName ?? selectedRecipe.targetPartId ?? 'unbound'} · path {selectedRecipe.targetPathId ?? 'none'} · anchor {selectedRecipe.targetAnchorJointId ?? 'part default'}</div>
                    </div>
                    <button className="chip" onClick={() => goStage('design')}>Edit</button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">{selectedRecipe.requiredParts.map(part => <span className="blueprint-pill" key={`${selectedRecipe.mechanismId}-${part.name}`}>{fabricationPartDisplayLabel(part.name)} × {part.quantity}</span>)}</div>
                <div className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm font-bold text-slate-700" data-testid="assembly-stack-summary">Stack: {readableFabricationStackSummary(selectedRecipe)}</div>
                {selectedRecipe.warnings.length ? <div className="warning mt-3">Warnings: {selectedRecipe.warnings.join('; ')}</div> : <div className="ok mt-3">No warnings</div>}
                {currentStep && <div className="mt-3 rounded-2xl bg-white p-3 shadow-sm" data-testid="prefab-assembly-steps">
                    <div className="section-title">Current step</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <span className="blueprint-pill">{currentStep.phase}</span>
                        {currentStep.coords.map((coord, index) => <span className="blueprint-pill" key={`${coord}-${index}`}>{fabricationBoardCoordinateCallout(coord)} · {currentStep.coordRoles[index] ?? 'ref'}</span>)}
                        <span className="blueprint-pill">Z {currentStep.zMm.toFixed(1)}mm</span>
                    </div>
                    <p className="mt-3 text-sm text-slate-600">{currentStep.instruction}</p>
                    {currentStep.check && <div className="ok mt-3">Check: {currentStep.check}</div>}
                </div>
                }
            </article> : <div className="warning">Generate first.</div>}
        </section>)
        }}
    />;
};

const Options = ({ project, dispatch, goStage }: { project: ProjectState; dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void; goStage: (stage: AppStage) => void }) => {
    const kit = project.settings.physicalKit;
    const updateSettings = (settings: Partial<ProjectState['settings']>) => dispatch({ type: 'update_settings', settings });
    const updateKit = (physicalKit: Partial<ProjectState['settings']['physicalKit']>) => updateSettings({ physicalKit: { ...kit, ...physicalKit } });
    const durationSeconds = Number((project.settings.animationDurationMs / 1000).toFixed(1));
    const unitSummary = formatGridReadout(kit, project.settings.gridUnit);
    return <EditorStageFrame
        stage="options"
        className="options-stage-frame"
        layout={{
            workflow: workflowPane(<div className="stage-pane-stack">
            <StageLeftSummary project={project} title="Options" stage="options" goStage={goStage}>
                <h3>Settings</h3>
                <div className="stage-option-list">
                    {OPTIONS_SECTION_MANIFEST.map(section => <a key={section.id} className="workspace-side-link" href={`#${section.id}`}>{section.label === 'Fabrication / Blueprint export' ? 'Fabrication' : section.label}</a>)}
                </div>
            </StageLeftSummary>
        </div>),
            canvas: canvasPane(<div className="path-canvas-shell options-preview-shell workspace overflow-hidden p-6">
            <svg viewBox="0 0 640 420" className="options-preview-canvas w-full h-full" role="img" aria-label="Options preview canvas">
                <defs>
                    <pattern id="options-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#e2e8f0" strokeWidth="1"/></pattern>
                </defs>
                <rect x="34" y="24" width="572" height="372" rx="24" fill="white" stroke="#d6dbe8"/>
                <rect x="34" y="24" width="572" height="372" rx="24" fill="url(#options-grid)" opacity=".9"/>
                <text x="58" y="64" fill="#94a3b8" fontSize="18" fontWeight="800">{formatGridLabel(project.settings.physicalKit, project.settings.gridUnit)}</text>
                <g transform="translate(300 210)">
                    <rect x="-70" y="-90" width="140" height="180" rx="32" fill="#cbd5e1" opacity=".55"/>
                    <circle cx="0" cy="-115" r="38" fill="#d8dee8"/>
                    <path d="M 70 -52 C 142 -24 122 58 78 94" fill="none" stroke="#8b5cf6" strokeWidth="8" strokeLinecap="round"/>
                    <path d="M -70 -54 C -126 -18 -116 60 -68 94" fill="none" stroke="#10b981" strokeWidth="6" strokeLinecap="round" opacity=".7"/>
                </g>
                <text x="58" y="362" fill="#64748b" fontSize="14" fontWeight="800">{project.settings.theme} theme · {project.settings.animationSpeed.toFixed(1)}x speed · {project.settings.physicalKit.defaultExportFormat} export</text>
            </svg>
        </div>),
            inspector: inspectorPane(<div className="options-workspace stage-pane-stack">
        <section className="workspace space-y-5 p-6">
            <div>
                <div className="section-title">Options</div>
                <h3>Settings</h3>
            </div>
            <SettingsSection section={optionSection('appearance')}>
                <SelectField label="Theme" value={project.settings.theme} onChange={theme => updateSettings({ theme: theme as ProjectState['settings']['theme'] })}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="blueprint">Blueprint tint</option>
                </SelectField>
                <Toggle label="Show toolbar" checked={project.settings.toolbarVisible} onChange={toolbarVisible => updateSettings({ toolbarVisible })}/>
                <Toggle label="Show Part Properties Panel" checked={project.settings.partPanelVisible} onChange={partPanelVisible => updateSettings({ partPanelVisible })}/>
            </SettingsSection>
            <SettingsSection section={optionSection('simulation')}>
                <MiniNumber label="Animation speed" value={project.settings.animationSpeed} min={0.1} max={5} step={0.1} onChange={animationSpeed => updateSettings({ animationSpeed })}/>
                <MiniNumber label="Animation Duration" value={durationSeconds} min={0.1} max={60} step={0.1} onChange={seconds => updateSettings({ animationDurationMs: Math.round(seconds * 1000) })}/>
                <SelectField label="Timing profile" value={project.settings.timingProfile} onChange={timingProfile => updateSettings({ timingProfile: timingProfile as ProjectState['settings']['timingProfile'] })}>
                    <option value="linear">Linear · steady preview</option>
                    <option value="ease-in">Ease-In · slower start</option>
                    <option value="ease-out">Ease-Out · faster finish</option>
                    <option value="ease-in-out">Ease-In-Out · gentle loop</option>
                    <option value="realtime">Realtime legacy</option>
                    <option value="slow">Slow inspection legacy</option>
                    <option value="presentation">Presentation legacy</option>
                </SelectField>
                <MiniNumber label="Simulation friction μ" value={project.settings.simulationFriction} min={0} max={2} step={0.01} onChange={simulationFriction => updateSettings({ simulationFriction })}/>
                <MiniNumber label="Simulation mass kg" value={project.settings.simulationMassKg} min={0.05} max={10} step={0.05} onChange={simulationMassKg => updateSettings({ simulationMassKg })}/>
            </SettingsSection>
        </section>
        <section className="space-y-5">
            <SettingsSection section={optionSection('performance')}>
                <SelectField label="Performance preset" value={project.settings.performancePreset} onChange={performancePreset => updateSettings({ performancePreset: performancePreset as ProjectState['settings']['performancePreset'] })}>
                    <option value="fast">Fast · fewer fit samples</option>
                    <option value="balanced">Balanced</option>
                    <option value="high">High · more fit samples</option>
                </SelectField>
                <SelectField label="Physics snap mode" value={project.settings.physicsSnapMode} onChange={physicsSnapMode => updateSettings({ physicsSnapMode: physicsSnapMode as ProjectState['settings']['physicsSnapMode'] })}>
                    <option value="fast">Fast · forgiving snap tolerance</option>
                    <option value="balanced">Balanced</option>
                    <option value="high">High · strict board-hole snap</option>
                </SelectField>
            </SettingsSection>
            <SettingsSection section={optionSection('debugging')}>
                <Toggle label="Debug visuals" checked={project.settings.debugVisuals} onChange={debugVisuals => updateSettings({ debugVisuals })}/>
                <Toggle label="Processing details" checked={project.settings.detailedProcessingSteps} onChange={detailedProcessingSteps => updateSettings({ detailedProcessingSteps })}/>
            </SettingsSection>
            <SettingsSection section={optionSection('workflow')}>
                <Toggle label="Enable autosave" checked={project.settings.autosave} onChange={autosave => updateSettings({ autosave })}/>
                <MiniNumber label="Autosave interval seconds" value={project.settings.autosaveIntervalSeconds} min={1} max={600} step={1} disabled={!project.settings.autosave} onChange={autosaveIntervalSeconds => updateSettings({ autosaveIntervalSeconds })}/>
            </SettingsSection>
            <SettingsSection section={optionSection('fabrication')}>
                <SelectField label="Export workflow" value={kit.exportMode} onChange={exportMode => updateKit({ exportMode: exportMode as ProjectState['settings']['physicalKit']['exportMode'] })}>
                    <option value="both">Both · custom parts + prefab board</option>
                    <option value="custom-parts">Custom parts only · SVG/PDF/STL</option>
                    <option value="prefab-board">Prefab board kit only · 15×15 assembly</option>
                </SelectField>
                <SelectField label="Default export format" value={kit.defaultExportFormat} onChange={defaultExportFormat => updateKit({ defaultExportFormat: defaultExportFormat as ProjectState['settings']['physicalKit']['defaultExportFormat'] })}>
                    <option value="both">Export SVG + JSON</option>
                    <option value="svg">Export SVG only</option>
                    <option value="json">Export JSON only</option>
                </SelectField>
                <SelectField label="Cut-sheet file type" value={kit.cutSheetFileType} onChange={cutSheetFileType => updateKit({ cutSheetFileType: cutSheetFileType as ProjectState['settings']['physicalKit']['cutSheetFileType'] })}>
                    <option value="pdf">PDF default</option>
                    <option value="svg">SVG</option>
                </SelectField>
                <Toggle label="Strict fabrication validation" checked={project.settings.fabricationReadyMode} onChange={fabricationReadyMode => updateSettings({ fabricationReadyMode })}/>
                <SelectField label="Board profile" value={kit.profileKey} onChange={profileKey => updateSettings({ physicalKit: physicalKitPreset(profileKey, kit) })}>
                    <option value="letter-15x15-2cm">Letter paper · 15×15 board holes · 2cm pitch</option>
                    <option value="letter-12x12-2cm">Letter paper · 12×12 draft board · 2cm pitch</option>
                    <option value="custom">Custom profile</option>
                </SelectField>
                <MiniNumber label="Grid pitch mm" value={kit.gridPitchMm} min={5} max={50} step={1} onChange={gridPitchMm => updateKit({ gridPitchMm, profileKey: kit.profileKey === 'custom' ? 'custom' : kit.profileKey })}/>
                <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600" data-testid="grid-cell-readout">
                    <div className="font-bold text-slate-800">Grid cell size</div>
                    <div>{unitSummary}</div>
                    <div>{kit.boardCells}×{kit.boardCells} board holes · {kit.sheetWidthMm.toFixed(1)}×{kit.sheetHeightMm.toFixed(1)}mm sheet</div>
                </div>
            </SettingsSection>
            <SettingsSection section={optionSection('units')}>
                <SelectField label="Grid unit system" value={project.settings.gridUnit} onChange={gridUnit => updateSettings({ gridUnit: gridUnit as ProjectState['settings']['gridUnit'] })}>
                    <option value="cm">Centimeters</option>
                    <option value="inch">Inches</option>
                    <option value="px">Scene pixels</option>
                </SelectField>
            </SettingsSection>
        </section>

        </div>)
        }}
    />;
};

const SettingsSection = ({ section, children }: { section: OptionsSectionMeta; children: React.ReactNode }) => <section id={section.id} className="workspace settings-section space-y-3 p-5" data-testid={`options-${section.id}`} aria-label={section.label}>
    <div>
        <div className="section-title" title={section.description}>{section.label}</div>
    </div>
    <div className="space-y-3">{children}</div>
</section>;

const SelectField = ({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) => <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
    <span>{label}</span>
    <select aria-label={label} className="field mt-1" value={value} onChange={e => onChange(e.target.value)}>{children}</select>
</label>;

const MiniNumber = ({ label, value, min, max, step = 1, disabled = false, onChange }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (v: number) => void }) => <label className={`block ${disabled ? 'opacity-50' : ''}`}><div className="mb-1 flex justify-between text-xs font-black uppercase tracking-wider text-slate-500"><span>{label}</span><span>{Number(value).toFixed(step < 1 ? 2 : 0)}</span></div><input aria-label={`${label} slider`} className="w-full" type="range" min={min} max={max} step={step} disabled={disabled} value={Number.isFinite(value) ? value : 0} onChange={e => onChange(Number(e.target.value))}/><input aria-label={`${label} number`} className="field mt-1" type="number" min={min} max={max} step={step} disabled={disabled} value={Number.isFinite(value) ? value : 0} onChange={e => onChange(Number(e.target.value))}/></label>;
const Toggle = ({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) => <label className={`flex items-center justify-between rounded-2xl bg-slate-100 px-3 py-2 text-sm font-bold ${disabled ? 'opacity-50' : ''}`}><span>{label}</span><input type="checkbox" disabled={disabled} checked={checked} onChange={e => onChange(e.target.checked)} /></label>;

const CAM_PROFILE_MIN = 0.35;
const CAM_PROFILE_MAX = 1.65;
const clampCamProfileSample = (value: number) => Math.max(CAM_PROFILE_MIN, Math.min(CAM_PROFILE_MAX, value));
const CamProfileEditor = ({ samples, onChange }: { samples?: number[]; onChange: (samples: number[]) => void }) => {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const activeIndexRef = useRef<number | null>(null);
    const profile = useMemo(() => normalizeCamProfileSamples(samples), [samples]);
    const width = 240;
    const height = 88;
    const pad = 12;
    const sampleToY = (value: number) => pad + (1 - ((value - CAM_PROFILE_MIN) / (CAM_PROFILE_MAX - CAM_PROFILE_MIN))) * (height - pad * 2);
    const pointX = (index: number) => pad + (index / Math.max(1, profile.length - 1)) * (width - pad * 2);
    const eventIndex = (event: React.PointerEvent<SVGElement>) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return activeIndexRef.current ?? 0;
        const t = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
        return Math.max(0, Math.min(profile.length - 1, Math.round(t * (profile.length - 1))));
    };
    const eventValue = (event: React.PointerEvent<SVGElement>) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return profile[activeIndexRef.current ?? 0] ?? 1;
        const t = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
        return clampCamProfileSample(CAM_PROFILE_MAX - t * (CAM_PROFILE_MAX - CAM_PROFILE_MIN));
    };
    const updatePoint = (index: number, value: number) => onChange(profile.map((sample, sampleIndex) => sampleIndex === index ? clampCamProfileSample(value) : sample));
    const profilePath = profile.map((value, index) => `${index === 0 ? 'M' : 'L'} ${pointX(index).toFixed(1)} ${sampleToY(value).toFixed(1)}`).join(' ');
    return <div className="rounded-2xl border border-slate-200 bg-white/80 p-3" data-testid="cam-profile-editor">
        <div className="mb-2 flex items-center justify-between">
            <div className="section-title">Cam profile</div>
            <button type="button" className="btn-secondary compact" data-testid="cam-profile-reset" onClick={() => onChange(defaultCamProfileSamples(profile.length))}>Reset</button>
        </div>
        <svg
            ref={svgRef}
            data-testid="cam-profile-canvas"
            className="w-full touch-none rounded-xl bg-slate-50"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Editable cam lift profile"
            onPointerDown={event => {
                event.preventDefault();
                const index = eventIndex(event);
                activeIndexRef.current = index;
                event.currentTarget.setPointerCapture(event.pointerId);
                updatePoint(index, eventValue(event));
            }}
            onPointerMove={event => {
                const index = activeIndexRef.current;
                if (index === null) return;
                event.preventDefault();
                updatePoint(index, eventValue(event));
            }}
            onPointerUp={() => { activeIndexRef.current = null; }}
            onPointerLeave={() => { activeIndexRef.current = null; }}
        >
            <path d={`M ${pad} ${height - pad} H ${width - pad}`} stroke="#cbd5e1" strokeWidth="2" />
            <path d={profilePath} fill="none" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {profile.map((value, index) => <circle
                key={index}
                data-testid={`cam-profile-point-${index}`}
                cx={pointX(index)}
                cy={sampleToY(value)}
                r={5}
                fill="#ffffff"
                stroke="#4f46e5"
                strokeWidth="2"
                onPointerDown={event => {
                    event.preventDefault();
                    activeIndexRef.current = index;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    updatePoint(index, eventValue(event));
                }}
            />)}
        </svg>
    </div>;
};

const showParam = (type: MechanismType, key: keyof MechanismConfig) => {
    if (key === 'speed2') return type === '5bar';
    if (key === 'phase') return ['5bar', 'gear', 'gear_linkage', 'planetary_gear'].includes(type);
    if (key === 'gearRatio') return false;
    if (key === 'rodLength') return ['5bar', '6bar', 'piston'].includes(type);
    if (key === 'groundLength') return !['cam', 'yoke', 'rack-pinion', 'gear', 'gear_linkage', 'planetary_gear'].includes(type);
    if (key === 'couplerLength') return !['cam', 'gear', 'planetary_gear', 'yoke', 'rack-pinion'].includes(type);
    return true;
};

type ThreeFoundryPreviewProps = {
    mechanism: MechanismConfig;
    simulation: ReturnType<typeof fitMechanismSimulation>;
    kit: PhysicalKitSettings;
    camera: FoundryCamera;
    rigOpacity: number;
    color: string;
    pathPoints: Point[];
    showGrid: boolean;
    showPathPreview: boolean;
    showTrail: boolean;
    showForces: boolean;
    showVelocity: boolean;
    physicsRule: string;
    velocityMagnitude: number;
    forceMagnitude: number;
    frictionCoefficient: number;
    frictionMagnitude: number;
    constraintError: number;
    cameraLabel: string;
    isPickingAnchor: boolean;
    isOrbiting: boolean;
    isZooming: boolean;
    isPanning: boolean;
    onAnchorPick: (point: Point) => void;
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onPointerMove: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp: React.PointerEventHandler<HTMLDivElement>;
    onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
    onWheel: React.WheelEventHandler<HTMLDivElement>;
    onProjectionSizeChange: (size: FoundryOverlaySize) => void;
    children: React.ReactNode;
};

const foundryRenderedInventory = (type: MechanismType) => {
    const fallback = ({
        '4bar': { parts: 5, holes: 15, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
        piston: { parts: 6, holes: 15, slots: 1, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
        yoke: { parts: 7, holes: 15, slots: 2, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
        'quick-return': { parts: 6, holes: 15, slots: 1, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
        '5bar': { parts: 7, holes: 25, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
        '6bar': { parts: 7, holes: 25, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
        cam: { parts: 8, holes: 16, slots: 1, gears: 0, racks: 0, cams: 1, followers: 1, endStops: 0 },
        'rack-pinion': { parts: 10, holes: 20, slots: 1, gears: 1, racks: 1, cams: 0, followers: 0, endStops: 2 },
        gear: { parts: 8, holes: 29, slots: 0, gears: 2, racks: 0, cams: 0, followers: 0, endStops: 0 },
        gear_linkage: { parts: 9, holes: 31, slots: 0, gears: 2, racks: 0, cams: 0, followers: 0, endStops: 0 },
        planetary_gear: { parts: 7, holes: 18, slots: 0, gears: 3, racks: 0, cams: 0, followers: 0, endStops: 0 },
        crank: { parts: 5, holes: 15, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 }
    }[type]);
    const referenceHoleCount = referenceRequiredPartsHoleCount(mechanismRequiredParts({ type }));
    return referenceHoleCount ? { ...fallback, holes: referenceHoleCount } : fallback;
};

const foundryAssemblyPinPoints = (type: MechanismType, state: ReturnType<typeof calculateLinkage>): Point[] => {
    const compact = (points: Array<Point | undefined>) => points.filter(Boolean) as Point[];
    if (type === '4bar') return compact([state.p1, state.j1, state.j2, state.p2]);
    if (type === '5bar' || type === '6bar') return compact([state.p1, state.j1, state.j2, state.aux, state.p2]);
    if (type === 'cam' || type === 'piston' || type === 'rack-pinion' || type === 'yoke' || type === 'quick-return') return compact([state.p1, state.j1, state.j2]);
    if (type === 'planetary_gear') return compact([state.p1, state.p2, state.j2]);
    return compact([state.p1, state.p2, state.j1, state.j2, state.aux, state.effector]);
};

const foundryAssemblyPinContract = (type: MechanismType) => {
    if (type === '4bar') return 'reference-A-B-C-D-only';
    if (type === '5bar' || type === '6bar') return 'reference-ground-chain-only';
    if (type === 'cam' || type === 'piston' || type === 'rack-pinion' || type === 'yoke' || type === 'quick-return') return 'guided-output-only';
    if (type === 'planetary_gear') return 'gear-centers-and-output-only';
    return 'template-specific-output';
};

const disposeThreeObject = (object: THREE.Object3D) => object.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry && !mesh.geometry.userData.foundryCached) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(item => {
        if (!item.userData.foundryCached) item.dispose();
    });
    else if (material && !material.userData.foundryCached) material.dispose();
});

const ThreeFoundryPreview = ({ mechanism, simulation, kit, camera, rigOpacity, color, pathPoints, showGrid, showPathPreview, showTrail, showForces, showVelocity, physicsRule, velocityMagnitude, forceMagnitude, frictionCoefficient, frictionMagnitude, constraintError, cameraLabel, isPickingAnchor, isOrbiting, isZooming, isPanning, onAnchorPick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onWheel, onProjectionSizeChange, children }: ThreeFoundryPreviewProps) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const stateRef = useRef<HTMLDivElement | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const cameraStateRef = useRef(camera);
    const dynamicBuildCountRef = useRef(0);
    const geometryCacheRef = useRef<Map<string, THREE.BufferGeometry>>(new Map());
    const materialCacheRef = useRef<Map<string, THREE.Material>>(new Map());
    const [physicsKernelRuntime, setPhysicsKernelRuntime] = useState<'loading' | 'ready' | 'unavailable'>('loading');
    const [physicsKernelVersion, setPhysicsKernelVersion] = useState('pending');
    const [physicsKernelError, setPhysicsKernelError] = useState('none');
    const isGearTrain = mechanism.type === 'gear' || mechanism.type === 'gear_linkage';
    const gearRadii = isGearTrain ? gearTrainPitchRadii(mechanism) : mechanism.type === 'planetary_gear' ? planetaryGearRadii(mechanism) : [mechanism.crankLength, mechanism.rockerLength];
    const gearCenters = isGearTrain ? gearTrainCenters(mechanism) : [];
    const planetaryConvention = mechanism.type === 'planetary_gear' ? planetaryGearConventionForMechanism(mechanism) : null;
    const baseInv = foundryRenderedInventory(mechanism.type);
    const inv = isGearTrain
        ? { ...baseInv, gears: gearRadii.length, parts: Math.max(baseInv.parts, gearRadii.length + 4) }
        : mechanism.type === 'planetary_gear'
            ? { ...baseInv, gears: gearRadii.length, parts: Math.max(baseInv.parts, gearRadii.length + 4) }
            : baseInv;
    const pinionRotation = Math.atan2(simulation.state.j1.y - simulation.state.p1.y, simulation.state.j1.x - simulation.state.p1.x) * 180 / Math.PI;
    const renderPlan = useMemo(() => fabricationRenderPlanForMechanism(mechanism), [mechanism]);
    const viewerContract = useMemo(() => createViewer3DContract('foundry', camera.preset, {
        grid: showGrid,
        character: 'absent',
        skeleton: 'absent',
        mechanisms: true,
        paths: showPathPreview,
        forces: showForces,
        velocity: showVelocity,
        trail: showTrail
    }), [camera.preset, showForces, showGrid, showPathPreview, showTrail, showVelocity]);
    const spacerLayerCount = renderPlan.layers.filter(item => item.role === 'spacer').length;
    const assemblyPinPoints = foundryAssemblyPinPoints(mechanism.type, simulation.state);
    const assemblyPinContract = foundryAssemblyPinContract(mechanism.type);
    const spacerRenderCount = spacerLayerCount * assemblyPinPoints.length;
    const stackZGap = renderPlan.layers.length > 1 ? renderPlan.layers[1].z - renderPlan.layers[0].z : 0;
    useEffect(() => {
        let active = true;
        loadRapierPhysicsKernel()
            .then(kernel => {
                if (!active) return;
                setPhysicsKernelRuntime('ready');
                setPhysicsKernelVersion(kernel.version());
                setPhysicsKernelError('none');
            })
            .catch(error => {
                if (!active) return;
                setPhysicsKernelRuntime('unavailable');
                setPhysicsKernelVersion('unavailable');
                setPhysicsKernelError(physicsKernelErrorMessage(error));
            });
        return () => { active = false; };
    }, []);

    const renderCamera = (view: FoundryCamera) => {
        const scene = sceneRef.current;
        const renderer = rendererRef.current;
        const cam = cameraRef.current;
        if (!scene || !renderer || !cam) return;
        cam.position.copy(foundryCameraPosition(view));
        cam.lookAt(foundryCameraTarget(view));
        renderer.render(scene, cam);
    };
    const handleAnchorClick: React.MouseEventHandler<HTMLDivElement> = event => {
        if (!isPickingAnchor) return;
        const renderer = rendererRef.current;
        const cam = cameraRef.current;
        if (!renderer || !cam) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const pointer = new THREE.Vector2(
            ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
            -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1)
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, cam);
        const hit = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit)) return;
        const previewX = 180 + hit.x * 18;
        const previewY = 120 - hit.y * 18;
        onAnchorPick({ x: ((previewX / 360) - 0.5) * SCENE_VIEW.width, y: (0.5 - (previewY / 240)) * SCENE_VIEW.height });
    };

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, WEBGL_PIXEL_RATIO_CAP));
        renderer.shadowMap.enabled = false;
        renderer.domElement.className = 'foundry-three-canvas';
        renderer.domElement.dataset.testid = 'foundry-three-canvas';
        host.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#f8f9ff');
        const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
        scene.add(new THREE.AmbientLight(0xffffff, 1.8));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(6, 8, 10);
        key.castShadow = true;
        scene.add(key);
        const staticRoot = new THREE.Group();
        staticRoot.name = 'foundry-static';
        const grid = new THREE.GridHelper(24, 24, '#c7d2fe', '#e2e8f0');
        grid.rotation.x = Math.PI / 2;
        grid.position.z = -0.9;
        staticRoot.add(grid);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(26, 16), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, transparent: true, opacity: 0.72 }));
        plane.receiveShadow = true;
        plane.position.z = -0.94;
        staticRoot.add(plane);
        scene.add(staticRoot);
        sceneRef.current = scene;
        rendererRef.current = renderer;
        cameraRef.current = cam;
        const resize = () => {
            const width = Math.max(1, host.clientWidth);
            const height = Math.max(1, host.clientHeight);
            onProjectionSizeChange({ width, height });
            renderer.setSize(width, height, false);
            cam.aspect = width / height;
            cam.updateProjectionMatrix();
            renderCamera(cameraStateRef.current);
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(host);
        renderCamera(cameraStateRef.current);
        return () => {
            ro.disconnect();
            renderer.dispose();
            if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
            disposeThreeObject(scene);
            geometryCacheRef.current.forEach(geometry => geometry.dispose());
            materialCacheRef.current.forEach(material => material.dispose());
            geometryCacheRef.current.clear();
            materialCacheRef.current.clear();
        };
    }, []);

    useEffect(() => {
        cameraStateRef.current = camera;
        renderCamera(camera);
    }, [camera]);

    useEffect(() => {
        const scene = sceneRef.current;
        const staticRoot = scene?.getObjectByName('foundry-static');
        if (!staticRoot) return;
        staticRoot.visible = showGrid;
        renderCamera(cameraStateRef.current);
    }, [showGrid]);

    useEffect(() => {
        const scene = sceneRef.current;
        const renderer = rendererRef.current;
        const cam = cameraRef.current;
        if (!scene || !renderer || !cam) return;
        const old = scene.getObjectByName('foundry-dynamic');
        if (old) {
            scene.remove(old);
            disposeThreeObject(old);
        }
        const root = new THREE.Group();
        root.name = 'foundry-dynamic';
        scene.add(root);
        const geometryCache = geometryCacheRef.current;
        const materialCache = materialCacheRef.current;
        const cachedGeometry = <T extends THREE.BufferGeometry>(key: string, create: () => T): T => {
            const existing = geometryCache.get(key) as T | undefined;
            if (existing) return existing;
            const geometry = create();
            geometry.userData.foundryCached = true;
            geometryCache.set(key, geometry);
            return geometry;
        };
        const cachedMaterial = <T extends THREE.Material>(key: string, create: () => T): T => {
            const existing = materialCache.get(key) as T | undefined;
            if (existing) return existing;
            const material = create();
            material.userData.foundryCached = true;
            materialCache.set(key, material);
            return material;
        };
        const materialForLayer = (colorValue: string, roughness = 0.66, metalness = 0.03) => cachedMaterial(
            `standard:${colorValue}:${roughness.toFixed(2)}:${metalness.toFixed(2)}:${rigOpacity.toFixed(3)}`,
            () => new THREE.MeshStandardMaterial({ color: colorValue, roughness, metalness, transparent: rigOpacity < 0.995, opacity: rigOpacity })
        );
        const material = {
            base: materialForLayer(renderPlan.base.color, 0.82, 0.01),
            accent: materialForLayer('#60a5fa', 0.45, 0.08),
            hole: cachedMaterial('standard:#ffffff:0.25:0.00:1', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25 })),
            dark: materialForLayer('#334155', 0.62, 0.03),
            edge: cachedMaterial('edge:#334155:0.72', () => new THREE.LineBasicMaterial({ color: '#334155', transparent: true, opacity: 0.72 })),
            path: cachedMaterial(`path:${color}`, () => new THREE.LineDashedMaterial({ color: new THREE.Color(color), dashSize: 0.25, gapSize: 0.16, linewidth: 2 })),
            trail: cachedMaterial(`trail:${color}`, () => new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.18 }))
        };
        const to3 = (point: Point, z = 0) => new THREE.Vector3((point.x - 180) / 18, (120 - point.y) / 18, z);
        const mmToThree = SCENE_PX_PER_MM / 18;
        const thickness = Math.max(0.2, kit.holeDiameterMm / 10);
        const barW = Math.max(0.34, FABRICATION_LINKAGE_WIDTH_MM * mmToThree);
        const holeR = Math.max(0.08, FABRICATION_HOLE_RADIUS_MM * mmToThree);
        const spacerOuterR = FABRICATION_SPACER_SPEC.outerDiameterMm * mmToThree / 2;
        const spacerInnerR = FABRICATION_SPACER_SPEC.innerDiameterMm * mmToThree / 2;
        const addEdges = (mesh: THREE.Mesh, key = mesh.geometry.uuid) => {
            const edges = new THREE.LineSegments(cachedGeometry(`edges:${key}`, () => new THREE.EdgesGeometry(mesh.geometry)), material.edge);
            mesh.add(edges);
        };
        const circularHole = (x: number, y: number, r = holeR) => {
            const hole = new THREE.Path();
            hole.absellipse(x, y, r, r, 0, Math.PI * 2, true);
            return hole;
        };
        const roundedRectShape = (width: number, height: number, radius = height / 2) => {
            const r = Math.min(radius, width / 2, height / 2);
            const shape = new THREE.Shape();
            shape.moveTo(-width / 2 + r, -height / 2);
            shape.lineTo(width / 2 - r, -height / 2);
            shape.quadraticCurveTo(width / 2, -height / 2, width / 2, -height / 2 + r);
            shape.lineTo(width / 2, height / 2 - r);
            shape.quadraticCurveTo(width / 2, height / 2, width / 2 - r, height / 2);
            shape.lineTo(-width / 2 + r, height / 2);
            shape.quadraticCurveTo(-width / 2, height / 2, -width / 2, height / 2 - r);
            shape.lineTo(-width / 2, -height / 2 + r);
            shape.quadraticCurveTo(-width / 2, -height / 2, -width / 2 + r, -height / 2);
            return shape;
        };
        const addHoleRing = (group: THREE.Group, x: number, y: number, z: number) => {
            const ring = new THREE.Mesh(cachedGeometry(`hole-ring:${holeR.toFixed(3)}`, () => new THREE.TorusGeometry(holeR * 1.1, 0.025, 8, 24)), material.accent);
            ring.position.set(x, y, z + thickness / 2 + 0.025);
            group.add(ring);
        };
        const addSpacerWasher = (point: Point | undefined, z: number, mat: THREE.Material) => {
            if (!point) return;
            const p = to3(point, z);
            const geometryKey = `spacer:${spacerOuterR.toFixed(3)}:${spacerInnerR.toFixed(3)}:${thickness.toFixed(3)}`;
            const washer = new THREE.Mesh(cachedGeometry(geometryKey, () => {
                const shape = new THREE.Shape();
                shape.absellipse(0, 0, spacerOuterR, spacerOuterR, 0, Math.PI * 2, false);
                shape.holes.push(circularHole(0, 0, spacerInnerR));
                return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.012 });
            }), mat);
            washer.position.set(p.x, p.y, z - thickness / 2);
            washer.castShadow = true;
            addEdges(washer, geometryKey);
            root.add(washer);
        };
        const addClipCap = (point: Point | undefined, z: number, mat: THREE.Material) => {
            if (!point) return;
            const p = to3(point, z);
            const clip = new THREE.Mesh(cachedGeometry(`clip:${holeR.toFixed(3)}`, () => new THREE.CylinderGeometry(holeR * 1.35, holeR * 1.35, 0.08, 24)), mat);
            clip.rotation.x = Math.PI / 2;
            clip.position.copy(p);
            clip.position.z = z;
            root.add(clip);
        };
        const addBar = (a: Point | undefined, b: Point | undefined, z: number, mat: THREE.Material, holeCount = 2) => {
            if (!a || !b) return;
            const av = to3(a, z), bv = to3(b, z);
            const dx = bv.x - av.x, dy = bv.y - av.y, len = Math.hypot(dx, dy);
            if (len < 0.05) return;
            const sceneLength = Math.hypot(b.x - a.x, b.y - a.y);
            const linkageSpec = fabricationLinkageSpecForSceneLength(sceneLength, kit.gridPitchMm, holeCount);
            const templateLen = linkageSpec.lengthMm * mmToThree;
            const firstHoleX = linkageSpec.holeCentersMm[0]?.x ?? 0;
            const holeXs = linkageSpec.holeCentersMm.map(point => ((point.x - firstHoleX) - linkageSpec.lengthMm / 2) * mmToThree);
            const outlineLen = templateLen + barW;
            const group = new THREE.Group();
            group.position.set((av.x + bv.x) / 2, (av.y + bv.y) / 2, z);
            group.rotation.z = Math.atan2(dy, dx);
            const geometryKey = `bar:${linkageSpec.key}:${kit.gridPitchMm}:${outlineLen.toFixed(3)}:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
            const mesh = new THREE.Mesh(cachedGeometry(geometryKey, () => {
                const shape = roundedRectShape(outlineLen, barW);
                shape.holes.push(...holeXs.map(x => circularHole(x, 0)));
                return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.018 });
            }), mat);
            mesh.position.z = -thickness / 2;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            addEdges(mesh, geometryKey);
            group.add(mesh);
            holeXs.forEach(x => addHoleRing(group, x, 0, 0));
            root.add(group);
        };
        const shapeFromPoints = (points: Point[]) => {
            const shape = new THREE.Shape();
            points.forEach((point, index) => {
                if (index === 0) shape.moveTo(point.x, point.y);
                else shape.lineTo(point.x, point.y);
            });
            shape.closePath();
            return shape;
        };
        const addGear = (center: Point, radius: number, z: number, rotation: number, mat: THREE.Material) => {
            const r = Math.max(0.38, radius * simulation.scale / 18);
            const profile = fabricationGearProfileForPitchRadius(r, radius / SCENE_PX_PER_MM);
            const shape = shapeFromPoints(profile.outlinePoints);
            const axleHoleRadius = Math.max(holeR * 0.7, profile.axleHoleRadius);
            shape.holes.push(circularHole(0, 0, axleHoleRadius));
            profile.attachmentHoleCenters.forEach(point => shape.holes.push(circularHole(point.x, point.y, Math.max(holeR * 0.55, profile.axleHoleRadius))));
            const geometryKey = `gear:${mechanism.type}:${radius.toFixed(3)}:${simulation.scale.toFixed(3)}:${thickness.toFixed(3)}`;
            const geom = cachedGeometry(geometryKey, () => new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02 }));
            const mesh = new THREE.Mesh(geom, mat);
            const c = to3(center, z);
            mesh.position.set(c.x, c.y, z - thickness / 2);
            mesh.rotation.z = rotation * Math.PI / 180;
            mesh.castShadow = true;
            addEdges(mesh, geometryKey);
            root.add(mesh);
            const holes = new THREE.Group();
            holes.position.set(c.x, c.y, z);
            addHoleRing(holes, 0, 0, 0);
            profile.attachmentHoleCenters.forEach(point => addHoleRing(holes, point.x, point.y, 0));
            root.add(holes);
        };
        const addRingGear = (center: Point, radius: number, z: number, rotation: number, mat: THREE.Material) => {
            const r = Math.max(0.82, radius * simulation.scale / 18);
            const profile = fabricationRingGearProfileForPitchRadius(r);
            const shape = new THREE.Shape();
            shape.absellipse(0, 0, profile.outerRadius, profile.outerRadius, 0, Math.PI * 2, false);
            const inner = new THREE.Path();
            fabricationRingInnerGearOutlinePoints(r).forEach((point, index) => {
                if (index === 0) inner.moveTo(point.x, point.y);
                else inner.lineTo(point.x, point.y);
            });
            inner.closePath();
            shape.holes.push(inner);
            const mountHoleRadius = Math.max(holeR * 0.58, profile.mountHoleRadius);
            profile.mountHoleCenters.forEach(point => shape.holes.push(circularHole(point.x, point.y, mountHoleRadius)));
            const geometryKey = `ring-gear:${radius.toFixed(3)}:${simulation.scale.toFixed(3)}:${thickness.toFixed(3)}`;
            const geom = cachedGeometry(geometryKey, () => new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02 }));
            const mesh = new THREE.Mesh(geom, mat);
            const c = to3(center, z);
            mesh.position.set(c.x, c.y, z - thickness / 2);
            mesh.rotation.z = rotation * Math.PI / 180;
            mesh.castShadow = true;
            addEdges(mesh, geometryKey);
            root.add(mesh);
            const holes = new THREE.Group();
            holes.position.set(c.x, c.y, z);
            profile.mountHoleCenters.forEach(point => addHoleRing(holes, point.x, point.y, 0));
            root.add(holes);
        };
        const addCam = (center: Point, z: number, mat: THREE.Material) => {
            const r = Math.max(0.5, mechanism.crankLength * simulation.scale / 22);
            const shape = new THREE.Shape();
            for (let i = 0; i < 56; i++) {
                const a = (i / 56) * Math.PI * 2;
                const rr = r * sampledCamProfileScale(a, mechanism.camProfileSamples);
                const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
                if (i === 0) shape.moveTo(x, y);
                else shape.lineTo(x, y);
            }
            shape.closePath();
            shape.holes.push(circularHole(0, 0, holeR * 1.35));
            const geometryKey = `cam:${mechanism.crankLength.toFixed(2)}:${(mechanism.camProfileSamples ?? []).join(',')}:${simulation.scale.toFixed(3)}:${thickness.toFixed(3)}`;
            const mesh = new THREE.Mesh(cachedGeometry(geometryKey, () => new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.025 })), mat);
            const c = to3(center, z);
            mesh.position.set(c.x, c.y, z - thickness / 2);
            mesh.castShadow = true;
            addEdges(mesh, geometryKey);
            root.add(mesh);
        };
        const addSlotPlate = (center: Point, length: number, rotation: number, z: number, mat: THREE.Material) => {
            const c = to3(center, z);
            const group = new THREE.Group();
            group.position.copy(c);
            group.rotation.z = rotation;
            const geometryKey = `slot:${length.toFixed(3)}:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
            const mesh = new THREE.Mesh(cachedGeometry(geometryKey, () => {
                const shape = roundedRectShape(length, barW * 1.35, barW * 0.28);
                shape.holes.push(roundedRectShape(length * 0.7, barW * 0.46, barW * 0.23));
                return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.015 });
            }), mat);
            mesh.position.z = -thickness / 2;
            mesh.castShadow = true;
            addEdges(mesh, geometryKey);
            group.add(mesh);
            root.add(group);
        };
        const addFollowerBlock = (center: Point, z: number, mat: THREE.Material) => {
            const c = to3(center, z);
            const group = new THREE.Group();
            group.position.copy(c);
            const blockKey = `follower-block:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
            const block = new THREE.Mesh(cachedGeometry(blockKey, () => new THREE.BoxGeometry(barW * 1.45, barW * 1.8, thickness)), mat);
            addEdges(block, blockKey);
            group.add(block);
            const roller = new THREE.Mesh(cachedGeometry(`follower-roller:${holeR.toFixed(3)}:${thickness.toFixed(3)}`, () => new THREE.CylinderGeometry(holeR * 1.3, holeR * 1.3, thickness * 1.18, 28)), material.accent);
            roller.position.set(0, -barW * 0.74, 0.04);
            roller.rotation.x = Math.PI / 2;
            group.add(roller);
            root.add(group);
        };
        const addEndStop = (center: Point, offset: number, z: number) => {
            const c = to3(center, z);
            const stopKey = `end-stop:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
            const stop = new THREE.Mesh(cachedGeometry(stopKey, () => new THREE.BoxGeometry(0.22, barW * 1.65, thickness * 1.25)), material.dark);
            stop.position.set(c.x + offset, c.y, z);
            addEdges(stop, stopKey);
            root.add(stop);
        };
        const addRack = (center: Point, z: number, mat: THREE.Material) => {
            const c = to3(center, z);
            const group = new THREE.Group();
            group.position.copy(c);
            const rackKey = `rack:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
            const rack = new THREE.Mesh(cachedGeometry(rackKey, () => new THREE.BoxGeometry(4.6, barW, thickness)), mat);
            addEdges(rack, rackKey);
            group.add(rack);
            for (let i = 0; i < 10; i++) {
                const toothKey = `rack-tooth:${thickness.toFixed(3)}`;
                const tooth = new THREE.Mesh(cachedGeometry(toothKey, () => new THREE.BoxGeometry(0.22, 0.18, thickness)), mat);
                tooth.position.set(-2.1 + i * 0.46, -barW * 0.65, 0.06);
                tooth.rotation.z = Math.PI / 4;
                group.add(tooth);
            }
            root.add(group);
        };
        const addPath = (points: Point[], z: number, mat: THREE.Material) => {
            if (points.length < 2) return;
            const geom = new THREE.BufferGeometry().setFromPoints(points.map(point => to3(point, z)));
            const line = new THREE.Line(geom, mat);
            if ('computeLineDistances' in line) line.computeLineDistances();
            root.add(line);
        };

        if (showTrail) addPath(pathPoints, -0.72, material.trail);
        if (showPathPreview) addPath(pathPoints, -0.55, material.path);

        const s = simulation.state;
        const angle = pinionRotation;
        const usesMeshedPitchCenters = ['gear', 'gear_linkage', 'planetary_gear', 'rack-pinion', 'cam'].includes(mechanism.type);
        if (!usesMeshedPitchCenters) addBar(s.p1, s.p2, 0, material.base, 3);
        const layerPoints = foundryAssemblyPinPoints(mechanism.type, s);
        const renderLinkageLayer = (label: string, z: number, mat: THREE.Material) => {
            if (mechanism.type === 'gear') return;
            if (mechanism.type === 'gear_linkage' && /L4|linkage/i.test(label)) addBar(s.j2, s.effector, z, mat, 4);
            else if (mechanism.type === 'gear_linkage' && /2-hole|bracket/i.test(label)) addSlotPlate(s.effector, barW * 3.2, Math.atan2(s.effector.y - s.j2.y, s.effector.x - s.j2.x), z, mat);
            else if (mechanism.type === '6bar' && /output rocker/i.test(label)) addBar(s.p2, s.j2, z, mat, 3);
            else if (mechanism.type === '6bar' && /dyad/i.test(label)) addBar(s.j2, s.aux, z, mat, 2);
            else if (mechanism.type === '6bar' && /follower/i.test(label)) addBar(s.p2, s.aux, z, mat, 2);
            else if (mechanism.type === 'planetary_gear' && /carrier/i.test(label)) planetaryPlanetCenters(s.p1, mechanism, degToRad(angle) * planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength)).forEach(center => addBar(s.p1, center, z, mat, 3));
            else if (mechanism.type === '4bar' && /output|rocker/i.test(label)) addBar(s.p2, s.j2, z, mat, 3);
            else if (/input|crank|left/i.test(label)) addBar(s.p1, s.j1, z, mat, 3);
            else if (/right/i.test(label)) addBar(s.p2, s.j2, z, mat, 3);
            else if (/coupler|center|carrier/i.test(label)) addBar(s.j1, s.j2, z, mat, 4);
            else if (/output|follower/i.test(label)) addBar(s.j2, s.effector, z, mat, 2);
            else addBar(s.j1, s.j2, z, mat, 3);
        };
        const renderGearLayer = (label: string, z: number, mat: THREE.Material) => {
            if (/ring/i.test(label)) addRingGear(s.p1, planetaryRingPitchRadius(mechanism), z, 0, mat);
            else if (/planet/i.test(label)) {
                const planetCenters = planetaryPlanetCenters(s.p1, mechanism, degToRad(angle) * planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength));
                const planetCount = Math.max(1, planetCenters.length);
                planetCenters.forEach((center, index) => addGear(center, mechanism.rockerLength, z, angle * planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength) + index * (360 / planetCount), mat));
            }
            else if (isGearTrain && /idler gear/i.test(label)) {
                const index = Math.max(1, Number(label.match(/(\d+)/)?.[1] ?? 1));
                const ratio = (index % 2 === 1 ? -1 : 1) * gearRadii[0] / gearRadii[index];
                addGear(gearCenters[index] ?? s.p2, gearRadii[index] ?? mechanism.rockerLength, z, angle * ratio, mat);
            }
            else if (isGearTrain && /output|right/i.test(label)) addGear(s.p2, gearRadii.at(-1) ?? mechanism.rockerLength, z, angle * gearTrainOutputRatio(gearRadii), mat);
            else addGear(s.p1, mechanism.crankLength, z, angle, mat);
        };
        renderPlan.layers.forEach(layerItem => {
            const mat = materialForLayer(layerItem.color, layerItem.role === 'spacer' ? 0.55 : 0.66, layerItem.role === 'spacer' ? 0.06 : 0.03);
            if (layerItem.renderKind === 'clip') layerPoints.forEach(point => addClipCap(point, layerItem.z, mat));
            else if (layerItem.renderKind === 'spacer') layerPoints.forEach(point => addSpacerWasher(point, layerItem.z, mat));
            else if (layerItem.renderKind === 'linkage') renderLinkageLayer(layerItem.label, layerItem.z, mat);
            else if (layerItem.renderKind === 'gear') renderGearLayer(layerItem.label, layerItem.z, mat);
            else if (layerItem.renderKind === 'cam') addCam(s.p1, layerItem.z, mat);
            else if (layerItem.renderKind === 'guide') {
                const slotRotation = /follower|slider|rack/i.test(layerItem.label) ? Math.PI / 2 : Math.atan2(s.j2.y - s.p2.y, s.j2.x - s.p2.x);
                addSlotPlate(/quick/i.test(layerItem.label) ? { x: (s.p2.x + s.j2.x) / 2, y: (s.p2.y + s.j2.y) / 2 } : s.j2, /rack/i.test(layerItem.label) ? 4.8 : 3.2, slotRotation, layerItem.z, mat);
            }
            else if (layerItem.renderKind === 'rack') {
                addRack(s.j2, layerItem.z, mat);
                addEndStop(s.j2, -2.55, layerItem.z + 0.04);
                addEndStop(s.j2, 2.55, layerItem.z + 0.04);
            }
            else if (layerItem.renderKind === 'follower') addFollowerBlock(s.j2, layerItem.z, mat);
        });
        const zBackClip = renderPlan.layers.find(item => item.role === 'clip')?.z ?? 0.22;
        const zPin = (renderPlan.layers.at(-1)?.z ?? 0.22) + 0.34;
        layerPoints.forEach(point => {
            const p = to3(point as Point, zPin);
            const pin = new THREE.Mesh(cachedGeometry(`pin:${holeR.toFixed(3)}:${Math.max(0.55, zPin - zBackClip + 0.12).toFixed(3)}`, () => new THREE.CylinderGeometry(holeR * 0.8, holeR * 0.8, Math.max(0.55, zPin - zBackClip + 0.12), 20)), material.dark);
            pin.rotation.x = Math.PI / 2;
            pin.position.copy(p);
            root.add(pin);
        });

        dynamicBuildCountRef.current += 1;
        if (stateRef.current) {
            stateRef.current.dataset.threeDynamicBuildCount = String(dynamicBuildCountRef.current);
            stateRef.current.dataset.threeGeometryCacheSize = String(geometryCacheRef.current.size);
            stateRef.current.dataset.threeMaterialCacheSize = String(materialCacheRef.current.size);
        }
        renderCamera(cameraStateRef.current);
    }, [mechanism, simulation, kit, color, pathPoints, showPathPreview, showTrail, pinionRotation, renderPlan, rigOpacity]);

    return <div
        data-testid="foundry-preview"
        onClick={handleAnchorClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onContextMenu={event => event.preventDefault()}
        className={`foundry-preview h-[520px] w-full ${isPickingAnchor ? 'is-picking-anchor' : ''} ${isOrbiting ? 'is-orbiting' : ''} ${isZooming ? 'is-zooming' : ''} ${isPanning ? 'is-panning' : ''}`}
        aria-label="Mechanism Foundry true WebGL 3D sandbox preview"
        data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
        data-viewer-contract-state={JSON.stringify(viewerContract)}
        data-viewer-tab={viewerContract.tab}
        data-layer-grid={viewer3DLayerDataValue(showGrid)}
        data-layer-mechanisms={viewer3DLayerDataValue(true)}
        data-layer-paths={viewer3DLayerDataValue(showPathPreview)}
        data-layer-forces={viewer3DLayerDataValue(showForces)}
        data-layer-velocity={viewer3DLayerDataValue(showVelocity)}
        data-layer-trail={viewer3DLayerDataValue(showTrail)}
    >
        <div ref={hostRef} className="foundry-three-host" />
        <div
            ref={stateRef}
            data-testid="foundry-camera-rig"
            data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
            data-viewer-contract-state={JSON.stringify(viewerContract)}
            data-viewer-tab={viewerContract.tab}
            data-camera-preset={camera.preset}
            data-layer-grid={viewer3DLayerDataValue(showGrid)}
            data-layer-mechanisms={viewer3DLayerDataValue(true)}
            data-layer-character={viewer3DLayerDataValue(undefined)}
            data-layer-skeleton={viewer3DLayerDataValue(undefined)}
            data-layer-paths={viewer3DLayerDataValue(showPathPreview)}
            data-layer-forces={viewer3DLayerDataValue(showForces)}
            data-layer-velocity={viewer3DLayerDataValue(showVelocity)}
            data-layer-trail={viewer3DLayerDataValue(showTrail)}
            data-camera-yaw={camera.yaw.toFixed(1)}
            data-camera-pitch={camera.pitch.toFixed(1)}
            data-camera-zoom={camera.zoom.toFixed(3)}
            data-camera-pan-x={(camera.pan?.x ?? 0).toFixed(3)}
            data-camera-pan-y={(camera.pan?.y ?? 0).toFixed(3)}
            data-camera-distance={foundryCameraDistance(camera).toFixed(3)}
            data-rig-opacity={rigOpacity.toFixed(2)}
            data-three-renderer="webgl"
            data-three-engine-stack={PHYSICS_RENDER_STACK}
            data-physics-kernel={PHYSICS_KERNEL_ENGINE}
            data-physics-update-policy={PHYSICS_UPDATE_POLICY}
            data-high-throughput-scene-policy={HIGH_THROUGHPUT_SCENE_POLICY}
            data-physics-contact-mode="kinematic-estimate-rapier-contact-probe"
            data-physics-kernel-runtime={physicsKernelRuntime}
            data-physics-kernel-version={physicsKernelVersion}
            data-physics-kernel-error={physicsKernelError}
            data-physics-authority="motionsmith-kinematics"
            data-mechanism-type={mechanism.type}
            data-three-part-count={inv.parts}
            data-three-hole-count={inv.holes}
            data-three-slot-count={inv.slots}
            data-three-gear-count={inv.gears}
            data-three-rack-count={inv.racks}
            data-three-cam-count={inv.cams}
            data-three-follower-count={inv.followers}
            data-three-end-stop-count={inv.endStops}
            data-three-gear-radii={gearRadii.map(radius => radius.toFixed(2)).join(',')}
            data-cam-profile={mechanism.type === 'cam' ? normalizeCamProfileSamples(mechanism.camProfileSamples).map(value => value.toFixed(2)).join(',') : ''}
            data-three-gear-pitch-center={(mechanism.type === 'planetary_gear' ? planetaryGearConventionForMechanism(mechanism).carrierPitchRadius : mechanism.groundLength).toFixed(2)}
            data-three-gear-pitch-sum={(isGearTrain ? gearTrainPitchCenterDistance(mechanism) : mechanism.type === 'planetary_gear' ? planetaryGearConventionForMechanism(mechanism).ringPitchRadius : mechanism.crankLength + mechanism.rockerLength).toFixed(2)}
            data-three-gear-output-ratio={(isGearTrain ? gearTrainOutputRatio(mechanism) : mechanism.type === 'planetary_gear' ? planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength) : gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength)).toFixed(3)}
            data-three-planet-count={planetaryConvention?.planetCount ?? 0}
            data-three-planetary-syntax={planetaryConvention?.syntax ?? ''}
            data-three-planetary-fixed={planetaryConvention?.fixedMember ?? ''}
            data-three-planetary-input={planetaryConvention?.inputMember ?? ''}
            data-three-planetary-output={planetaryConvention?.outputMember ?? ''}
            data-three-planetary-ring-radius={planetaryConvention?.ringPitchRadius.toFixed(2) ?? ''}
            data-three-planetary-carrier-radius={planetaryConvention?.carrierPitchRadius.toFixed(2) ?? ''}
            data-three-gear-train-linkage-mode={mechanism.type === 'gear' ? 'gear-only-train' : mechanism.type === 'gear_linkage' ? 'output-gear-handle-l4-bracket' : 'template-specific'}
            data-three-gear-linkage-mode={mechanism.type === 'gear_linkage' ? 'off-center-output-gear-crank' : 'none'}
            data-three-linkage-pin-radius={mechanism.type === 'gear_linkage' ? mechanism.couplerPointDist.toFixed(2) : ''}
            data-three-spacer-key={FABRICATION_SPACER_SPEC.key}
            data-three-spacer-label={FABRICATION_SPACER_SPEC.label}
            data-three-spacer-mm={`${FABRICATION_SPACER_SPEC.outerDiameterMm}x${FABRICATION_SPACER_SPEC.innerDiameterMm}`}
            data-three-spacer-layers={spacerLayerCount}
            data-three-spacer-render-count={spacerRenderCount}
            data-three-physical-pin-count={assemblyPinPoints.length}
            data-three-physical-pin-contract={assemblyPinContract}
            data-path-preview={showPathPreview ? 'shown' : 'hidden'}
            data-trail={showTrail ? 'shown' : 'hidden'}
            data-forces={showForces ? 'shown' : 'hidden'}
            data-velocity={showVelocity ? 'shown' : 'hidden'}
            data-pinion-rotation-deg={pinionRotation.toFixed(2)}
            data-physics-rule={physicsRule}
            data-velocity-magnitude={velocityMagnitude.toFixed(3)}
            data-force-magnitude={forceMagnitude.toFixed(3)}
            data-friction-coefficient={frictionCoefficient.toFixed(3)}
            data-friction-magnitude={frictionMagnitude.toFixed(3)}
            data-constraint-error={constraintError.toFixed(3)}
            data-camera-label={cameraLabel}
            data-anchor-pick-mode="three-raycaster-plane"
            data-three-hole-mode="extruded-cut-through"
            data-three-render-loop="camera-only-orbit"
            data-three-pixel-ratio-cap={WEBGL_PIXEL_RATIO_CAP.toFixed(1)}
            data-three-animation-commit-ms={FOUNDRY_ANIMATION_COMMIT_MS.toFixed(1)}
            data-three-dynamic-build-count={dynamicBuildCountRef.current}
            data-three-geometry-cache-size={geometryCacheRef.current.size}
            data-three-material-cache-size={materialCacheRef.current.size}
            data-three-static-grid-mode="persistent-scene-layer"
            data-three-fit-bounds="phase-invariant-sweep"
            data-three-inventory-source="rendered-template"
            data-three-stack-source="fabricationStackForMechanism"
            data-three-stack-mode="assembled-spacer-separated"
            data-three-exploded="false"
            data-three-spacer-z-gap={stackZGap.toFixed(2)}
            data-three-base-layer={renderPlan.base.label}
            data-three-stack-order={renderPlan.stackSummary}
            data-three-stack-occurrences={renderPlan.occurrenceSummary}
            data-three-stack-roles={renderPlan.roleSummary}
            data-three-stack-colors={renderPlan.colorSummary}
            data-three-stack-z={renderPlan.zSummary}
            data-three-stack-layer-count={renderPlan.layers.length}
            data-three-rendered-layer-labels={renderPlan.layers.map(item => item.label).join(' → ')}
            data-three-rendered-layer-roles={renderPlan.layers.map(item => item.renderKind).join('>')}
            data-three-rendered-layer-colors={renderPlan.layers.map(item => item.color).join(',')}
            data-three-rendered-layer-z={renderPlan.layers.map(item => item.z.toFixed(2)).join(',')}
            data-three-geometry-contract={renderPlan.layers.map(item => foundryLayerGeometryContract(mechanism.type, item.label, item.renderKind)).join(' → ')}
            data-three-stack-validation-errors={renderPlan.validationErrors.length}
            className="foundry-three-scene-state"
        />
        {children}
    </div>;
};

const MechanismLinkagePreview = ({ mechanism, simulation, kit, testId, compact = false }: { mechanism: MechanismConfig; simulation: ReturnType<typeof fitMechanismSimulation>; kit: PhysicalKitSettings; testId: string; compact?: boolean }) => {
    const s = simulation.state;
    const r = compact ? 2.5 : 4;
    const depth = compact ? 2.2 : 5.5;
    const thicknessTestId = compact ? undefined : 'foundry-material-thickness';
    const scaled = (length: number, min: number, max: number) => Math.max(min, Math.min(max, length * simulation.scale));
    const test = (name: string) => compact ? undefined : `foundry-mechanism-${name}`;
    const templateTest = compact ? undefined : `foundry-template-${mechanism.type}`;
    const fabricationTest = (name: string) => compact ? undefined : `foundry-fabrication-${name}`;
    const radius = (length: number, min = compact ? 8 : 16, max = compact ? 28 : 58) => scaled(Math.max(1, length), min, max);
    const holeR = Math.max(compact ? 1.8 : 2.6, Math.min(compact ? 3.4 : 5.6, FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM * simulation.scale));
    const pitch = Math.max(holeR * 3.5, kit.gridPitchMm * SCENE_PX_PER_MM * simulation.scale);
    const barWidth = Math.max(FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * simulation.scale, holeR * 3.5, compact ? 8 : 14);
    const axisForAngle = (deg: number) => ({ x: Math.cos(degToRad(deg)), y: -Math.sin(degToRad(deg)) });
    const trackAxis = axisForAngle(mechanism.groundAngle ?? 0);
    const normalAxis = { x: -trackAxis.y, y: trackAxis.x };
    const inputAngleDeg = Math.atan2(s.j1.y - s.p1.y, s.j1.x - s.p1.x) * 180 / Math.PI;
    const outputAngleDeg = Math.atan2(s.j2.y - s.p2.y, s.j2.x - s.p2.x) * 180 / Math.PI;
    const isGearTrainPreview = mechanism.type === 'gear' || mechanism.type === 'gear_linkage';
    const previewGearRadii = isGearTrainPreview ? gearTrainPitchRadii(mechanism) : [];
    const previewGearCenters = isGearTrainPreview ? gearTrainCenters(mechanism) : [];
    const vectorAxis = (a: Point | undefined, b: Point | undefined, fallback = trackAxis) => {
        if (!a || !b) return fallback;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        return len > 0.5 ? { x: dx / len, y: dy / len } : fallback;
    };
    const link = (a: Point | undefined, b: Point | undefined, key: string, className = 'mechanism-link', testIdName?: string) => {
        if (!a || !b) return null;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (!Number.isFinite(len) || len < 0.5) return null;
        const sceneLength = len / Math.max(0.0001, simulation.scale);
        const minHoleCount = key === 'coupler' ? 4 : key.includes('carrier') || key === 'frame' || key === 'driver' || key === 'output' ? 3 : 2;
        const linkageSpec = fabricationLinkageSpecForSceneLength(sceneLength, kit.gridPitchMm, minHoleCount);
        const templateLen = linkageSpec.lengthMm * SCENE_PX_PER_MM * simulation.scale;
        const outlineLen = templateLen + barWidth;
        const firstHoleX = linkageSpec.holeCentersMm[0]?.x ?? 0;
        const holeXs = linkageSpec.holeCentersMm.map(point => ((point.x - firstHoleX) - linkageSpec.lengthMm / 2) * SCENE_PX_PER_MM * simulation.scale);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return <g key={key} data-testid={testIdName ? test(testIdName) : undefined} className={`mechanism-part ${className}`} transform={`translate(${mid.x} ${mid.y}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`}>
            <rect data-testid={thicknessTestId} className="mechanism-thickness" x={-outlineLen / 2 + depth} y={-barWidth / 2 + depth} width={outlineLen} height={barWidth} rx={barWidth / 2} />
            <rect data-testid={fabricationTest('part')} className="mechanism-face" x={-outlineLen / 2} y={-barWidth / 2} width={outlineLen} height={barWidth} rx={barWidth / 2} />
            {holeXs.map((x, index) => <circle key={index} data-testid={fabricationTest('hole')} className="mechanism-hole" cx={x} cy="0" r={holeR} />)}
        </g>;
    };
    const guideAxis = (center: Point, axis: Point, key: string, reach = compact ? 42 : 95, endStops = false) => {
        const len = Math.hypot(axis.x, axis.y) || 1;
        const ux = axis.x / len;
        const uy = axis.y / len;
        const start = { x: center.x - ux * reach, y: center.y - uy * reach };
        const angle = Math.atan2(uy, ux) * 180 / Math.PI;
        return <g key={key} data-testid={test('guide')} className="mechanism-part mechanism-frame" transform={`translate(${start.x} ${start.y}) rotate(${angle})`}>
            <rect data-testid={thicknessTestId} className="mechanism-thickness" x={depth} y={-barWidth / 2 + depth} width={reach * 2} height={barWidth} rx={barWidth / 2} />
            <rect data-testid={fabricationTest('slot')} className="mechanism-face" x="0" y={-barWidth / 2} width={reach * 2} height={barWidth} rx={barWidth / 2} />
            <rect className="mechanism-slot" x={barWidth * 0.8} y={-holeR} width={Math.max(holeR * 2, reach * 2 - barWidth * 1.6)} height={holeR * 2} rx={holeR} />
            {endStops && [0, reach * 2].map((x, index) => <rect key={`stop-${index}`} data-testid={fabricationTest('end-stop')} className="mechanism-end-stop" x={x - holeR} y={-barWidth * 0.85} width={holeR * 2} height={barWidth * 1.7} rx={holeR * 0.45} />)}
            {[0, reach * 2].map((x, index) => <circle key={index} data-testid={fabricationTest('hole')} className="mechanism-hole" cx={x} cy="0" r={holeR} />)}
        </g>;
    };
    const guide = (center: Point, a: Point, b: Point, key: string) => guideAxis(center, vectorAxis(a, b), key);
    const slotPlate = (center: Point, axis: Point, length: number, key: string, className = 'mechanism-link', testIdName?: string) => {
        const len = Math.max(length, barWidth * 3);
        const angle = Math.atan2(axis.y, axis.x) * 180 / Math.PI;
        return <g key={key} data-testid={testIdName ? test(testIdName) : undefined} className={`mechanism-part ${className}`} transform={`translate(${center.x} ${center.y}) rotate(${angle})`}>
            <rect data-testid={thicknessTestId} className="mechanism-thickness" x={-len / 2 + depth} y={-barWidth / 2 + depth} width={len} height={barWidth} rx={barWidth / 2} />
            <rect data-testid={fabricationTest('part')} className="mechanism-face" x={-len / 2} y={-barWidth / 2} width={len} height={barWidth} rx={barWidth / 2} />
            <rect data-testid={fabricationTest('slot')} className="mechanism-slot" x={-len / 2 + barWidth * 0.75} y={-holeR} width={len - barWidth * 1.5} height={holeR * 2} rx={holeR} />
            {[-len / 2, len / 2].map((x, index) => <circle key={index} data-testid={fabricationTest('hole')} className="mechanism-hole" cx={x} cy="0" r={holeR} />)}
        </g>;
    };
    const pins = [s.p1, s.p2, s.j1, s.j2, s.aux].filter((point): point is Point => Boolean(point));
    const gear = (center: Point, length: number, className: string, key: string, min = compact ? 8 : 16, max = compact ? 34 : 62, rotation = 0) => {
        const pitchRadius = radius(length, min, max);
        const gearProfile = fabricationGearProfileForPitchRadius(pitchRadius, pitchRadius / SCENE_PX_PER_MM);
        return <g key={key} data-mechanism-gear-key={key} data-rotation-deg={rotation.toFixed(2)} className={`mechanism-gear-part ${className}`} transform={`translate(${center.x} ${center.y}) rotate(${rotation})`}>
            <path data-testid={thicknessTestId} className="mechanism-thickness" transform={`translate(${depth} ${depth})`} d={gearPathD(pitchRadius)} />
            <path data-testid={fabricationTest('gear')} className="mechanism-gear-teeth mechanism-face" d={gearPathD(pitchRadius)} />
            <circle data-testid={fabricationTest('hole')} className="mechanism-hole axle-hole" cx="0" cy="0" r={holeR} />
            {gearProfile.attachmentHoleCenters.map((point, index) => <circle key={index} data-testid={fabricationTest('hole')} className="mechanism-hole" cx={point.x} cy={point.y} r={holeR} />)}
        </g>;
    };
    const ringGear = (center: Point, length: number, className: string, key: string) => {
        const pitchRadius = radius(length, compact ? 18 : 34, compact ? 62 : 120);
        const ringProfile = fabricationRingGearProfileForPitchRadius(pitchRadius);
        return <g key={key} data-mechanism-gear-key={key} className={`mechanism-gear-part ${className}`} transform={`translate(${center.x} ${center.y})`}>
            <path data-testid={thicknessTestId} className="mechanism-thickness" transform={`translate(${depth} ${depth})`} d={fabricationRingGearPathD(pitchRadius)} fillRule="evenodd" />
            <path data-testid={fabricationTest('gear')} className="mechanism-gear-teeth mechanism-face" d={fabricationRingGearPathD(pitchRadius)} fillRule="evenodd" />
            {ringProfile.mountHoleCenters.map((point, index) => <circle key={index} data-testid={fabricationTest('hole')} className="mechanism-hole" cx={point.x} cy={point.y} r={holeR} />)}
        </g>;
    };
    const rackPlate = (center: Point, axis: Point, length: number, key: string) => {
        const len = Math.max(length, barWidth * 6);
        const angle = Math.atan2(axis.y, axis.x) * 180 / Math.PI;
        const toothCount = Math.max(8, Math.min(24, Math.round(len / Math.max(holeR * 2.4, 4))));
        const step = len / toothCount;
        const teeth = Array.from({ length: toothCount }, (_, index) => {
            const x = -len / 2 + index * step;
            return `M ${x} ${-barWidth / 2} L ${x + step / 2} ${-barWidth / 2 - holeR * 1.2} L ${x + step} ${-barWidth / 2}`;
        }).join(' ');
        return <g key={key} data-testid={test('rack')} className="mechanism-part mechanism-output" transform={`translate(${center.x} ${center.y}) rotate(${angle})`}>
            <rect data-testid={thicknessTestId} className="mechanism-thickness" x={-len / 2 + depth} y={-barWidth / 2 + depth} width={len} height={barWidth} rx={barWidth / 5} />
            <rect data-testid={fabricationTest('rack')} className="mechanism-face" x={-len / 2} y={-barWidth / 2} width={len} height={barWidth} rx={barWidth / 5} />
            <path className="mechanism-rack-teeth" d={teeth} />
            <rect data-testid={fabricationTest('slot')} className="mechanism-slot" x={-len / 2 + barWidth * 0.8} y={-holeR} width={len - barWidth * 1.6} height={holeR * 2} rx={holeR} />
            {[-len / 2, 0, len / 2].map((x, index) => <circle key={index} data-testid={fabricationTest('hole')} className="mechanism-hole" cx={x} cy="0" r={holeR} />)}
        </g>;
    };
    const camProfile = (center: Point, length: number) => {
        const base = radius(length, compact ? 10 : 20, compact ? 34 : 66);
        const points = Array.from({ length: 42 }, (_, index) => {
            const angle = (index / 42) * Math.PI * 2;
            const lift = sampledCamProfileScale(angle, mechanism.camProfileSamples);
            return `${Math.cos(angle) * base * lift} ${Math.sin(angle) * base * lift}`;
        });
        return <g key="cam-body" data-testid={fabricationTest('cam')} className="mechanism-part mechanism-cam" transform={`translate(${center.x} ${center.y}) rotate(${inputAngleDeg})`}>
            <path data-testid={thicknessTestId} className="mechanism-thickness" transform={`translate(${depth} ${depth})`} d={`M ${points.join(' L ')} Z`} />
            <path className="mechanism-cam-profile mechanism-face" d={`M ${points.join(' L ')} Z`} />
            <circle data-testid={fabricationTest('hole')} className="mechanism-hole axle-hole" cx="0" cy="0" r={holeR} />
            <circle className="mechanism-hole" cx={base * 0.45} cy="0" r={holeR} />
        </g>;
    };
    const followerBlock = (center: Point) => <g key="follower" data-testid={fabricationTest('follower')} className="mechanism-part mechanism-output" transform={`translate(${center.x} ${center.y}) rotate(${Math.atan2(normalAxis.y, normalAxis.x) * 180 / Math.PI})`}>
        <rect data-testid={thicknessTestId} className="mechanism-thickness" x={-barWidth * 1.35 + depth} y={-barWidth / 2 + depth} width={barWidth * 2.7} height={barWidth} rx={barWidth / 3} />
        <rect data-testid={fabricationTest('part')} className="mechanism-face" x={-barWidth * 1.35} y={-barWidth / 2} width={barWidth * 2.7} height={barWidth} rx={barWidth / 3} />
        <circle data-testid={fabricationTest('hole')} className="mechanism-hole" cx="0" cy="0" r={holeR} />
    </g>;
    const gearPreview = (mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear' || mechanism.type === 'rack-pinion') && <g data-testid={test('gear')}>
        {mechanism.type === 'rack-pinion' && <>
            {gear(s.p1, mechanism.crankLength, 'mechanism-driver', 'rack-pinion-gear', compact ? 8 : 16, compact ? 34 : 62, inputAngleDeg)}
        </>}
        {isGearTrainPreview && <>
            {previewGearRadii.map((radiusValue, index) => {
                const ratio = index === 0 ? 1 : (index % 2 === 1 ? -1 : 1) * previewGearRadii[0] / radiusValue;
                return gear(previewGearCenters[index] ?? (index === 0 ? s.p1 : s.p2), radiusValue, index === 0 ? 'mechanism-driver' : index === previewGearRadii.length - 1 ? 'mechanism-link secondary' : 'mechanism-link', `gear-${index}`, compact ? 8 : 16, compact ? 34 : 62, inputAngleDeg * ratio + (index === previewGearRadii.length - 1 ? (mechanism.phase ?? 0) * 180 / Math.PI : 0));
            })}
        </>}
        {mechanism.type === 'planetary_gear' && <>
            {ringGear(s.p1, planetaryRingPitchRadius(mechanism), 'mechanism-frame carrier', 'ring')}
            {gear(s.p1, mechanism.crankLength, 'mechanism-driver', 'sun', compact ? 7 : 12, compact ? 22 : 42, inputAngleDeg)}
            {(() => {
                const planetCenters = planetaryPlanetCenters(s.p1, mechanism, degToRad(inputAngleDeg) * planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength));
                const planetCount = Math.max(1, planetCenters.length);
                return planetCenters.map((center, index) =>
                    gear(center, mechanism.rockerLength, 'mechanism-link secondary', `planet-${index + 1}`, compact ? 7 : 12, compact ? 22 : 42, outputAngleDeg + index * (360 / planetCount))
                );
            })()}
        </>}
    </g>;
    const links = (() => {
        if (mechanism.type === 'crank') return [link(s.p1, s.j1, 'driver', 'mechanism-driver', 'driver'), link(s.j1, s.effector, 'output', 'mechanism-output', 'output')];
        if (mechanism.type === '4bar') return [
            link(s.p1, s.p2, 'frame', 'mechanism-frame', 'frame'),
            link(s.p1, s.j1, 'driver', 'mechanism-driver', 'driver'),
            link(s.j1, s.j2, 'coupler', 'mechanism-link', 'link'),
            link(s.p2, s.j2, 'rocker', 'mechanism-link')
        ];
        if (mechanism.type === '5bar') return [
            link(s.p1, s.p2, 'frame', 'mechanism-frame', 'frame'),
            link(s.p1, s.j1, 'driver-a', 'mechanism-driver', 'driver'),
            link(s.p2, s.aux, 'driver-b', 'mechanism-driver'),
            link(s.j1, s.j2, 'rod-a', 'mechanism-link', 'link'),
            link(s.aux, s.j2, 'rod-b', 'mechanism-link'),
            link(s.j2, s.effector, 'output', 'mechanism-output', 'output')
        ];
        if (mechanism.type === '6bar') return [
            link(s.p1, s.p2, 'frame', 'mechanism-frame', 'frame'),
            link(s.p1, s.j1, 'driver', 'mechanism-driver', 'driver'),
            link(s.j1, s.j2, 'coupler', 'mechanism-link', 'link'),
            link(s.p2, s.j2, 'rocker', 'mechanism-link'),
            link(s.j2, s.aux, 'dyad', 'mechanism-link'),
            link(s.p2, s.aux, 'follower', 'mechanism-output', 'output')
        ];
        if (mechanism.type === 'piston') return [
            guideAxis(s.j2, trackAxis, 'guide'),
            link(s.p1, s.j1, 'driver', 'mechanism-driver', 'driver'),
            link(s.j1, s.j2, 'slider-link', 'mechanism-link', 'link'),
            link(s.j2, s.effector, 'output', 'mechanism-output', 'output')
        ];
        if (mechanism.type === 'yoke') return [
            guideAxis(s.j2, trackAxis, 'guide'),
            slotPlate(s.j2, normalAxis, radius(mechanism.crankLength, compact ? 28 : 54, compact ? 72 : 130), 'yoke-slot', 'mechanism-link', 'link'),
            link(s.p1, s.j1, 'driver', 'mechanism-driver', 'driver'),
            link(s.j2, s.effector, 'output', 'mechanism-output', 'output')
        ];
        if (mechanism.type === 'cam') return [
            guideAxis(s.j2, trackAxis, 'guide'),
            camProfile(s.p1, mechanism.crankLength),
            followerBlock(s.j2)
        ];
        if (mechanism.type === 'rack-pinion') {
            const rackAxis = vectorAxis(s.j2, s.effector, trackAxis);
            const rawInputAngle = ((-Math.atan2(s.j1.y - s.p1.y, s.j1.x - s.p1.x)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
            const travel = Math.max(1, mechanism.crankLength) * (rawInputAngle - Math.PI) * simulation.scale;
            const fixedGuideCenter = { x: s.j2.x - rackAxis.x * travel, y: s.j2.y - rackAxis.y * travel };
            const rackVisualLength = radius(mechanism.rockerLength, compact ? 56 : 120, compact ? 160 : 340);
            return [
                guideAxis(fixedGuideCenter, rackAxis, 'guide', rackVisualLength / 2 + radius(mechanism.crankLength, compact ? 8 : 16, compact ? 34 : 62), true),
                rackPlate(s.j2, rackAxis, rackVisualLength, 'rack'),
                link(s.p1, s.j1, 'pinion-radius', 'mechanism-driver', 'driver'),
                link(s.j2, s.effector, 'rack-output', 'mechanism-output', 'output')
            ];
        }
        if (mechanism.type === 'quick-return') return [
            link(s.p1, s.p2, 'frame', 'mechanism-frame', 'frame'),
            link(s.p1, s.j1, 'driver', 'mechanism-driver', 'driver'),
            slotPlate({ x: (s.p2.x + s.j2.x) / 2, y: (s.p2.y + s.j2.y) / 2 }, vectorAxis(s.p2, s.j2), Math.hypot(s.j2.x - s.p2.x, s.j2.y - s.p2.y), 'slotted-rocker', 'mechanism-link', 'link'),
            link(s.j2, s.effector, 'output', 'mechanism-output', 'output')
        ];
        if (mechanism.type === 'gear') return [];
        if (mechanism.type === 'gear_linkage') return [
            link(s.j2, s.effector, 'l4-output-linkage', 'mechanism-output', 'output'),
            slotPlate(s.effector, vectorAxis(s.j2, s.effector), barWidth * 3.2, 'output-bracket', 'mechanism-output', 'output')
        ];
        if (mechanism.type === 'planetary_gear') {
            const planetCenters = planetaryPlanetCenters(s.p1, mechanism, degToRad(inputAngleDeg) * planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength));
            return [
                ...planetCenters.map((center, index) => link(s.p1, center, `carrier-${index + 1}`, 'mechanism-driver', index === 0 ? 'driver' : undefined)),
                link(s.p2, s.effector, 'carrier-output', 'mechanism-output', 'output')
            ];
        }
        return [
            link(s.p1, s.p2, 'frame', 'mechanism-frame', 'frame'),
            link(s.p1, s.j1, 'driver', 'mechanism-driver', 'driver'),
            link(s.j1, s.j2, 'coupler', 'mechanism-link', 'link'),
            link(s.j2, s.p2, 'rocker', 'mechanism-link'),
            link(s.j1, s.effector, 'output', 'mechanism-output', 'output')
        ];
    })();
    const referenceRecipe = referenceRecipeForType(mechanism.type);
    const referenceCoordRoles = referenceRecipe.assemblySteps
        .flatMap(step => step.coords.map((coord, index) => `${coord}:${step.coordRoles[index] ?? 'moving_reference'}`))
        .join('|');
    return <g
        data-testid={testId}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        data-mechanism-type={mechanism.type}
        data-reference-canonical-key={referenceRecipe.canonicalKey}
        data-reference-topology={mechanismReferenceTopologySummary(mechanism.type)}
        data-reference-stack-labels={referenceRecipe.stackLabels.join(' → ')}
        data-reference-coord-roles={referenceCoordRoles}
        data-reference-export-ready={referenceRecipe.exportReady ? 'true' : 'false'}
    >
        <g data-testid={templateTest}>
            {gearPreview}
            {links}
            {pins.map((point, i) => <circle key={i} className="mechanism-pin" cx={point.x} cy={point.y} r={r} />)}
            <circle data-testid={test('output-point')} className="mechanism-effector" cx={s.effector.x} cy={s.effector.y} r={r + 2}/>
        </g>
    </g>;
};

export default App;
