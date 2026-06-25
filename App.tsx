import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from './components/Canvas';
import { TrackingModal } from './components/TrackingModal';
import {
    AppStage,
    BodyPartLayer,
    CanvasViewport,
    CharacterPackageArtifact,
    FabricationRecipe,
    FoundryExportPackage,
    GlobalConfig,
    MechanismConfig,
    MechanismType,
    PhysicalKitSettings,
    Point,
    ProjectMotionPath,
    ProjectState
} from './types';
import { gearPathD, generateDXF, generateSVG } from './utils/exporter';
import { animationDeltaRadians, calculateLinkage, camProfileScale, generateCurvePoints } from './utils/kinematics';
import { evaluateFitness, generateSmartConfig, mutateConfig } from './utils/optimizer';
import {
    applyProjectAction,
    createDefaultMechanism,
    createProjectFromProcessed,
    createSampleProject,
    downloadText,
    handoffGate,
    loadProjectSnapshot,
    mechanismRequiredParts,
    mechanismWithGeneratedPath,
    projectSelfCheck,
    serializeProject,
    uid,
    validatePath
} from './utils/project';
import { processImageWithWebOnnx } from './utils/webOnnx';
import { createFabricationPackage, sampleFeasibleRange, validateForFabrication } from './utils/fabrication';
import { boardGridLines, boardToScene, bodyPartPivotScene, localPivotOffsetForScene, pathFromPoints, physicalKitPreset, sceneBoundsForSheet, sceneToBoard, sceneToBoardRaw, sceneToSvg, svgPointerToScene, SCENE_PX_PER_MM, SCENE_VIEW } from './utils/coordinates';
import { loadCharacterPackage } from './utils/packageLoader';
import { Z_AXIS_LABEL, Z_STACK_LABEL, Z_STACK_LAYERS } from './utils/zStack';
import { describeMotionChain, mechanismBindingWarnings, motionAnchorJointIds, motionChainOptionLabel, motionPreviewForPath, preferredMotionJointId } from './utils/motion';
import { clampCanvasZoom, DEFAULT_CANVAS_VIEWPORT, normalizeCanvasViewport } from './utils/viewport';
import { AUTHORABLE_MECHANISM_TYPES, FOUNDRY_PRESETS, MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY, mechanismTemplateLabel } from './utils/mechanismTemplates';
import { AlertCircle, Boxes, BrainCircuit, Camera, CheckCircle2, Download, FileJson, Loader2, Play, Plus, Route, Save, Sparkles, Trash2, Upload } from 'lucide-react';
import girlStarterUrl from './resources/examples/raw/girl.png?url';
import boyStarterUrl from './resources/examples/raw/boy.PNG?url';

type FoundryState = MechanismConfig;
type StarterImageTemplate = { id: string; label: string; fileName: string; description: string; url: string };

const STARTER_IMAGE_TEMPLATES: StarterImageTemplate[] = [
    { id: 'girl', label: 'Girl starter', fileName: 'girl.png', description: 'Flat vector pose from resources/examples/raw/girl.png.', url: girlStarterUrl },
    { id: 'boy', label: 'Boy starter', fileName: 'boy.PNG', description: 'Textured pose from resources/examples/raw/boy.PNG.', url: boyStarterUrl }
];

const STAGES: Array<{ id: AppStage; label: string; kicker: string }> = [
    { id: 'character', label: 'Character Selection', kicker: 'image → rig package' },
    { id: 'path', label: 'Path Editor', kicker: 'parts, skeleton, paths' },
    { id: 'foundry', label: 'Mechanism Foundry', kicker: 'recipe sandbox' },
    { id: 'design', label: 'Mechanism Design', kicker: 'attach + tune' },
    { id: 'blueprint', label: 'Blueprint Export', kicker: 'fabrication package' },
    { id: 'options', label: 'Options', kicker: 'global settings' }
];
const stageNavLabel = (stage: AppStage) => ({
    character: 'Character',
    foundry: 'Foundry',
    blueprint: 'Blueprint'
} as Partial<Record<AppStage, string>>)[stage];


const STAGE_PANE_NAV_ITEMS: Array<{ ariaLabel: string; label: string; target: AppStage; activeStages: AppStage[]; icon: 'route' | 'boxes' | 'download' }> = [
    { ariaLabel: 'Rail motion path', label: 'Motion path', target: 'path', activeStages: ['path'], icon: 'route' },
    { ariaLabel: 'Rail mechanism parameters', label: 'Parameters', target: 'design', activeStages: ['foundry', 'design'], icon: 'boxes' },
    { ariaLabel: 'Rail export package', label: 'Blueprint export', target: 'blueprint', activeStages: ['blueprint'], icon: 'download' }
];

const OPTIONS_SECTION_MANIFEST = [
    { id: 'appearance', label: 'Appearance', description: 'Keep the interface light and show only the panels you need.' },
    { id: 'simulation', label: 'Simulation', description: 'Preview timing for one full motion loop.' },
    { id: 'performance', label: 'Performance', description: 'Choose how hard path fitting and snap checks work.' },
    { id: 'debugging', label: 'Debugging', description: 'Turn on labels when something feels off.' },
    { id: 'workflow', label: 'Workflow', description: 'Autosave is local to this browser.' },
    { id: 'fabrication', label: 'Fabrication / Blueprint export', description: 'Match the preview grid to the physical sheet and board holes.' },
    { id: 'units', label: 'Units', description: 'Only labels change; fabrication still stores millimeters.' }
] as const;

type OptionsSectionMeta = typeof OPTIONS_SECTION_MANIFEST[number];
const optionSection = (id: OptionsSectionMeta['id']) => OPTIONS_SECTION_MANIFEST.find(section => section.id === id)!;
const StagePaneNavIcon = ({ icon }: { icon: typeof STAGE_PANE_NAV_ITEMS[number]['icon'] }) => {
    if (icon === 'boxes') return <Boxes size={16}/>;
    if (icon === 'download') return <Download size={16}/>;
    return <Route size={16}/>;
};

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

const App: React.FC = () => {
    const [project, setProject] = useState<ProjectState>(() => {
        projectSelfCheck();
        return createSampleProject();
    });
    const [stage, setStage] = useState<AppStage>('path');
    const [showWelcome, setShowWelcome] = useState(true);
    const [angle, setAngle] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);
    const [showTrace, setShowTrace] = useState(true);
    const [drawMode, setDrawMode] = useState(false);
    const [showTracking, setShowTracking] = useState(false);
    const [showCamera, setShowCamera] = useState(false);
    const [showRecommendations, setShowRecommendations] = useState(false);
    const [foundry, setFoundry] = useState<FoundryState>(() => createDefaultMechanism('4bar', 'foundry-preview'));
    const [pendingCharacter, setPendingCharacter] = useState<{ project: ProjectState; summary: string; returnStage: AppStage } | null>(null);
    const [replaceCharacter, setReplaceCharacter] = useState(false);
    const [optimizerBusy, setOptimizerBusy] = useState(false);
    const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>(DEFAULT_CANVAS_VIEWPORT);
    const [commandStatus, setCommandStatus] = useState('Ready');
    const projectInputRef = useRef<HTMLInputElement>(null);
    const latestProjectRef = useRef<ProjectState | null>(null);
    const appShellRef = useRef<HTMLDivElement>(null);

    const dispatch = (action: Parameters<typeof applyProjectAction>[1]) => setProject(prev => applyProjectAction(prev, action));
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
        if (!isPlaying || drawMode || optimizerBusy) return;
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
    }, [isPlaying, drawMode, optimizerBusy, playbackDurationMs, project.settings.animationSpeed, project.settings.timingProfile]);

    useEffect(() => {
        if (stage !== 'path' && drawMode) setDrawMode(false);
    }, [stage, drawMode]);

    const mechanismConfig: GlobalConfig = {
        speed: project.settings.animationSpeed,
        rotation: 0,
        mechanisms: project.mechanisms
    };

    const setMechanismConfig: React.Dispatch<React.SetStateAction<GlobalConfig>> = update => {
        setProject(prev => {
            const current = { speed: prev.settings.animationSpeed, rotation: 0, mechanisms: prev.mechanisms };
            const next = typeof update === 'function' ? update(current) : update;
            return applyProjectAction(prev, {
                type: 'set_mechanisms',
                mechanisms: next.mechanisms,
                selectedMechanismId: prev.selectedMechanismId ?? next.mechanisms[0]?.id
            });
        });
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
        dispatch({ type: 'upsert_mechanism', mechanism: mechanismWithGeneratedPath({ ...next, activeVisualPartIds: next.targetPartId ? [next.targetPartId] : [] }) });
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

    const mergeReplacementProject = (next: ProjectState, previous: ProjectState): ProjectState => {
        const paths = Object.fromEntries(Object.entries(previous.paths).filter(([, path]) => Boolean(next.parts[path.partId])));
        const mechanisms = previous.mechanisms.map(m => {
            const targetPartId = m.targetPartId && next.parts[m.targetPartId] ? m.targetPartId : undefined;
            const targetPathId = m.targetPathId && paths[m.targetPathId] ? m.targetPathId : undefined;
            return mechanismWithGeneratedPath({ ...m, targetPartId, targetPathId, activeVisualPartIds: targetPartId ? [targetPartId] : [] });
        });
        return {
            ...next,
            paths,
            mechanisms,
            selectedMechanismId: mechanisms[0]?.id,
            selectedPathId: Object.keys(paths)[0],
            characterPackage: next.characterPackage ? {
                ...next.characterPackage,
                replacementContext: {
                    mode: 'replace-character',
                    previousStage: stage,
                    rebindingSummary: `${mechanisms.length} mechanisms preserved; ${Object.keys(paths).length} matching paths rebound.`
                }
            } : next.characterPackage
        };
    };

    const queueCharacterReview = (next: ProjectState, summary: string) => {
        const reviewed = replaceCharacter ? mergeReplacementProject(next, project) : next;
        setPendingCharacter({ project: reviewed, summary, returnStage: replaceCharacter ? (reviewed.mechanisms.length ? 'design' : 'path') : 'path' });
        dispatch({ type: 'set_processing', processing: { stage: 'ready', message: 'Review generated character package', progress: 100 } });
        setShowWelcome(true);
        setStage('character');
    };

    const runWebOnnx = async (file: File) => {
        dispatch({ type: 'set_processing', processing: { stage: 'loading-model', message: 'Loading local image analyzer', progress: 10 } });
        try {
            const result = await processImageWithWebOnnx(file, (stageName, progress) => {
                dispatch({ type: 'set_processing', processing: { stage: stageName as ProjectState['processing']['stage'], message: stageName.replaceAll('-', ' '), progress } });
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
                    rebindingSummary: replaceCharacter ? 'Review before preserving compatible mechanisms.' : 'Starts clean with no mechanisms.'
                }
            });
            queueCharacterReview(next, `${next.partOrder.length} parts · ${Object.keys(next.skeleton?.joints ?? {}).length} joints · ready to review`);
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
        setCommandStatus(`Processing ${template.label} with local ONNX`);
        dispatch({ type: 'set_processing', processing: { stage: 'loading-model', message: `Loading ${template.label}`, progress: 8 } });
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
        dispatch({ type: 'set_processing', processing: { stage: 'loading-model', message: 'Loading character package', progress: 20 } });
        try {
            queueCharacterReview(await loadCharacterPackage(files), 'Character package ready. Review before accepting.');
        } catch (error) {
            dispatch({
                type: 'set_processing',
                processing: {
                    stage: 'error',
                    message: 'Character package import failed',
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
            setProject(loadProjectSnapshot(raw));
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
            setShowWelcome(true);
            setStage('character');
        }
    };

    const editCharacterParts = () => {
        setCommandStatus('Opened actual parts / skeleton editor');
        setShowWelcome(false);
        setStage('path');
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

    const chooseSaveFolder = async () => {
        const picker = (window as Window & { showDirectoryPicker?: () => Promise<{ name?: string }> }).showDirectoryPicker;
        if (!picker) {
            setCommandStatus('Browser downloads use the default download folder');
            return;
        }
        try {
            const handle = await picker();
            setCommandStatus(`Output folder: ${handle.name ?? 'selected'}`);
        } catch {
            setCommandStatus('Choose save folder cancelled');
        }
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
                localStorage.setItem('mechanim.autosave', serializeProject(latestProjectRef.current ?? project));
            } catch {
                // ponytail: autosave is best-effort; manual Save stays available.
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
    const saveProject = () => {
        downloadText(`${project.metadata.name.replaceAll(' ', '-')}.mechanim.json`, serializeProject(project));
        setCommandStatus('Saved project snapshot');
    };
    const newProject = () => {
        if (projectHasUserWork(project) && !window.confirm('Start a new project? Unsaved paths, mechanisms, and blueprint work will be discarded.')) {
            setCommandStatus('New project cancelled');
            return;
        }
        setPendingCharacter(null);
        setProject(createSampleProject());
        setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
        setCommandStatus('Started a fresh template project');
        setShowWelcome(true);
        setStage('character');
    };
    const recoverAutosave = () => {
        try {
            const raw = localStorage.getItem('mechanim.autosave');
            if (!raw) {
                setCommandStatus('No autosave snapshot found');
                return;
            }
            setProject(loadProjectSnapshot(JSON.parse(raw)));
            setCommandStatus('Recovered autosave snapshot');
            setStage('path');
        } catch (error) {
            setCommandStatus(`Autosave recovery failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const saveWorkspaceLayout = () => {
        localStorage.setItem('mechanim.workspace', JSON.stringify({ stage, viewport: canvasViewport, toolbarVisible: project.settings.toolbarVisible, partPanelVisible: project.settings.partPanelVisible }));
        setCommandStatus('Workspace layout saved');
    };
    const restoreWorkspaceLayout = () => {
        try {
            const raw = localStorage.getItem('mechanim.workspace');
            if (!raw) {
                setCommandStatus('No workspace layout saved');
                return;
            }
            const layout = JSON.parse(raw) as Partial<{ stage: unknown; viewport: unknown; toolbarVisible: unknown; partPanelVisible: unknown }>;
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
    const disabledCommand = (reason: string) => setCommandStatus(reason);
    const themeClass = project.settings.theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-950';
    const editorStage: AppStage = stage === 'character' ? 'path' : stage;
    const welcomeOpen = showWelcome || stage === 'character';
    const closeWelcome = () => {
        setShowWelcome(false);
        if (stage === 'character') setStage('path');
    };
    const stageMeta = STAGES.find(s => s.id === stage);
    const playerDock = !welcomeOpen && editorStage !== 'foundry'
        ? <WorkspacePlayerDock isPlaying={isPlaying} setIsPlaying={setIsPlaying} angle={angle} setAngle={setAngle} speed={project.settings.animationSpeed} drawMode={drawMode} />
        : null;

    useEffect(() => {
        const shell = appShellRef.current;
        if (welcomeOpen) {
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
    }, [welcomeOpen]);

    return (
        <main className={`min-h-screen overflow-hidden ${themeClass}`} data-theme={project.settings.theme}>
            <div className="pointer-events-none fixed inset-0 opacity-70" style={{ background: 'radial-gradient(circle at 15% 10%, rgba(90,108,255,.12), transparent 28%), radial-gradient(circle at 85% 20%, rgba(90,108,255,.08), transparent 24%), linear-gradient(120deg, rgba(8,10,18,.04), transparent)' }} />
            <div ref={appShellRef} className="relative grid min-h-screen app-shell">
                <section className="relative flex min-w-0 flex-col">
                    <header className="app-header flex items-center justify-between border-b border-slate-300/70 bg-white/50 px-7 py-4 backdrop-blur-xl">
                        <div className="flex min-w-0 items-center gap-6">
                            <div>
                                <div className="accent-label text-[11px] font-black uppercase tracking-[0.28em]">MotionSmith</div>
                                <h1 className="text-2xl font-black tracking-[-0.05em]">MechAnim</h1>
                                <h2 className="current-stage-title">{stageMeta?.label}</h2>
                            </div>
                            <nav className="workspace-steps" data-testid="workspace-steps">
                                {STAGES.map((item, index) => (
                                    <button key={item.id} aria-label={item.label} onClick={() => goStage(item.id)} className={stage === item.id ? 'active' : ''}>
                                        {index + 1}. {stageNavLabel(item.id) ?? item.label}
                                    </button>
                                ))}
                            </nav>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <TopCommandBar
                                onNew={newProject}
                                onLoad={() => projectInputRef.current?.click()}
                                onRecoverAutosave={recoverAutosave}
                                onSave={saveProject}
                                onExport={() => goStage('blueprint')}
                                onZoomIn={() => zoomCanvas(1.2)}
                                onZoomOut={() => zoomCanvas(1 / 1.2)}
                                onFit={fitCanvas}
                                onSaveWorkspace={saveWorkspaceLayout}
                                onRestoreWorkspace={restoreWorkspaceLayout}
                                onResetWorkspace={resetWorkspaceLayout}
                                onOptions={() => goStage('options')}
                                onDisabled={disabledCommand}
                            />
                            {project.settings.toolbarVisible && <div className="flex gap-2" data-testid="quick-toolbar">
                                <label className="btn-secondary cursor-pointer"><Upload size={16}/> Import<input hidden type="file" accept="application/json,.json" onChange={e => e.target.files?.[0] && importProject(e.target.files[0])}/></label>
                                <button className="btn-secondary" onClick={saveProject}><Save size={16}/> Save</button>
                                <button className="btn-primary" onClick={() => goStage('blueprint')}><Download size={16}/> Export</button>
                            </div>}
                        </div>
                    </header>
                    <input ref={projectInputRef} hidden type="file" accept="application/json,.mechanim.json,.json" onChange={e => e.target.files?.[0] && importProject(e.target.files[0])}/>

                    <div className="stage-body editor-workbench relative min-h-0 flex-1 overflow-auto p-7" data-testid="shared-workbench">
                        {editorStage === 'path' && <PathEditor project={project} sortedParts={sortedParts} selectedPart={selectedPart} selectedPath={selectedPath} drawMode={drawMode} setDrawMode={setDrawMode} dispatch={dispatch} setPathPoints={setPathPoints} openTracking={() => setShowTracking(true)} isPlaying={isPlaying} setIsPlaying={setIsPlaying} angle={angle} setAngle={setAngle} onNext={() => goStage('foundry')} goStage={goStage} viewport={canvasViewport} setViewport={setCanvasViewport} />}
                        {editorStage === 'foundry' && <MechanismFoundry project={project} foundry={foundry} setFoundry={setFoundry} selectedPart={selectedPart} selectedPath={selectedPath} goStage={goStage} onExport={(pkg) => {
                            const existingTarget = project.mechanisms.find(m =>
                                m.targetPartId === pkg.targetPartId &&
                                m.targetPathId === pkg.targetPathId &&
                                preferredMotionJointId(project, m.targetPartId, m.targetAnchorJointId) === pkg.targetAnchorJointId
                            );
                            const mech = mechanismWithGeneratedPath({
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
                            dispatch({ type: 'set_foundry_export', foundryExport: pkg });
                            dispatch({ type: 'upsert_mechanism', mechanism: mech });
                            setStage('design');
                        }} />}
                        {editorStage === 'design' && <MechanismDesign project={project} selectedMechanism={selectedMechanism} mechanismConfig={mechanismConfig} setMechanismConfig={setMechanismConfig} updateMechanism={updateMechanism} dispatch={dispatch} isPlaying={isPlaying} setIsPlaying={setIsPlaying} showTrace={showTrace} setShowTrace={setShowTrace} angle={angle} setAngle={setAngle} onOptimize={optimizeSelectedMechanism} onRecommendations={() => setShowRecommendations(true)} optimizerBusy={optimizerBusy} exportSvg={exportMechanismSvg} exportDxf={exportMechanismDxf} onBlueprint={() => goStage('blueprint')} goStage={goStage} viewport={canvasViewport} setViewport={setCanvasViewport} />}
                        {editorStage === 'blueprint' && <BlueprintExport project={project} config={mechanismConfig} setConfig={setMechanismConfig} dispatch={dispatch} goStage={goStage} isPlaying={isPlaying} angle={angle} setAngle={setAngle} viewport={canvasViewport} setViewport={setCanvasViewport} />}
                        {editorStage === 'options' && <Options project={project} dispatch={dispatch} goStage={goStage} />}
                        {playerDock && <div className="stage-player-row" data-testid="stage-player-row" aria-label="Shared playback controls">{playerDock}</div>}
                    </div>
                    <WorkflowStatusStrip stage={editorStage} project={project} selectedPart={selectedPart} selectedPath={selectedPath} />
                    <footer className="status-bar" data-testid="status-bar">{commandStatus} · parts:{project.partOrder.length} · paths:{Object.keys(project.paths).length} · mechs:{project.mechanisms.length} · zoom {Math.round(canvasViewport.zoom * 100)}%</footer>
                </section>
            </div>
            {welcomeOpen && <CharacterSelection project={project} pendingCharacter={pendingCharacter} replaceCharacter={replaceCharacter} setReplaceCharacter={setReplaceCharacter} starterTemplates={STARTER_IMAGE_TEMPLATES} onStarterImage={loadStarterImage} onAccept={() => { if (!pendingCharacter) return; setProject(pendingCharacter.project); setPendingCharacter(null); setShowWelcome(false); setStage(pendingCharacter.returnStage); }} onDiscard={() => setPendingCharacter(null)} onSample={() => { setPendingCharacter(null); setProject(createSampleProject()); setShowWelcome(false); setStage('path'); }} onProcess={runWebOnnx} onCamera={() => setShowCamera(true)} onPackage={importCharacterPackage} onImport={importProject} onEditCharacter={editCharacterParts} onSaveSkeleton={saveSkeleton} onChooseSaveFolder={chooseSaveFolder} onClose={closeWelcome} />}
            <CameraCaptureDialog isOpen={showCamera} onClose={() => setShowCamera(false)} onCapture={file => { setShowCamera(false); runWebOnnx(file); }} />
            <MechanismRecommendationSheet isOpen={showRecommendations} project={project} selectedPart={selectedPart} selectedPath={selectedPath} onClose={() => setShowRecommendations(false)} onApply={mechanism => { dispatch({ type: 'upsert_mechanism', mechanism }); setShowRecommendations(false); setStage('design'); }} />
            <TrackingModal isOpen={showTracking} onClose={() => setShowTracking(false)} onTransfer={path => { setPathPoints(path, 'tracked'); setShowTracking(false); setStage('path'); }} />
        </main>
    );
};

const TopCommandBar = ({ onNew, onLoad, onRecoverAutosave, onSave, onExport, onZoomIn, onZoomOut, onFit, onSaveWorkspace, onRestoreWorkspace, onResetWorkspace, onOptions, onDisabled }: {
    onNew: () => void;
    onLoad: () => void;
    onRecoverAutosave: () => void;
    onSave: () => void;
    onExport: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
    onSaveWorkspace: () => void;
    onRestoreWorkspace: () => void;
    onResetWorkspace: () => void;
    onOptions: () => void;
    onDisabled: (reason: string) => void;
}) => {
    const unavailable = (label: string) => () => onDisabled(`${label} is not available in the browser build yet.`);
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const toggleMenu = (id: string) => (event: React.MouseEvent) => {
        event.preventDefault();
        setOpenMenu(openMenu === id ? null : id);
    };
    const runCommand = (fn: () => void) => () => {
        fn();
        setOpenMenu(null);
    };
    return <nav className="command-bar" aria-label="Application command menu" data-testid="top-command-bar">
        <details open={openMenu === 'file'}><summary onClick={toggleMenu('file')}>File</summary><div className="command-menu">
            <button onClick={runCommand(onNew)}>New</button>
            <button onClick={runCommand(onLoad)}>Load Project…</button>
            <button onClick={runCommand(onRecoverAutosave)}>Recover Autosave…</button>
            <button onClick={runCommand(onSave)}>Save Project</button>
            <button onClick={runCommand(onSave)}>Save Project As…</button>
            <button onClick={runCommand(onExport)}>Export Blueprint Package</button>
            <button onClick={runCommand(onSave)}>Export Project Copy</button>
            <button onClick={runCommand(unavailable('Exit'))}>Exit</button>
        </div></details>
        <details open={openMenu === 'view'}><summary onClick={toggleMenu('view')}>View</summary><div className="command-menu">
            <button onClick={runCommand(onZoomIn)}>Zoom In</button>
            <button onClick={runCommand(onZoomOut)}>Zoom Out</button>
            <button onClick={runCommand(onFit)}>Zoom to Fit</button>
            <button onClick={runCommand(onFit)}>Reset View</button>
            <button onClick={runCommand(onSaveWorkspace)}>Save Workspace Layout</button>
            <button onClick={runCommand(onRestoreWorkspace)}>Restore Workspace Layout</button>
            <button onClick={runCommand(onResetWorkspace)}>Reset Workspace Layout</button>
        </div></details>
        <details open={openMenu === 'edit'}><summary onClick={toggleMenu('edit')}>Edit</summary><div className="command-menu">
            <button onClick={runCommand(unavailable('Undo'))}>Back (Undo)</button>
            <button onClick={runCommand(unavailable('Redo'))}>Forward (Redo)</button>
        </div></details>
        <details open={openMenu === 'options'}><summary onClick={toggleMenu('options')}>Options</summary><div className="command-menu">
            <button onClick={runCommand(onOptions)}>Preferences…</button>
        </div></details>
        <details open={openMenu === 'help'}><summary onClick={toggleMenu('help')}>Help</summary><div className="command-menu">
            <button onClick={runCommand(unavailable('Check for Updates'))}>Check for Updates…</button>
            <button onClick={runCommand(() => onDisabled('MechAnim web port · local ONNX, persistent scene state, blueprint export.'))}>About…</button>
        </div></details>
    </nav>;
};

const CanvasZoomToolbar = ({ viewport, setViewport }: { viewport: CanvasViewport; setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>> }) => {
    const zoomBy = (factor: number) => setViewport(prev => ({ ...prev, zoom: clampCanvasZoom(prev.zoom * factor) }));
    const reset = () => setViewport(DEFAULT_CANVAS_VIEWPORT);
    return <div className="canvas-zoom-toolbar" onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
        <span data-testid="canvas-zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
        <button type="button" aria-label="Fit view" onClick={reset}>Fit</button>
    </div>;
};

const WorkspacePlayerDock = ({ isPlaying, setIsPlaying, angle, setAngle, speed, drawMode }: {
    isPlaying: boolean;
    setIsPlaying: (value: boolean) => void;
    angle: number;
    setAngle: React.Dispatch<React.SetStateAction<number>>;
    speed: number;
    drawMode: boolean;
}) => {
    const progress = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
    const percent = Math.round(progress * 100);
    return <aside className={`player-dock ${drawMode ? 'is-drawing' : ''}`} data-testid="workspace-player-dock" aria-label="Shared animation controls">
        <div className="section-title">Animation</div>
        <div className="player-actions">
            <button type="button" aria-label="Shared transport toggle" onClick={() => setIsPlaying(!isPlaying)}>{isPlaying ? 'Ⅱ' : '▶'}</button>
            <button type="button" aria-label="Shared scrub restart" onClick={() => setAngle(0)}>↺</button>
            <span>{speed.toFixed(1)}x</span>
        </div>
        <input
            aria-label="Workspace scrubber"
            type="range"
            min={0}
            max={100}
            value={percent}
            onChange={event => setAngle((Number(event.currentTarget.value) / 100) * Math.PI * 2)}
        />
    </aside>;
};

const EDITOR_PANE_CONTRACT = {
    left: { testId: 'stage-left-pane', ariaLabel: 'Workflow and primary actions' },
    center: { testId: 'stage-canvas-pane', ariaLabel: 'Shared canvas' },
    right: { testId: 'stage-right-inspector', ariaLabel: 'Selected item inspector' }
} as const;

type PaneSlot<Kind extends 'workflow' | 'canvas' | 'inspector'> = Readonly<{
    kind: Kind;
    content: React.ReactNode;
}>;
type StageLayoutSpec = Readonly<{
    workflow: PaneSlot<'workflow'>;
    canvas: PaneSlot<'canvas'>;
    inspector: PaneSlot<'inspector'>;
}>;
const workflowPane = (content: React.ReactNode): PaneSlot<'workflow'> => ({ kind: 'workflow', content });
const canvasPane = (content: React.ReactNode): PaneSlot<'canvas'> => ({ kind: 'canvas', content });
const inspectorPane = (content: React.ReactNode): PaneSlot<'inspector'> => ({ kind: 'inspector', content });

const EditorStageFrame = ({ stage, layout, className = '' }: { stage: AppStage; layout: StageLayoutSpec; className?: string }) => (
    <div className={`editor-stage-frame ${className}`.trim()} data-stage={stage}>
        <aside className="stage-left-pane workspace p-5" data-pane-kind={layout.workflow.kind} data-testid={EDITOR_PANE_CONTRACT.left.testId} aria-label={EDITOR_PANE_CONTRACT.left.ariaLabel}>
            <div className="stage-left-pane-content" data-testid="editor-sidebar">{layout.workflow.content}</div>
        </aside>
        <section className="stage-canvas-pane" data-pane-kind={layout.canvas.kind} data-testid={EDITOR_PANE_CONTRACT.center.testId} aria-label={EDITOR_PANE_CONTRACT.center.ariaLabel}>{layout.canvas.content}</section>
        <aside className="stage-right-inspector workspace p-5" data-pane-kind={layout.inspector.kind} data-testid={EDITOR_PANE_CONTRACT.right.testId} aria-label={EDITOR_PANE_CONTRACT.right.ariaLabel}>{layout.inspector.content}</aside>
    </div>
);

const StageLeftSummary = ({ project, title, kicker, stage, goStage, children }: {
    project: ProjectState;
    title: string;
    kicker: string;
    stage: AppStage;
    goStage?: (stage: AppStage) => void;
    children: React.ReactNode;
}) => {
    const linkClass = (targets: AppStage[]) => `workspace-side-link ${targets.includes(stage) ? 'active' : ''}`;
    return <>
        <div className="stage-project-card rounded-3xl bg-slate-100 p-4">
            <div className="flex items-center gap-3">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white">MS</div>
                <div>
                    <div className="font-black tracking-tight text-slate-900">{project.metadata.name}</div>
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{kicker}</div>
                </div>
            </div>
            <div className="mt-3 text-xs font-bold text-slate-500">
                <div>{project.partOrder.length} parts · {Object.keys(project.paths).length} paths · {project.mechanisms.length} mechanisms</div>
                <div>Grid {project.settings.physicalKit.gridPitchMm} mm · Shared canvas</div>
            </div>
        </div>
        {goStage && <nav className="stage-nav-compact">
            <div className="section-title">Workflow tabs</div>
            {STAGE_PANE_NAV_ITEMS.map(item => <button key={item.ariaLabel} aria-label={item.ariaLabel} className={linkClass(item.activeStages)} onClick={() => goStage(item.target)}><StagePaneNavIcon icon={item.icon}/> {item.label}</button>)}
        </nav>}
        <div className="stage-workflow-block">
            <div className="section-title">{title}</div>
            {children}
        </div>
    </>;
};

const WorkflowStatusStrip = ({ stage, project, selectedPart, selectedPath }: { stage: AppStage; project: ProjectState; selectedPart?: BodyPartLayer; selectedPath?: ProjectMotionPath }) => {
    const validation = validateForFabrication(project);
    const enabledMechanisms = project.mechanisms.filter(m => m.visible && m.enabled !== false);
    const stageLabel = STAGES.find(item => item.id === stage)?.label ?? stage;
    let blocker = 'No blocker';
    let nextAction = 'Keep going';
    if (!project.partOrder.length) {
        blocker = 'No character loaded';
        nextAction = 'Open a template, load a package, or create from image.';
    } else if (stage === 'path') {
        blocker = selectedPart?.locked ? `${selectedPart.name} is locked` : (selectedPath && selectedPath.points.length >= 3 ? 'No blocker' : 'Need at least 3 path points');
        nextAction = selectedPath && selectedPath.points.length >= 3 ? 'Open Foundry or Design to attach a mechanism.' : 'Press Draw free path and click a few motion points.';
    } else if (stage === 'foundry') {
        blocker = selectedPath && selectedPath.points.length >= 3 ? 'No blocker' : 'Path is not ready';
        nextAction = selectedPath && selectedPath.points.length >= 3 ? 'Choose a mechanism and Add to Mechanism Tab.' : 'Return to Path Editor and draw a path.';
    } else if (stage === 'design') {
        blocker = enabledMechanisms.length ? 'No blocker' : 'No enabled mechanism';
        nextAction = enabledMechanisms.length ? 'Review target part/path/anchor, then Blueprint Export.' : 'Use Get recommendations or add from Foundry.';
    } else if (stage === 'blueprint') {
        blocker = validation.errors[0] ?? validation.warnings[0] ?? 'No blocker';
        nextAction = validation.errors.length ? 'Use the recovery action or return to Mechanism Design.' : 'Generate package, then download the guide and cut sheet.';
    } else if (stage === 'options') {
        nextAction = 'Tune settings, then return to the current workflow stage.';
    } else {
        nextAction = 'Choose a template or browser ONNX capture.';
    }
    return <div className="workflow-status-strip" data-testid="workflow-status-strip">
        <span><strong>Step</strong> {stageLabel}</span>
        <span><strong>Blocker</strong> {blocker}</span>
        <span><strong>Next</strong> {nextAction}</span>
    </div>;
};

const CharacterSelection = ({ project, pendingCharacter, replaceCharacter, setReplaceCharacter, starterTemplates, onStarterImage, onAccept, onDiscard, onSample, onProcess, onCamera, onPackage, onImport, onEditCharacter, onSaveSkeleton, onChooseSaveFolder, onClose }: {
    project: ProjectState;
    pendingCharacter: { project: ProjectState; summary: string; returnStage: AppStage } | null;
    replaceCharacter: boolean;
    setReplaceCharacter: (v: boolean) => void;
    starterTemplates: StarterImageTemplate[];
    onStarterImage: (template: StarterImageTemplate) => void;
    onAccept: () => void;
    onDiscard: () => void;
    onSample: () => void;
    onProcess: (file: File) => void;
    onCamera: () => void;
    onPackage: (files: FileList | File[]) => void;
    onImport: (file: File) => void;
    onEditCharacter: () => void;
    onSaveSkeleton: () => void;
    onChooseSaveFolder: () => void;
    onClose: () => void;
}) => {
    const reviewedProject = pendingCharacter?.project ?? project;
    const artifact = reviewedProject.characterPackage;
    const isPlainReview = artifact?.replacementContext?.mode !== 'replace-character';
    const isReplacementReview = artifact?.replacementContext?.mode === 'replace-character';
    const statusOpen = Boolean(pendingCharacter || project.settings.detailedProcessingSteps || ['loading-model', 'running-model', 'normalizing', 'error'].includes(project.processing.stage));
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
    const dialogRef = useRef<HTMLElement>(null);

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogRef.current?.focus();
        return () => previousFocus?.isConnected && previousFocus.focus();
    }, []);

    const trapDialogFocus = (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key !== 'Tab') return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = Array.from(dialog.querySelectorAll(
            'summary, button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((element): element is HTMLElement => element instanceof HTMLElement && element.offsetParent !== null);
        if (!focusables.length) {
            event.preventDefault();
            dialog.focus();
            return;
        }
        const first = focusables[0];
        const last = focusables.at(-1)!;
        const active = document.activeElement;
        if (!dialog.contains(active)) {
            event.preventDefault();
            first.focus();
        } else if (event.shiftKey && (active === first || active === dialog)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    return (
    <div className="modal-backdrop welcome-backdrop" role="presentation">
    <section ref={dialogRef} className="modal-sheet welcome-dialog animate-rise" role="dialog" aria-modal="true" aria-labelledby="welcome-dialog-title" data-testid="welcome-dialog" tabIndex={-1} onKeyDown={trapDialogFocus}>
    <div className="welcome-titlebar">
        <div>
            <div className="section-title">Welcome workspace</div>
            <h2 id="welcome-dialog-title">Start like a CAD editor</h2>
        </div>
    </div>
    <div className="onboarding-page">
        <section className="onboarding-hero">
            <div className="onboarding-copy animate-rise">
                <div className="landing-brand">
                    <span>MotionSmith</span>
                    <small>local ONNX · real blueprints</small>
                </div>
                <h1>MechAnim</h1>
                <h3>Draw the path. Build the motion.</h3>
                <p>Start with a rigged character, sketch a free path, fit a mechanism, then export the assembly guide.</p>
                <div className="landing-steps" aria-label="Workflow preview">
                    <span>1 Character</span>
                    <span>2 Free path</span>
                    <span>3 Mechanism</span>
                    <span>4 Blueprint</span>
                </div>
            </div>

            <div className="landing-board">
                <div className="landing-sketch" aria-hidden="true">
                    <svg viewBox="0 0 460 420" role="img">
                        <defs>
                            <pattern id="landing-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                                <path d="M32 0H0V32" fill="none" stroke="#e2e8f0" strokeWidth="1"/>
                            </pattern>
                            <filter id="landing-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#8b5cf6" floodOpacity=".16"/>
                            </filter>
                        </defs>
                        <rect width="460" height="420" rx="32" fill="#fff"/>
                        <rect x="18" y="18" width="424" height="384" rx="28" fill="url(#landing-grid)" stroke="#dbe3f1"/>
                        <g filter="url(#landing-soft-shadow)">
                            <rect x="190" y="72" width="80" height="74" rx="26" fill="#d8dee8"/>
                            <rect x="154" y="150" width="152" height="138" rx="34" fill="#cbd5e1"/>
                            <rect x="96" y="164" width="50" height="138" rx="25" fill="#d8dee8" transform="rotate(13 121 233)"/>
                            <rect x="312" y="162" width="50" height="138" rx="25" fill="#d8dee8" transform="rotate(-13 337 231)"/>
                            <rect x="166" y="296" width="56" height="128" rx="28" fill="#d8dee8" transform="rotate(4 194 360)"/>
                            <rect x="244" y="296" width="56" height="128" rx="28" fill="#d8dee8" transform="rotate(-4 272 360)"/>
                        </g>
                        <path d="M333 180 C395 154 424 204 394 248 S342 295 354 336" fill="none" stroke="#8b5cf6" strokeWidth="8" strokeLinecap="round"/>
                        <path d="M333 180 C392 158 421 205 394 248 S342 295 354 336" fill="none" stroke="#f472b6" strokeWidth="3" strokeDasharray="8 8" strokeLinecap="round"/>
                        {[[230,118],[230,172],[230,226],[154,158],[306,158],[132,232],[328,232],[194,340],[272,340]].map(([x, y]) => (
                            <circle key={`${x}-${y}`} cx={x} cy={y} r="7" fill="#fff" stroke="#64748b" strokeWidth="5"/>
                        ))}
                    </svg>
                    <div className="landing-sketch-label">
                        <strong>Starter preview</strong>
                        <span>6 parts · 17 joints · 1 path</span>
                    </div>
                </div>

                <div className="template-gallery" data-testid="template-gallery">
                    <button type="button" className="template-tile primary" onClick={onSample}>
                        <span className="template-kicker">Start fastest</span>
                        <strong>Waving arm</strong>
                        <span>Ready path + four-bar.</span>
                        <b><Sparkles size={16}/> Open Waving arm</b>
                    </button>
                    {starterTemplates.map(template => (
                        <button key={template.id} type="button" className="template-tile starter cursor-pointer" onClick={() => onStarterImage(template)}>
                            <img className="starter-thumb" src={template.url} alt="" />
                            <span className="template-kicker">Image</span>
                            <strong>{template.label}</strong>
                            <span>Browser ONNX rigging.</span>
                            <b><BrainCircuit size={16}/> Create from {template.id}</b>
                        </button>
                    ))}
                    <button type="button" className="template-tile cursor-pointer" onClick={() => packageInputRef.current?.click()}>
                        <span className="template-kicker">Package</span>
                        <strong>Blank character</strong>
                        <span>Load art + skeleton.</span>
                        <b><FileJson size={16}/> Load package</b>
                    </button>
                    <input ref={packageInputRef} data-testid="blank-package-input" hidden type="file" multiple accept=".json,.yaml,.yml,image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => {
                        const files = e.currentTarget.files ? Array.from(e.currentTarget.files) as File[] : [];
                        e.currentTarget.value = '';
                        if (files.length) onPackage(files);
                    }}/>
                    <button type="button" className="template-tile cursor-pointer" onClick={() => onnxInputRef.current?.click()}>
                        <span className="template-kicker">Private</span>
                        <strong>Create from image</strong>
                        <span>Local on-device processing.</span>
                        <b><BrainCircuit size={16}/> Choose image</b>
                    </button>
                    <input ref={onnxInputRef} data-testid="onnx-input" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
                        const file = e.currentTarget.files?.[0];
                        e.currentTarget.value = '';
                        if (file) onProcess(file);
                    }}/>
                    <button type="button" className="template-tile cursor-pointer" onClick={onCamera}>
                        <span className="template-kicker">Camera</span>
                        <strong>Capture Camera</strong>
                        <span>Capture one frame.</span>
                        <b><Camera size={16}/> Capture Camera</b>
                    </button>
                </div>
            </div>
        </section>

        <section className="onboarding-secondary">
            <div className="secondary-actions">
                <button type="button" className="btn-secondary cursor-pointer" onClick={() => importInputRef.current?.click()}><Upload size={16}/> Import project</button><input ref={importInputRef} data-testid="onboarding-import-input" hidden type="file" accept="application/json,.json" onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (file) onImport(file);
                }}/>
                <label className="replace-toggle"><input aria-label="Replace current character and preserve compatible mechanisms" type="checkbox" checked={replaceCharacter} onChange={e => setReplaceCharacter(e.target.checked)} /> Preserve mechanisms when replacing character</label>
            </div>
            <details className="advanced-panel landing-tools" data-testid="character-processing-panel">
                <summary>Advanced import tools</summary>
                <div className="landing-tools-grid">
                    <div>
                        <h4 className="section-title">Processing Steps</h4>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button className="btn-primary" onClick={() => onnxInputRef.current?.click()}>Process Image (Skeleton)</button>
                            <button className="btn-secondary" onClick={onEditCharacter}>Edit Skeleton</button>
                            <button className="btn-secondary" onClick={onSaveSkeleton}>Save Skeleton</button>
                            <button className="btn-secondary" onClick={() => onnxInputRef.current?.click()}>Generate Body Parts</button>
                        </div>
                    </div>
                    <div>
                        <h4 className="section-title">Recognition Editing</h4>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button className="btn-secondary" onClick={onEditCharacter}>Edit Parts / Skeleton / Boxes</button>
                            <button className="btn-secondary" onClick={onEditCharacter}>Edit Skeleton Joints</button>
                        </div>
                    </div>
                    <div>
                        <h4 className="section-title">Download / Output Location</h4>
                        <div className="mt-3 flex flex-wrap gap-2"><button className="btn-secondary" onClick={onChooseSaveFolder}>Choose Save Folder…</button></div>
                        <p className="mt-2 text-xs font-bold text-slate-500">Web exports still use browser-safe downloads.</p>
                    </div>
                </div>
            </details>
            <details className="advanced-panel import-status" open={statusOpen}>
                <summary>Import status</summary>
                <div className="mt-3"><ProgressBlock project={project} /></div>
                {pendingCharacter && <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">review generated package</div>
                    <div className="mt-1 font-bold">{pendingCharacter.project.metadata.name}</div>
                    <div className="text-sm text-slate-600">{pendingCharacter.summary}</div>
                    <div className="mt-2 text-xs text-slate-500">{pendingCharacter.project.characterPackage?.replacementContext?.rebindingSummary ?? 'Starts clean with no mechanisms.'}</div>
                    <div className="mt-4 flex gap-2"><button className="btn-primary" onClick={onAccept}>Accept package</button><button className="btn-secondary" onClick={onDiscard}>Discard</button></div>
                </div>}
                <details className="advanced-panel mt-6">
                    <summary>Technical checks</summary>
                    <div className="mt-3 grid gap-3 text-sm text-slate-600">
                        {checks.map(item => <div key={item.label} className="flex items-center gap-2">
                            {item.ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-amber-600" />}
                            <span className={item.ok ? '' : 'font-bold text-amber-700'}>{item.label}</span>
                        </div>)}
                    </div>
                </details>
            </details>
        </section>
    </div>
    <div className="welcome-footer"><button type="button" className="btn-secondary" onClick={onClose}>Start editing</button></div>
    </section>
    </div>
    );
};

const CameraCaptureDialog = ({ isOpen, onClose, onCapture }: { isOpen: boolean; onClose: () => void; onCapture: (file: File) => void }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting');
    const [error, setError] = useState('');
    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        const stopStream = () => {
            streamRef.current?.getTracks().forEach(track => track.stop());
            streamRef.current = null;
            if (videoRef.current) videoRef.current.srcObject = null;
        };
        setStatus('starting');
        setError('');
        const camera = navigator.mediaDevices;
        if (!camera?.getUserMedia) {
            setStatus('error');
            setError('Camera unavailable in this browser. Upload an image instead.');
            return stopStream;
        }
        const waitForPreview = (video: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
            let timeout = 0;
            const cleanup = () => {
                window.clearTimeout(timeout);
                video.removeEventListener('loadedmetadata', ready);
                video.removeEventListener('canplay', ready);
            };
            const ready = () => {
                if (!video.videoWidth || !video.videoHeight) return;
                cleanup();
                resolve();
            };
            video.addEventListener('loadedmetadata', ready);
            video.addEventListener('canplay', ready);
            timeout = window.setTimeout(() => {
                cleanup();
                reject(new Error('Camera preview did not start. Try closing and reopening camera capture.'));
            }, 7000);
            ready();
        });
        camera.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
            .then(async stream => {
                if (!active) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    void videoRef.current.play().catch(() => undefined);
                    await waitForPreview(videoRef.current);
                } else {
                    throw new Error('Camera preview element is missing.');
                }
                if (active) setStatus('ready');
            })
            .catch((cause: unknown) => {
                if (!active) return;
                stopStream();
                const name = cause instanceof DOMException ? cause.name : cause instanceof Error ? cause.name : 'CameraError';
                const message = cause instanceof Error ? cause.message : String(cause);
                setStatus('error');
                setError(name === 'NotAllowedError' ? 'Camera permission denied. Allow camera access or use Create from image.' : `Camera error: ${message}`);
            });
        return () => {
            active = false;
            stopStream();
        };
    }, [isOpen]);

    const captureFrame = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || status !== 'ready' || !video.videoWidth || !video.videoHeight) {
            setError('Camera preview is still starting. Wait for the live preview or use Create from image.');
            return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
            if (!blob) {
                setStatus('error');
                setError('Could not capture a camera frame.');
                return;
            }
            onCapture(new File([blob], `camera-frame-${Date.now()}.png`, { type: 'image/png' }));
        }, 'image/png');
    };

    if (!isOpen) return null;
    return <div className="modal-backdrop" role="presentation">
        <section className="modal-sheet camera-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-dialog-title" data-testid="camera-dialog">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="section-title">Camera Capture</div>
                    <h3 id="camera-dialog-title">Camera Capture</h3>
                </div>
                <button className="btn-secondary" onClick={onClose}>Cancel</button>
            </div>
            <div className="camera-preview mt-4">
                <video ref={videoRef} muted playsInline data-testid="camera-preview-video" className={status === 'ready' ? '' : 'hidden'} />
                {status !== 'ready' && <div className="camera-placeholder">{status === 'starting' ? 'Requesting browser camera…' : 'Camera preview unavailable'}</div>}
            </div>
            <canvas ref={canvasRef} hidden />
            {status === 'error' && <div className="error" data-testid="camera-error">{error}</div>}
            {status === 'ready' && <div className="ok">Camera Ready. Capture one frame to process with local ONNX.</div>}
            <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-primary" disabled={status !== 'ready'} onClick={captureFrame}><Camera size={16}/> Capture frame</button>
                <button className="btn-secondary" onClick={onClose}>Close</button>
            </div>
        </section>
    </div>;
};

const ProgressBlock = ({ project }: { project: ProjectState }) => {
    const p = project.processing;
    const steps: Array<{ stage: ProjectState['processing']['stage']; label: string }> = [
        { stage: 'selecting', label: 'Choose source files' },
        { stage: 'loading-model', label: 'Load local model or package' },
        { stage: 'running-onnx', label: 'Run browser ONNX analysis' },
        { stage: 'extracting-parts', label: 'Extract character parts' },
        { stage: 'normalizing', label: 'Normalize to the physical sheet' },
        { stage: 'ready', label: 'Ready for review' }
    ];
    const activeIndex = Math.max(0, steps.findIndex(step => step.stage === p.stage));
    return <div className="progress-card rounded-3xl p-5">
        <div className="flex items-center gap-3">
            {p.stage === 'error' ? <AlertCircle className="text-red-400"/> : p.stage === 'ready' ? <CheckCircle2 className="text-emerald-400"/> : <Loader2 className="progress-icon animate-spin"/>}
            <div>
                <div className="font-bold capitalize">{p.message}</div>
                <div className="progress-stage text-xs">{p.stage}</div>
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
    const pathLocked = Boolean(selectedPart?.locked);
    const pointCount = selectedPath?.points.length ?? 0;
    const jointOptions = selectedPart ? motionAnchorJointIds(project, selectedPart.id) : [];
    const selectedIkJointId = selectedPart
        ? preferredMotionJointId(project, selectedPart.id, selectedPath?.targetAnchorJointId, { preferDistalWhenRoot: !selectedPath?.targetAnchorJointId })
        : undefined;
    const ikDescriptor = selectedPart ? describeMotionChain(project, selectedPart.id, selectedIkJointId) : undefined;
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
    const updateSelectedAnchor = (anchorJointId: string) => {
        if (!selectedPart || pathLocked) return;
        const anchor = project.skeleton?.joints[anchorJointId]?.position;
        dispatch({ type: 'update_part', partId: selectedPart.id, updates: { anchorJointId, localPivotOffset: anchor ? localPivotOffsetForScene(selectedPart, anchor) : selectedPart.localPivotOffset, localPivotJointId: anchorJointId } });
    };
    const updateIkHandle = (targetAnchorJointId: string) => updatePath({ targetAnchorJointId });
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
    return <EditorStageFrame
        stage="path"
        className="path-stage-frame"
        layout={{
            workflow: workflowPane(<div className="path-panel stage-pane-stack" data-testid="novice-path-panel">
            <StageLeftSummary project={project} title="Free path workflow" kicker="parts · paths · IK" stage="path" goStage={goStage}>
                <h3>Draw the motion path</h3>
                <p>Choose a body part, press Draw free path, then sketch directly on the shared canvas.</p>
                <select aria-label="Selected body part" className="field mt-2" value={selectedPart?.id ?? ''} onChange={e => dispatch({ type: 'select_part', partId: e.target.value })}>
                    {sortedParts.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
                </select>
                <div className="mt-3 flex flex-col gap-2">
                    <button className={`btn-primary ${drawMode ? 'active' : ''}`} disabled={pathLocked} onClick={() => setDrawMode(!drawMode)}><Route size={16}/>{drawMode ? 'Drawing free path' : 'Draw free path'}</button>
                    <button className="btn-secondary" disabled={!selectedPath || pathLocked} onClick={clearPath}><Trash2 size={16}/> Clear path</button>
                    <button className="btn-secondary" disabled={pointCount < 3 || pathLocked} onClick={onNext}>Next: choose mechanism</button>
                </div>
                <div className="free-draw-status" data-testid="free-draw-status">{selectedPath ? `${pointCount} points · ${selectedPath.id}` : '0 points · none'}{pathLocked ? ' · locked part' : ''}</div>
                {selectedPath && <div className="mt-3 space-y-3" data-testid="path-shape-controls">
                    <div className="flex gap-2">
                        <button className={`btn-secondary ${!selectedPath.closed ? 'active' : ''}`} disabled={pathLocked} onClick={() => updatePath({ closed: false })}>Open</button>
                        <button className={`btn-secondary ${selectedPath.closed ? 'active' : ''}`} disabled={pathLocked} onClick={() => updatePath({ closed: true })}>Closed</button>
                    </div>
                    <MiniNumber label="Smoothness" value={selectedPath.smoothness ?? 0} min={0} max={100} step={1} disabled={pathLocked} onChange={smoothness => updatePath({ smoothness })}/>
                </div>}
                {!selectedPath && <div className="warning">No path for this part yet. Draw or track a path before fitting a mechanism.</div>}
                {selectedPath && selectedPath.points.length < 3 && <div className="warning">Add at least 3 path points before choosing a mechanism.</div>}
                {pathLocked && <div className="warning">Unlock the selected part before editing, deleting, drawing, or tracking its path.</div>}
                {selectedPath?.warnings.map((w, i) => <div key={`${w}-${i}`} className="warning">{w}</div>)}
                <details className="advanced-panel mt-4">
                    <summary>Path options</summary>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button className="btn-secondary" disabled={pathLocked} onClick={openTracking}><Camera size={16}/> Track from video</button>
                        <button className="btn-secondary" aria-label={isPlaying ? 'Play / Stop' : 'Play'} onClick={() => setIsPlaying(!isPlaying)}><Play size={16}/>{isPlaying ? 'Stop' : 'Play'}</button>
                        <button className="btn-secondary" onClick={() => setAngle(0)}>Reset</button>
                        {selectedPath && <button className="btn-secondary" disabled={pathLocked} onClick={() => updatePath({ visible: !selectedPath.visible })}>{selectedPath.visible ? 'Hide path' : 'Show path'}</button>}
                        {selectedPath && <button className="btn-secondary" disabled={pathLocked} onClick={() => updatePath({ enabled: !selectedPath.enabled })}>{selectedPath.enabled ? 'Disable' : 'Enable'}</button>}
                        {selectedPoint !== null && <button className="btn-secondary" disabled={pathLocked} onClick={deletePoint}>Delete point</button>}
                    </div>
                    <div className="mt-3 text-sm text-slate-600">{selectedPath ? `${selectedPath.source} · ${selectedPath.duration} ms · ${selectedPath.timedPoints?.length ?? 0} timed samples` : 'No timing yet'}</div>
                </details>
                {project.settings.partPanelVisible ? <details className="advanced-panel mt-4" data-testid="rig-structure-drawer">
                    <summary>Advanced part setup</summary>
                    <div className="mt-3 space-y-3">
                        <div>
                            <h4 className="section-title">Parts + skeleton</h4>
                            <p className="mt-1 text-sm text-slate-600">Topology changes live in this workflow column so the inspector stays focused on the selected item.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button className="btn-secondary" onClick={addLayer}><Plus size={16}/> Add body part</button>
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
            canvas: canvasPane(<div className="path-canvas-shell workspace overflow-hidden p-0">
            <CanvasZoomToolbar viewport={viewport} setViewport={setViewport} />
            <SceneSketch svgRef={svgRef} project={project} selectedPath={selectedPath} dragPoint={dragPoint} selectedPoint={selectedPoint} setDragPoint={setDragPoint} setSelectedPoint={setSelectedPoint} onPointMove={movePoint} onPointUp={stopDrawing} onCanvasDown={onCanvasDown} dispatch={dispatch} drawMode={drawMode} pathLocked={pathLocked} isPlaying={isPlaying} angle={angle} viewport={viewport}/>
        </div>),
            inspector: inspectorPane(<div className="path-inspector stage-pane-stack">
            <div>
                <div className="section-title">Selected inspector</div>
                <h3>{selectedPart?.name ?? 'No body part selected'}</h3>
                <p className="mt-2 text-sm text-slate-600">Fine tune the selected path anchor, IK handle, fold direction, and point readout here.</p>
            </div>
            {selectedPath && <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
                <div className="font-bold text-slate-800">Path detail</div>
                <div>{selectedPath.id} · {pointCount} points · {selectedPath.closed ? 'closed' : 'open'}</div>
                <div>{selectedPoint !== null && selectedPath.points[selectedPoint] ? `Point ${selectedPoint + 1}: ${selectedPath.points[selectedPoint].x.toFixed(0)}, ${selectedPath.points[selectedPoint].y.toFixed(0)}` : 'Select a point on the canvas for point-level edits.'}</div>
            </div>}
            <div className="rig-helper" data-testid="quick-rig-helper">
                <h4 className="section-title">Body rig</h4>
                <h3>Easy IK setup</h3>
                <p>Anchor is where this part attaches. IK handle is the joint that follows your drawn path.</p>
                {selectedPart && <label className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${pathLocked ? 'opacity-50' : ''}`}>Anchor point<select aria-label="Anchor point" className="field mt-1" disabled={pathLocked} value={selectedPart.anchorJointId} onChange={e => updateSelectedAnchor(e.target.value)}>
                    {Object.keys(project.skeleton?.joints ?? {}).map(id => <option key={id} value={id}>{jointLabel(id)}</option>)}
                </select></label>}
                {selectedPart && <label className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${pathLocked || !selectedPath ? 'opacity-50' : ''}`}>IK handle<select aria-label="IK handle" className="field mt-1" disabled={pathLocked || !selectedPath} value={selectedIkJointId ?? ''} onChange={e => updateIkHandle(e.target.value)}>
                    {jointOptions.map(id => <option key={id} value={id}>{motionChainOptionLabel(project, selectedPart.id, id)}</option>)}
                </select></label>}
                {selectedPart && <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-slate-600" data-testid="ik-chain-summary">
                    <div className="font-bold text-slate-800">{ikDescriptor?.label ?? 'No IK chain'}</div>
                    <div>{ikDescriptor?.helper ?? 'Choose an IK handle to preview the limb chain.'}</div>
                </div>}
                <div className="fold-picker" data-testid="fold-direction-control">
                    <div>
                        <div className="text-xs font-black uppercase tracking-wider text-slate-500">Fold direction</div>
                        <div className="text-sm text-slate-600">{bendJoint ? `${jointLabel(bendJoint.id)} bends ${bendJoint.bendDirection < 0 ? 'left' : 'right'}` : ikDescriptor?.kind === 'two-joint-direct' ? 'Direct handle has no fold joint' : 'Choose a limb with elbow/knee joint'}</div>
                    </div>
                    <div className="flex gap-2">
                        <button className={`btn-secondary ${bendJoint && bendJoint.bendDirection < 0 ? 'active' : ''}`} disabled={!bendJoint || bendJoint.locked} onClick={() => setBendDirection(-1)}>Fold left</button>
                        <button className={`btn-secondary ${bendJoint && bendJoint.bendDirection >= 0 ? 'active' : ''}`} disabled={!bendJoint || bendJoint.locked} onClick={() => setBendDirection(1)}>Fold right</button>
                    </div>
                </div>
            </div>
        </div>)
        }}
    />;
};

const SceneSketch = ({ project, svgRef, selectedPath, dragPoint, selectedPoint, setDragPoint, setSelectedPoint, onPointMove, onPointUp, onCanvasDown, dispatch, drawMode, pathLocked, isPlaying, angle, viewport }: { project: ProjectState; svgRef: React.RefObject<SVGSVGElement | null>; selectedPath?: ProjectMotionPath; dragPoint: number | null; selectedPoint: number | null; setDragPoint: (i: number | null) => void; setSelectedPoint: (i: number | null) => void; onPointMove: (e: React.MouseEvent<SVGSVGElement>) => void; onPointUp: () => void; onCanvasDown: (e: React.MouseEvent<SVGSVGElement>) => void; dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void; drawMode?: boolean; pathLocked?: boolean; isPlaying: boolean; angle: number; viewport: CanvasViewport }) => {
    const kit = project.settings.physicalKit;
    const sheet = sceneBoundsForSheet(kit);
    const pathMechanism = selectedPath ? project.mechanisms.find(m => m.targetPathId === selectedPath.id && m.targetPartId === selectedPath.partId) : undefined;
    const requestedTargetJointId = pathMechanism?.targetAnchorJointId ?? selectedPath?.targetAnchorJointId;
    const targetJointId = selectedPath ? preferredMotionJointId(project, selectedPath.partId, requestedTargetJointId, { preferDistalWhenRoot: !requestedTargetJointId }) : undefined;
    const pathPreview = isPlaying && selectedPath?.visible && selectedPath.enabled && selectedPath.points.length > 1
        ? motionPreviewForPath(project, selectedPath, angle, targetJointId)
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
    return <svg ref={svgRef} aria-label="Path editor canvas" data-testid="path-canvas" viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} className={`h-[calc(100vh-160px)] min-h-[560px] w-full bg-[#f8fbff] ${drawMode ? 'cursor-crosshair' : ''}`} onMouseDown={onCanvasDown} onMouseMove={onPointMove} onMouseUp={onPointUp} onMouseLeave={onPointUp}>
        <defs><filter id="soft"><feDropShadow dx="0" dy="10" stdDeviation="10" floodOpacity="0.13"/></filter></defs>
        <rect x={sheetSvg.x} y={sheetSvg.y} width={sheetSvg.width} height={sheetSvg.height} rx="18" fill="white" stroke="#d6dbe8" strokeWidth="1.5"/>
        {gridLines}
        <text x={sheetSvg.x + 16} y={sheetSvg.y + 28} className="fill-slate-400 text-[12px] font-bold" data-testid="scene-grid-label">Letter sheet · {kit.gridPitchMm / 10}cm grid</text>
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
            return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#434a59" strokeWidth="2" opacity="0.35"/>;
        })}
        {project.partOrder.map(id => previewParts[id] ?? project.parts[id]).filter(Boolean).map(part => <React.Fragment key={part.id}><PartShape part={part} selected={project.selectedPartId === part.id} drawMode={drawMode} onSelect={() => dispatch({ type: 'select_part', partId: part.id })}/></React.Fragment>) }
        {previewSkeleton && Object.values(previewSkeleton.joints).map(j => {
            const p = sceneToSvg(j.position);
            return <g key={j.id}><circle data-testid={`skeleton-joint-${j.id}`} cx={p.x} cy={p.y} r={j.locked ? 6 : 4.5} fill={j.locked ? '#64748b' : '#94a3b8'} stroke="white" strokeWidth="2"/><title>{j.id} bend {j.bendDirection}</title></g>;
        })}
        {Object.values(project.paths).filter(p => p.visible).map(path => <path key={path.id} d={pathFromPoints(path.points, path.closed, path.smoothness)} fill="none" stroke={path.enabled ? '#5a6cff' : '#94a3b8'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/>)}
        {selectedPath?.visible && selectedPath.points.map((pt, i) => {
            const p = sceneToSvg(pt);
            const active = dragPoint === i || selectedPoint === i;
            return <circle key={`${selectedPath.id}-${i}`} cx={p.x} cy={p.y} r={active ? 8 : 6} fill={active ? '#5a6cff' : '#fff'} stroke="#5a6cff" strokeWidth="3" pointerEvents={drawMode ? 'none' : undefined} className={pathLocked ? 'cursor-not-allowed' : 'cursor-grab'} onClick={e => e.stopPropagation()} onMouseDown={e => { e.stopPropagation(); if (!pathLocked) { setSelectedPoint(i); setDragPoint(i); } }} />;
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

const PartShape = ({ part, selected, drawMode, onSelect }: { part: BodyPartLayer; selected: boolean; drawMode?: boolean; onSelect: () => void }) => {
    if (!part.visible) return null;
    const p = sceneToSvg(part.transform);
    const w = part.bounds.width * part.transform.scale;
    const h = part.bounds.height * part.transform.scale;
    const stroke = selected ? '#5a6cff' : '#94a3b8';
    return <g data-testid={`path-part-${part.id}`} transform={`translate(${p.x} ${p.y}) rotate(${-part.transform.rotation})`} onClick={e => { if (!drawMode) { e.stopPropagation(); onSelect(); } }} className={`${drawMode ? 'cursor-crosshair' : 'cursor-pointer'} transition-opacity`} opacity={part.opacity} filter="url(#soft)">
        {part.textureUrl ? <image href={part.textureUrl} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="xMidYMid meet" opacity=".5" style={{ filter: 'grayscale(1) saturate(0.2)' }}/> : <rect x={-w/2} y={-h/2} width={w} height={h} rx="22" fill="#cbd5e1" opacity=".42"/>}
        <rect x={-w/2} y={-h/2} width={w} height={h} rx="22" fill="none" stroke={stroke} strokeWidth={selected ? 4 : 1.5} strokeDasharray={selected ? '0' : '5 5'}/>
        {part.localPivotOffset && <circle cx={part.localPivotOffset.x * part.transform.scale} cy={-part.localPivotOffset.y * part.transform.scale} r={5} fill="#64748b" stroke="white" strokeWidth="2"><title>local pivot</title></circle>}
    </g>;
};

const PartInspector = ({ part, dispatch }: { part: BodyPartLayer; dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void }) => {
    const updateTransform = (updates: Partial<BodyPartLayer['transform']>) => dispatch({ type: 'update_part', partId: part.id, updates: { transform: { ...part.transform, ...updates } } });
    return <div className="mt-4 space-y-3">
        <Toggle label="Visible" checked={part.visible} disabled={part.locked} onChange={visible => dispatch({ type: 'update_part', partId: part.id, updates: { visible } })}/>
        <Toggle label="Locked" checked={part.locked} onChange={locked => dispatch({ type: 'update_part', partId: part.id, updates: { locked } })}/>
        <MiniNumber label="X" value={part.transform.x} min={-320} max={320} disabled={part.locked} onChange={x => updateTransform({ x })}/>
        <MiniNumber label="Y" value={part.transform.y} min={-320} max={320} disabled={part.locked} onChange={y => updateTransform({ y })}/>
        <MiniNumber label="Rotation" value={part.transform.rotation} min={-180} max={180} disabled={part.locked} onChange={rotation => updateTransform({ rotation })}/>
        <MiniNumber label="Scale" value={part.transform.scale} min={0.2} max={2.5} step={0.05} disabled={part.locked} onChange={scale => updateTransform({ scale })}/>
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

const availableMotionAnchorForRecommendation = (project: ProjectState, partId: string) => {
    const anchors = motionAnchorJointIds(project, partId);
    const occupied = new Set(project.mechanisms
        .filter(m => m.visible && m.enabled !== false && m.targetPartId === partId)
        .map(m => preferredMotionJointId(project, partId, m.targetAnchorJointId))
        .filter(Boolean));
    return [...anchors].reverse().find(anchor => !occupied.has(anchor)) ?? preferredMotionJointId(project, partId, undefined, { preferDistalWhenRoot: true });
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
        : type === 'gear' || type === 'planetary_gear'
            ? tunedCrankLength + tunedRockerLength
            : Math.max(60, Math.min(220, span * 0.85));
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
        couplerLength: type === 'gear' || type === 'planetary_gear' || type === 'cam' || type === 'yoke' || type === 'rack-pinion' ? 0 : Math.max(70, Math.min(260, metrics.length * 0.55)),
        rockerLength: tunedRockerLength,
        sliderOffset: type === 'piston' || type === 'yoke' ? Math.max(-80, Math.min(80, metrics.height * 0.2)) : type === 'rack-pinion' ? Math.max(30, Math.min(100, span * 0.28)) : base.sliderOffset,
        couplerPointDist: Math.max(35, Math.min(190, span * 0.72)),
        couplerPointAngle: type === 'piston' || type === 'rack-pinion' ? 0 : base.couplerPointAngle,
        gearRatio: type === 'gear' ? -1 : type === 'planetary_gear' ? 3 : undefined,
        speed2: type === 'gear' ? -1 : type === 'planetary_gear' ? 3 : base.speed2,
        phase: 0,
        targetPartId: selectedPart.id,
        targetPathId: selectedPath.id,
        targetAnchorJointId: selectedPath.targetAnchorJointId ?? availableMotionAnchorForRecommendation(project, selectedPart.id),
        activeVisualPartIds: [selectedPart.id],
        source: 'optimized',
        presetId: `recommendation-${type}`,
        recommendation: reason,
        warnings: score < 55 ? ['Low-confidence recommendation; review in Foundry before fabrication.'] : []
    };
    return fitRecommendedMechanismToSheet(project, mechanismWithGeneratedPath(tuned));
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
        { type: 'yoke', score: 58 + (linear ? 18 : 0) + (compact ? 8 : 0), reason: 'Compact straight reciprocation with a slot-style guide.' },
        { type: 'cam', score: 57 + (metrics.height > metrics.width * 0.75 ? 12 : 0) + (compact ? 8 : 0), reason: 'Useful for repeated lifts and bouncy offsets.' },
        { type: 'rack-pinion', score: 59 + (linear ? 18 : 0) + (metrics.aspect > 1.8 || metrics.aspect < 0.55 ? 10 : 0), reason: 'PaperMech-style toothed rack for clear up-down or open-close linear travel.' },
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
    const [showForces, setShowForces] = useState(false);
    const [showVelocity, setShowVelocity] = useState(false);
    const [showTrail, setShowTrail] = useState(false);
    const [showPathPreview, setShowPathPreview] = useState(true);
    const [showSensemaking, setShowSensemaking] = useState(true);
    const targetReady = Boolean(selectedPart && selectedPath && selectedPath.enabled && selectedPath.points.length >= 3);
    const rawLanding = manualAnchor ?? selectedPath?.points[0] ?? (selectedPart ? bodyPartPivotScene(selectedPart, project.skeleton) : { x: foundry.anchorX ?? 0, y: foundry.anchorY ?? 0 });
    const landingBoard = sceneToBoard(rawLanding, project.settings.physicalKit);
    const landing = boardToScene(landingBoard.col, landingBoard.row, project.settings.physicalKit);
    const snapDistance = Math.hypot(rawLanding.x - landing.x, rawLanding.y - landing.y);
    const landedFoundry = useMemo(() => ({ ...foundry, anchorX: landing.x, anchorY: landing.y, sceneAnchor: landing }), [foundry, landing.x, landing.y]);
    const anchorMarker = { x: 180 + (landing.x / SCENE_VIEW.width) * 360, y: 120 - (landing.y / SCENE_VIEW.height) * 240 };
    const preview = useMemo(() => generateCurvePoints(landedFoundry, 96).points, [landedFoundry]);
    const range = sampleFeasibleRange(landedFoundry);
    const library = MECHANISM_LIBRARY[foundry.type];
    const targetIkJointId = selectedPart ? preferredMotionJointId(project, selectedPart.id, selectedPath?.targetAnchorJointId, { preferDistalWhenRoot: !selectedPath?.targetAnchorJointId }) : undefined;
    const feasibilityText = range.warning ?? '360° valid sampled motion';
    const selectedSimulation = fitMechanismSimulation(landedFoundry, foundryPhase, 360, 240, 96);
    const previewPoints = selectedSimulation.pathPoints.length ? selectedSimulation.pathPoints : fitPointsToBox(preview, 360, 240);
    const previewPath = selectedSimulation.pathD || pointsToSvgPath(previewPoints);
    const playIndex = previewPoints.length ? Math.floor((((foundryPhase / (Math.PI * 2)) % 1 + 1) % 1) * (previewPoints.length - 1)) : 0;
    const playhead = selectedSimulation.state.effector ?? previewPoints[playIndex];
    const previousPoint = previewPoints[Math.max(0, playIndex - 1)] ?? playhead;
    const nextPoint = previewPoints[Math.min(previewPoints.length - 1, playIndex + 1)] ?? playhead;
    const hardBlocked = !targetReady || range.percentValid === 0 || !Number.isFinite(landing.x) || !Number.isFinite(landing.y);
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
    const handleAnchorPick = (event: React.MouseEvent<SVGSVGElement>) => {
        if (!isPickingAnchor) return;
        const svg = event.currentTarget;
        const matrix = svg.getScreenCTM();
        if (!matrix) return;
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const { x, y } = point.matrixTransform(matrix.inverse());
        applyAnchor({ x: ((x / 360) - 0.5) * SCENE_VIEW.width, y: (0.5 - (y / 240)) * SCENE_VIEW.height });
        setIsPickingAnchor(false);
    };
    const updateFoundryParam = (key: keyof MechanismConfig, value: number) => {
        if (key === 'anchorX' || key === 'anchorY') {
            const anchor = {
                x: key === 'anchorX' ? value : (foundry.anchorX ?? landing.x),
                y: key === 'anchorY' ? value : (foundry.anchorY ?? landing.y)
            };
            setManualAnchor(anchor);
            setFoundry({
                ...foundry,
                [key]: value,
                sceneAnchor: anchor,
                transform: { ...(foundry.transform ?? { x: anchor.x, y: anchor.y, rotation: foundry.groundAngle ?? 0, scale: 1 }), x: anchor.x, y: anchor.y }
            });
            return;
        }
        setFoundry({ ...foundry, [key]: value });
    };
    const keepCurrentAnchor = (mechanism: MechanismConfig): MechanismConfig => ({
        ...mechanism,
        anchorX: landing.x,
        anchorY: landing.y,
        sceneAnchor: landing,
        transform: { ...(mechanism.transform ?? { x: landing.x, y: landing.y, rotation: mechanism.groundAngle ?? 0, scale: 1 }), x: landing.x, y: landing.y }
    });
    useEffect(() => {
        if (!foundryPlaying) return;
        let frame = 0;
        let last = performance.now();
        const tick = (time: number) => {
            const dt = Math.min(64, time - last);
            last = time;
            setFoundryPhase(prev => (prev + dt * 0.0025 * project.settings.animationSpeed) % (Math.PI * 2));
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [foundryPlaying, project.settings.animationSpeed]);
    const makePackage = (): FoundryExportPackage => {
        const mechanismId = uid('mech');
        const state = calculateLinkage(landedFoundry, 0);
        const preset = foundry.presetId ?? 'balanced';
        return {
            id: `foundry-${Date.now().toString(36)}`,
            createdAt: new Date().toISOString(),
            mechanismId,
            mechanismType: landedFoundry.type,
            parameters: { ...landedFoundry, id: mechanismId },
            pivot: landing,
            outputPoint: state.isValid ? state.effector : undefined,
            generatedPath: preview,
            simulationSummary: feasibilityText,
            visual: { color: landedFoundry.color, scale: landedFoundry.transform?.scale ?? 1, constraintsVisible: true },
            animation: { duration: selectedPath?.duration ?? 3200, steps: preview.length, loop: true },
            targetPartId: selectedPart?.id,
            targetPathId: selectedPath?.id,
            targetAnchorJointId: targetIkJointId,
            metadata: { sourceTab: 'mechanism-foundry', selectedPreset: preset, recommendation: foundry.recommendation ?? FOUNDRY_PRESETS[preset]?.recommendation },
            warnings: range.warning ? [range.warning] : [],
            source: 'mechanism-foundry'
        };
    };
    return <EditorStageFrame
        stage="foundry"
        className="foundry-stage-frame"
        layout={{
            workflow: workflowPane(<div className="stage-pane-stack">
            <StageLeftSummary project={project} title="Mechanism Foundry" kicker="recipe sandbox" stage="foundry" goStage={goStage}>
                <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600" data-testid="foundry-target-summary">
                    <div className="font-bold text-slate-800">Target: {selectedPart?.name ?? 'none'} · path {selectedPath?.points.length ?? 0} pts</div>
                    <div>Board hole {landingBoard.label} · anchor {selectedPart?.anchorJointId ?? 'none'} · IK handle {targetIkJointId ?? 'none'}</div>
                    {snapDistance > 0.5 && <div>Snapped {snapDistance.toFixed(0)} scene units from target to nearest board hole for fabrication.</div>}
                    <div><strong>Valid Range:</strong> {range.percentValid === 1 ? '360° valid' : feasibilityText}</div>
                    <div data-testid="foundry-anchor-status">{isPickingAnchor ? 'Pick mode: click the sandbox board.' : (manualAnchor ? 'Anchor picked visually.' : (foundry.recommendation ?? FOUNDRY_PRESETS.balanced.recommendation))}</div>
                </div>
                <button type="button" data-testid="foundry-pick-anchor" className={`btn-secondary w-full ${isPickingAnchor ? 'active' : ''}`} onClick={() => setIsPickingAnchor(value => !value)}>{isPickingAnchor ? 'Cancel anchor pick' : 'Pick anchor on canvas'}</button>
                <button className="btn-primary w-full" disabled={hardBlocked} onClick={() => onExport(makePackage())}><Boxes size={16}/> Use this mechanism</button>
                {!targetReady && <div className="warning">Draw at least 3 points for a selected body part before exporting a mechanism.</div>}
                {range.warning && <div className="warning">{range.warning}</div>}
                <h4 className="section-title mt-4">Mechanism Gallery</h4>
                <div className="mechanism-choice-grid" data-testid="foundry-mechanism-gallery">
                    {AUTHORABLE_MECHANISM_TYPES.map(type => {
                        const item = MECHANISM_LIBRARY[type];
                        const cardMechanism = { ...createDefaultMechanism(type, `foundry-card-${type}`), color: foundry.color };
                        const cardSimulation = fitMechanismSimulation(cardMechanism, foundryPhase, 180, 96, 48);
                        return <button key={type} type="button" className={`recommendation-card mechanism-choice ${foundry.type === type ? 'active' : ''}`} onClick={() => setFoundry(keepCurrentAnchor({ ...createDefaultMechanism(type, 'foundry-preview'), color: foundry.color, presetId: 'balanced', recommendation: FOUNDRY_PRESETS.balanced.recommendation }))}>
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
                    <div>Sensemaking: {library.sense}.</div>
                    <div>Constraint: {library.constraint}.</div>
                    <div data-testid="foundry-feasibility">Feasibility: {feasibilityText}</div>
                </div>}
            </StageLeftSummary>
        </div>),
            canvas: canvasPane(<section className="path-canvas-shell foundry-canvas-shell workspace p-6">
            <div className="mb-5 flex items-center justify-between"><h4 className="section-title">Sandbox preview</h4><span className="chip">{foundryPlaying ? 'Simulation active' : 'Paused'}</span></div>
            <svg viewBox="0 0 360 240" data-testid="foundry-preview" onClick={handleAnchorPick} className={`foundry-preview h-[520px] w-full rounded-[2rem] ${isPickingAnchor ? 'is-picking-anchor' : ''}`} aria-label="Mechanism Foundry CAD-like 2.5D sandbox preview">
                <defs>
                    <pattern id="foundry-cad-grid" width="18" height="18" patternUnits="userSpaceOnUse">
                        <path d="M 18 0 L 0 0 0 18" fill="none" stroke="#93c5fd" strokeWidth="0.55" opacity="0.38" />
                    </pattern>
                    <linearGradient id="foundry-board-plane" x1="0" x2="1" y1="0" y2="1">
                        <stop offset="0" stopColor="#ffffff" />
                        <stop offset="1" stopColor="#eff6ff" />
                    </linearGradient>
                    <filter id="foundry-depth-shadow-filter" x="-30%" y="-30%" width="170%" height="170%">
                        <feDropShadow dx="8" dy="10" stdDeviation="6" floodColor="#1e293b" floodOpacity="0.18" />
                    </filter>
                </defs>
                <FoundryDepthOverlay />
                {showTrail && <path data-testid="foundry-trail-overlay" d={previewPath} fill="none" stroke={foundry.color} strokeWidth="12" strokeLinecap="round" opacity="0.12"/>}
                {showPathPreview && <path data-testid="foundry-path-preview" d={previewPath} fill="none" stroke={foundry.color} strokeWidth="3" strokeLinecap="round" strokeDasharray="9 7" opacity="0.52"/>}
                <g data-testid="foundry-depth-scene" className="foundry-depth-scene" filter="url(#foundry-depth-shadow-filter)">
                    <MechanismLinkagePreview mechanism={landedFoundry} simulation={selectedSimulation} kit={project.settings.physicalKit} testId="foundry-selected-linkage" />
                </g>
                {showForces && playhead && <g data-testid="foundry-forces-overlay" stroke="#ef4444" strokeWidth="3" strokeLinecap="round">
                    <line x1={playhead.x} y1={playhead.y} x2={180} y2={120} />
                    <line x1={playhead.x} y1={playhead.y} x2={playhead.x} y2={Math.max(22, playhead.y - 42)} />
                </g>}
                {showVelocity && playhead && <g data-testid="foundry-velocity-overlay" stroke="#10b981" strokeWidth="4" strokeLinecap="round">
                    <line x1={playhead.x} y1={playhead.y} x2={playhead.x + (nextPoint.x - previousPoint.x) * 2.2} y2={playhead.y + (nextPoint.y - previousPoint.y) * 2.2} />
                </g>}
                {playhead && <circle data-testid="foundry-playhead" cx={playhead.x} cy={playhead.y} r="7" fill="#f472b6" stroke="white" strokeWidth="3" />}
                <g data-testid="foundry-anchor-marker" transform={`translate(${anchorMarker.x} ${anchorMarker.y})`}>
                    <circle r="8" fill="#ffffff" stroke="#8b5cf6" strokeWidth="3" />
                    <path d="M -13 0 H 13 M 0 -13 V 13" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" />
                    <text x="12" y="-10" fill="#5b21b6" fontSize="8" fontWeight="900">{landingBoard.label}</text>
                </g>
                <FoundrySpacerStack points={[selectedSimulation.state.p1, selectedSimulation.state.p2, selectedSimulation.state.j1, selectedSimulation.state.j2, selectedSimulation.state.aux, selectedSimulation.state.effector]} />
                <FoundryAngleStrip mechanism={landedFoundry} phase={foundryPhase} kit={project.settings.physicalKit} />
                <text x="22" y="38" className="foundry-preview-label" fontSize="16" fontWeight="800">{library.label} · {range.percentValid === 1 ? '360° valid' : range.warning} · {Z_STACK_LABEL}</text>
            </svg>
            <div className="mt-3 text-xs font-bold text-slate-500" data-testid="foundry-toolbar-state">Toolbar: {foundryPlaying ? 'playing' : 'paused'} · path {showPathPreview ? 'shown' : 'hidden'} · phase {Math.round(foundryPhase * 180 / Math.PI)}°</div>
        </section>),
            inspector: inspectorPane(<div className="stage-pane-stack">
            <div>
                <div className="section-title">Selected mechanism</div>
                <h3>{library.label}</h3>
                <p className="mt-2 text-sm text-slate-600">Fine tune the selected physical template and preview overlays.</p>
            </div>
            <details className="advanced-panel">
                <summary>Mechanism options</summary>
                <div className="mt-3 space-y-3">
                    <select aria-label="Foundry mechanism type" className="field" value={foundry.type} onChange={e => setFoundry(keepCurrentAnchor({ ...createDefaultMechanism(e.target.value as MechanismType, 'foundry-preview'), color: foundry.color, presetId: 'balanced', recommendation: FOUNDRY_PRESETS.balanced.recommendation }))}>{AUTHORABLE_MECHANISM_TYPES.map(t => <option key={t} value={t}>{mechanismTemplateLabel(t)}</option>)}</select>
                    <select aria-label="Foundry preset" className="field" value={foundry.presetId ?? 'balanced'} onChange={e => {
                        const presetId = e.target.value;
                        const preset = FOUNDRY_PRESETS[presetId];
                        const { label: _label, ...updates } = preset;
                        const base = presetId === 'balanced' ? createDefaultMechanism(foundry.type, 'foundry-preview') : foundry;
                        setFoundry(keepCurrentAnchor({ ...base, color: foundry.color, ...updates, presetId, recommendation: preset.recommendation }));
                    }}>{Object.entries(FOUNDRY_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}</select>
                    {PARAMS.filter(p => showParam(foundry.type, p.key)).map(p => <React.Fragment key={String(p.key)}><MiniNumber label={p.label} value={Number(foundry[p.key] ?? 0)} min={p.min} max={p.max} step={p.step} onChange={value => updateFoundryParam(p.key, value)}/></React.Fragment>) }
                </div>
            </details>
            <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
                <div className="foundry-toolbar mb-3" data-testid="foundry-toolbar">
                    <button className={`btn-secondary ${foundryPlaying ? 'active' : ''}`} onClick={() => setFoundryPlaying(!foundryPlaying)}>{foundryPlaying ? 'Pause' : 'Play'}</button>
                    <button className="btn-secondary" onClick={() => { setFoundryPhase(0); setFoundryPlaying(false); }}>Reset</button>
                </div>
                <div className="font-bold text-slate-800">Preview overlays</div>
                <div className="foundry-toolbar mt-2">
                    <button type="button" className={`btn-secondary ${showForces ? 'active' : ''}`} aria-pressed={showForces} onClick={() => setShowForces(!showForces)}>Forces</button>
                    <button type="button" className={`btn-secondary ${showVelocity ? 'active' : ''}`} aria-pressed={showVelocity} onClick={() => setShowVelocity(!showVelocity)}>Velocity</button>
                    <button type="button" className={`btn-secondary ${showTrail ? 'active' : ''}`} aria-pressed={showTrail} onClick={() => setShowTrail(!showTrail)}>Trail</button>
                    <button type="button" className={`btn-secondary ${showPathPreview ? 'active' : ''}`} aria-pressed={showPathPreview} onClick={() => setShowPathPreview(!showPathPreview)}>Path Preview</button>
                    <button type="button" className={`btn-secondary ${showSensemaking ? 'active' : ''}`} aria-pressed={showSensemaking} onClick={() => setShowSensemaking(!showSensemaking)}>Show Sensemaking</button>
                    <button type="button" className="btn-secondary" onClick={() => setShowSensemaking(true)}>Back to Gallery</button>
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
    const selectedTargetChain = selectedMechanism?.targetPartId
        ? describeMotionChain(project, selectedMechanism.targetPartId, selectedTargetAnchor)
        : undefined;
    return <EditorStageFrame
        stage="design"
        className="design-stage-frame"
        layout={{
            workflow: workflowPane(<div className="stage-pane-stack">
            <StageLeftSummary project={project} title="Mechanism Design" kicker="attach · tune" stage="design" goStage={goStage}>
                <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary" aria-label={isPlaying ? 'Play / Pause' : 'Play'} onClick={() => setIsPlaying(!isPlaying)}><Play size={16}/>{isPlaying ? 'Pause' : 'Play'}</button>
                    <button className={`btn-secondary ${showTrace ? 'active' : ''}`} onClick={() => setShowTrace(!showTrace)}>Trace</button>
                    <button className="btn-primary" onClick={onRecommendations}><Sparkles size={16}/> Get recommendations</button>
                </div>
                <h4 className="section-title mt-4">Mechanism instances</h4>
                <select aria-label="Mechanism instance" className="field" value={selectedMechanism?.id ?? ''} onChange={e => dispatch({ type: 'set_mechanisms', mechanisms: project.mechanisms, selectedMechanismId: e.target.value })}>{project.mechanisms.map(m => <option key={m.id} value={m.id}>{m.id} · {m.type}</option>)}</select>
                <div className="mt-3 flex flex-wrap gap-2">
                    {AUTHORABLE_MECHANISM_TYPES.map(type => <button key={type} className="chip" title={mechanismTemplateLabel(type)} onClick={() => dispatch({ type: 'upsert_mechanism', mechanism: mechanismWithGeneratedPath(createDefaultMechanism(type, uid('mech'))) })}>{type}</button>)}
                </div>
                {selectedLibrary && <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600" data-testid="design-mechanism-library">
                    <div className="font-bold text-slate-800">Mechanism library</div>
                    <div>{selectedLibrary.label}</div>
                    <div>Sensemaking: {selectedLibrary.sense}.</div>
                    <div>Good for: {selectedLibrary.goodFor}.</div>
                    <div>Constraint: {selectedLibrary.constraint}.</div>
                    <div data-testid="design-feasibility">Feasibility: {selectedRange?.warning ?? '360° valid sampled motion'}</div>
                </div>}
                {Object.entries(bindingWarnings).map(([id, warnings]) => warnings.length ? <div className="warning" key={id}>{id}: {warnings.join('; ')}</div> : null)}
                <button className="btn-primary w-full" onClick={onBlueprint}>Go to blueprint</button>
            </StageLeftSummary>
        </div>),
            canvas: canvasPane(<div className="path-canvas-shell workspace overflow-hidden p-0">
            <CanvasZoomToolbar viewport={viewport} setViewport={setViewport} />
            <Canvas project={project} config={mechanismConfig} setConfig={setMechanismConfig} selectedId={project.selectedMechanismId ?? null} setSelectedId={id => dispatch({ type: 'set_mechanisms', mechanisms: project.mechanisms, selectedMechanismId: id })} isPlaying={isPlaying} showTrace={showTrace} isDrawMode={false} userPath={[]} setUserPath={() => {}} angle={angle} setAngle={setAngle} viewport={viewport} setViewport={setViewport}/>
        </div>),
            inspector: inspectorPane(<div className="stage-pane-stack">
            <div>
                <div className="section-title">Selected mechanism inspector</div>
                <h3>{selectedMechanism ? `${selectedMechanism.id} · ${mechanismTemplateLabel(selectedMechanism.type)}` : 'No mechanism selected'}</h3>
                <p className="mt-2 text-sm text-slate-600">Bindings, visibility, feasibility, and numeric parameters live here.</p>
            </div>
            {selectedMechanism && <>
                <Toggle label="Visible" checked={selectedMechanism.visible} onChange={visible => updateMechanism(selectedMechanism.id, { visible })}/>
                <Toggle label="Enabled" checked={selectedMechanism.enabled !== false} onChange={enabled => updateMechanism(selectedMechanism.id, { enabled })}/>
                <div className="section-title">Assign Character</div>
                <select aria-label="Mechanism target part" className="field" value={selectedMechanism.targetPartId ?? ''} onChange={e => updateMechanism(selectedMechanism.id, { targetPartId: e.target.value || undefined })}><option value="">No target part</option>{project.partOrder.map(id => <option key={id} value={id}>{project.parts[id].name}</option>)}</select>
                <select aria-label="Mechanism target path" className="field" value={selectedMechanism.targetPathId ?? ''} onChange={e => updateMechanism(selectedMechanism.id, { targetPathId: e.target.value || undefined })}><option value="">No target path</option>{Object.values(project.paths).filter(p => !selectedMechanism.targetPartId || p.partId === selectedMechanism.targetPartId).map(p => <option key={p.id} value={p.id}>{p.id} · {p.points.length} pts</option>)}</select>
                {selectedMechanism.targetPartId && project.skeleton && <select aria-label="Mechanism target anchor" className="field" value={selectedTargetAnchor ?? ''} onChange={e => updateMechanism(selectedMechanism.id, { targetAnchorJointId: e.target.value || undefined })}>
                    <option value="">Part anchor default</option>
                    {targetAnchorOptions.map(id => <option key={id} value={id}>{motionChainOptionLabel(project, selectedMechanism.targetPartId, id)}</option>)}
                </select>}
                {selectedTargetChain && <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-slate-600" data-testid="mechanism-ik-chain-summary">
                    <div className="font-bold text-slate-800">{selectedTargetChain.label}</div>
                    <div>{selectedTargetChain.helper}</div>
                </div>}
                <div className="section-title">Parametric Edit</div>
                {PARAMS.filter(p => showParam(selectedMechanism.type, p.key)).map(p => <React.Fragment key={String(p.key)}><MiniNumber label={p.label} value={Number(selectedMechanism[p.key] ?? 0)} min={p.min} max={p.max} step={p.step} onChange={value => updateMechanism(selectedMechanism.id, { [p.key]: value } as Partial<MechanismConfig>)}/></React.Fragment>) }
                {selectedBindingWarnings.map((w, i) => <div className="warning" key={`binding-${w}-${i}`}>{w}</div>)}
                {selectedRange?.warning && <div className="warning">{selectedRange.warning}</div>}
                {selectedMechanism.warnings?.map((w, i) => <div className="warning" key={`${w}-${i}`}>{w}</div>)}
                <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={optimizerBusy} onClick={onOptimize}>{optimizerBusy ? <Loader2 className="animate-spin" size={16}/> : <Sparkles size={16}/>} Fit path</button><button className="btn-secondary" onClick={() => dispatch({ type: 'delete_mechanism', mechanismId: selectedMechanism.id })}><Trash2 size={16}/> Delete</button></div>
                <div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={exportSvg}>SVG</button><button className="btn-secondary" onClick={exportDxf}>DXF</button><button className="btn-primary" onClick={onBlueprint}>Export Blueprint</button></div>
            </>}
        </div>)
        }}
    />;
};

const pendingRecipeForMechanism = (project: ProjectState, mechanism: MechanismConfig): FabricationRecipe => {
    const board = sceneToBoardRaw({ x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }, project.settings.physicalKit);
    const boardScene = board.valid ? boardToScene(board.col, board.row, project.settings.physicalKit) : { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const targetPart = mechanism.targetPartId ? project.parts[mechanism.targetPartId] : undefined;
    const targetPath = mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
    const targetAnchorJointId = preferredMotionJointId(project, mechanism.targetPartId, mechanism.targetAnchorJointId);
    const range = sampleFeasibleRange(mechanism);
    return {
        mechanismId: mechanism.id,
        type: mechanism.type,
        targetPartId: mechanism.targetPartId,
        targetPathId: mechanism.targetPathId,
        targetAnchorJointId,
        targetPartName: targetPart?.name,
        targetPathPointCount: targetPath?.points.length,
        boardCoordinate: board.label,
        board,
        sceneAnchor: { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 },
        offsetFromBoardMm: { x: ((mechanism.anchorX ?? 0) - boardScene.x) / SCENE_PX_PER_MM, y: ((mechanism.anchorY ?? 0) - boardScene.y) / SCENE_PX_PER_MM },
        requiredParts: mechanismRequiredParts(mechanism),
        steps: ['Generate package to lock the final cut sheet and detailed assembly sequence.'],
        warnings: [...(mechanism.warnings ?? []), ...(range.warning ? [range.warning] : [])]
    };
};

const BlueprintExport = ({ project, config, setConfig, dispatch, goStage, isPlaying, angle, setAngle, viewport, setViewport }: {
    project: ProjectState;
    config: GlobalConfig;
    setConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>;
    dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void;
    goStage: (stage: AppStage) => void;
    isPlaying: boolean;
    angle: number;
    setAngle: React.Dispatch<React.SetStateAction<number>>;
    viewport: CanvasViewport;
    setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
}) => {
    const validation = validateForFabrication(project);
    const create = () => {
        const pkg = createFabricationPackage(project);
        dispatch({ type: 'set_export', fabricationPackage: pkg });
    };
    const pkg = project.lastExport;
    const defaultFormat = project.settings.physicalKit.defaultExportFormat;
    const cutSheetFileType = project.settings.physicalKit.cutSheetFileType;
    const activeMechanisms = project.mechanisms.filter(m => m.visible && m.enabled !== false);
    const recipes = pkg?.recipes ?? activeMechanisms.map(mechanism => pendingRecipeForMechanism(project, mechanism));
    const downloadJson = () => pkg && downloadText(`${pkg.id}.json`, JSON.stringify(pkg, null, 2));
    const downloadSvg = () => pkg && downloadText(`${pkg.id}.svg`, pkg.svg, 'image/svg+xml');
    const downloadCutSheetPdf = () => pkg && downloadText(`${pkg.id}-cut-sheet.pdf`, pkg.cutSheetPdf, 'application/pdf');
    const downloadAssemblyPdf = () => pkg && downloadText(`${pkg.id}-assembly.pdf`, pkg.assemblyGuidePdf, 'application/pdf');
    const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
    const selectedRecipe = recipes.find(recipe => recipe.mechanismId === selectedRecipeId) ?? recipes[0];
    return <EditorStageFrame
        stage="blueprint"
        className="blueprint-stage-frame"
        layout={{
            workflow: workflowPane(<div className="stage-pane-stack" data-testid="blueprint-control-panel">
            <StageLeftSummary project={project} title="Blueprint Export" kicker="fabrication package" stage="blueprint" goStage={goStage}>
                <h3>Build-ready package</h3>
                <p className="mt-2 text-sm text-slate-600">Validation, downloads, and recipe selection stay here; the center remains the build canvas.</p>
                <div className="mt-4 space-y-2">{validation.issues.map((issue, index) => <div className={issue.severity === 'error' ? 'error' : 'warning'} key={`${issue.message}-${index}`}>
                    <div>{issue.message}</div>
                    <button className="mt-2 underline" onClick={() => goStage(issue.recoveryStage)}>{issue.recoveryAction}</button>
                </div>)}{!validation.errors.length && !validation.warnings.length && <div className="ok">Fabrication state ready.</div>}</div>
                <button className="btn-primary mt-5" disabled={!!validation.errors.length} onClick={create}><FileJson size={16}/> Generate package</button>
                {pkg && <div className="mt-5 space-y-3">
                    <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
                        <div className="font-bold text-slate-800">Default export: {defaultFormat}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {defaultFormat !== 'svg' && <button className="btn-primary" onClick={downloadJson}>Download JSON default</button>}
                            {defaultFormat !== 'json' && <button className="btn-primary" onClick={downloadSvg}>Download SVG default</button>}
                        </div>
                        <div className="mt-2 text-xs">Full package artifacts remain available for handoff and archival.</div>
                    </div>
                    <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
                        <div className="font-bold text-slate-800">Cut-sheet default: {cutSheetFileType.toUpperCase()}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {cutSheetFileType === 'pdf'
                                ? <button className="btn-primary" onClick={downloadCutSheetPdf}>Download PDF cut sheet default</button>
                                : <button className="btn-primary" onClick={downloadSvg}>Download SVG cut sheet default</button>}
                        </div>
                        <div className="mt-2 text-xs">Assembly guide stays bundled even when SVG is the preferred cut sheet.</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button className="btn-secondary" onClick={downloadJson}>JSON</button>
                        <button className="btn-secondary" onClick={downloadSvg}>SVG</button>
                        <button className="btn-secondary" onClick={() => downloadText(`${pkg.id}-assembly.html`, pkg.assemblyGuideHtml, 'text/html')}>Guide</button>
                        <button className="btn-secondary" onClick={() => downloadText(`${pkg.id}-metadata.json`, pkg.metadataJson)}>Metadata</button>
                        <button className="btn-secondary" onClick={downloadAssemblyPdf}>PDF</button>
                    </div>
                </div>}
                <div className="mt-5">
                    <h4 className="section-title">Recipe list</h4>
                    <div className="mt-3 grid gap-2">
                        {recipes.map(recipe => <button key={recipe.mechanismId} type="button" className={`assembly-recipe-card text-left ${selectedRecipe?.mechanismId === recipe.mechanismId ? 'ring-2 ring-inset' : ''}`} onClick={() => setSelectedRecipeId(recipe.mechanismId)}>
                            <div className="font-bold text-slate-800">{recipe.mechanismId} · {recipe.type}</div>
                            <div className="text-sm text-slate-600">Hole {recipe.boardCoordinate}</div>
                            <div className="text-xs text-slate-500">Target {recipe.targetPartName ?? recipe.targetPartId ?? 'unbound'} · {recipe.targetPathPointCount ?? 0} points</div>
                        </button>)}
                    </div>
                </div>
            </StageLeftSummary>
        </div>),
            canvas: canvasPane(<div className="path-canvas-shell workspace overflow-hidden p-0" data-testid="blueprint-canvas-preview">
            <CanvasZoomToolbar viewport={viewport} setViewport={setViewport} />
            <Canvas project={project} config={config} setConfig={setConfig} selectedId={project.selectedMechanismId ?? null} setSelectedId={id => dispatch({ type: 'set_mechanisms', mechanisms: project.mechanisms, selectedMechanismId: id })} isPlaying={isPlaying} showTrace={true} isDrawMode={false} userPath={[]} setUserPath={() => {}} angle={angle} setAngle={setAngle} viewport={viewport} setViewport={setViewport}/>
        </div>),
            inspector: inspectorPane(<section className="stage-pane-stack" data-testid="assembly-guide-preview">
            <div>
                <div className="section-title">Selected recipe detail</div>
                <h3>Assembly guide preview</h3>
                <p className="mt-2 text-sm text-slate-600">Inspect the selected recipe without moving the shared work canvas.</p>
            </div>
            {selectedRecipe ? <article className="assembly-recipe-card" data-testid={`assembly-recipe-${selectedRecipe.mechanismId}`}>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="font-bold text-slate-800">{selectedRecipe.mechanismId} · {selectedRecipe.type}</div>
                        <div className="text-sm text-slate-600">Board {selectedRecipe.boardCoordinate}</div>
                        <div className="text-xs text-slate-500">Target {selectedRecipe.targetPartName ?? selectedRecipe.targetPartId ?? 'unbound'} · path {selectedRecipe.targetPathId ?? 'none'} · anchor {selectedRecipe.targetAnchorJointId ?? 'part default'} · {selectedRecipe.targetPathPointCount ?? 0} points</div>
                    </div>
                    <button className="chip" onClick={() => goStage('design')}>Edit</button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">{selectedRecipe.requiredParts.map(part => <span className="blueprint-pill" key={`${selectedRecipe.mechanismId}-${part.name}`}>{part.name} × {part.quantity}</span>)}</div>
                {selectedRecipe.warnings.length ? <div className="warning mt-3">Warnings: {selectedRecipe.warnings.join('; ')}</div> : <div className="ok mt-3">Warnings: none</div>}
                <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">{selectedRecipe.steps.map(step => <li key={step}>{step}</li>)}</ol>
            </article> : <div className="warning">No recipe yet. Return to Mechanism Design or generate a package.</div>}
            {pkg && <img className="mt-5 rounded-3xl border border-slate-200 bg-white p-3" alt="fabrication SVG preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pkg.svg)}`} />}
            {!pkg && <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">Generate package to lock downloadable cut sheets, metadata, and the final assembly guide.</div>}
        </section>)
        }}
    />;
};

const Options = ({ project, dispatch, goStage }: { project: ProjectState; dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void; goStage: (stage: AppStage) => void }) => {
    const kit = project.settings.physicalKit;
    const updateSettings = (settings: Partial<ProjectState['settings']>) => dispatch({ type: 'update_settings', settings });
    const updateKit = (physicalKit: Partial<ProjectState['settings']['physicalKit']>) => updateSettings({ physicalKit: { ...kit, ...physicalKit } });
    const durationSeconds = Number((project.settings.animationDurationMs / 1000).toFixed(1));
    const unitSummary = project.settings.gridUnit === 'inch'
        ? `${(kit.gridPitchMm / 25.4).toFixed(2)} in between board holes`
        : project.settings.gridUnit === 'px'
            ? `${(kit.gridPitchMm * 2).toFixed(0)} scene px between board holes`
            : `${(kit.gridPitchMm / 10).toFixed(1)} cm between board holes`;
    return <EditorStageFrame
        stage="options"
        className="options-stage-frame"
        layout={{
            workflow: workflowPane(<div className="stage-pane-stack">
            <StageLeftSummary project={project} title="Options" kicker="global settings" stage="options" goStage={goStage}>
                <h3>Studio settings</h3>
                <p className="mt-2 text-sm text-slate-600">Pick a category here, then tune details in the inspector.</p>
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
                <text x="58" y="64" fill="#94a3b8" fontSize="18" fontWeight="800">Letter sheet · {project.settings.physicalKit.gridPitchMm / 10}cm grid</text>
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
                <h3>Make the studio feel simple.</h3>
                <p className="mt-2 text-sm text-slate-600">These controls write into the real project settings. Fabrication and grid choices also refresh blueprint validation.</p>
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
                <Toggle label="Enable Debug Visuals" checked={project.settings.debugVisuals} onChange={debugVisuals => updateSettings({ debugVisuals })}/>
                <Toggle label="Show Detailed Processing Steps" checked={project.settings.detailedProcessingSteps} onChange={detailedProcessingSteps => updateSettings({ detailedProcessingSteps })}/>
            </SettingsSection>
            <SettingsSection section={optionSection('workflow')}>
                <Toggle label="Enable autosave" checked={project.settings.autosave} onChange={autosave => updateSettings({ autosave })}/>
                <MiniNumber label="Autosave interval seconds" value={project.settings.autosaveIntervalSeconds} min={1} max={600} step={1} disabled={!project.settings.autosave} onChange={autosaveIntervalSeconds => updateSettings({ autosaveIntervalSeconds })}/>
            </SettingsSection>
            <SettingsSection section={optionSection('fabrication')}>
                <SelectField label="Default export format" value={kit.defaultExportFormat} onChange={defaultExportFormat => updateKit({ defaultExportFormat: defaultExportFormat as ProjectState['settings']['physicalKit']['defaultExportFormat'] })}>
                    <option value="both">Export SVG + JSON</option>
                    <option value="svg">Export SVG only</option>
                    <option value="json">Export JSON only</option>
                </SelectField>
                <SelectField label="Cut-sheet file type" value={kit.cutSheetFileType} onChange={cutSheetFileType => updateKit({ cutSheetFileType: cutSheetFileType as ProjectState['settings']['physicalKit']['cutSheetFileType'] })}>
                    <option value="pdf">PDF default</option>
                    <option value="svg">SVG</option>
                </SelectField>
                <Toggle label="Fabrication-ready mode" checked={project.settings.fabricationReadyMode} onChange={fabricationReadyMode => updateSettings({ fabricationReadyMode })}/>
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
        <div className="section-title">{section.label}</div>
        <p className="mt-1 text-sm text-slate-600">{section.description}</p>
    </div>
    <div className="space-y-3">{children}</div>
</section>;

const SelectField = ({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) => <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
    <span>{label}</span>
    <select aria-label={label} className="field mt-1" value={value} onChange={e => onChange(e.target.value)}>{children}</select>
</label>;

const MiniNumber = ({ label, value, min, max, step = 1, disabled = false, onChange }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (v: number) => void }) => <label className={`block ${disabled ? 'opacity-50' : ''}`}><div className="mb-1 flex justify-between text-xs font-black uppercase tracking-wider text-slate-500"><span>{label}</span><span>{Number(value).toFixed(step < 1 ? 2 : 0)}</span></div><input aria-label={`${label} slider`} className="w-full" type="range" min={min} max={max} step={step} disabled={disabled} value={Number.isFinite(value) ? value : 0} onChange={e => onChange(Number(e.target.value))}/><input aria-label={`${label} number`} className="field mt-1" type="number" min={min} max={max} step={step} disabled={disabled} value={Number.isFinite(value) ? value : 0} onChange={e => onChange(Number(e.target.value))}/></label>;
const Toggle = ({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) => <label className={`flex items-center justify-between rounded-2xl bg-slate-100 px-3 py-2 text-sm font-bold ${disabled ? 'opacity-50' : ''}`}><span>{label}</span><input type="checkbox" disabled={disabled} checked={checked} onChange={e => onChange(e.target.checked)} /></label>;

const showParam = (type: MechanismType, key: keyof MechanismConfig) => {
    if (['speed2', 'phase', 'gearRatio'].includes(String(key))) return ['5bar', 'gear', 'planetary_gear'].includes(type);
    if (key === 'rodLength') return ['5bar', 'piston'].includes(type);
    if (key === 'groundLength') return !['cam', 'yoke', 'rack-pinion'].includes(type);
    if (key === 'couplerLength') return !['cam', 'gear', 'planetary_gear', 'yoke', 'rack-pinion'].includes(type);
    return true;
};

const fitPointsToBox = (points: Point[], width: number, height: number) => {
    if (!points.length) return [];
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((width - 60) / Math.max(1, maxX - minX), (height - 70) / Math.max(1, maxY - minY));
    const tx = width / 2 - ((minX + maxX) / 2) * scale;
    const ty = height / 2 + ((minY + maxY) / 2) * scale;
    return points.map(p => ({ x: p.x * scale + tx, y: ty - p.y * scale }));
};

const pointsToSvgPath = (points: Point[]) => points.length ? `M ${points.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}` : '';
const fitPathToBox = (points: Point[], width: number, height: number) => pointsToSvgPath(fitPointsToBox(points, width, height));

const FoundryDepthOverlay = () => <g data-testid="foundry-depth-overlay" aria-label="Foundry CAD Z-axis and board depth overlay">
    <path data-testid="foundry-cad-plane" className="foundry-depth-plane" d="M 24 58 L 276 34 L 342 72 L 85 102 Z" />
    <path className="foundry-depth-grid" d="M 24 58 L 85 102 M 66 54 L 129 96 M 108 50 L 172 90 M 150 46 L 215 84 M 192 42 L 258 78 M 234 38 L 301 72 M 64 64 L 316 40 M 82 76 L 334 52 M 100 88 L 352 64" />
    <g data-testid="foundry-axis-widget" className="foundry-axis-widget" transform="translate(42 205)">
        <line x1="0" y1="0" x2="46" y2="0" className="foundry-axis-x" />
        <line x1="0" y1="0" x2="0" y2="-42" className="foundry-axis-y" />
        <line data-testid="foundry-axis-z" x1="0" y1="0" x2="28" y2="-28" className="foundry-axis-z" />
        <text x="50" y="4">X</text>
        <text x="-7" y="-48">Y</text>
        <text x="32" y="-30">{Z_AXIS_LABEL}</text>
    </g>
    <g data-testid="foundry-spacer-stack" className="foundry-spacer-stack" transform="translate(282 156)">
        <text x="-18" y="-42">{Z_STACK_LABEL}</text>
        {Z_STACK_LAYERS.map((layer, index) => <g key={layer.id} data-z-layer={layer.id} transform={`translate(${index * 10} ${-index * 9})`}>
            <ellipse data-testid="foundry-spacer-washer" className="foundry-spacer-ring" cx="0" cy="0" rx="14" ry="5.2" fill={layer.color} />
            <ellipse className="foundry-spacer-hole" cx="0" cy="0" rx="5.2" ry="2" />
        </g>)}
    </g>
</g>;

const FoundrySpacerStack = ({ points }: { points: Array<Point | undefined> }) => <g data-testid="foundry-z-spacers" className="foundry-z-spacers">
    {points.filter((point): point is Point => Boolean(point)).slice(0, 6).map((point, index) => {
        const x = point.x.toFixed(2);
        const y = point.y.toFixed(2);
        return <g key={`${Math.round(point.x)}-${Math.round(point.y)}-${index}`} data-testid="foundry-z-spacer" className="foundry-z-spacer" data-point-x={x} data-point-y={y} data-z-offset-mm={(index * 2).toFixed(1)} transform={`translate(${x} ${y})`}>
            <line x1="0" y1="0" x2="8" y2="-8" />
            <ellipse cx="8" cy="-8" rx="5.4" ry="2.2" />
            <ellipse cx="0" cy="0" rx="5.4" ry="2.2" />
        </g>;
    })}
</g>;

const FoundryAngleStrip = ({ mechanism, phase, kit }: { mechanism: MechanismConfig; phase: number; kit: PhysicalKitSettings }) => {
    const views = [
        { angle: 0, label: 'Front', testId: 'foundry-angle-view-0' },
        { angle: Math.PI / 2, label: 'Iso 90°', testId: 'foundry-angle-view-90' },
        { angle: Math.PI, label: 'Side 180°', testId: 'foundry-angle-view-180' },
        { angle: Math.PI * 1.5, label: 'Back 270°', testId: 'foundry-angle-view-270' }
    ];
    return <g data-testid="foundry-angle-strip" className="foundry-angle-strip" transform="translate(20 166)">
        <rect x="0" y="0" width="236" height="58" rx="13" />
        <text x="10" y="16">multi-angle simulation</text>
        {views.map((view, index) => {
            const simulation = fitMechanismSimulation(mechanism, phase + view.angle, 54, 34, 36);
            return <svg key={view.testId} data-testid={view.testId} data-angle-deg={Math.round(view.angle * 180 / Math.PI)} data-effector-x={simulation.state.effector.x.toFixed(2)} data-effector-y={simulation.state.effector.y.toFixed(2)} x={10 + index * 56} y="20" width="50" height="31" viewBox="0 0 54 34" className="foundry-angle-card">
                <path d={simulation.pathD} fill="none" stroke={mechanism.color} strokeWidth="1.2" strokeDasharray="3 3" opacity="0.45" />
                <MechanismLinkagePreview mechanism={mechanism} simulation={simulation} kit={kit} testId={`${view.testId}-linkage`} compact />
                <text x="3" y="31">{view.label}</text>
            </svg>;
        })}
    </g>;
};

const fitMechanismSimulation = (mechanism: MechanismConfig, angle: number, width: number, height: number, resolution = 72) => {
    const state = calculateLinkage(mechanism, angle);
    const pathPoints = generateCurvePoints(mechanism, resolution).points;
    const statePoints = [state.p1, state.p2, state.j1, state.j2, state.aux, state.effector].filter((point): point is Point => Boolean(point));
    const visualBounds: Point[] = [];
    const addRadiusBounds = (center: Point | undefined, radius: number) => {
        if (!center || !Number.isFinite(radius) || radius <= 0) return;
        visualBounds.push(
            { x: center.x - radius, y: center.y - radius },
            { x: center.x + radius, y: center.y + radius }
        );
    };
    if (mechanism.type === 'cam') addRadiusBounds(state.p1, mechanism.crankLength * 1.35);
    if (mechanism.type === 'gear' || mechanism.type === '5bar' || mechanism.type === 'rack-pinion') {
        addRadiusBounds(state.p1, mechanism.crankLength);
        addRadiusBounds(state.p2, mechanism.rockerLength);
    }
    if (mechanism.type === 'planetary_gear') {
        addRadiusBounds(state.p1, mechanism.groundLength + mechanism.rockerLength);
        addRadiusBounds(state.p2, mechanism.rockerLength);
    }
    const source = [...pathPoints, ...statePoints, ...visualBounds];
    if (!source.length) return { pathPoints: [] as Point[], pathD: '', state, scale: 1 };
    const xs = source.map(p => p.x), ys = source.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((width - 34) / Math.max(1, maxX - minX), (height - 32) / Math.max(1, maxY - minY));
    const tx = width / 2 - ((minX + maxX) / 2) * scale;
    const ty = height / 2 + ((minY + maxY) / 2) * scale;
    const map = (point: Point): Point => ({ x: point.x * scale + tx, y: ty - point.y * scale });
    const fittedPath = pathPoints.map(map);
    return {
        pathPoints: fittedPath,
        pathD: pointsToSvgPath(fittedPath),
        scale,
        state: {
            ...state,
            p1: map(state.p1),
            p2: map(state.p2),
            j1: map(state.j1),
            j2: map(state.j2),
            aux: state.aux ? map(state.aux) : undefined,
            effector: map(state.effector)
        }
    };
};

const MechanismLinkagePreview = ({ mechanism, simulation, kit, testId, compact = false }: { mechanism: MechanismConfig; simulation: ReturnType<typeof fitMechanismSimulation>; kit: PhysicalKitSettings; testId: string; compact?: boolean }) => {
    const s = simulation.state;
    const r = compact ? 2.5 : 4;
    const scaled = (length: number, min: number, max: number) => Math.max(min, Math.min(max, length * simulation.scale));
    const test = (name: string) => compact ? undefined : `foundry-mechanism-${name}`;
    const templateTest = compact ? undefined : `foundry-template-${mechanism.type}`;
    const fabricationTest = (name: string) => compact ? undefined : `foundry-fabrication-${name}`;
    const radius = (length: number, min = compact ? 8 : 16, max = compact ? 28 : 58) => scaled(Math.max(1, length), min, max);
    const holeR = Math.max(compact ? 1.8 : 2.6, Math.min(compact ? 3.4 : 5.6, (kit.holeDiameterMm * SCENE_PX_PER_MM * simulation.scale) / 2));
    const pitch = Math.max(holeR * 3.5, kit.gridPitchMm * SCENE_PX_PER_MM * simulation.scale);
    const barWidth = Math.max(holeR * 4.2, compact ? 8 : 14);
    const degToRad = (deg: number) => (deg * Math.PI) / 180;
    const axisForAngle = (deg: number) => ({ x: Math.cos(degToRad(deg)), y: -Math.sin(degToRad(deg)) });
    const trackAxis = axisForAngle(mechanism.groundAngle ?? 0);
    const normalAxis = { x: -trackAxis.y, y: trackAxis.x };
    const inputAngleDeg = Math.atan2(s.j1.y - s.p1.y, s.j1.x - s.p1.x) * 180 / Math.PI;
    const outputAngleDeg = Math.atan2(s.j2.y - s.p2.y, s.j2.x - s.p2.x) * 180 / Math.PI;
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
        const holeCount = Math.max(2, Math.min(10, Math.round(len / pitch) + 1));
        return <g key={key} data-testid={testIdName ? test(testIdName) : undefined} className={`mechanism-part ${className}`} transform={`translate(${a.x} ${a.y}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`}>
            <rect data-testid={fabricationTest('part')} x="0" y={-barWidth / 2} width={len} height={barWidth} rx={barWidth / 2} />
            {Array.from({ length: holeCount }, (_, index) => {
                const x = holeCount === 1 ? 0 : (len * index) / (holeCount - 1);
                return <circle key={index} data-testid={fabricationTest('hole')} className="mechanism-hole" cx={x} cy="0" r={holeR} />;
            })}
        </g>;
    };
    const guideAxis = (center: Point, axis: Point, key: string, reach = compact ? 42 : 95, endStops = false) => {
        const len = Math.hypot(axis.x, axis.y) || 1;
        const ux = axis.x / len;
        const uy = axis.y / len;
        const start = { x: center.x - ux * reach, y: center.y - uy * reach };
        const angle = Math.atan2(uy, ux) * 180 / Math.PI;
        return <g key={key} data-testid={test('guide')} className="mechanism-part mechanism-frame" transform={`translate(${start.x} ${start.y}) rotate(${angle})`}>
            <rect data-testid={fabricationTest('slot')} x="0" y={-barWidth / 2} width={reach * 2} height={barWidth} rx={barWidth / 2} />
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
            <rect data-testid={fabricationTest('part')} x={-len / 2} y={-barWidth / 2} width={len} height={barWidth} rx={barWidth / 2} />
            <rect data-testid={fabricationTest('slot')} className="mechanism-slot" x={-len / 2 + barWidth * 0.75} y={-holeR} width={len - barWidth * 1.5} height={holeR * 2} rx={holeR} />
            {[-len / 2, len / 2].map((x, index) => <circle key={index} data-testid={fabricationTest('hole')} className="mechanism-hole" cx={x} cy="0" r={holeR} />)}
        </g>;
    };
    const pins = [s.p1, s.p2, s.j1, s.j2, s.aux].filter((point): point is Point => Boolean(point));
    const gear = (center: Point, length: number, className: string, key: string, min = compact ? 8 : 16, max = compact ? 34 : 62, rotation = 0) => {
        const outer = radius(length, min, max);
        const teeth = Math.max(8, Math.min(40, Math.round(outer / (compact ? 2.3 : 2.8))));
        const attachment = Math.max(outer * 0.48, holeR * 3);
        return <g key={key} data-mechanism-gear-key={key} data-rotation-deg={rotation.toFixed(2)} className={`mechanism-gear-part ${className}`} transform={`translate(${center.x} ${center.y}) rotate(${rotation})`}>
            <path data-testid={fabricationTest('gear')} className="mechanism-gear-teeth" d={gearPathD(outer, teeth)} />
            <circle data-testid={fabricationTest('hole')} className="mechanism-hole axle-hole" cx="0" cy="0" r={holeR} />
            {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle, index) => <circle key={index} data-testid={fabricationTest('hole')} className="mechanism-hole" cx={Math.cos(angle) * attachment} cy={Math.sin(angle) * attachment} r={holeR} />)}
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
            <rect data-testid={fabricationTest('rack')} x={-len / 2} y={-barWidth / 2} width={len} height={barWidth} rx={barWidth / 5} />
            <path className="mechanism-rack-teeth" d={teeth} />
            <rect data-testid={fabricationTest('slot')} className="mechanism-slot" x={-len / 2 + barWidth * 0.8} y={-holeR} width={len - barWidth * 1.6} height={holeR * 2} rx={holeR} />
            {[-len / 2, 0, len / 2].map((x, index) => <circle key={index} data-testid={fabricationTest('hole')} className="mechanism-hole" cx={x} cy="0" r={holeR} />)}
        </g>;
    };
    const camProfile = (center: Point, length: number) => {
        const base = radius(length, compact ? 10 : 20, compact ? 34 : 66);
        const points = Array.from({ length: 42 }, (_, index) => {
            const angle = (index / 42) * Math.PI * 2;
            const lift = camProfileScale(angle);
            return `${Math.cos(angle) * base * lift} ${Math.sin(angle) * base * lift}`;
        });
        return <g key="cam-body" data-testid={fabricationTest('cam')} className="mechanism-part mechanism-cam" transform={`translate(${center.x} ${center.y}) rotate(${inputAngleDeg})`}>
            <path className="mechanism-cam-profile" d={`M ${points.join(' L ')} Z`} />
            <circle data-testid={fabricationTest('hole')} className="mechanism-hole axle-hole" cx="0" cy="0" r={holeR} />
            <circle className="mechanism-hole" cx={base * 0.45} cy="0" r={holeR} />
        </g>;
    };
    const followerBlock = (center: Point) => <g key="follower" data-testid={fabricationTest('follower')} className="mechanism-part mechanism-output" transform={`translate(${center.x} ${center.y}) rotate(${Math.atan2(normalAxis.y, normalAxis.x) * 180 / Math.PI})`}>
        <rect data-testid={fabricationTest('part')} x={-barWidth * 1.35} y={-barWidth / 2} width={barWidth * 2.7} height={barWidth} rx={barWidth / 3} />
        <circle data-testid={fabricationTest('hole')} className="mechanism-hole" cx="0" cy="0" r={holeR} />
    </g>;
    const gearPreview = (mechanism.type === 'gear' || mechanism.type === 'planetary_gear' || mechanism.type === '5bar' || mechanism.type === 'rack-pinion') && <g data-testid={mechanism.type === '5bar' ? undefined : test('gear')}>
        {mechanism.type === 'rack-pinion' && <>
            {gear(s.p1, mechanism.crankLength, 'mechanism-driver', 'rack-pinion-gear', compact ? 8 : 16, compact ? 34 : 62, inputAngleDeg)}
        </>}
        {mechanism.type === 'gear' && <>
            {gear(s.p1, mechanism.crankLength, 'mechanism-driver', 'gear-a', compact ? 8 : 16, compact ? 34 : 62, inputAngleDeg)}
            {gear(s.p2, mechanism.rockerLength, 'mechanism-link secondary', 'gear-b', compact ? 8 : 16, compact ? 34 : 62, outputAngleDeg)}
        </>}
        {mechanism.type === 'planetary_gear' && <>
            {gear(s.p1, mechanism.crankLength, 'mechanism-driver', 'sun', compact ? 7 : 12, compact ? 22 : 42, 0)}
            {gear(s.p2, mechanism.rockerLength, 'mechanism-link secondary', 'planet', compact ? 7 : 12, compact ? 22 : 42, outputAngleDeg)}
            <circle className="mechanism-gear carrier" cx={s.p1.x} cy={s.p1.y} r={Math.max(radius(mechanism.groundLength, compact ? 16 : 30, compact ? 52 : 105), radius(mechanism.crankLength))} />
        </>}
        {mechanism.type === '5bar' && <>
            {gear(s.p1, mechanism.crankLength, 'mechanism-driver', 'fivebar-gear-a', compact ? 7 : 12, compact ? 22 : 42, inputAngleDeg)}
            {gear(s.p2, mechanism.rockerLength, 'mechanism-driver', 'fivebar-gear-b', compact ? 7 : 12, compact ? 22 : 42, outputAngleDeg)}
        </>}
    </g>;
    const links = (() => {
        if (mechanism.type === 'crank') return [link(s.p1, s.j1, 'driver', 'mechanism-driver', 'driver'), link(s.j1, s.effector, 'output', 'mechanism-output', 'output')];
        if (mechanism.type === '5bar') return [
            link(s.p1, s.p2, 'frame', 'mechanism-frame', 'frame'),
            link(s.p1, s.j1, 'driver-a', 'mechanism-driver', 'driver'),
            link(s.p2, s.aux, 'driver-b', 'mechanism-driver'),
            link(s.j1, s.j2, 'rod-a', 'mechanism-link', 'link'),
            link(s.aux, s.j2, 'rod-b', 'mechanism-link'),
            link(s.j2, s.effector, 'output', 'mechanism-output', 'output')
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
        if (mechanism.type === 'gear') return [
            link(s.p1, s.p2, 'gear-frame', 'mechanism-frame', 'frame'),
            link(s.p2, s.j2, 'gear-output-arm', 'mechanism-link', 'link'),
            link(s.j2, s.effector, 'gear-output', 'mechanism-output', 'output')
        ];
        if (mechanism.type === 'planetary_gear') return [
            link(s.p1, s.p2, 'carrier', 'mechanism-driver', 'driver'),
            link(s.p2, s.j2, 'planet-output-arm', 'mechanism-link', 'link'),
            link(s.j2, s.effector, 'planet-output', 'mechanism-output', 'output')
        ];
        return [
            link(s.p1, s.p2, 'frame', 'mechanism-frame', 'frame'),
            link(s.p1, s.j1, 'driver', 'mechanism-driver', 'driver'),
            link(s.j1, s.j2, 'coupler', 'mechanism-link', 'link'),
            link(s.j2, s.p2, 'rocker', 'mechanism-link'),
            link(s.j1, s.effector, 'output', 'mechanism-output', 'output')
        ];
    })();
    return <g data-testid={testId} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <g data-testid={templateTest}>
            {gearPreview}
            {links}
            {pins.map((point, i) => <circle key={i} className="mechanism-pin" cx={point.x} cy={point.y} r={r} />)}
            <circle data-testid={test('output-point')} className="mechanism-effector" cx={s.effector.x} cy={s.effector.y} r={r + 2}/>
        </g>
    </g>;
};

export default App;
