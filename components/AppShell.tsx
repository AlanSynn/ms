import React, { useEffect, useRef, useState } from 'react';
import { BrainCircuit, FileJson, Sparkles, Upload } from 'lucide-react';
import motionSmithIconUrl from '../resources/icons/AppIcon.png?url';
import type { AppStage, CanvasViewport } from '../types';
import type { WebOnnxCacheStatus } from '../utils/webOnnx';
import { APP_MENU_GROUPS, commandById, commandShortcutListText, commandShortcutText, type AppCommandId } from '../utils/appCommands';
import { clampCanvasZoom, DEFAULT_CANVAS_VIEWPORT } from '../utils/viewport';
import { STAGE_PANE_NAV_ITEMS, StagePaneNavIcon } from './stages/stageLayout';

export type StarterImageTemplate = { id: string; label: string; fileName: string; url: string; thumbUrl: string };

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
const APP_VERSION = __APP_VERSION__;

const MotionSmithLogoMark = ({ className = '' }: { className?: string }) => <img className={`motionsmith-logo-mark ${className}`.trim()} src={motionSmithIconUrl} alt="" aria-hidden="true" decoding="async" draggable={false}/>;

export const OnnxCacheStatusPill = ({ status, onDownload }: { status: WebOnnxCacheStatus; onDownload: () => void }) => {
    const busy = status.stage === 'checking' || status.stage === 'downloading';
    const label = status.stage === 'cached'
        ? 'AI ready'
        : status.stage === 'downloading'
            ? `AI ${status.progress}% ${formatBytes(status.bytesLoaded)}`
            : status.stage === 'error'
                ? 'Try again'
                : 'Get AI';
    return <button type="button" className={`status-cache-pill ${status.stage}`} data-testid="onnx-cache-status" disabled={busy || status.stage === 'cached'} onClick={onDownload} aria-label={status.error ?? label}>{label}</button>;
};

export const WorkflowRail = ({ stage, goStage }: { stage: AppStage; goStage: (stage: AppStage) => void }) => (
    <nav className="workflow-rail workspace-steps" data-testid="workspace-steps" aria-label="Workflow">
        <div className="workflow-rail-brand" aria-hidden="true"><MotionSmithLogoMark className="workflow-rail-app-icon" /></div>
        {STAGES.map(item => {
            const navItem = STAGE_PANE_NAV_ITEMS.find(nav => nav.target === item.id);
            return <button key={item.id} type="button" aria-label={item.label} aria-current={stage === item.id ? 'step' : undefined} onClick={() => goStage(item.id)} className={stage === item.id ? 'active' : ''}>
                <span className="workflow-rail-mark" aria-hidden="true">{navItem && <StagePaneNavIcon icon={navItem.icon}/>}</span>
                <span className="workflow-rail-short">{stageNavLabel(item.id) ?? item.label}</span>
                <span className="workflow-rail-full">{item.label}</span>
            </button>;
        })}
        <span className="workflow-rail-version" aria-label={`MotionSmith version ${APP_VERSION}`}>v{APP_VERSION}</span>
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
    return <nav className="command-bar" aria-label="Commands" data-testid="top-command-bar">
        {APP_MENU_GROUPS.map(group => <details key={group.id} open={openMenu === group.id}>
            <summary onClick={toggleMenu(group.id)}>{group.label}</summary>
            <div className="command-menu">
                {group.commandIds.map(id => {
                    const command = commandById(id);
                    const shortcut = commandShortcutText(command);
                    return <button key={id} data-command-id={id} data-testid={command.testId ?? `command-${id.replaceAll('.', '-')}`} onClick={runCommand(id)}>
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
                <div className="accent-label">Commands</div>
                <h3 id="shortcut-help-title">Shortcuts</h3>
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
                <p className="mt-2 text-sm font-bold text-slate-500">Local only.</p>
            </div>
            <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
        <div className="shortcut-help-grid">
            <div className="shortcut-help-row"><span>Version</span><kbd>v{APP_VERSION}</kbd></div>
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
        aria-label="Playback"
        style={{ '--player-x': `${offset.x}px`, '--player-y': `${offset.y}px` } as React.CSSProperties}
    >
        <button type="button" className="player-drag-handle" data-testid="workspace-player-drag-handle" aria-label="Move controls" title="Move" onPointerDown={startDrag}>
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
    const dialogRef = useRef<HTMLElement>(null);
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
    useEffect(() => {
        dialogRef.current?.focus();
        const autoCloseTimer = window.setTimeout(() => onCloseRef.current(false), 5000);
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

    return <div className="modal-backdrop welcome-backdrop" role="presentation">
        <section ref={dialogRef} className="modal-sheet welcome-dialog splash-dialog animate-rise" role="dialog" aria-modal="true" aria-labelledby="welcome-dialog-title" data-testid="welcome-dialog" tabIndex={-1} onKeyDown={trapDialogFocus}>
            <div className="splash-brand">
                <MotionSmithLogoMark />
                <h2 id="welcome-dialog-title">MOTIONSMITH</h2>
            </div>
            <span className="splash-version" aria-label={`Version ${APP_VERSION}`}>v{APP_VERSION}</span>
        </section>
    </div>;
};

export const GettingStartedDialog = ({ starterTemplates, onSample, onStarterImage, onPackage, onProcess, onImport, onClose }: {
    starterTemplates: StarterImageTemplate[];
    onSample: () => void;
    onStarterImage: (template: StarterImageTemplate) => void;
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
                    <h2 id="getting-started-title">Start a character.</h2>
                </div>
                <button type="button" className="btn-secondary" onClick={onClose}>Skip</button>
            </div>
            <div className="template-gallery" data-testid="getting-started-gallery">
                <button type="button" className="template-tile primary" data-testid="getting-started-card-humanoid" aria-label="Open starter rig" onClick={onSample}>
                    <span className="template-icon-slot"><Sparkles size={18}/></span>
                    <strong>Starter rig</strong>
                    <b><Sparkles size={16}/> Start</b>
                </button>
                {starterTemplates.map(template => (
                    <button key={template.id} type="button" className="template-tile starter cursor-pointer" data-testid={`getting-started-card-${template.id}`} aria-label={`Start ${template.label} starter`} onClick={() => onStarterImage(template)}>
                        <span className="template-icon-slot"><img className="starter-thumb" src={template.thumbUrl} alt="" /></span>
                        <strong>{template.label}</strong>
                        <b><Sparkles size={16}/> Start</b>
                    </button>
                ))}
                <button type="button" className="template-tile cursor-pointer" data-testid="getting-started-card-image" aria-label="Choose image" onClick={() => onnxInputRef.current?.click()}>
                    <span className="template-icon-slot"><BrainCircuit size={18}/></span>
                    <strong>Image</strong>
                    <b><BrainCircuit size={16}/> Choose</b>
                </button>
                <input ref={onnxInputRef} data-testid="getting-started-onnx-input" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (file) onProcess(file);
                }}/>
                <button type="button" className="template-tile cursor-pointer" data-testid="getting-started-card-package" aria-label="Load character file" onClick={() => packageInputRef.current?.click()}>
                    <span className="template-icon-slot"><FileJson size={18}/></span>
                    <strong>Character file</strong>
                    <b><FileJson size={16}/> Load</b>
                </button>
                <input ref={packageInputRef} data-testid="getting-started-package-input" hidden type="file" multiple accept=".json,.yaml,.yml,image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => {
                    const files = e.currentTarget.files ? Array.from(e.currentTarget.files) as File[] : [];
                    e.currentTarget.value = '';
                    if (files.length) onPackage(files);
                }}/>
            </div>
            <div className="getting-started-foot">
                <button type="button" className="btn-secondary cursor-pointer" onClick={() => importInputRef.current?.click()}><Upload size={16}/> Open full project</button><input ref={importInputRef} data-testid="getting-started-import-input" hidden type="file" accept="application/json,.json" onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (file) onImport(file);
                }}/>
            </div>
        </section>
    </div>;
};
