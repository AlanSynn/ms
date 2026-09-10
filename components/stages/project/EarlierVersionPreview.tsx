import { Pause, Play, RotateCcw } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasViewport, ProjectState } from '../../../types';
import type { PlaybackClock } from '../../../runtime/playback/externalPlaybackClock';
import { createPlaybackClock } from '../../../runtime/playback/externalPlaybackClock';
import type { ProjectVersionsView } from '../../../runtime/versions/versionTypes';
import { animationDeltaRadians } from '../../../utils/kinematics';
import { sharedMotionPlaybackDurationMs, motionAngleAtTimelineMs } from '../../../utils/motion';
import { DEFAULT_CANVAS_VIEWPORT } from '../../../utils/viewport';
import { FOUNDRY_VIEW_PRESETS, type FoundryCamera } from '../../../utils/foundryCamera';
import { withSessionPerformance } from '../../../utils/sessionSettings';

const ProjectWorkingPreview = lazy(async () => ({
  default: (await import('./ProjectWorkingPreview')).ProjectWorkingPreview,
}));

const TWO_PI = Math.PI * 2;

export type EarlierVersionPreviewProps = {
  preview: NonNullable<ProjectVersionsView['preview']>;
  onRestore: () => void;
  onBack: () => void;
};

const initialPreviewCamera = (): FoundryCamera => ({
  ...FOUNDRY_VIEW_PRESETS.iso,
  yaw: -24,
  pitch: 18,
  preset: 'iso',
  pan: { x: 0, y: 0 },
});

const previewAdvance = (
  elapsedMs: number,
  previousPhase: number,
  project: ProjectState,
  durationMs: number,
) => (previousPhase + animationDeltaRadians(
  Math.min(64, elapsedMs),
  durationMs,
  project.settings.animationSpeed,
  project.settings.timingProfile,
  previousPhase,
)) % TWO_PI;

export const EarlierVersionPreview = ({ preview, onRestore, onBack }: EarlierVersionPreviewProps) => {
  // Archived snapshots carry the preset saved at capture time; the preview
  // renders with the session's presentation preset instead.
  const project = withSessionPerformance(preview.project);
  const previewRef = useRef<HTMLElement>(null);
  const playbackClock = useMemo<PlaybackClock>(() => createPlaybackClock(), []);
  const [angle, setAngle] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineMs, setTimelineMs] = useState(0);
  const [viewport, setViewport] = useState<CanvasViewport>(DEFAULT_CANVAS_VIEWPORT);
  const [camera, setCamera] = useState<FoundryCamera>(initialPreviewCamera);
  const durationMs = useMemo(() => sharedMotionPlaybackDurationMs(project), [project]);

  useEffect(() => {
    playbackClock.setTimelineDuration(durationMs);
  }, [durationMs, playbackClock]);

  useEffect(() => () => playbackClock.stop(), [playbackClock]);

  // ThreePuppetPreview already samples the external clock at its render cadence.
  // Refresh only the small UI readout periodically instead of scheduling React
  // state work for every playback frame.
  useEffect(() => {
    const readTimeline = () => setTimelineMs(Math.max(0, Math.min(durationMs, playbackClock.getTimelineMs())));
    if (!isPlaying) {
      readTimeline();
      return;
    }
    readTimeline();
    const interval = window.setInterval(readTimeline, 180);
    return () => window.clearInterval(interval);
  }, [durationMs, isPlaying, playbackClock]);

  useEffect(() => {
    playbackClock.stop();
    playbackClock.setPhase(0);
    setAngle(0);
    setTimelineMs(0);
    setIsPlaying(false);
    setViewport(DEFAULT_CANVAS_VIEWPORT);
    setCamera(initialPreviewCamera());
  }, [playbackClock, preview.entry.id]);

  useEffect(() => {
    if (!isPlaying) {
      playbackClock.stop();
      return;
    }
    playbackClock.start({
      initialPhase: playbackClock.getPhase(),
      advancePhase: (elapsedMs, previousPhase) => previewAdvance(elapsedMs, previousPhase, project, durationMs),
    });
    return () => playbackClock.stop();
  }, [durationMs, isPlaying, playbackClock, project]);

  const scrub = (nextTimelineMs: number) => {
    const value = Math.max(0, Math.min(durationMs, nextTimelineMs));
    playbackClock.stop();
    setIsPlaying(false);
    playbackClock.setPhase(motionAngleAtTimelineMs(value, durationMs));
    setAngle(playbackClock.getPhase());
    setTimelineMs(value);
  };

  const restore = () => {
    playbackClock.stop();
    setIsPlaying(false);
    onRestore();
  };

  const backToCurrent = useCallback(() => {
    playbackClock.stop();
    setIsPlaying(false);
    onBack();
  }, [onBack, playbackClock]);

  // Keep Escape available after a canvas click. The Three host is intentionally
  // read-only and may not retain DOM focus itself, so focus the preview shell on
  // pointer interaction and keep a document listener for renderer descendants.
  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const active = document.activeElement;
      if (active && previewRef.current && !previewRef.current.contains(active)) return;
      event.preventDefault();
      event.stopPropagation();
      backToCurrent();
    };
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown);
  }, [backToCurrent]);

  const entryDate = Number.isFinite(preview.entry.createdAt)
    ? new Date(preview.entry.createdAt)
    : undefined;
  const timestamp = entryDate && !Number.isNaN(entryDate.getTime())
    ? entryDate.toLocaleString()
    : 'Time unavailable';
  const previewName = preview.entry.name || preview.entry.description || 'Unnamed version';

  return <section
    ref={previewRef}
    className="canvas-workspace relative"
    data-testid="earlier-version-preview"
    data-preview-entry-id={preview.entry.id}
    data-preview-read-only="true"
    aria-label="Earlier version preview"
    tabIndex={-1}
    onPointerDownCapture={() => previewRef.current?.focus({ preventScroll: true })}
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      backToCurrent();
    }}
    style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
  >
    <div style={{ minHeight: 0, flex: '1 1 0', position: 'relative', zIndex: 0 }}>
    <Suspense fallback={<div className="project-preview-empty" role="status">Opening earlier version…</div>}>
      <ProjectWorkingPreview
        project={project}
        angle={angle}
        isPlaying={isPlaying}
        playbackClock={playbackClock}
        viewport={viewport}
        setViewport={setViewport}
        camera={camera}
        onCameraChange={setCamera}
      />
    </Suspense>
    </div>
    <div
      className="rounded-2xl border p-3 shadow-xl"
      data-testid="earlier-version-controls"
      style={{
        background: 'var(--ms-bg, #fff)',
        border: '1px solid var(--ms-line)',
        flex: '0 0 auto',
        margin: '.75rem',
        padding: '.75rem',
        pointerEvents: 'auto',
        position: 'relative',
        zIndex: 10,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <strong className="block text-sm text-slate-800" data-testid="earlier-version-viewing">Viewing earlier version</strong>
          <span className="block text-xs text-slate-500" title={timestamp}>{previewName}</span>
        </div>
        <span className="status-chip">Read-only</span>
      </div>
      <div className="mt-2 flex items-center gap-2" data-testid="earlier-version-playback">
        <button
          type="button"
          className="btn-secondary"
          aria-label={isPlaying ? 'Pause earlier version' : 'Play earlier version'}
          aria-pressed={isPlaying}
          onClick={() => setIsPlaying(value => !value)}
          data-testid="earlier-version-play"
        >
          {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={durationMs}
          step={1}
          value={timelineMs}
          onChange={event => scrub(Number(event.target.value))}
          aria-label="Earlier version timeline"
          data-testid="earlier-version-scrubber"
          style={{ minWidth: '7rem', flex: 1 }}
        />
        <output className="text-xs text-slate-500" aria-live="off">{(timelineMs / 1000).toFixed(1)}s</output>
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={backToCurrent} data-testid="earlier-version-back">
          Back to current
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={restore}
          title="Restore this version. Your current work will be kept."
          aria-label="Restore this version. Your current work will be kept."
          data-testid="earlier-version-restore"
        >
          <RotateCcw size={14} aria-hidden="true" /> Restore
        </button>
      </div>
    </div>
  </section>;
};
