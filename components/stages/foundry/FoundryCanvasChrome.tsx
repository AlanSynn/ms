import { useEffect, useRef } from "react";
import type {
  FoundryCamera,
  FoundryCameraPreset,
  FoundryViewPreset,
} from "../../../utils/foundryCamera";
import { FOUNDRY_VIEW_PRESETS } from "../../../utils/foundryCamera";
import { VIEWER3D_CONTRACT_VERSION } from "../../../utils/viewer3d";
import { ContextHelp } from "../../ui/ContextHelp";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";

export const FoundrySimBadge = ({ foundryPlaying }: { foundryPlaying: boolean }) => (
  <div className="foundry-sim-badge" data-testid="foundry-sim-badge">
    <span className={foundryPlaying ? "status-pulse" : ""} />
    {foundryPlaying ? "Playing" : "Paused"}
  </div>
);

type FoundryCameraControlsProps = {
  foundryCamera: FoundryCamera;
  foundryCameraLabel: string;
  showFoundryGrid: boolean;
  showUserPathPreview: boolean;
  showPathPreview: boolean;
  showForces: boolean;
  showVelocity: boolean;
  showTrail: boolean;
  onSetCameraPreset: (preset: Exclude<FoundryViewPreset, "custom">) => void;
  onToggleGrid: () => void;
  onToggleUserPathPreview: () => void;
  onTogglePathPreview: () => void;
  onToggleForces: () => void;
  onToggleVelocity: () => void;
  outputTraceLabel: string;
  canCycleOutputTrace: boolean;
  onCycleOutputTrace: () => void;
  onToggleTrail: () => void;
};

export const FoundryCameraControls = ({
  foundryCamera,
  foundryCameraLabel,
  showFoundryGrid,
  showUserPathPreview,
  showPathPreview,
  showForces,
  showVelocity,
  showTrail,
  onSetCameraPreset,
  onToggleGrid,
  onToggleUserPathPreview,
  onTogglePathPreview,
  onToggleForces,
  outputTraceLabel,
  canCycleOutputTrace,
  onToggleVelocity,
  onCycleOutputTrace,
  onToggleTrail,
}: FoundryCameraControlsProps) => (
  <div
    className="foundry-camera-hud"
    data-testid="foundry-camera-controls"
    aria-label="Shared 3D viewer toolbar"
    data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
  >
    <span
      className="foundry-camera-readout"
      data-testid="foundry-camera-readout"
    >
      3D {foundryCameraLabel} · {Math.round(foundryCamera.zoom * 100)}%
    </span>
    <ContextHelp helpId="viewer.layers" className="shrink-0" />
    {(
      Object.entries(FOUNDRY_VIEW_PRESETS) as Array<
        [Exclude<FoundryViewPreset, "custom">, FoundryCameraPreset]
      >
    ).map(([preset, view]) => (
      <button
        key={preset}
        type="button"
        data-testid={`foundry-camera-preset-${preset}`}
        className={foundryCamera.preset === preset ? "active" : ""}
        aria-pressed={foundryCamera.preset === preset}
        onClick={() => onSetCameraPreset(preset)}
      >
        {view.label}
      </button>
    ))}
    <span className="viewer-toolbar-divider" aria-hidden="true" />
    <button
      type="button"
      data-testid="foundry-toggle-grid"
      className={showFoundryGrid ? "active" : ""}
      aria-label="Grid layer"
      aria-pressed={showFoundryGrid}
      onClick={onToggleGrid}
    >
      Grid
    </button>
    <button
      type="button"
      data-testid="foundry-toggle-user-path"
      className={showUserPathPreview ? "active" : ""}
      aria-label="User path layer"
      aria-pressed={showUserPathPreview}
      onClick={onToggleUserPathPreview}
    >
      User path
    </button>
    <button
      type="button"
      data-testid="foundry-toggle-paths"
      className={showPathPreview ? "active" : ""}
      aria-label="Mechanism path layer"
      aria-pressed={showPathPreview}
      onClick={onTogglePathPreview}
    >
      Mech path
    </button>
    <button
      type="button"
      data-testid="foundry-cycle-output-trace"
      aria-label="Motion target point"
      disabled={!canCycleOutputTrace}
      onClick={onCycleOutputTrace}
    >
      Target {outputTraceLabel}
    </button>
    <button
      type="button"
      data-testid="foundry-toggle-forces"
      className={showForces ? "active" : ""}
      aria-label="Motion push layer"
      aria-pressed={showForces}
      onClick={onToggleForces}
    >
      Push
    </button>
    <button
      type="button"
      data-testid="foundry-toggle-velocity"
      className={showVelocity ? "active" : ""}
      aria-label="Motion speed layer"
      aria-pressed={showVelocity}
      onClick={onToggleVelocity}
    >
      Speed
    </button>
    <button
      type="button"
      data-testid="foundry-toggle-trail"
      className={showTrail ? "active" : ""}
      aria-label="Motion trace layer"
      aria-pressed={showTrail}
      onClick={onToggleTrail}
    >
      Trace
    </button>
  </div>
);

type FoundryPlaybackPanelProps = {
  foundryPlaying: boolean;
  foundryPhaseDegrees: number;
  playbackClock?: PlaybackClock;
  onTogglePlaying: () => void;
  onResetPreview: () => void;
  onPhaseChange: (phase: number) => void;
};

export const FoundryPlaybackPanel = ({
  foundryPlaying,
  foundryPhaseDegrees,
  playbackClock,
  onTogglePlaying,
  onResetPreview,
  onPhaseChange,
}: FoundryPlaybackPanelProps) => {
  const phaseInputRef = useRef<HTMLInputElement>(null);
  const phasePercentRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!playbackClock) return;
    let lastUpdate = -Infinity;
    const update = (phase: number, time: number) => {
      if (time !== 0 && time - lastUpdate < 100) return;
      lastUpdate = time;
      const degrees = (((phase / (Math.PI * 2)) % 1 + 1) % 1) * 360;
      if (phaseInputRef.current) phaseInputRef.current.value = String(degrees);
      if (phasePercentRef.current) phasePercentRef.current.textContent = `${Math.round((degrees / 360) * 100)}%`;
    };
    update(playbackClock.getPhase(), 0);
    return playbackClock.subscribe((frame) => update(frame.phase, frame.time));
  }, [playbackClock]);

  return <div
    className="foundry-playback-hud foundry-toolbar"
    data-testid="foundry-toolbar"
    aria-label="Foundry playback"
  >
    <button
      className={`btn-secondary ${foundryPlaying ? "active" : ""}`}
      data-feature-id="playback.play"
      onClick={onTogglePlaying}
    >
      {foundryPlaying ? "Pause" : "Play"}
    </button>
    <button className="btn-secondary" onClick={onResetPreview}>
      Reset
    </button>
    <input
      ref={phaseInputRef}
      aria-label="Foundry phase"
      data-feature-id="playback.scrub"
      type="range"
      min="0"
      max="360"
      value={foundryPhaseDegrees}
      onChange={(event) => onPhaseChange(Number(event.target.value))}
    />
    <span ref={phasePercentRef}>{Math.round((foundryPhaseDegrees / 360) * 100)}%</span>
  </div>
};
