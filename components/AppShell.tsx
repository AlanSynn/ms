import React, { useEffect, useRef, useState } from 'react';
import { BrainCircuit, FileJson, Sparkles, Upload } from 'lucide-react';
import type { AppStage, CanvasViewport } from '../types';
import type { WebOnnxCacheStatus } from '../utils/webOnnx';
import { APP_MENU_GROUPS, commandById, commandShortcutListText, commandShortcutText, type AppCommandId } from '../utils/appCommands';
import { clampCanvasZoom, DEFAULT_CANVAS_VIEWPORT } from '../utils/viewport';
import { STAGE_PANE_NAV_ITEMS, StagePaneNavIcon } from './stages/stageLayout';

export type StarterImageTemplate = { id: string; label: string; fileName: string; description: string; url: string };
export type ClassroomLessonTile = { id: string; label: string; description: string; actionLabel: string };

export const SHARED_PLAYBACK_STAGES: AppStage[] = ['path', 'design'];

export const STAGES: Array<{ id: AppStage; label: string }> = [
    { id: 'character', label: 'Character' },
    { id: 'path', label: 'Path Editor' },
    { id: 'foundry', label: 'Mechanism Foundry' },
    { id: 'design', label: 'Mechanism Design' },
    { id: 'blueprint', label: 'Blueprint' },
    { id: 'assembly', label: 'Assembly' },
    { id: 'options', label: 'Options' }
];
const stageNavLabel = (stage: AppStage) => ({
    character: 'Character',
    path: 'Path',
    foundry: 'Foundry',
    design: 'Design',
    blueprint: 'Blueprint',
    assembly: 'Assembly'
} as Partial<Record<AppStage, string>>)[stage];

const formatBytes = (bytes?: number) => bytes ? `${Math.round(bytes / 1024 / 1024)}MB` : '';

const MotionSmithLogoMark = () => <svg className="motionsmith-logo-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M43 44h9v8H18v-8h9" fill="#f472b6" stroke="#2f56d6" strokeWidth="3"/>
        <path d="M45 28l9 7 4-5" stroke="#2f56d6" strokeWidth="4"/>
        <path d="M19 28l-9 7-4-5" stroke="#2f56d6" strokeWidth="4"/>
        <path d="M24 43l-4 10M40 43l4 10" stroke="#2f56d6" strokeWidth="4"/>
        <circle cx="32" cy="15" r="9" fill="#ffd45a" stroke="#2f56d6" strokeWidth="3"/>
        <circle cx="29" cy="14" r="1.5" fill="#2f56d6"/>
        <circle cx="36" cy="14" r="1.5" fill="#2f56d6"/>
        <path d="M28 19c3 3 7 3 10 0" stroke="#2f56d6" strokeWidth="2.5"/>
        <path d="M24 29c0-5 4-9 8-9s8 4 8 9v12H24z" fill="#f472b6" stroke="#2f56d6" strokeWidth="3"/>
        <path d="M49 42l2-3 4 1 1 4 4 2-2 5-4-1-3 3-4-2v-4l-3-3z" fill="#60a5fa" stroke="#2f56d6" strokeWidth="2.6"/>
        <circle cx="52" cy="46" r="3" fill="#facc15" stroke="#2f56d6" strokeWidth="2"/>
    </g>
</svg>;

export const OnnxCacheStatusPill = ({ status, onDownload }: { status: WebOnnxCacheStatus; onDownload: () => void }) => {
    const busy = status.stage === 'checking' || status.stage === 'downloading';
    const label = status.stage === 'cached'
        ? 'AI ready'
        : status.stage === 'downloading'
            ? `AI ${status.progress}% ${formatBytes(status.bytesLoaded)}`
            : status.stage === 'error'
                ? 'Try again'
                : 'Get AI';
    return <button type="button" className={`status-cache-pill ${status.stage}`} data-testid="onnx-cache-status" disabled={busy || status.stage === 'cached'} onClick={onDownload} title={status.error ?? 'Cache ONNX model for faster image imports'}>{label}</button>;
};

export const WorkflowRail = ({ stage, goStage }: { stage: AppStage; goStage: (stage: AppStage) => void }) => (
    <nav className="workflow-rail workspace-steps" data-testid="workspace-steps" aria-label="Workflow">
        <div className="workflow-rail-brand" aria-hidden="true"><Sparkles size={18}/></div>
        {STAGES.map(item => {
            const navItem = STAGE_PANE_NAV_ITEMS.find(nav => nav.target === item.id);
            return <button key={item.id} type="button" aria-label={item.label} aria-current={stage === item.id ? 'step' : undefined} onClick={() => goStage(item.id)} className={stage === item.id ? 'active' : ''}>
                <span className="workflow-rail-mark" aria-hidden="true">{navItem && <StagePaneNavIcon icon={navItem.icon}/>}</span>
                <span className="workflow-rail-short">{stageNavLabel(item.id) ?? item.label}</span>
                <span className="workflow-rail-full">{item.label}</span>
            </button>;
        })}
    </nav>
);

export const TopCommandBar = ({ commandHandlers }: { commandHandlers: Record<AppCommandId, () => void> }) => {
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const toggleMenu = (id: string) => (event: React.MouseEvent) => {
        event.preventDefault();
        setOpenMenu(openMenu === id ? null : id);
    };
    const runCommand = (id: AppCommandId) => () => {
        commandHandlers[id]();
        setOpenMenu(null);
    };
    return <nav className="command-bar" aria-label="Application command menu" data-testid="top-command-bar">
        {APP_MENU_GROUPS.map(group => <details key={group.id} open={openMenu === group.id}>
            <summary onClick={toggleMenu(group.id)}>{group.label}</summary>
            <div className="command-menu">
                {group.commandIds.map(id => {
                    const command = commandById(id);
                    const shortcut = commandShortcutText(command);
                    return <button key={id} data-command-id={id} data-testid={command.testId ?? `command-${id.replaceAll('.', '-')}`} onClick={runCommand(id)} title={command.description}>
                        <span>{command.label}</span>
                        {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
                    </button>;
                })}
            </div>
        </details>)}
    </nav>;
};

export const ShortcutHelpDialog = ({ onClose }: { onClose: () => void }) => <div className="modal-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
}}>
    <section role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title" className="modal-sheet shortcut-help-dialog" data-testid="shortcut-help-dialog">
        <div className="flex items-start justify-between gap-4">
            <div>
                <div className="accent-label">Application commands</div>
                <h3 id="shortcut-help-title">Keyboard Shortcuts</h3>
                <p className="mt-2 text-sm font-bold text-slate-500">One registry drives the menu bar, shortcuts, and this reference.</p>
            </div>
            <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
        <div className="shortcut-help-grid">
            {APP_MENU_GROUPS.map(group => <section key={group.id} className="shortcut-help-group">
                <h4>{group.label}</h4>
                {group.commandIds.map(id => {
                    const command = commandById(id);
                    const shortcuts = commandShortcutListText(command);
                    return <div key={id} className="shortcut-help-row">
                        <span>{command.label}</span>
                        <kbd>{shortcuts || 'menu'}</kbd>
                    </div>;
                })}
            </section>)}
        </div>
    </section>
</div>;

export const AboutDialog = ({ onClose }: { onClose: () => void }) => <div className="modal-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
}}>
    <section role="dialog" aria-modal="true" aria-labelledby="about-title" className="modal-sheet shortcut-help-dialog" data-testid="about-dialog">
        <div className="flex items-start justify-between gap-4">
            <div>
                <div className="accent-label">About</div>
                <h3 id="about-title">MotionSmith</h3>
                <p className="mt-2 text-sm font-bold text-slate-500">Static web workbench: no account, no upload, Local ONNX, local downloads.</p>
            </div>
            <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
        <div className="shortcut-help-grid">
            <div className="shortcut-help-row"><span>Version</span><kbd>0.0.2</kbd></div>
            <div className="shortcut-help-row"><span>Release</span><kbd>/ms/ static web</kbd></div>
            <div className="shortcut-help-row"><span>Data</span><kbd>browser autosave · files</kbd></div>
            <div className="shortcut-help-row"><span>Project</span><kbd>MotionSmith</kbd></div>
        </div>
    </section>
</div>;


export const CanvasZoomToolbar = ({ viewport, setViewport }: { viewport: CanvasViewport; setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>> }) => {
    const zoomBy = (factor: number) => setViewport(prev => ({ ...prev, zoom: clampCanvasZoom(prev.zoom * factor) }));
    const reset = () => setViewport(DEFAULT_CANVAS_VIEWPORT);
    return <div className="canvas-zoom-toolbar" onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
        <span data-testid="canvas-zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
        <button type="button" aria-label="Fit view" onClick={reset}>Fit</button>
    </div>;
};

export const WorkspacePlayerDock = ({ isPlaying, setIsPlaying, angle, setAngle, speed, drawMode }: {
    isPlaying: boolean;
    setIsPlaying: (value: boolean) => void;
    angle: number;
    setAngle: React.Dispatch<React.SetStateAction<number>>;
    speed: number;
    drawMode: boolean;
}) => {
    const progress = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
    const percent = Math.round(progress * 100);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const dragStart = useRef<{ x: number; y: number; offset: { x: number; y: number } } | null>(null);
    useEffect(() => {
        if (!dragging) return;
        const onMove = (event: PointerEvent) => {
            const start = dragStart.current;
            if (!start) return;
            setOffset({
                x: Math.max(-260, Math.min(260, start.offset.x + event.clientX - start.x)),
                y: Math.max(-220, Math.min(120, start.offset.y + event.clientY - start.y))
            });
        };
        const onUp = () => {
            dragStart.current = null;
            setDragging(false);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp, { once: true });
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, [dragging]);
    const startDrag = (event: React.PointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragStart.current = { x: event.clientX, y: event.clientY, offset };
        setDragging(true);
    };
    return <aside
        className={`player-dock ${drawMode ? 'is-drawing' : ''} ${dragging ? 'is-moving' : ''}`}
        data-testid="workspace-player-dock"
        aria-label="Shared animation controls"
        style={{ '--player-x': `${offset.x}px`, '--player-y': `${offset.y}px` } as React.CSSProperties}
    >
        <button type="button" className="player-drag-handle" data-testid="workspace-player-drag-handle" aria-label="Move controls" title="Drag controls" onPointerDown={startDrag}>
            <span aria-hidden="true">⋮⋮</span>
        </button>
        <div className="player-actions">
            <button type="button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => setIsPlaying(!isPlaying)}>{isPlaying ? 'Ⅱ' : '▶'}</button>
            <button type="button" aria-label="Start over" onClick={() => setAngle(0)}>↺</button>
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

export const WorkflowStatusStrip = ({ stageLabel, blocker, nextAction }: { stageLabel: string; blocker: string; nextAction: string }) => (
    <div className="workflow-status-strip" data-testid="workflow-status-strip">
        <span><strong>Now</strong> {stageLabel}</span>
        <span><strong>Fix</strong> {blocker}</span>
        <span><strong>Next</strong> {nextAction}</span>
    </div>
);

export const WelcomeDialog = ({ onClose }: { onClose: (hideNextTime?: boolean) => void }) => {
    const [hideNextTime, setHideNextTime] = useState(false);
    const dialogRef = useRef<HTMLElement>(null);
    const onCloseRef = useRef(onClose);
    const hideNextTimeRef = useRef(false);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
    useEffect(() => {
        dialogRef.current?.focus();
        const autoCloseTimer = window.setTimeout(() => onCloseRef.current(hideNextTimeRef.current), 3000);
        return () => window.clearTimeout(autoCloseTimer);
    }, []);
    const trapDialogFocus = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose(false);
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

    return <div className="modal-backdrop welcome-backdrop" role="presentation">
        <section ref={dialogRef} className="modal-sheet welcome-dialog splash-dialog animate-rise" role="dialog" aria-modal="true" aria-labelledby="welcome-dialog-title" data-testid="welcome-dialog" tabIndex={-1} onKeyDown={trapDialogFocus}>
            <div className="splash-brand">
                <MotionSmithLogoMark />
                <h2 id="welcome-dialog-title">MOTIONSMITH</h2>
            </div>
            <button type="button" className="btn-primary" onClick={() => onClose(hideNextTime)}>Start</button>
            <label className="replace-toggle"><input type="checkbox" checked={hideNextTime} onChange={event => { hideNextTimeRef.current = event.target.checked; setHideNextTime(event.target.checked); }} /> Do not show this again</label>
        </section>
    </div>;
};

export const GettingStartedDialog = ({ lessonTemplates, starterTemplates, replaceCharacter, setReplaceCharacter, onLesson, onStarterImage, onSample, onPackage, onProcess, onImport, onClose }: {
    lessonTemplates: readonly ClassroomLessonTile[];
    starterTemplates: StarterImageTemplate[];
    replaceCharacter: boolean;
    setReplaceCharacter: (v: boolean) => void;
    onLesson: (lessonId: string) => void;
    onStarterImage: (template: StarterImageTemplate) => void;
    onSample: () => void;
    onPackage: (files: FileList | File[]) => void;
    onProcess: (file: File) => void;
    onImport: (file: File) => void;
    onClose: () => void;
}) => {
    const dialogRef = useRef<HTMLElement>(null);
    const packageInputRef = useRef<HTMLInputElement>(null);
    const onnxInputRef = useRef<HTMLInputElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => { dialogRef.current?.focus(); }, []);
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

    return <div className="modal-backdrop welcome-backdrop" role="presentation">
        <section ref={dialogRef} className="modal-sheet getting-started-dialog animate-rise" role="dialog" aria-modal="true" aria-labelledby="getting-started-title" data-testid="getting-started-dialog" tabIndex={-1} onKeyDown={trapDialogFocus}>
            <div className="getting-started-head">
                <div>
                    <div className="section-title">Getting started</div>
                    <h2 id="getting-started-title">Pick a starter, then tune it in Character.</h2>
                </div>
                <button type="button" className="btn-secondary" onClick={onClose}>Skip to editor</button>
            </div>
            <div className="template-gallery" data-testid="getting-started-gallery">
                {lessonTemplates.map(template => (
                    <button key={template.id} type="button" className="template-tile primary" data-testid={`lesson-template-${template.id}`} onClick={() => onLesson(template.id)}>
                        <span className="template-kicker">Lesson</span>
                        <strong>{template.label}</strong>
                        <span>{template.description}</span>
                        <b><Sparkles size={16}/> {template.actionLabel}</b>
                    </button>
                ))}
                <button type="button" className="template-tile primary" onClick={onSample}>
                    <span className="template-kicker">Start clean</span>
                    <strong>Humanoid starter</strong>
                    <span>Full body rig. No mechanism.</span>
                    <b><Sparkles size={16}/> Open humanoid starter</b>
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
                    <strong>Load character</strong>
                    <span>Load art + skeleton.</span>
                    <b><FileJson size={16}/> Load package</b>
                </button>
                <input ref={packageInputRef} data-testid="getting-started-package-input" hidden type="file" multiple accept=".json,.yaml,.yml,image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => {
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
                <input ref={onnxInputRef} data-testid="getting-started-onnx-input" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (file) onProcess(file);
                }}/>
            </div>
            <div className="getting-started-foot">
                <button type="button" className="btn-secondary cursor-pointer" onClick={() => importInputRef.current?.click()}><Upload size={16}/> Import project</button><input ref={importInputRef} data-testid="getting-started-import-input" hidden type="file" accept="application/json,.json" onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (file) onImport(file);
                }}/>
                <label className="replace-toggle"><input aria-label="Replace current character and preserve compatible mechanisms" type="checkbox" checked={replaceCharacter} onChange={e => setReplaceCharacter(e.target.checked)} /> Preserve compatible mechanisms</label>
            </div>
        </section>
    </div>;
};
