import type { Dispatch, SetStateAction } from "react";
import { Pause, Play, Plus, Route, Trash2 } from "lucide-react";

import { ContextHelp } from "../../ui/ContextHelp";
import { MiniNumber } from "../../ui/InspectorControls";
import { StageLeftSummary } from "../stageLayout";
import type {
  AppStage,
  BodyPartLayer,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
  SceneObject,
} from "../../../types";
import { motionPathStatus } from "../../../utils/motion";
import {
  pathOwnerLabel,
  pathTargetId,
  pathTargetKind,
} from "../../../utils/pathTargets";

interface PathWorkflowPanelProps {
  project: ProjectState;
  sortedParts: BodyPartLayer[];
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  selectedPath?: ProjectMotionPath;
  motionPaths: ProjectMotionPath[];
  drawMode: boolean;
  pathLocked: boolean;
  pointCount: number;
  selectedPoint: number | null;
  isPlaying: boolean;
  playablePathCount: number;
  dispatch: (action: ProjectAction) => void;
  goStage: (stage: AppStage) => void;
  togglePathDrawing: () => void;
  clearPath: () => void;
  undoClearPath: () => void;
  canUndoClear: boolean;
  selectMotion: (pathId: string) => void;
  addMotion: () => void;
  updatePath: (updates: Partial<ProjectMotionPath>) => void;
  openTracking: () => void;
  setIsPlaying: (value: boolean) => void;
  setAngle: Dispatch<SetStateAction<number>>;
  deletePoint: () => void;
}

export const PathWorkflowPanel = ({
  project,
  sortedParts,
  selectedPart,
  selectedSceneObject,
  selectedPath,
  motionPaths,
  drawMode,
  pathLocked,
  pointCount,
  selectedPoint,
  isPlaying,
  playablePathCount,
  dispatch,
  goStage,
  togglePathDrawing,
  clearPath,
  undoClearPath,
  canUndoClear,
  selectMotion,
  addMotion,
  updatePath,
  openTracking,
  setIsPlaying,
  setAngle,
  deletePoint,
}: PathWorkflowPanelProps) => {
  const selectedTargetId = selectedSceneObject?.id ?? selectedPart?.id ?? "";
  const motionLabel = (path: ProjectMotionPath) => {
    const ownerId = pathTargetId(path);
    const ownerKind = pathTargetKind(path);
    const siblings = motionPaths.filter(
      (candidate) =>
        pathTargetKind(candidate) === ownerKind &&
        pathTargetId(candidate) === ownerId,
    );
    if (siblings.length < 2) return pathOwnerLabel(project, path);
    return `${pathOwnerLabel(project, path)} ${siblings.indexOf(path) + 1}`;
  };

  return (
    <div className="path-panel stage-pane-stack" data-testid="novice-path-panel">
      <StageLeftSummary project={project} title="Path" stage="path" goStage={goStage}>
        <div className="flex items-center justify-between gap-2">
          <h3>Motions</h3>
          <span className="status-chip" data-testid="motion-count">
            {motionPaths.length}
          </span>
        </div>
        <div
          className="mt-2 flex flex-col gap-1.5"
          data-testid="motion-inventory"
          aria-label="Motions"
        >
          {motionPaths.map((path) => {
            const selected = path.id === selectedPath?.id;
            const status = path.points.length >= 3 ? motionPathStatus(path) : "Draw";
            return (
              <button
                type="button"
                key={path.id}
                className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                  selected
                    ? "border-violet-400 bg-violet-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
                aria-pressed={selected}
                data-testid={`motion-item-${path.id}`}
                data-motion-status={status.toLowerCase()}
                onClick={() => selectMotion(path.id)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-bold text-slate-800">
                    {motionLabel(path)}
                  </span>
                  <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-500">
                    {status}
                  </span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  {path.sceneObjectId ? "Object" : "Body part"}
                </span>
              </button>
            );
          })}
          {!motionPaths.length && (
            <div className="free-draw-status" data-testid="motion-inventory-empty">
              No motions
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <select
            aria-label="Motion target"
            data-testid="selected-motion-target"
            className="field min-w-0 flex-1"
            value={selectedTargetId}
            onChange={(event) => {
              const id = event.target.value;
              if (project.sceneObjects[id]) {
                dispatch({ type: "select_scene_object", objectId: id });
              } else {
                dispatch({ type: "select_part", partId: id });
              }
            }}
          >
            <optgroup label="Body parts">
              {sortedParts.map((part) => (
                <option value={part.id} key={part.id}>
                  {part.name}
                </option>
              ))}
            </optgroup>
            {project.sceneObjectOrder.length > 0 && (
              <optgroup label="Scene objects">
                {project.sceneObjectOrder.map((id) => {
                  const object = project.sceneObjects[id];
                  return object ? (
                    <option value={object.id} key={object.id}>
                      {object.name}
                    </option>
                  ) : null;
                })}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            className="btn-secondary shrink-0"
            disabled={!selectedTargetId || pathLocked}
            onClick={addMotion}
          >
            <Plus size={16} /> Add motion
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <h3>{selectedPath ? `Edit ${motionLabel(selectedPath)}` : "Draw path"}</h3>
          <ContextHelp helpId="path.draw" />
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            className={drawMode ? "btn-primary active" : "btn-secondary"}
            aria-label={drawMode ? "Drawing free path" : "Draw free path"}
            disabled={pathLocked}
            onClick={togglePathDrawing}
          >
            <Route size={16} />
            {drawMode ? "Drawing" : selectedPath && pointCount ? "Redraw" : "Draw"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={!selectedPath || pathLocked || pointCount === 0}
              onClick={clearPath}
            >
              <Trash2 size={16} /> Clear
            </button>
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={!canUndoClear || pathLocked}
              onClick={undoClearPath}
            >
              Undo
            </button>
            <button
              type="button"
              className="btn-secondary flex-1"
              aria-label={isPlaying ? "Stop all motions" : "Play motions"}
              disabled={playablePathCount === 0}
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              {isPlaying ? "Stop" : playablePathCount > 1 ? "Play all" : "Play"}
            </button>
          </div>
        </div>
        <div
          className="free-draw-status"
          data-testid="free-draw-status"
          data-point-count={pointCount}
          data-draw-mode={drawMode ? "drawing" : "idle"}
          data-selected-point={selectedPoint ?? "none"}
        >
          {selectedPath
            ? pointCount >= 3
              ? "Path ready"
              : "Keep drawing"
            : "No path yet"}
          {pathLocked ? " / locked" : ""}
        </div>
        {selectedPath && (
          <div className="mt-3 space-y-3" data-testid="path-shape-controls">
            <div className="flex gap-2">
              <button
                type="button"
                className={`btn-secondary ${!selectedPath.closed ? "active" : ""}`}
                disabled={pathLocked}
                onClick={() => updatePath({ closed: false })}
              >
                Open
              </button>
              <button
                type="button"
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
        {!selectedPath && <div className="warning">Draw a path.</div>}
        {selectedPath && selectedPath.points.length < 3 && (
          <div className="warning">Keep drawing.</div>
        )}
        {pathLocked && <div className="warning">Unlock target.</div>}
        {selectedPath?.warnings.map((warning, index) => (
          <div key={`${warning}-${index}`} className="warning">
            {warning}
          </div>
        ))}
        <details className="advanced-panel mt-4">
          <summary>More</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                className="btn-secondary"
                disabled={pathLocked}
                onClick={openTracking}
              >
                <Route size={16} /> Trace
              </button>
              <ContextHelp helpId="path.trace" />
            </span>
            <button type="button" className="btn-secondary" onClick={() => setAngle(0)}>
              Reset
            </button>
            {selectedPath && (
              <button
                type="button"
                className="btn-secondary"
                disabled={pathLocked}
                onClick={() => updatePath({ visible: !selectedPath.visible })}
              >
                {selectedPath.visible ? "Hide path" : "Show path"}
              </button>
            )}
            {selectedPath && (
              <button
                type="button"
                className="btn-secondary"
                disabled={pathLocked}
                onClick={() => updatePath({ enabled: !selectedPath.enabled })}
              >
                {selectedPath.enabled ? "Disable" : "Enable"}
              </button>
            )}
            {selectedPoint !== null && (
              <button
                type="button"
                className="btn-secondary"
                disabled={pathLocked}
                onClick={deletePoint}
              >
                Delete point
              </button>
            )}
          </div>
          <div className="mt-3 text-sm text-slate-600">
            {selectedPath ? "Motion timing ready" : "No timing"}
          </div>
        </details>
      </StageLeftSummary>
    </div>
  );
};
