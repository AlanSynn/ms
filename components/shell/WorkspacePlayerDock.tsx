import React, { useEffect, useRef, useState } from 'react';

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
  const stopDragListeners = useRef<(() => void) | null>(null);

  const moveDockToPointer = (clientX: number, clientY: number) => {
    const start = dragStart.current;
    if (!start) return;
    setOffset({
      x: Math.max(-260, Math.min(260, start.offset.x + clientX - start.x)),
      y: Math.max(-220, Math.min(120, start.offset.y + clientY - start.y)),
    });
  };

  const stopDrag = () => {
    dragStart.current = null;
    setDragging(false);
    stopDragListeners.current?.();
    stopDragListeners.current = null;
  };

  useEffect(() => () => stopDragListeners.current?.(), []);

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopDragListeners.current?.();
    dragStart.current = { x: event.clientX, y: event.clientY, offset };
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window listeners below are the durable drag source.
    }
    const onMove = (moveEvent: PointerEvent) => moveDockToPointer(moveEvent.clientX, moveEvent.clientY);
    const onUp = () => stopDrag();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    stopDragListeners.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
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
