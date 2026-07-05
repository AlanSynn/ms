import { Play, Plus, Route, Trash2 } from "lucide-react";

import { ContextHelp } from "../../ui/ContextHelp";
import { MiniNumber } from "../../ui/InspectorControls";
import { PartInspector } from "../character/PartInspector";
import { SkeletonInspector } from "../character/SkeletonInspector";
import { StageLeftSummary } from "../stageLayout";
import type {
  AppStage,
  BodyPartLayer,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../../../types";

interface PathWorkflowPanelProps {
  project: ProjectState;
  sortedParts: BodyPartLayer[];
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  drawMode: boolean;
  pathLocked: boolean;
  pointCount: number;
  selectedPoint: number | null;
  isPlaying: boolean;
  dispatch: (action: ProjectAction) => void;
  goStage: (stage: AppStage) => void;
  togglePathDrawing: () => void;
  clearPath: () => void;
  updatePath: (updates: Partial<ProjectMotionPath>) => void;
  openTracking: () => void;
  setIsPlaying: (value: boolean) => void;
  setAngle: React.Dispatch<React.SetStateAction<number>>;
  deletePoint: () => void;
  addLayer: () => void;
  addJointAtIkHandle: () => void;
}

export const PathWorkflowPanel = ({
  project,
  sortedParts,
  selectedPart,
  selectedPath,
  drawMode,
  pathLocked,
  pointCount,
  selectedPoint,
  isPlaying,
  dispatch,
  goStage,
  togglePathDrawing,
  clearPath,
  updatePath,
  openTracking,
  setIsPlaying,
  setAngle,
  deletePoint,
  addLayer,
  addJointAtIkHandle,
}: PathWorkflowPanelProps) => (
  <div className="path-panel stage-pane-stack" data-testid="novice-path-panel">
    <StageLeftSummary project={project} title="Path" stage="path" goStage={goStage}>
      <div className="flex items-center gap-2">
        <h3>Draw path</h3>
        <ContextHelp helpId="path.draw" />
      </div>
      <select
        aria-label="Selected body part"
        className="field mt-2"
        value={selectedPart?.id ?? ""}
        onChange={(e) => dispatch({ type: "select_part", partId: e.target.value })}
      >
        {sortedParts.map((p) => (
          <option value={p.id} key={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="mt-3 flex flex-col gap-2">
        <button
          className={drawMode ? "btn-primary active" : "btn-secondary"}
          aria-label={drawMode ? "Drawing free path" : "Draw free path"}
          disabled={pathLocked}
          onClick={togglePathDrawing}
        >
          <Route size={16} />
          {drawMode ? "Drawing" : "Draw"}
        </button>
        <button
          className="btn-secondary"
          disabled={!selectedPath || pathLocked}
          onClick={clearPath}
        >
          <Trash2 size={16} /> Clear path
        </button>
      </div>
      <div
        className="free-draw-status"
        data-testid="free-draw-status"
        data-point-count={pointCount}
        data-draw-mode={drawMode ? "drawing" : "idle"}
      >
        {selectedPath
          ? pointCount >= 3
            ? "Path ready"
            : "Keep drawing"
          : "No path yet"}
        {pathLocked ? " · locked" : ""}
      </div>
      {selectedPath && (
        <div className="mt-3 space-y-3" data-testid="path-shape-controls">
          <div className="flex gap-2">
            <button
              className={`btn-secondary ${!selectedPath.closed ? "active" : ""}`}
              disabled={pathLocked}
              onClick={() => updatePath({ closed: false })}
            >
              Open
            </button>
            <button
              className={`btn-secondary ${selectedPath.closed ? "active" : ""}`}
              disabled={pathLocked}
              onClick={() => updatePath({ closed: true })}
            >
              Closed
            </button>
          </div>
          <MiniNumber
            label="Smoothness"
            helpId="path.smoothness"
            value={selectedPath.smoothness ?? 0}
            min={0}
            max={100}
            step={1}
            disabled={pathLocked}
            onChange={(smoothness) => updatePath({ smoothness })}
          />
        </div>
      )}
      {!selectedPath && <div className="warning">No path.</div>}
      {selectedPath && selectedPath.points.length < 3 && (
        <div className="warning">Keep drawing.</div>
      )}
      {pathLocked && <div className="warning">Unlock part.</div>}
      {selectedPath?.warnings.map((w, i) => (
        <div key={`${w}-${i}`} className="warning">
          {w}
        </div>
      ))}
      <details className="advanced-panel mt-4">
        <summary>More</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1">
            <button className="btn-secondary" disabled={pathLocked} onClick={openTracking}>
              <Route size={16} /> Trace
            </button>
            <ContextHelp helpId="path.trace" />
          </span>
          <button
            className="btn-secondary"
            aria-label={isPlaying ? "Play / Stop" : "Play"}
            onClick={() => setIsPlaying(!isPlaying)}
          >
            <Play size={16} />
            {isPlaying ? "Stop" : "Play"}
          </button>
          <button className="btn-secondary" onClick={() => setAngle(0)}>
            Reset
          </button>
          {selectedPath && (
            <button
              className="btn-secondary"
              disabled={pathLocked}
              onClick={() => updatePath({ visible: !selectedPath.visible })}
            >
              {selectedPath.visible ? "Hide path" : "Show path"}
            </button>
          )}
          {selectedPath && (
            <button
              className="btn-secondary"
              disabled={pathLocked}
              onClick={() => updatePath({ enabled: !selectedPath.enabled })}
            >
              {selectedPath.enabled ? "Disable" : "Enable"}
            </button>
          )}
          {selectedPoint !== null && (
            <button className="btn-secondary" disabled={pathLocked} onClick={deletePoint}>
              Delete point
            </button>
          )}
        </div>
        <div className="mt-3 text-sm text-slate-600">
          {selectedPath ? "Motion timing ready" : "No timing"}
        </div>
      </details>
      {project.settings.partPanelVisible ? (
        <details className="advanced-panel mt-4" data-testid="rig-structure-drawer">
          <summary>Rig setup</summary>
          <div className="mt-3 space-y-3">
            <div>
              <h4 className="section-title">Rig</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={addLayer}>
                <Plus size={16} /> Add layer
              </button>
              {selectedPart && (
                <button
                  className="btn-secondary"
                  disabled={selectedPart.locked}
                  onClick={() =>
                    dispatch({
                      type: "delete_part",
                      partId: selectedPart.id,
                    })
                  }
                >
                  <Trash2 size={16} /> Remove layer
                </button>
              )}
              <button
                className="btn-secondary"
                disabled={!selectedPart || pathLocked}
                onClick={addJointAtIkHandle}
              >
                <Plus size={16} /> New handle
              </button>
            </div>
            {selectedPart && (
              <PartInspector
                part={selectedPart}
                skeleton={project.skeleton}
                sourceTextureUrl={project.characterPackage?.sourceTextureUrl}
                dispatch={dispatch}
              />
            )}
            <div className="divider mt-4" />
            <SkeletonInspector project={project} dispatch={dispatch} />
          </div>
        </details>
      ) : (
        <div
          className="rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-500"
          data-testid="rig-structure-hidden"
        >
          Part panel hidden.
        </div>
      )}
    </StageLeftSummary>
  </div>
);
