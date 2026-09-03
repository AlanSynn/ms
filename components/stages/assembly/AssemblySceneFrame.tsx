import { useEffect, useRef } from "react";
import type { AssemblySceneFrame as AssemblySceneFrameModel } from "../../../utils/assemblySceneFrame";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";

const coordText = (coords: string[]) => (coords.length ? coords.join(" · ") : "None");
const frameBoardText = (frame: AssemblySceneFrameModel) =>
  coordText(
    frame.activeBoardCoords.length
      ? frame.activeBoardCoords
      : frame.mechanismContract?.boardCoordinate
        ? [frame.mechanismContract.boardCoordinate]
        : [],
  );

export const AssemblySceneFrame = ({
  frame,
  playbackClock,
}: {
  frame: AssemblySceneFrameModel;
  playbackClock?: PlaybackClock;
}) => {
  const rootRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!playbackClock) return;
    const update = (phase: number) => {
      const progress = (((phase / (Math.PI * 2)) % 1) + 1) % 1;
      const percent = Math.round(progress * 100);
      rootRef.current?.setAttribute("data-progress", String(percent));
      progressRef.current?.setAttribute("data-progress", String(percent));
      if (progressFillRef.current) {
        progressFillRef.current.style.width = `${percent}%`;
      }
    };
    update(playbackClock.getPhase());
    return playbackClock.subscribe((clockFrame) => update(clockFrame.phase));
  }, [playbackClock]);

  return <section
    ref={rootRef}
    className="assembly-scene-frame assembly-readonly-step-strip"
    data-testid="assembly-readonly-step-strip"
    data-assembly-frame-version={frame.version}
    data-assembly-frame-kind={frame.kind}
    data-step-phase={frame.phase}
    data-assembly-motion-kind={frame.motion}
    data-assembly-explode-axis={frame.explodeAxis}
    data-board-mode={frame.boardMode}
    data-progress={Math.round(frame.progress * 100)}
    data-active-board-coords={frame.activeBoardCoords.join(",")}
    data-floating-reference-coords={frame.floatingReferenceCoords.join(",")}
    data-active-part-ids={frame.activePartIds.join(",")}
    data-mechanism-scene-contract-version={frame.mechanismContract?.version ?? ""}
    data-mechanism-scene-contract-mechanism-id={frame.mechanismContract?.mechanismId ?? ""}
    data-mechanism-scene-contract-stack-source={frame.mechanismContract?.stackSource ?? ""}
    data-mechanism-scene-contract-layer-count={frame.mechanismContract?.layers.length ?? 0}
    aria-label="Assembly scene step"
  >
    <div className="assembly-scene-frame-head">
      <div>
        <p className="section-title">Step {frame.stepIndex}</p>
        <h3>{frame.label}</h3>
      </div>
      <span className="badge">{frame.motion === "scrub_time" ? "Test" : frame.explodeAxis === "z" ? "Add" : "Place"}</span>
    </div>
    <p className="assembly-scene-instruction">{frame.instruction}</p>
    {frame.check && <p className="assembly-scene-check">Check: {frame.check}</p>}
    <div
      ref={progressRef}
      className="assembly-visual-progress"
      data-testid="assembly-visual-progress"
      data-progress={Math.round(frame.progress * 100)}
      aria-hidden="true"
    >
      <span
        ref={progressFillRef}
        style={{ width: `${Math.round(frame.progress * 100)}%` }}
      />
    </div>
    <div
      className="assembly-scene-sensemaking"
      data-testid="assembly-scene-sensemaking"
      data-sensemaking-evidence={frame.mechanismContract ? "fabrication stack drives the Three build scene" : "character parts use the same Three build scene"}
    >
      {frame.kind === "mechanism" ? "Mechanism stack" : "Character pins"}
    </div>
    <div className="assembly-scene-meta">
      <span data-testid="assembly-active-board-coords">Board: {frameBoardText(frame)}</span>
      <span data-testid="assembly-floating-references">Refs: {coordText(frame.floatingReferenceCoords)}</span>
      <span>Parts: {frame.visibleParts.length}</span>
    </div>
    <div className="assembly-scene-part-list" data-testid="assembly-scene-part-list">
      {frame.visibleParts.slice(0, 8).map((part) => (
        <span key={part.id} data-active={part.active ? "true" : "false"} data-part-role={part.role}>
          {part.label}
        </span>
      ))}
    </div>
  </section>;
};
