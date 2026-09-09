import { useRef, useState, type Dispatch, type SetStateAction } from "react";
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
import { motionPathReadiness, motionPathStatus } from "../../../utils/motion";
import { contextHelpFor } from "../../../utils/contextHelp";
import { PathTargetChooser } from "./PathTargetChooser";
import {
  pathOwnerLabel,
  pathTargetId,
  pathTargetKind,
  type PathTargetKind,
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
  addMotion: (kind: PathTargetKind, id: string) => void;
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
  const [addingPath, setAddingPath] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const selectedTargetId = selectedSceneObject?.id ?? selectedPart?.id ?? "";
  const readiness = selectedPath ? motionPathReadiness(project, selectedPath) : undefined;
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
          <h3>Paths</h3>
          <span className="status-chip" data-testid="motion-count">
            {motionPaths.length}
          </span>
        </div>
        <div
          className="mt-2 flex flex-col gap-1.5"
          data-testid="motion-inventory"
          data-feature-id="path.switchMotion"
          aria-label="Paths"
        >
          {motionPaths.map((path) => {
            const selected = path.id === selectedPath?.id;
            const status = motionPathStatus(project, path);
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
              No paths
            </div>
          )}
        </div>

        <label className="mt-3 block text-xs font-bold text-slate-500">
          Selected target
          <select
            aria-label="Motion target"
            data-testid="selected-motion-target"
            data-feature-id="path.target"
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
        </label>
          <button
            ref={addButtonRef}
            type="button"
            className="btn-secondary mt-2 w-full"
            aria-expanded={addingPath}
            disabled={!sortedParts.some(part => !part.locked) && !Object.values(project.sceneObjects).some(object => !object.locked)}
            onClick={() => setAddingPath(true)}
            data-feature-id="path.addMotion"
          >
            <Plus size={16} /> Add path
          </button>
        {addingPath && <PathTargetChooser
          project={project}
          paths={motionPaths}
          initialTarget={selectedTargetId ? `${selectedSceneObject ? "scene-object" : "part"}:${selectedTargetId}` : ""}
          onAdd={(kind, id) => { addMotion(kind, id); setAddingPath(false); }}
          onSelect={id => { selectMotion(id); setAddingPath(false); }}
          onCancel={() => { setAddingPath(false); addButtonRef.current?.focus(); }}
        />}

        <div className="mt-4 flex items-center gap-2">
          <h3>{selectedPath ? `Edit ${motionLabel(selectedPath)}` : "Draw path"}</h3>
          <ContextHelp helpId="path.draw" />
        </div>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            className={drawMode ? "btn-primary active" : "btn-secondary"}
            aria-label={drawMode ? "Drawing free path" : "Draw free path"}
            aria-describedby={drawMode ? "path-draw-cue" : undefined}
            data-feature-id="path.draw"
            data-feature-blocker={pathLocked ? "Unlock target first." : undefined}
            disabled={pathLocked}
            onClick={togglePathDrawing}
          >
            <Route size={16} />
            {drawMode ? "Drawing" : selectedPath && pointCount ? "Redraw" : "Draw"}
          </button>
          {drawMode && (
            <p id="path-draw-cue" data-testid="path-draw-cue" className="text-xs leading-5 text-slate-600" role="status">
              {contextHelpFor("path.draw").body}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
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
              aria-label={isPlaying ? "Pause all paths" : "Play paths"}
              disabled={playablePathCount === 0}
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              {isPlaying ? "Pause" : playablePathCount > 1 ? "Play all" : "Play"}
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
            ? readiness?.playable ? "Path ready" : readiness?.reason
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
              featureId="path.smoothness"
              featureBlocker={pathLocked ? "Unlock target first." : undefined}
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
        {pathLocked && <div className="warning">Unlock target.</div>}
        <details className="advanced-panel mt-4">
          <summary>More</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                className="btn-secondary"
                disabled={pathLocked}
                onClick={openTracking}
                data-feature-id="path.trace"
                data-feature-blocker={pathLocked ? "Unlock target first." : undefined}
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
