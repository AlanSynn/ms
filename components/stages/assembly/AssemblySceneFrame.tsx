import type { AssemblySceneFrame as AssemblySceneFrameModel } from "../../../utils/assemblySceneFrame";

const coordText = (coords: string[]) => (coords.length ? coords.join(" · ") : "None");

export const AssemblySceneFrame = ({ frame }: { frame: AssemblySceneFrameModel }) => (
  <section
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
      <span className="badge">{frame.motion === "scrub_time" ? "Test" : frame.explodeAxis === "z" ? "Explode" : "Place"}</span>
    </div>
    <p className="assembly-scene-instruction">{frame.instruction}</p>
    {frame.check && <p className="assembly-scene-check">Check: {frame.check}</p>}
    <div
      className="assembly-visual-progress"
      data-testid="assembly-visual-progress"
      data-progress={Math.round(frame.progress * 100)}
      aria-hidden="true"
    >
      <span style={{ width: `${Math.round(frame.progress * 100)}%` }} />
    </div>
    <div
      className="assembly-scene-sensemaking"
      data-testid="assembly-scene-sensemaking"
      data-sensemaking-evidence={frame.mechanismContract ? "fabrication stack drives the Three build scene" : "character parts use the same Three build scene"}
    >
      {frame.kind === "mechanism" ? "Build the mechanism, then connect the character." : "Pin fixed joints; keep moving pivots free."}
    </div>
    <div className="assembly-scene-meta">
      <span data-testid="assembly-active-board-coords">Board: {coordText(frame.activeBoardCoords)}</span>
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
  </section>
);
