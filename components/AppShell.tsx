import React, { useEffect, useRef, useState } from 'react';
import motionSmithIconUrl from '../resources/icons/AppIcon.png?url';
import type { AppStage, CanvasViewport } from '../types';
import type { WebOnnxCacheStatus } from '../utils/webOnnx';
import { APP_MENU_GROUPS, commandById, commandShortcutListText, commandShortcutText, type AppCommandId } from '../utils/appCommands';
import { clampCanvasZoom, DEFAULT_CANVAS_VIEWPORT } from '../utils/viewport';
import { STAGE_PANE_NAV_ITEMS, StagePaneNavIcon } from './stages/stageLayout';

export { GettingStartedDialog, type GuidedLessonTile, type StarterImageTemplate } from './shell/GettingStartedDialog';

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

export type WorkspaceStepPlayback = {
    stepIndex: number;
    stepCount: number;
    onStepChange: (index: number) => void;
};

export const WorkspacePlayerDock = ({ isPlaying, setIsPlaying, angle, setAngle, speed, drawMode, stepPlayback }: {
    isPlaying: boolean;
    setIsPlaying: (value: boolean) => void;
    angle: number;
    setAngle: React.Dispatch<React.SetStateAction<number>>;
    speed: number;
    drawMode: boolean;
    stepPlayback?: WorkspaceStepPlayback;
}) => {
    const stepCount = Math.max(0, stepPlayback?.stepCount ?? 0);
    const maxStepIndex = Math.max(0, stepCount - 1);
    const stepIndex = Math.max(0, Math.min(maxStepIndex, stepPlayback?.stepIndex ?? 0));
    const progress = stepPlayback
        ? (maxStepIndex > 0 ? stepIndex / maxStepIndex : 0)
        : ((angle / (Math.PI * 2)) % 1 + 1) % 1;
    const percent = Math.round(progress * 100);
    const goStep = (next: number) => stepPlayback?.onStepChange(Math.max(0, Math.min(maxStepIndex, next)));
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
            {stepPlayback && <button type="button" data-testid="workspace-player-prev-step" aria-label="Previous assembly step" disabled={stepIndex <= 0} onClick={() => goStep(stepIndex - 1)}>←</button>}
            <button type="button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => setIsPlaying(!isPlaying)}>{isPlaying ? 'Ⅱ' : '▶'}</button>
            {stepPlayback && <button type="button" data-testid="workspace-player-next-step" aria-label="Next assembly step" disabled={stepIndex >= maxStepIndex} onClick={() => goStep(stepIndex + 1)}>→</button>}
            <button type="button" aria-label="Start over" onClick={() => stepPlayback ? goStep(0) : setAngle(0)}>↺</button>
            <span>{speed.toFixed(1)}x</span>
        </div>
        <input
            aria-label={stepPlayback ? 'Assembly scrubber' : 'Workspace scrubber'}
            type="range"
            min={0}
            max={stepPlayback ? maxStepIndex : 100}
            value={stepPlayback ? stepIndex : percent}
            onChange={event => stepPlayback ? goStep(Number(event.currentTarget.value)) : setAngle((Number(event.currentTarget.value) / 100) * Math.PI * 2)}
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
