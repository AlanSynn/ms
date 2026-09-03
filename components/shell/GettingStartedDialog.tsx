import React, { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { FileJson, Sparkles, Upload } from 'lucide-react';
import type { BodyPartLayer, MechanismConfig, Point, ProjectState } from '../../types';
import { pathFromPoints, sceneToSvg } from '../../utils/coordinates';
import { gearTrainCenters, gearTrainPitchRadii } from '../../utils/kinematics';
import { type ClassroomLessonId, createLessonProject, createSampleProject } from '../../utils/project';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, partOutlinePathD } from '../../utils/partGeometry';

export type GuidedLessonTile = {
    id: string;
    label: string;
    outcome: string;
    changeCue: string;
    buildCue: string;
    actionLabel: string;
    sensemaking?: {
        directTranslation?: string;
        tryThis?: string;
        expectedAnswer?: string;
        evidenceCue?: string;
        clipSlot?: 'generated-loop' | 'local-asset' | 'optional-url';
    };
};


const sceneDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const transformPartLocalToScene = (part: BodyPartLayer, point: Point): Point => {
    const angle = (part.transform.rotation * Math.PI) / 180;
    const scale = part.transform.scale || 1;
    const x = point.x * scale;
    const y = point.y * scale;
    return {
        x: part.transform.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: part.transform.y + x * Math.sin(angle) + y * Math.cos(angle)
    };
};

const previewViewBox = (points: Point[]) => {
    const fallback = { x: 210, y: 80, width: 480, height: 520 };
    if (!points.length) return fallback;
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(180, maxX - minX);
    const height = Math.max(180, maxY - minY);
    const pad = Math.max(34, Math.min(82, Math.max(width, height) * 0.12));
    return {
        x: minX - pad,
        y: minY - pad,
        width: width + pad * 2,
        height: height + pad * 2
    };
};


const mechanismSceneAnchor = (mechanism: MechanismConfig): Point =>
    mechanism.sceneAnchor ?? mechanism.transform ?? { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };

const lessonGearGlyphs = (project: ProjectState | null) => (project?.mechanisms ?? [])
    .filter(mechanism => mechanism.type === 'gear' || mechanism.type === 'planetary_gear')
    .map(mechanism => {
        const centers = mechanism.type === 'gear' ? gearTrainCenters(mechanism) : [mechanismSceneAnchor(mechanism)];
        const radii = mechanism.type === 'gear' ? gearTrainPitchRadii(mechanism) : (mechanism.gearTrainRadii ?? [38, mechanism.outputGearRadius ?? 38]);
        const r1 = Math.max(24, Math.min(62, radii[0] ?? 38));
        const r2 = Math.max(24, Math.min(62, radii[1] ?? r1));
        const c1 = sceneToSvg(centers[0] ?? mechanismSceneAnchor(mechanism));
        const c2 = sceneToSvg(centers.at(-1) ?? { x: (centers[0]?.x ?? 0) + r1 + r2 + 8, y: centers[0]?.y ?? 0 });
        return {
            id: mechanism.id,
            color: mechanism.color || '#7c3aed',
            c1,
            c2,
            r1,
            r2
        };
    });

const lessonPreviewProject = (lessonId: string): ProjectState | null => {
    try {
        return createLessonProject(lessonId as ClassroomLessonId);
    } catch {
        return null;
    }
};

const starterRigPreviewProject = (project: ProjectState): ProjectState => {
    return {
        ...project,
        paths: {},
        mechanisms: [],
        selectedPartId: undefined,
        selectedPathId: undefined,
        selectedMechanismId: undefined
    };
};

const GuidedLessonMotionPreview = ({ lessonId, project }: { lessonId: string; project: ProjectState | null }) => {
    const allVisibleParts = project?.partOrder
        .map(id => project.parts[id])
        .filter((part): part is BodyPartLayer => Boolean(part) && part.visible !== false) ?? [];
    const selectedPath = project?.selectedPathId ? project.paths[project.selectedPathId] : Object.values(project?.paths ?? {})[0];
    const generatedPath = !selectedPath ? project?.mechanisms.find(mechanism => mechanism.generatedPath?.length)?.generatedPath : undefined;
    const tracePoints = selectedPath?.points?.length ? selectedPath.points : generatedPath;
    const svgPoints: Point[] = [];
    const focusPoints: Point[] = [];
    const highlightedPartIds = new Set(
        [selectedPath?.partId, project?.selectedPartId]
            .filter((id): id is string => Boolean(id))
    );
    const previewPartIds = new Set(highlightedPartIds);
    const preferredPreviewParts = [
        'torso',
        'head',
        'left_arm_upper',
        'right_arm_upper',
        'left_leg_upper',
        'right_leg_upper'
    ];
    for (const id of preferredPreviewParts) {
        if (allVisibleParts.some(part => part.id === id)) previewPartIds.add(id);
    }
    for (const part of allVisibleParts) {
        if (previewPartIds.size >= 8) break;
        previewPartIds.add(part.id);
    }
    const visibleParts = allVisibleParts.filter(part => previewPartIds.has(part.id));
    const parts = visibleParts.map(part => {
        const landmarks = partLandmarkLocalPoints(part, project?.skeleton);
        const outline = fabricablePartOutlinePoints(part, landmarks);
        const outlineSvgPoints = outline.map(point => sceneToSvg(transformPartLocalToScene(part, point)));
        svgPoints.push(...outlineSvgPoints);
        if (highlightedPartIds.has(part.id)) focusPoints.push(...outlineSvgPoints);
        return { part, landmarks, outlineD: partOutlinePathD(part, landmarks, { scale: part.transform.scale, flipY: true }) };
    });
    const traceSvgPoints = tracePoints?.map(sceneToSvg) ?? [];
    svgPoints.push(...traceSvgPoints);
    focusPoints.push(...traceSvgPoints);
    const gearGlyphs = lessonGearGlyphs(project);
    for (const glyph of gearGlyphs) {
        const gearPoints = [
            { x: glyph.c1.x - glyph.r1, y: glyph.c1.y - glyph.r1 },
            { x: glyph.c1.x + glyph.r1, y: glyph.c1.y + glyph.r1 },
            { x: glyph.c2.x - glyph.r2, y: glyph.c2.y - glyph.r2 },
            { x: glyph.c2.x + glyph.r2, y: glyph.c2.y + glyph.r2 }
        ];
        svgPoints.push(...gearPoints);
        focusPoints.push(...gearPoints);
    }
    const box = previewViewBox(focusPoints.length >= 2 ? focusPoints : svgPoints);
    const traceD = tracePoints?.length ? pathFromPoints(tracePoints, Boolean(selectedPath?.closed), selectedPath?.smoothness ?? 42) : '';
    const traceLength = tracePoints?.slice(1).reduce((sum, point, index) => sum + sceneDistance(tracePoints[index] ?? point, point), 0) ?? 0;
    const previewBgId = `guidedPreviewBg-${lessonId}`;

    return <span className="guided-project-preview" data-testid={`guided-project-preview-${lessonId}`} data-preview-mode="rendered-character-motion" aria-hidden="true">
        <svg viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} role="img" focusable="false" data-motion-preview="character-path">
            <defs>
                <linearGradient id={previewBgId} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset="1" stopColor="#f3efff" />
                </linearGradient>
                <filter id={`guidedPreviewSoft-${lessonId}`}>
                    <feDropShadow dx="0" dy="10" stdDeviation="8" floodOpacity="0.14" />
                </filter>
            </defs>
            <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="30" fill={`url(#${previewBgId})`} />
            <g filter={`url(#guidedPreviewSoft-${lessonId})`}>
                {parts.map(({ part, landmarks, outlineD }) => {
                    const origin = sceneToSvg(part.transform);
                    const highlighted = highlightedPartIds.has(part.id);
                    return <g key={part.id} transform={`translate(${origin.x} ${origin.y}) rotate(${-part.transform.rotation})`} opacity={highlighted ? 0.98 : 0.58}>
                        <path d={outlineD} fill={part.fillColor} stroke={highlighted ? '#7c3aed' : '#475569'} strokeWidth={highlighted ? 3.6 : 1.35} />
                        {highlighted && landmarks.slice(0, 3).map((point, index) => <circle key={`${part.id}-pin-${index}`} cx={point.x * part.transform.scale} cy={-point.y * part.transform.scale} r={5.2} fill="#ffffff" stroke="#8b5cf6" strokeWidth="2" />)}
                    </g>;
                })}
            </g>
            {gearGlyphs.map(glyph => <g key={glyph.id} opacity="0.92">
                <circle cx={glyph.c1.x} cy={glyph.c1.y} r={glyph.r1} fill="#eef2ff" stroke={glyph.color} strokeWidth="5" strokeDasharray="4 6" />
                <circle cx={glyph.c2.x} cy={glyph.c2.y} r={glyph.r2} fill="#f5f3ff" stroke="#8b5cf6" strokeWidth="5" strokeDasharray="4 6" />
                <path d={`M ${glyph.c1.x - glyph.r1 * 0.48} ${glyph.c1.y} A ${glyph.r1 * 0.48} ${glyph.r1 * 0.48} 0 1 0 ${glyph.c1.x + glyph.r1 * 0.48} ${glyph.c1.y}`} fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round" />
                <path d={`M ${glyph.c2.x + glyph.r2 * 0.48} ${glyph.c2.y} A ${glyph.r2 * 0.48} ${glyph.r2 * 0.48} 0 1 1 ${glyph.c2.x - glyph.r2 * 0.48} ${glyph.c2.y}`} fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round" />
            </g>)}
            {traceD && <g>
                <path d={traceD} fill="none" stroke="#7c3aed" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity="0.16" />
                <path d={traceD} fill="none" stroke="#7c3aed" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={traceLength > 60 ? '10 9' : undefined} />
                {tracePoints && <circle cx={sceneToSvg(tracePoints[0]).x} cy={sceneToSvg(tracePoints[0]).y} r="6" fill="#7c3aed" />}
            </g>}
        </svg>
    </span>;
};

const starterCopy = {
    guide: 'Pick a working motion project.',
    humanoid: 'Start with a simple body.'
} as const;

const starterCues = {
    guide: ['Edit one move', 'Ready to build'],
    humanoid: ['Move arms or legs', 'Add a path next']
} as const;

const StarterCues = ({ items }: { items: readonly string[] }) => (
    <span className="starter-card-cues" aria-hidden="true">
        {items.map((item, index) => <span key={item}><em>{index === 0 ? 'Change' : 'Build'}</em> {item}</span>)}
    </span>
);

export const GettingStartedDialog = ({ guidedLessons, hideForSession, onLesson, onSample, onPackage, onImport, onHideForSessionChange, onClose }: {
    guidedLessons: readonly GuidedLessonTile[];
    hideForSession: boolean;
    onLesson: (lessonId: string, preparedProject?: ProjectState) => void;
    onSample: (preparedProject?: ProjectState) => void;
    onPackage: (files: File[]) => void;
    onImport: (file: File) => void;
    onHideForSessionChange: (hidden: boolean) => void;
    onClose: () => void;
}) => {
    const dialogRef = useRef<HTMLElement>(null);
    const packageInputRef = useRef<HTMLInputElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const [showGuided, setShowGuided] = useState(false);
    const [previewProjects, setPreviewProjects] = useState<Record<string, ProjectState | null>>({});
    const starterRigProject = useMemo(createSampleProject, []);
    const starterRigPreview = useMemo(
        () => starterRigPreviewProject(starterRigProject),
        [starterRigProject]
    );
    useEffect(() => { dialogRef.current?.focus(); }, []);
    useEffect(() => {
        if (!showGuided) return;
        let cancelled = false;
        let index = 0;
        let idleHandle = 0;
        let timeoutHandle = 0;
        const host = window as typeof window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
            cancelIdleCallback?: (handle: number) => void;
        };
        const buildNext = () => {
            if (cancelled || index >= guidedLessons.length) return;
            const lesson = guidedLessons[index++];
            const prepared = lessonPreviewProject(lesson.id);
            startTransition(() => setPreviewProjects(current => ({
                ...current,
                [lesson.id]: prepared
            })));
            scheduleNext();
        };
        const scheduleNext = () => {
            if (cancelled || index >= guidedLessons.length) return;
            if (host.requestIdleCallback) {
                idleHandle = host.requestIdleCallback(buildNext, { timeout: 1_500 });
            } else {
                timeoutHandle = window.setTimeout(buildNext, 160);
            }
        };
        timeoutHandle = window.setTimeout(scheduleNext, 250);
        return () => {
            cancelled = true;
            if (idleHandle) host.cancelIdleCallback?.(idleHandle);
            if (timeoutHandle) window.clearTimeout(timeoutHandle);
        };
    }, [guidedLessons, showGuided]);
    const trapDialogFocus = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key !== 'Tab') return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element): element is HTMLElement => element instanceof HTMLElement && element.offsetParent !== null);
        if (!focusables.length) return;
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

    return <div className="modal-backdrop starter-backdrop" role="presentation">
        <section ref={dialogRef} className="modal-sheet getting-started-dialog animate-rise" role="dialog" aria-modal="true" aria-labelledby="getting-started-title" data-testid="getting-started-dialog" tabIndex={-1} onKeyDown={trapDialogFocus}>
            <div className="getting-started-head">
                <div>
                    <div className="section-title">Getting started</div>
                    <h2 id="getting-started-title">{showGuided ? 'Pick a project.' : 'Start.'}</h2>
                </div>
                <button type="button" className="btn-secondary" onClick={showGuided ? () => setShowGuided(false) : onClose}>{showGuided ? 'Starters' : 'Close'}</button>
            </div>
            {showGuided ? <div className="guided-project-library" data-testid="guided-project-library">
                {guidedLessons.map(lesson => <button key={lesson.id} type="button" className="template-tile primary guided-project-card" data-testid={`guided-project-card-${lesson.id}`} aria-label={`${lesson.actionLabel}: ${lesson.outcome}`} data-change-cue={lesson.changeCue} data-build-cue={lesson.buildCue} data-direct-translation={lesson.sensemaking?.directTranslation ?? ''} data-evidence-cue={lesson.sensemaking?.evidenceCue ?? ''} data-expected-answer={lesson.sensemaking?.expectedAnswer ?? ''} data-clip-slot={lesson.sensemaking?.clipSlot ?? ''} onClick={() => onLesson(lesson.id, previewProjects[lesson.id] ?? undefined)}>
                    <GuidedLessonMotionPreview lessonId={lesson.id} project={previewProjects[lesson.id]} />
                    <strong>{lesson.outcome}</strong>
                    <span className="guided-card-cues" aria-hidden="true">
                        <span><em>Change</em> {lesson.changeCue}</span>
                        <span><em>Build</em> {lesson.buildCue}</span>
                    </span>
                    <b><Sparkles size={16}/> Open</b>
                </button>)}
            </div> : <>
                <div className="template-gallery" data-testid="getting-started-gallery">
                    <button type="button" className="template-tile primary" data-testid="getting-started-card-guided" aria-label="Open Guide" onClick={() => setShowGuided(true)}>
                        <span className="template-icon-slot guide-preview-slot" data-testid="getting-started-guide-preview">
                            <GuidedLessonMotionPreview lessonId="starter-rig" project={starterRigPreview} />
                        </span>
                        <strong>Guide</strong>
                        <small>{starterCopy.guide}</small>
                        <StarterCues items={starterCues.guide} />
                        <b><Sparkles size={16}/> Open</b>
                    </button>
                    <button type="button" className="template-tile primary" data-testid="getting-started-card-humanoid" aria-label="Open starter rig" onClick={() => onSample(starterRigProject)}>
                        <span className="template-icon-slot"><Sparkles size={18}/></span>
                        <strong>Starter rig</strong>
                        <small>{starterCopy.humanoid}</small>
                        <StarterCues items={starterCues.humanoid} />
                        <b><Sparkles size={16}/> Start</b>
                    </button>
                </div>
                <div className="getting-started-foot">
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-600" data-testid="getting-started-hide-session">
                        <input type="checkbox" checked={hideForSession} onChange={event => onHideForSessionChange(event.currentTarget.checked)}/>
                        Don&apos;t show again this session
                    </label>
                    <div className="getting-started-file-actions" data-testid="getting-started-file-actions">
                        <button type="button" className="btn-secondary cursor-pointer" data-testid="getting-started-open-character" onClick={() => packageInputRef.current?.click()}><FileJson size={16}/> Character file</button>
                        <input ref={packageInputRef} data-testid="getting-started-package-input" hidden type="file" multiple accept=".json,.yaml,.yml,image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => {
                            const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
                            e.currentTarget.value = '';
                            if (files.length) onPackage(files);
                        }}/>
                        <button type="button" className="btn-secondary cursor-pointer" data-testid="getting-started-open-project" onClick={() => importInputRef.current?.click()}><Upload size={16}/> Open full project</button>
                        <input ref={importInputRef} data-testid="getting-started-import-input" hidden type="file" accept="application/json,.json" onChange={e => {
                            const file = e.currentTarget.files?.[0];
                            e.currentTarget.value = '';
                            if (file) onImport(file);
                        }}/>
                    </div>
                </div>
            </>}
        </section>
    </div>;
};
