import type { ProjectMotionPath, ProjectState, StandardJoint } from "../../../types";
import { motionChainOptionLabel, motionPathReadiness, type MotionChainDescriptor } from "../../../utils/motion";

interface PathInspectorPanelProps {
  project: ProjectState;
  selectedPartId?: string;
  selectedSceneObjectId?: string;
  selectedPartName?: string;
  selectedPath?: ProjectMotionPath;
  pointCount: number;
  motionWarning?: string;
  selectedPoint: number | null;
  pathLocked: boolean;
  selectedChainRootId?: string;
  chainRootOptions: string[];
  selectedIkJointId?: string;
  jointOptions: string[];
  ikDescriptor?: MotionChainDescriptor;
  bendJoint?: StandardJoint;
  jointLabel: (id?: string) => string;
  updateChainRoot: (jointId: string) => void;
  updateIkHandle: (jointId: string) => void;
  resetMotionJoints?: () => void;
  setBendDirection: (bendDirection: number) => void;
}

export const PathInspectorPanel = ({
  project,
  selectedPartId,
  selectedSceneObjectId,
  selectedPartName,
  selectedPath,
  selectedPoint,
  motionWarning,
  pathLocked,
  selectedChainRootId,
  chainRootOptions,
  selectedIkJointId,
  jointOptions,
  ikDescriptor,
  bendJoint,
  jointLabel,
  updateChainRoot,
  updateIkHandle,
  resetMotionJoints,
  setBendDirection,
}: PathInspectorPanelProps) => {
  const readiness = selectedPath ? motionPathReadiness(project, selectedPath) : undefined;
  const rootJointId = ikDescriptor?.rootJointId ?? selectedChainRootId;
  const targetJointId = ikDescriptor?.targetJointId ?? selectedIkJointId;
  return (
    <div className="path-inspector stage-pane-stack">
      <div>
        <div className="section-title">Selection</div>
        <h3>{selectedPartName ?? "No target selected"}</h3>
      </div>
      {selectedPath && (
        <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
          <div className="font-bold text-slate-800">Path</div>
          <div>
            {readiness?.playable
              ? selectedPath.closed
                ? "Loop ready"
                : "Curve ready"
              : readiness?.reason}
          </div>
          {motionWarning && <div role="status" className="text-amber-800" data-testid="path-motion-warning">{motionWarning}</div>}
          <div>
            {selectedPoint !== null && selectedPath.points[selectedPoint]
              ? "Point selected."
              : "Drag the curve."}
          </div>
        </div>
      )}
      <div className="rig-helper" data-testid="quick-rig-helper">
        <h4 className="section-title">Motion</h4>
        <h3>{selectedSceneObjectId ? "Move object" : "Move part"}</h3>
        {selectedSceneObjectId && (
          <div
            className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-slate-600"
            data-testid="object-path-summary"
          >
            <div className="font-bold text-slate-800">Object path</div>
            <div>Drag the curve.</div>
          </div>
        )}
        {selectedPartId && (
          <>
            <div
              className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-slate-600"
              data-testid="ik-chain-summary"
              data-chain-root={rootJointId ?? ""}
              data-chain-handle={targetJointId ?? ""}
              data-chain-kind={ikDescriptor?.kind ?? "invalid"}
            >
              <div className="font-bold text-slate-800">
                {selectedPath ? "Start → Handle" : "New path defaults"}
              </div>
              {ikDescriptor?.jointCount ? (
                <>
                  <div>{jointLabel(rootJointId)} → {jointLabel(targetJointId)}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {ikDescriptor.jointCount} {ikDescriptor.jointCount === 1 ? "joint" : "joints"}
                    {readiness?.playable ? " · Motion ready" : ""}
                  </div>
                </>
              ) : <div>Pick a part with joints.</div>}
              {ikDescriptor?.warning && <div className="mt-1 text-xs text-amber-800" role="status">{ikDescriptor.warning}</div>}
            </div>
            <details className="advanced-panel" data-testid="motion-joint-options">
              <summary>Change joints</summary>
              <div className="mt-3 space-y-3">
                {resetMotionJoints && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pathLocked || !selectedPath}
                    onClick={resetMotionJoints}
                  >
                    Automatic
                  </button>
                )}
                <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
                  Start
                  <select
                    aria-label="Motion start"
                    className="field mt-1"
                    disabled={pathLocked || !selectedPath}
                    value={rootJointId ?? ""}
                    onChange={(e) => updateChainRoot(e.target.value)}
                  >
                    {chainRootOptions.map((id) => (
                      <option key={id} value={id}>{jointLabel(id)}</option>
                    ))}
                  </select>
                </label>
                {selectedPath && (
                  <div className="flex flex-wrap gap-2" data-testid="ik-chain-root-options">
                    {chainRootOptions.map((id) => (
                      <button
                        type="button"
                        key={id}
                        className={`btn-secondary ${id === rootJointId ? "active" : ""}`}
                        disabled={pathLocked}
                        onClick={() => updateChainRoot(id)}
                      >
                        {jointLabel(id)}
                      </button>
                    ))}
                  </div>
                )}
                <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
                  Handle
                  <select
                    aria-label="Motion handle"
                    className="field mt-1"
                    disabled={pathLocked || !selectedPath}
                    value={targetJointId ?? ""}
                    onChange={(e) => updateIkHandle(e.target.value)}
                  >
                    {jointOptions.map((id) => (
                      <option key={id} value={id}>
                        {motionChainOptionLabel(project, selectedPartId, id, { rootJointId })}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
          </>
        )}
        {!selectedSceneObjectId && ikDescriptor?.canFold && bendJoint && (
          <div className="fold-picker" data-testid="fold-direction-control">
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-slate-500">
                Fold
              </div>
              <div className="text-sm text-slate-600">
                {jointLabel(bendJoint.id)} · {bendJoint.bendDirection < 0 ? "left" : "right"}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                aria-label="Fold left"
                className={`btn-secondary ${bendJoint.bendDirection < 0 ? "active" : ""}`}
                disabled={pathLocked || bendJoint.locked}
                onClick={() => setBendDirection(-1)}
              >
                Left
              </button>
              <button
                aria-label="Fold right"
                className={`btn-secondary ${bendJoint.bendDirection >= 0 ? "active" : ""}`}
                disabled={pathLocked || bendJoint.locked}
                onClick={() => setBendDirection(1)}
              >
                Right
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
