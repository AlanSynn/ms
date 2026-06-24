import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from './components/Canvas';
import { TrackingModal } from './components/TrackingModal';
import {
    AppStage,
    BodyPartLayer,
    CharacterPackageArtifact,
    FoundryExportPackage,
    GlobalConfig,
    MechanismConfig,
    MechanismType,
    Point,
    ProjectMotionPath,
    ProjectState
} from './types';
import { generateDXF, generateSVG } from './utils/exporter';
import { animationDeltaRadians, calculateLinkage, generateCurvePoints } from './utils/kinematics';
import { evaluateFitness, generateSmartConfig, mutateConfig } from './utils/optimizer';
import {
    applyProjectAction,
    createDefaultMechanism,
    createProjectFromProcessed,
    createSampleProject,
    downloadText,
    handoffGate,
    loadProjectSnapshot,
    mechanismWithGeneratedPath,
    projectSelfCheck,
    serializeProject,
    uid,
    validatePath
} from './utils/project';
import { processImageWithWebOnnx } from './utils/webOnnx';
import { createFabricationPackage, sampleFeasibleRange, validateForFabrication } from './utils/fabrication';
import { boardGridLines, boardToScene, bodyPartPivotScene, localPivotOffsetForScene, pathFromPoints, physicalKitPreset, sceneBoundsForSheet, sceneToBoard, sceneToSvg, svgPointerToScene, SCENE_VIEW } from './utils/coordinates';
import { loadCharacterPackage } from './utils/packageLoader';
import { mechanismBindingWarnings, motionAnchorJointIds, motionPreviewForPath, preferredMotionJointId } from './utils/motion';
import { AlertCircle, Boxes, BrainCircuit, Camera, CheckCircle2, Download, FileJson, Loader2, Play, Plus, Route, Save, Sparkles, Trash2, Upload } from 'lucide-react';

type FoundryState = MechanismConfig;

const STAGES: Array<{ id: AppStage; label: string; kicker: string }> = [
    { id: 'character', label: 'Character Selection', kicker: 'image → rig package' },
    { id: 'path', label: 'Path Editor', kicker: 'parts, skeleton, paths' },
    { id: 'foundry', label: 'Mechanism Foundry', kicker: 'recipe sandbox' },
    { id: 'design', label: 'Mechanism Design', kicker: 'attach + tune' },
    { id: 'blueprint', label: 'Blueprint Export', kicker: 'fabrication package' },
    { id: 'options', label: 'Options', kicker: 'global settings' }
];

const MECH_TYPES: MechanismType[] = ['4bar', 'cam', 'gear', 'planetary_gear', 'piston', 'yoke', 'quick-return', '5bar'];
const FOUNDRY_PRESETS: Record<string, Partial<MechanismConfig> & { label: string; recommendation: string }> = {
    balanced: { label: 'Balanced recommendation', recommendation: 'general purpose linkage with printable proportions' },
    compact: { label: 'Compact', recommendation: 'smaller footprint for tight board placement', groundLength: 120, couplerLength: 120, rockerLength: 80 },
    broad: { label: 'Broad sweep', recommendation: 'larger output sweep when board space allows', groundLength: 220, couplerLength: 210, rockerLength: 150 }
};
const MECHANISM_LIBRARY: Record<MechanismType, { label: string; sense: string; goodFor: string; constraint: string }> = {
    crank: { label: 'Crank driver', sense: 'single rotating input sets phase for simple cyclic motion', goodFor: 'baseline timing checks', constraint: 'needs downstream linkage before fabrication output is useful' },
    '4bar': { label: 'Four-bar linkage', sense: 'crank, coupler, and rocker turn rotation into an arcing output point', goodFor: 'limb swings and repeatable character gestures', constraint: 'show sampled safe angle range; partial rotation is acceptable when warned' },
    piston: { label: 'Slider piston', sense: 'rotation pushes a rod along one linear slide', goodFor: 'push-pull limbs, doors, and props', constraint: 'rod length and slider offset must keep the guide printable' },
    yoke: { label: 'Scotch yoke', sense: 'pin-in-slot motion converts rotation to straight reciprocation', goodFor: 'compact back-and-forth travel', constraint: 'slot stroke must stay inside the board profile' },
    'quick-return': { label: 'Quick-return linkage', sense: 'uneven timing makes one stroke faster than the return stroke', goodFor: 'snappy mechanical accents', constraint: 'review partial range before export' },
    '5bar': { label: 'Five-bar linkage', sense: 'two cranks combine phases for wider two-arm tracing', goodFor: 'complex foot or hand trajectories', constraint: 'phase and second speed decide path shape and collision risk' },
    cam: { label: 'Cam follower', sense: 'cam radius lifts a follower from a rotating disk profile', goodFor: 'timed bumps and repeated lifts', constraint: 'follower guide and cam disk must stay aligned' },
    gear: { label: 'Gear train', sense: 'paired gears transfer rotation through a fixed ratio', goodFor: 'reversing or scaling rotation', constraint: 'ratio sign and gear size decide output direction' },
    planetary_gear: { label: 'Planetary gear', sense: 'sun and planet gears compound rotation in a small footprint', goodFor: 'dense rotary assemblies', constraint: 'extra gears need spacing and clear labels in the recipe' }
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

const App: React.FC = () => {
    const [project, setProject] = useState<ProjectState>(() => {
        projectSelfCheck();
        return createSampleProject();
    });
    const [stage, setStage] = useState<AppStage>('character');
    const [angle, setAngle] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);
    const [showTrace, setShowTrace] = useState(true);
    const [drawMode, setDrawMode] = useState(false);
    const [showTracking, setShowTracking] = useState(false);
    const [foundry, setFoundry] = useState<FoundryState>(() => createDefaultMechanism('4bar', 'foundry-preview'));
    const [pendingCharacter, setPendingCharacter] = useState<{ project: ProjectState; summary: string; returnStage: AppStage } | null>(null);
    const [replaceCharacter, setReplaceCharacter] = useState(false);
    const [optimizerBusy, setOptimizerBusy] = useState(false);

    const dispatch = (action: Parameters<typeof applyProjectAction>[1]) => setProject(prev => applyProjectAction(prev, action));
    const goStage = (target: AppStage) => {
        const gate = handoffGate(project, target);
        if (!gate.ok && 'recoveryStage' in gate) {
            dispatch({ type: 'set_processing', processing: { stage: 'error', message: gate.message, progress: 0, error: gate.message } });
            setStage(gate.recoveryStage);
        } else {
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
            setAngle(prev => (prev + animationDeltaRadians(dt, playbackDurationMs, project.settings.animationSpeed, project.settings.timingProfile)) % (Math.PI * 2));
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [isPlaying, drawMode, optimizerBusy, playbackDurationMs, project.settings.animationSpeed, project.settings.timingProfile]);

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
            if (path) nextUpdates.targetPartId = path.partId;
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
            setStage('character');
        }
    };

    const optimizeSelectedMechanism = async () => {
        if (!selectedMechanism || !selectedPath || selectedPath.points.length < 3) return;
        setOptimizerBusy(true);
        await new Promise(r => setTimeout(r, 16));
        let best = generateSmartConfig(selectedPath.points, selectedMechanism.type);
        let bestScore = evaluateFitness(best, selectedPath.points);
        for (let i = 0; i < 260; i++) {
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
        if (!project.settings.autosave) return;
        try {
            localStorage.setItem('mechanim.autosave', serializeProject(project));
        } catch {
            // ponytail: autosave is best-effort; manual Save stays available.
        }
    }, [project]);

    const exportMechanismSvg = () => downloadText(`mechanisms-${Date.now()}.svg`, generateSVG(mechanismConfig, angle), 'image/svg+xml');
    const exportMechanismDxf = () => downloadText(`mechanisms-${Date.now()}.dxf`, generateDXF(mechanismConfig, angle), 'application/dxf');
    const saveProject = () => downloadText(`${project.metadata.name.replaceAll(' ', '-')}.mechanim.json`, serializeProject(project));
    const themeClass = project.settings.theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-950';

    return (
        <main className={`min-h-screen overflow-hidden ${themeClass}`} data-theme={project.settings.theme}>
            <div className="pointer-events-none fixed inset-0 opacity-70" style={{ background: 'radial-gradient(circle at 15% 10%, rgba(90,108,255,.12), transparent 28%), radial-gradient(circle at 85% 20%, rgba(90,108,255,.08), transparent 24%), linear-gradient(120deg, rgba(8,10,18,.04), transparent)' }} />
            <div className={`relative grid min-h-screen app-shell ${stage === 'character' ? 'is-onboarding' : ''}`}>
                <aside className="app-rail border-r border-slate-300/80 bg-white/70 p-5 backdrop-blur-xl">
                    <div className="mb-7">
                        <div className="accent-label text-[11px] font-black uppercase tracking-[0.28em]">Automataii web port</div>
                        <h1 className="mt-2 text-4xl font-black tracking-[-0.08em]">MechAnim</h1>
                        <p className="mt-2 text-sm leading-5 text-slate-500">Character, motion, mechanism, fabrication. One scene frame.</p>
                    </div>
                    <nav className="space-y-1">
                        {STAGES.map((item, index) => (
                            <button key={item.id} onClick={() => goStage(item.id)} className={`group w-full rounded-2xl px-3 py-3 text-left transition-all ${stage === item.id ? 'bg-slate-950 text-white shadow-xl shadow-slate-400/20' : 'hover:bg-white'}`}>
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-black uppercase tracking-[0.2em] opacity-60">0{index + 1}</span>
                                    {stage === item.id && <span className="nav-active-dot h-2 w-2 rounded-full" />}
                                </div>
                                <div className="mt-1 font-bold tracking-tight">{item.label}</div>
                                <div className="text-xs opacity-60">{item.kicker}</div>
                            </button>
                        ))}
                    </nav>
                    <div className="mt-6 border-t border-slate-200 pt-5 text-xs text-slate-500">
                        <div className="font-bold text-slate-800">{project.metadata.name}</div>
                        <div>{project.partOrder.length} parts · {Object.keys(project.paths).length} paths · {project.mechanisms.length} mechanisms</div>
                        <div>Grid {project.settings.physicalKit.gridPitchMm} mm · {project.metadata.status}</div>
                    </div>
                </aside>

                <section className="relative flex min-w-0 flex-col">
                    <header className="app-header flex items-center justify-between border-b border-slate-300/70 bg-white/50 px-7 py-4 backdrop-blur-xl">
                        <div>
                            <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">{STAGES.find(s => s.id === stage)?.kicker}</div>
                            <h2 className="text-2xl font-black tracking-[-0.05em]">{STAGES.find(s => s.id === stage)?.label}</h2>
                        </div>
                        {project.settings.toolbarVisible && <div className="flex gap-2">
                            <label className="btn-secondary cursor-pointer"><Upload size={16}/> Import<input hidden type="file" accept="application/json,.json" onChange={e => e.target.files?.[0] && importProject(e.target.files[0])}/></label>
                            <button className="btn-secondary" onClick={saveProject}><Save size={16}/> Save</button>
                            <button className="btn-primary" onClick={() => goStage('blueprint')}><Download size={16}/> Export</button>
                        </div>}
                    </header>

                    <div className={`stage-body min-h-0 flex-1 overflow-auto ${stage === 'character' ? 'p-0' : 'p-7'}`}>
                        {stage === 'character' && <CharacterSelection project={project} pendingCharacter={pendingCharacter} replaceCharacter={replaceCharacter} setReplaceCharacter={setReplaceCharacter} onAccept={() => { if (!pendingCharacter) return; setProject(pendingCharacter.project); setPendingCharacter(null); setStage(pendingCharacter.returnStage); }} onDiscard={() => setPendingCharacter(null)} onSample={() => { setPendingCharacter(null); setProject(createSampleProject()); setStage('path'); }} onProcess={runWebOnnx} onPackage={importCharacterPackage} onImport={importProject} />}
                        {stage === 'path' && <PathEditor project={project} sortedParts={sortedParts} selectedPart={selectedPart} selectedPath={selectedPath} drawMode={drawMode} setDrawMode={setDrawMode} dispatch={dispatch} setPathPoints={setPathPoints} openTracking={() => setShowTracking(true)} isPlaying={isPlaying} setIsPlaying={setIsPlaying} angle={angle} setAngle={setAngle} onNext={() => goStage('foundry')} />}
                        {stage === 'foundry' && <MechanismFoundry project={project} foundry={foundry} setFoundry={setFoundry} selectedPart={selectedPart} selectedPath={selectedPath} onExport={(pkg) => {
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
                        {stage === 'design' && <MechanismDesign project={project} selectedMechanism={selectedMechanism} mechanismConfig={mechanismConfig} setMechanismConfig={setMechanismConfig} updateMechanism={updateMechanism} dispatch={dispatch} isPlaying={isPlaying} setIsPlaying={setIsPlaying} showTrace={showTrace} setShowTrace={setShowTrace} angle={angle} setAngle={setAngle} onOptimize={optimizeSelectedMechanism} optimizerBusy={optimizerBusy} exportSvg={exportMechanismSvg} exportDxf={exportMechanismDxf} />}
                        {stage === 'blueprint' && <BlueprintExport project={project} dispatch={dispatch} goStage={goStage} />}
                        {stage === 'options' && <Options project={project} dispatch={dispatch} />}
                    </div>
                </section>
            </div>
            <TrackingModal isOpen={showTracking} onClose={() => setShowTracking(false)} onTransfer={path => { setPathPoints(path, 'tracked'); setShowTracking(false); setStage('path'); }} />
        </main>
    );
};

const CharacterSelection = ({ project, pendingCharacter, replaceCharacter, setReplaceCharacter, onAccept, onDiscard, onSample, onProcess, onPackage, onImport }: {
    project: ProjectState;
    pendingCharacter: { project: ProjectState; summary: string; returnStage: AppStage } | null;
    replaceCharacter: boolean;
    setReplaceCharacter: (v: boolean) => void;
    onAccept: () => void;
    onDiscard: () => void;
    onSample: () => void;
    onProcess: (file: File) => void;
    onPackage: (files: FileList | File[]) => void;
    onImport: (file: File) => void;
}) => {
    const reviewedProject = pendingCharacter?.project ?? project;
    const artifact = reviewedProject.characterPackage;
    const isPlainReview = artifact?.replacementContext?.mode !== 'replace-character';
    const isReplacementReview = artifact?.replacementContext?.mode === 'replace-character';
    const statusOpen = Boolean(pendingCharacter || ['loading-model', 'running-model', 'normalizing', 'error'].includes(project.processing.stage));
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
    return (
    <div className="onboarding-page">
        <section className="onboarding-hero">
            <div className="onboarding-copy animate-rise">
                <div className="accent-label section-title">Start with a template</div>
                <h1>MechAnim</h1>
                <h3>Pick a motion, then draw the path.</h3>
                <p>Choose a real starter project or load your own character package. Everything flows into paths, mechanisms, and blueprint export.</p>
            </div>
            <div className="template-gallery" data-testid="template-gallery">
                <button type="button" className="template-tile primary" onClick={onSample}>
                    <span className="template-kicker">Best first choice</span>
                    <strong>Waving arm</strong>
                    <span>Right arm path + four-bar linkage, ready to preview and export.</span>
                    <small>6 parts · 1 path · 1 mechanism</small>
                    <b><Sparkles size={16}/> Open Waving arm</b>
                </button>
                <button type="button" className="template-tile cursor-pointer" onClick={() => packageInputRef.current?.click()}>
                    <span className="template-kicker">Use your art</span>
                    <strong>Blank character</strong>
                    <span>Load a character package with artwork and skeleton. No fake mechanism is added.</span>
                    <small>Package review · 0 mechanisms</small>
                    <b><FileJson size={16}/> Load package</b>
                </button>
                <input ref={packageInputRef} data-testid="blank-package-input" hidden type="file" multiple accept=".json,.yaml,.yml,image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => {
                    const files = e.currentTarget.files ? Array.from(e.currentTarget.files) as File[] : [];
                    e.currentTarget.value = '';
                    if (files.length) onPackage(files);
                }}/>
                <button type="button" className="template-tile cursor-pointer" onClick={() => onnxInputRef.current?.click()}>
                    <span className="template-kicker">Image assist</span>
                    <strong>Create from image</strong>
                    <span>Analyze one image locally, then review the generated character package.</span>
                    <small>Private on-device processing</small>
                    <b><BrainCircuit size={16}/> Choose image</b>
                </button>
                <input ref={onnxInputRef} data-testid="onnx-input" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (file) onProcess(file);
                }}/>
            </div>
        </section>
        <section className="onboarding-secondary">
            <div className="secondary-actions">
                <button type="button" className="btn-secondary cursor-pointer" onClick={() => importInputRef.current?.click()}><Upload size={16}/> Import project</button><input ref={importInputRef} data-testid="onboarding-import-input" hidden type="file" accept="application/json,.json" onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (file) onImport(file);
                }}/>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-600"><input type="checkbox" checked={replaceCharacter} onChange={e => setReplaceCharacter(e.target.checked)} /> Replace current character and preserve compatible mechanisms</label>
            </div>
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
    );
};

const ProgressBlock = ({ project }: { project: ProjectState }) => {
    const p = project.processing;
    return <div className="progress-card rounded-3xl p-5">
        <div className="flex items-center gap-3">
            {p.stage === 'error' ? <AlertCircle className="text-red-400"/> : p.stage === 'ready' ? <CheckCircle2 className="text-emerald-400"/> : <Loader2 className="progress-icon animate-spin"/>}
            <div>
                <div className="font-bold capitalize">{p.message}</div>
                <div className="progress-stage text-xs">{p.stage}</div>
            </div>
        </div>
        <div className="progress-track mt-4 h-2 rounded-full"><div className="progress-bar h-2 rounded-full transition-all" style={{ width: `${p.progress}%` }}/></div>
        {p.error && <pre className="mt-4 max-h-32 overflow-auto whitespace-pre-wrap rounded-2xl bg-red-950/60 p-3 text-xs text-red-100">{p.error}</pre>}
    </div>;
};

const PathEditor = ({ project, sortedParts, selectedPart, selectedPath, drawMode, setDrawMode, dispatch, setPathPoints, openTracking, isPlaying, setIsPlaying, angle, setAngle, onNext }: {
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
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const freeDraftRef = useRef<Point[] | null>(null);
    const [dragPoint, setDragPoint] = useState<number | null>(null);
    const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
    const [isFreeDrawing, setIsFreeDrawing] = useState(false);
    const pathLocked = Boolean(selectedPart?.locked);
    const pointCount = selectedPath?.points.length ?? 0;
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
    return <div className={`grid gap-5 ${project.settings.partPanelVisible ? 'xl:grid-cols-[1fr_340px]' : ''}`}>
        <div className="path-canvas-shell workspace overflow-hidden p-0">
            <div className="canvas-hint">
                <strong>{drawMode ? (isFreeDrawing ? 'Drawing…' : 'Drag anywhere to draw') : 'Pick Draw free path'}</strong>
                <span>{selectedPart?.name ?? 'No part'} · {pointCount} points</span>
            </div>
            <SceneSketch svgRef={svgRef} project={project} selectedPath={selectedPath} dragPoint={dragPoint} selectedPoint={selectedPoint} setDragPoint={setDragPoint} setSelectedPoint={setSelectedPoint} onPointMove={movePoint} onPointUp={stopDrawing} onCanvasDown={onCanvasDown} dispatch={dispatch} drawMode={drawMode} pathLocked={pathLocked} isPlaying={isPlaying} angle={angle}/>
        </div>
        {project.settings.partPanelVisible && <aside className="path-panel workspace space-y-4 p-5" data-testid="novice-path-panel">
            <div>
                <h4 className="section-title">Free path</h4>
                <h3>Draw the motion path</h3>
                <p>Choose a body part, press Draw free path, then hold and drag on the canvas.</p>
                <select aria-label="Selected body part" className="field mt-2" value={selectedPart?.id ?? ''} onChange={e => dispatch({ type: 'select_part', partId: e.target.value })}>
                    {sortedParts.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
                </select>
                <div className="mt-3 flex flex-col gap-2">
                    <button className={`btn-primary ${drawMode ? 'active' : ''}`} disabled={pathLocked} onClick={() => setDrawMode(!drawMode)}><Route size={16}/>{drawMode ? 'Drawing free path' : 'Draw free path'}</button>
                    <button className="btn-secondary" disabled={!selectedPath || pathLocked} onClick={clearPath}><Trash2 size={16}/> Clear path</button>
                    <button className="btn-secondary" disabled={pointCount < 3 || pathLocked} onClick={onNext}>Next: choose mechanism</button>
                </div>
                <div className="free-draw-status" data-testid="free-draw-status">{selectedPath ? `${pointCount} points · ${selectedPath.id}` : '0 points · none'}{pathLocked ? ' · locked part' : ''}</div>
                {!selectedPath && <div className="warning">No path for this part yet. Draw or track a path before fitting a mechanism.</div>}
                {selectedPath && selectedPath.points.length < 3 && <div className="warning">Add at least 3 path points before choosing a mechanism.</div>}
                {pathLocked && <div className="warning">Unlock the selected part before editing, deleting, drawing, or tracking its path.</div>}
                {selectedPath?.warnings.map((w, i) => <div key={`${w}-${i}`} className="warning">{w}</div>)}
            </div>
            <details className="advanced-panel">
                <summary>Path options</summary>
                <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn-secondary" disabled={pathLocked} onClick={openTracking}><Camera size={16}/> Track from video</button>
                    <button className="btn-secondary" onClick={() => setIsPlaying(!isPlaying)}><Play size={16}/>{isPlaying ? 'Stop' : 'Play'}</button>
                    <button className="btn-secondary" onClick={() => setAngle(0)}>Reset</button>
                    {selectedPath && <button className="btn-secondary" disabled={pathLocked} onClick={() => updatePath({ visible: !selectedPath.visible })}>{selectedPath.visible ? 'Hide path' : 'Show path'}</button>}
                    {selectedPath && <button className="btn-secondary" disabled={pathLocked} onClick={() => updatePath({ enabled: !selectedPath.enabled })}>{selectedPath.enabled ? 'Disable' : 'Enable'}</button>}
                    {selectedPoint !== null && <button className="btn-secondary" disabled={pathLocked} onClick={deletePoint}>Delete point</button>}
                </div>
                <div className="mt-3 text-sm text-slate-600">{selectedPath ? `${selectedPath.source} · ${selectedPath.duration} ms · ${selectedPath.timedPoints?.length ?? 0} timed samples` : 'No timing yet'}</div>
            </details>
            <details className="advanced-panel">
                <summary>Advanced part setup</summary>
                <div className="mt-3">
                    <h4 className="section-title">Parts + skeleton</h4>
                    <div className="mt-3 flex gap-2"><button className="btn-secondary" onClick={addLayer}><Plus size={16}/> Add layer</button>{selectedPart && <button className="btn-secondary" disabled={selectedPart.locked} onClick={() => dispatch({ type: 'delete_part', partId: selectedPart.id })}><Trash2 size={16}/> Remove layer</button>}</div>
                    {selectedPart && <PartInspector part={selectedPart} dispatch={dispatch} />}
                    <div className="divider mt-4" />
                    <SkeletonInspector project={project} dispatch={dispatch} />
                </div>
            </details>
        </aside>}
    </div>;
};

const SceneSketch = ({ project, svgRef, selectedPath, dragPoint, selectedPoint, setDragPoint, setSelectedPoint, onPointMove, onPointUp, onCanvasDown, dispatch, drawMode, pathLocked, isPlaying, angle }: { project: ProjectState; svgRef: React.RefObject<SVGSVGElement | null>; selectedPath?: ProjectMotionPath; dragPoint: number | null; selectedPoint: number | null; setDragPoint: (i: number | null) => void; setSelectedPoint: (i: number | null) => void; onPointMove: (e: React.MouseEvent<SVGSVGElement>) => void; onPointUp: () => void; onCanvasDown: (e: React.MouseEvent<SVGSVGElement>) => void; dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void; drawMode?: boolean; pathLocked?: boolean; isPlaying: boolean; angle: number }) => {
    const kit = project.settings.physicalKit;
    const sheet = sceneBoundsForSheet(kit);
    const pathMechanism = selectedPath ? project.mechanisms.find(m => m.targetPathId === selectedPath.id && m.targetPartId === selectedPath.partId) : undefined;
    const targetJointId = selectedPath ? preferredMotionJointId(project, selectedPath.partId, pathMechanism?.targetAnchorJointId, { preferDistalWhenRoot: !pathMechanism?.targetAnchorJointId }) : undefined;
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
    return <svg ref={svgRef} aria-label="Path editor canvas" data-testid="path-canvas" viewBox={`0 0 ${SCENE_VIEW.width} ${SCENE_VIEW.height}`} className={`h-[calc(100vh-160px)] min-h-[560px] w-full bg-[#f8fbff] ${drawMode ? 'cursor-crosshair' : ''}`} onMouseDown={onCanvasDown} onMouseMove={onPointMove} onMouseUp={onPointUp} onMouseLeave={onPointUp}>
        <defs><filter id="soft"><feDropShadow dx="0" dy="10" stdDeviation="10" floodOpacity="0.13"/></filter></defs>
        <rect x={sheetSvg.x} y={sheetSvg.y} width={sheetSvg.width} height={sheetSvg.height} rx="18" fill="white" stroke="#d6dbe8" strokeWidth="1.5"/>
        {gridLines}
        <text x={sheetSvg.x + 16} y={sheetSvg.y + 28} className="fill-slate-400 text-[12px] font-bold">Letter sheet · {kit.gridPitchMm / 10}cm grid</text>
        {previewSkeleton?.bones.map(([a, b]) => {
            const ja = previewSkeleton?.joints[a]; const jb = previewSkeleton?.joints[b];
            if (!ja || !jb) return null;
            const pa = sceneToSvg(ja.position); const pb = sceneToSvg(jb.position);
            return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#434a59" strokeWidth="2" opacity="0.35"/>;
        })}
        {project.partOrder.map(id => previewParts[id] ?? project.parts[id]).filter(Boolean).map(part => <React.Fragment key={part.id}><PartShape part={part} selected={project.selectedPartId === part.id} drawMode={drawMode} onSelect={() => dispatch({ type: 'select_part', partId: part.id })}/></React.Fragment>) }
        {previewSkeleton && Object.values(previewSkeleton.joints).map(j => {
            const p = sceneToSvg(j.position);
            return <g key={j.id}><circle cx={p.x} cy={p.y} r={j.locked ? 6 : 4} fill={j.locked ? '#ef4444' : '#434a59'} stroke="white" strokeWidth="2"/><title>{j.id} bend {j.bendDirection}</title></g>;
        })}
        {Object.values(project.paths).filter(p => p.visible).map(path => <path key={path.id} d={pathFromPoints(path.points, path.closed)} fill="none" stroke={path.enabled ? '#5a6cff' : '#94a3b8'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/>)}
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
    return <g data-testid={`path-part-${part.id}`} transform={`translate(${p.x} ${p.y}) rotate(${-part.transform.rotation})`} onClick={e => { if (!drawMode) { e.stopPropagation(); onSelect(); } }} className={`${drawMode ? 'cursor-crosshair' : 'cursor-pointer'} transition-opacity`} opacity={part.opacity} filter="url(#soft)">
        {part.textureUrl ? <image href={part.textureUrl} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="xMidYMid meet"/> : <rect x={-w/2} y={-h/2} width={w} height={h} rx="22" fill={part.fillColor}/>}
        <rect x={-w/2} y={-h/2} width={w} height={h} rx="22" fill="none" stroke={selected ? '#5a6cff' : part.fillColor} strokeWidth={selected ? 4 : 1.5} strokeDasharray={selected ? '0' : '5 5'}/>
        {part.localPivotOffset && <circle cx={part.localPivotOffset.x * part.transform.scale} cy={-part.localPivotOffset.y * part.transform.scale} r={5} fill="#5a6cff" stroke="white" strokeWidth="2"><title>local pivot</title></circle>}
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
            <MiniNumber label="Bend direction" value={joint.bendDirection} min={-1} max={1} step={0.1} disabled={joint.locked} onChange={bendDirection => dispatch({ type: 'update_joint', jointId: joint.id, updates: { bendDirection } })}/>
            <button className="btn-secondary" disabled={joint.locked || project.skeleton?.rootJointIds.includes(joint.id)} onClick={() => dispatch({ type: 'remove_joint', jointId: joint.id })}><Trash2 size={16}/> Remove joint</button>
        </div>}
        <button className="btn-secondary mt-4" onClick={() => dispatch({ type: 'add_joint', joint: { id: uid('joint'), name: 'new joint', position: { x: 0, y: 0 }, parentId: joint?.id ?? null, locked: false, bendDirection: 1 } })}><Plus size={16}/> Add joint</button>
    </div>;
};

const MechanismFoundry = ({ project, foundry, setFoundry, selectedPart, selectedPath, onExport }: { project: ProjectState; foundry: FoundryState; setFoundry: (m: FoundryState) => void; selectedPart?: BodyPartLayer; selectedPath?: ProjectMotionPath; onExport: (pkg: FoundryExportPackage) => void }) => {
    const targetReady = Boolean(selectedPart && selectedPath && selectedPath.enabled && selectedPath.points.length >= 3);
    const rawLanding = selectedPath?.points[0] ?? (selectedPart ? bodyPartPivotScene(selectedPart, project.skeleton) : { x: foundry.anchorX ?? 0, y: foundry.anchorY ?? 0 });
    const landingBoard = sceneToBoard(rawLanding, project.settings.physicalKit);
    const landing = boardToScene(landingBoard.col, landingBoard.row, project.settings.physicalKit);
    const snapDistance = Math.hypot(rawLanding.x - landing.x, rawLanding.y - landing.y);
    const landedFoundry = useMemo(() => ({ ...foundry, anchorX: landing.x, anchorY: landing.y, sceneAnchor: landing }), [foundry, landing.x, landing.y]);
    const preview = useMemo(() => generateCurvePoints(landedFoundry, 96).points, [landedFoundry]);
    const range = sampleFeasibleRange(landedFoundry);
    const library = MECHANISM_LIBRARY[foundry.type];
    const feasibilityText = range.warning ?? '360° valid sampled motion';
    const previewPath = fitPathToBox(preview, 360, 240);
    const hardBlocked = !targetReady || range.percentValid === 0 || !Number.isFinite(landing.x) || !Number.isFinite(landing.y);
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
            targetAnchorJointId: preferredMotionJointId(project, selectedPart?.id, undefined, { preferDistalWhenRoot: true }),
            metadata: { sourceTab: 'mechanism-foundry', selectedPreset: preset, recommendation: foundry.recommendation ?? FOUNDRY_PRESETS[preset]?.recommendation },
            warnings: range.warning ? [range.warning] : [],
            source: 'mechanism-foundry'
        };
    };
    return <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="workspace p-6">
            <div className="mb-5 flex items-center justify-between"><h4 className="section-title">Sandbox preview</h4><button className="btn-primary" disabled={hardBlocked} onClick={() => onExport(makePackage())}><Boxes size={16}/> Use this mechanism</button></div>
            <svg viewBox="0 0 360 240" className="foundry-preview h-[520px] w-full rounded-[2rem]">
                <path d={previewPath} fill="none" stroke={foundry.color} strokeWidth="4" strokeLinecap="round" opacity="0.95"/>
                <text x="22" y="38" className="foundry-preview-label" fontSize="16" fontWeight="800">{library.label} · {range.percentValid === 1 ? '360° valid' : range.warning}</text>
            </svg>
        </section>
        <aside className="workspace space-y-4 p-5">
            <h4 className="section-title">Mechanism library</h4>
            <div className="mechanism-choice-grid">
                {(['4bar', 'cam', 'piston', 'gear'] as MechanismType[]).map(type => {
                    const item = MECHANISM_LIBRARY[type];
                    return <button key={type} type="button" className={`recommendation-card mechanism-choice ${foundry.type === type ? 'active' : ''}`} onClick={() => setFoundry({ ...createDefaultMechanism(type, 'foundry-preview'), color: foundry.color, presetId: 'balanced', recommendation: FOUNDRY_PRESETS.balanced.recommendation })}>
                        <div className="font-bold text-slate-800">{item.label}</div>
                        <div>{item.goodFor}</div>
                    </button>;
                })}
            </div>
            <div className="recommendation-card" data-testid="foundry-mechanism-library">
                <div className="font-bold text-slate-800">Selected: {library.label}</div>
                <div>Sensemaking: {library.sense}.</div>
                <div>Constraint: {library.constraint}.</div>
                <div data-testid="foundry-feasibility">Feasibility: {feasibilityText}</div>
            </div>
            <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600" data-testid="foundry-target-summary">
                <div className="font-bold text-slate-800">Target: {selectedPart?.name ?? 'none'} · path {selectedPath?.points.length ?? 0} pts</div>
                <div>Export lands at {landing.x.toFixed(0)}, {landing.y.toFixed(0)} ({landingBoard.label}) · anchor {selectedPart?.anchorJointId ?? 'none'}</div>
                {snapDistance > 0.5 && <div>Snapped {snapDistance.toFixed(0)} scene units from target to nearest board hole for fabrication.</div>}
                <div>{foundry.recommendation ?? FOUNDRY_PRESETS.balanced.recommendation}</div>
            </div>
            {!targetReady && <div className="warning">Draw at least 3 points for a selected body part before exporting a mechanism.</div>}
            {range.warning && <div className="warning">{range.warning}</div>}
            <details className="advanced-panel">
                <summary>Mechanism options</summary>
                <div className="mt-3 space-y-3">
                    <select aria-label="Foundry mechanism type" className="field" value={foundry.type} onChange={e => setFoundry({ ...createDefaultMechanism(e.target.value as MechanismType, 'foundry-preview'), color: foundry.color, presetId: 'balanced', recommendation: FOUNDRY_PRESETS.balanced.recommendation })}>{MECH_TYPES.map(t => <option key={t}>{t}</option>)}</select>
                    <select aria-label="Foundry preset" className="field" value={foundry.presetId ?? 'balanced'} onChange={e => {
                        const presetId = e.target.value;
                        const preset = FOUNDRY_PRESETS[presetId];
                        const { label: _label, ...updates } = preset;
                        const base = presetId === 'balanced' ? createDefaultMechanism(foundry.type, 'foundry-preview') : foundry;
                        setFoundry({ ...base, anchorX: foundry.anchorX, anchorY: foundry.anchorY, sceneAnchor: foundry.sceneAnchor, color: foundry.color, ...updates, presetId, recommendation: preset.recommendation });
                    }}>{Object.entries(FOUNDRY_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}</select>
                    {PARAMS.filter(p => showParam(foundry.type, p.key)).map(p => <React.Fragment key={String(p.key)}><MiniNumber label={p.label} value={Number(foundry[p.key] ?? 0)} min={p.min} max={p.max} step={p.step} onChange={value => setFoundry({ ...foundry, [p.key]: value })}/></React.Fragment>) }
                </div>
            </details>
        </aside>
    </div>;
};

const MechanismDesign = ({ project, selectedMechanism, mechanismConfig, setMechanismConfig, updateMechanism, dispatch, isPlaying, setIsPlaying, showTrace, setShowTrace, angle, setAngle, onOptimize, optimizerBusy, exportSvg, exportDxf }: {
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
    optimizerBusy: boolean;
    exportSvg: () => void;
    exportDxf: () => void;
}) => {
    const selectedLibrary = selectedMechanism ? MECHANISM_LIBRARY[selectedMechanism.type] : undefined;
    const selectedRange = selectedMechanism ? sampleFeasibleRange(selectedMechanism) : undefined;
    const bindingWarnings = mechanismBindingWarnings(project);
    const selectedBindingWarnings = selectedMechanism ? bindingWarnings[selectedMechanism.id] ?? [] : [];
    const targetAnchorOptions = selectedMechanism?.targetPartId ? motionAnchorJointIds(project, selectedMechanism.targetPartId) : [];
    const selectedTargetAnchor = selectedMechanism?.targetPartId
        ? preferredMotionJointId(project, selectedMechanism.targetPartId, selectedMechanism.targetAnchorJointId)
        : undefined;
    return <div className={`grid gap-5 ${project.settings.partPanelVisible ? 'xl:grid-cols-[1fr_360px]' : ''}`}>
    <div className="workspace overflow-hidden p-0">
        <Canvas project={project} config={mechanismConfig} setConfig={setMechanismConfig} selectedId={project.selectedMechanismId ?? null} setSelectedId={id => dispatch({ type: 'set_mechanisms', mechanisms: project.mechanisms, selectedMechanismId: id })} isPlaying={isPlaying} showTrace={showTrace} isDrawMode={false} userPath={[]} setUserPath={() => {}} angle={angle} setAngle={setAngle}/>
    </div>
    {project.settings.partPanelVisible && <aside className="workspace space-y-4 p-5">
        <div className="flex gap-2"><button className="btn-secondary" onClick={() => setIsPlaying(!isPlaying)}><Play size={16}/>{isPlaying ? 'Pause' : 'Play'}</button><button className="btn-secondary" onClick={() => setShowTrace(!showTrace)}>Trace</button></div>
        <h4 className="section-title">Mechanism instances</h4>
        <select aria-label="Mechanism instance" className="field" value={selectedMechanism?.id ?? ''} onChange={e => dispatch({ type: 'set_mechanisms', mechanisms: project.mechanisms, selectedMechanismId: e.target.value })}>{project.mechanisms.map(m => <option key={m.id} value={m.id}>{m.id} · {m.type}</option>)}</select>
        <div className="flex flex-wrap gap-2">
            {MECH_TYPES.map(type => <button key={type} className="chip" onClick={() => dispatch({ type: 'upsert_mechanism', mechanism: mechanismWithGeneratedPath(createDefaultMechanism(type, uid('mech'))) })}>{type}</button>)}
        </div>
        {selectedLibrary && <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600" data-testid="design-mechanism-library">
            <div className="font-bold text-slate-800">Mechanism library</div>
            <div>{selectedLibrary.label}</div>
            <div>Sensemaking: {selectedLibrary.sense}.</div>
            <div>Good for: {selectedLibrary.goodFor}.</div>
            <div>Constraint: {selectedLibrary.constraint}.</div>
            <div data-testid="design-feasibility">Feasibility: {selectedRange?.warning ?? '360° valid sampled motion'}</div>
        </div>}
        {selectedMechanism && <>
            <Toggle label="Visible" checked={selectedMechanism.visible} onChange={visible => updateMechanism(selectedMechanism.id, { visible })}/>
            <Toggle label="Enabled" checked={selectedMechanism.enabled !== false} onChange={enabled => updateMechanism(selectedMechanism.id, { enabled })}/>
            <select aria-label="Mechanism target part" className="field" value={selectedMechanism.targetPartId ?? ''} onChange={e => updateMechanism(selectedMechanism.id, { targetPartId: e.target.value || undefined })}><option value="">No target part</option>{project.partOrder.map(id => <option key={id} value={id}>{project.parts[id].name}</option>)}</select>
            <select aria-label="Mechanism target path" className="field" value={selectedMechanism.targetPathId ?? ''} onChange={e => updateMechanism(selectedMechanism.id, { targetPathId: e.target.value || undefined })}><option value="">No target path</option>{Object.values(project.paths).filter(p => !selectedMechanism.targetPartId || p.partId === selectedMechanism.targetPartId).map(p => <option key={p.id} value={p.id}>{p.id} · {p.points.length} pts</option>)}</select>
            {selectedMechanism.targetPartId && project.skeleton && <select aria-label="Mechanism target anchor" className="field" value={selectedTargetAnchor ?? ''} onChange={e => updateMechanism(selectedMechanism.id, { targetAnchorJointId: e.target.value || undefined })}>
                <option value="">Part anchor default</option>
                {targetAnchorOptions.map(id => <option key={id} value={id}>{id}</option>)}
            </select>}
            {PARAMS.filter(p => showParam(selectedMechanism.type, p.key)).map(p => <React.Fragment key={String(p.key)}><MiniNumber label={p.label} value={Number(selectedMechanism[p.key] ?? 0)} min={p.min} max={p.max} step={p.step} onChange={value => updateMechanism(selectedMechanism.id, { [p.key]: value } as Partial<MechanismConfig>)}/></React.Fragment>) }
            {selectedBindingWarnings.map((w, i) => <div className="warning" key={`binding-${w}-${i}`}>{w}</div>)}
            {selectedRange?.warning && <div className="warning">{selectedRange.warning}</div>}
            {selectedMechanism.warnings?.map((w, i) => <div className="warning" key={`${w}-${i}`}>{w}</div>)}
            <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={optimizerBusy} onClick={onOptimize}>{optimizerBusy ? <Loader2 className="animate-spin" size={16}/> : <Sparkles size={16}/>} Fit path</button><button className="btn-secondary" onClick={() => dispatch({ type: 'delete_mechanism', mechanismId: selectedMechanism.id })}><Trash2 size={16}/> Delete</button></div>
            <div className="flex gap-2"><button className="btn-secondary" onClick={exportSvg}>SVG</button><button className="btn-secondary" onClick={exportDxf}>DXF</button></div>
        </>}
    </aside>}
</div>;
};

const BlueprintExport = ({ project, dispatch, goStage }: { project: ProjectState; dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void; goStage: (stage: AppStage) => void }) => {
    const validation = validateForFabrication(project);
    const create = () => {
        const pkg = createFabricationPackage(project);
        dispatch({ type: 'set_export', fabricationPackage: pkg });
    };
    const pkg = project.lastExport;
    const defaultFormat = project.settings.physicalKit.defaultExportFormat;
    const downloadJson = () => pkg && downloadText(`${pkg.id}.json`, JSON.stringify(pkg, null, 2));
    const downloadSvg = () => pkg && downloadText(`${pkg.id}.svg`, pkg.svg, 'image/svg+xml');
    return <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <section className="workspace p-6">
            <h4 className="section-title">Validation</h4>
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
                <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={downloadJson}>JSON</button>
                <button className="btn-secondary" onClick={downloadSvg}>SVG</button>
                <button className="btn-secondary" onClick={() => downloadText(`${pkg.id}-assembly.html`, pkg.assemblyGuideHtml, 'text/html')}>Guide</button>
                <button className="btn-secondary" onClick={() => downloadText(`${pkg.id}-metadata.json`, pkg.metadataJson)}>Metadata</button>
                <button className="btn-secondary" onClick={() => downloadText(`${pkg.id}-assembly.pdf`, pkg.assemblyGuidePdf, 'application/pdf')}>PDF</button>
                </div>
            </div>}
        </section>
        <section className="workspace p-6">
            <h4 className="section-title">Current-scene recipes</h4>
            <div className="mt-4 grid gap-3">{(pkg?.recipes ?? project.mechanisms.map(m => ({ mechanismId: m.id, type: m.type, boardCoordinate: 'pending', warnings: m.warnings ?? [] }))).map(r => <div key={r.mechanismId} className="row"><div><div className="font-bold">{r.mechanismId} · {r.type}</div><div className="text-sm text-slate-500">Board {r.boardCoordinate}</div></div><div className="text-xs text-amber-700">{r.warnings?.join(', ')}</div></div>)}</div>
            {pkg && <img className="mt-5 rounded-3xl border border-slate-200 bg-white p-3" alt="fabrication SVG preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pkg.svg)}`} />}
        </section>
    </div>;
};

const Options = ({ project, dispatch }: { project: ProjectState; dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void }) => <div className="workspace max-w-3xl space-y-5 p-6">
    <h4 className="section-title">Global settings</h4>
    <MiniNumber label="Animation speed" value={project.settings.animationSpeed} min={0.1} max={5} step={0.1} onChange={animationSpeed => dispatch({ type: 'update_settings', settings: { animationSpeed } })}/>
    <MiniNumber label="Animation duration ms" value={project.settings.animationDurationMs} min={300} max={12000} step={100} onChange={animationDurationMs => dispatch({ type: 'update_settings', settings: { animationDurationMs } })}/>
    <select className="field" value={project.settings.timingProfile} onChange={e => dispatch({ type: 'update_settings', settings: { timingProfile: e.target.value as ProjectState['settings']['timingProfile'] } })}>
        <option value="realtime">Timing: realtime</option>
        <option value="slow">Timing: slow inspection</option>
        <option value="presentation">Timing: presentation</option>
    </select>
    <MiniNumber label="Grid pitch mm" value={project.settings.physicalKit.gridPitchMm} min={5} max={50} onChange={gridPitchMm => dispatch({ type: 'update_settings', settings: { physicalKit: { ...project.settings.physicalKit, gridPitchMm } } })}/>
    <select className="field" value={project.settings.physicalKit.profileKey} onChange={e => dispatch({ type: 'update_settings', settings: { physicalKit: physicalKitPreset(e.target.value, project.settings.physicalKit) } })}>
        <option value="letter-15x15-2cm">Letter 15×15 · 2cm</option>
        <option value="letter-12x12-2cm">Letter 12×12 · 2cm draft</option>
        <option value="custom">Custom profile</option>
    </select>
    <select className="field" value={project.settings.physicalKit.defaultExportFormat} onChange={e => dispatch({ type: 'update_settings', settings: { physicalKit: { ...project.settings.physicalKit, defaultExportFormat: e.target.value as ProjectState['settings']['physicalKit']['defaultExportFormat'] } } })}>
        <option value="both">Export SVG + JSON</option>
        <option value="svg">Export SVG only</option>
        <option value="json">Export JSON only</option>
    </select>
    <Toggle label="Toolbar visible" checked={project.settings.toolbarVisible} onChange={toolbarVisible => dispatch({ type: 'update_settings', settings: { toolbarVisible } })}/>
    <Toggle label="Part panel visible" checked={project.settings.partPanelVisible} onChange={partPanelVisible => dispatch({ type: 'update_settings', settings: { partPanelVisible } })}/>
    <Toggle label="Autosave" checked={project.settings.autosave} onChange={autosave => dispatch({ type: 'update_settings', settings: { autosave } })}/>
    <select className="field" value={project.settings.theme} onChange={e => dispatch({ type: 'update_settings', settings: { theme: e.target.value as ProjectState['settings']['theme'] } })}><option value="blueprint">Blueprint</option><option value="light">Light</option><option value="dark">Dark</option></select>
</div>;

const MiniNumber = ({ label, value, min, max, step = 1, disabled = false, onChange }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (v: number) => void }) => <label className={`block ${disabled ? 'opacity-50' : ''}`}><div className="mb-1 flex justify-between text-xs font-black uppercase tracking-wider text-slate-500"><span>{label}</span><span>{Number(value).toFixed(step < 1 ? 2 : 0)}</span></div><input aria-label={`${label} slider`} className="w-full" type="range" min={min} max={max} step={step} disabled={disabled} value={Number.isFinite(value) ? value : 0} onChange={e => onChange(Number(e.target.value))}/><input aria-label={`${label} number`} className="field mt-1" type="number" min={min} max={max} step={step} disabled={disabled} value={Number.isFinite(value) ? value : 0} onChange={e => onChange(Number(e.target.value))}/></label>;
const Toggle = ({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) => <label className={`flex items-center justify-between rounded-2xl bg-slate-100 px-3 py-2 text-sm font-bold ${disabled ? 'opacity-50' : ''}`}><span>{label}</span><input type="checkbox" disabled={disabled} checked={checked} onChange={e => onChange(e.target.checked)} /></label>;

const showParam = (type: MechanismType, key: keyof MechanismConfig) => {
    if (['speed2', 'phase', 'gearRatio'].includes(String(key))) return ['5bar', 'gear', 'planetary_gear'].includes(type);
    if (key === 'rodLength') return ['5bar', 'piston'].includes(type);
    if (key === 'groundLength') return !['cam', 'yoke'].includes(type);
    if (key === 'couplerLength') return !['cam', 'gear', 'planetary_gear', 'yoke'].includes(type);
    return true;
};

const fitPathToBox = (points: Point[], width: number, height: number) => {
    if (!points.length) return '';
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((width - 60) / Math.max(1, maxX - minX), (height - 70) / Math.max(1, maxY - minY));
    const tx = width / 2 - ((minX + maxX) / 2) * scale;
    const ty = height / 2 + ((minY + maxY) / 2) * scale;
    const scaled = points.map(p => ({ x: p.x * scale + tx, y: ty - p.y * scale }));
    return `M ${scaled.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`;
};

export default App;
