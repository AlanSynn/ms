import type { ProjectMotionPath, ProjectState, StandardJoint } from "../../../types";
import { motionChainOptionLabel, type MotionChainDescriptor } from "../../../utils/motion";

interface PathInspectorPanelProps {
  project: ProjectState;
  selectedPartId?: string;
  selectedPartName?: string;
  selectedPath?: ProjectMotionPath;
  pointCount: number;
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
  setBendDirection: (bendDirection: number) => void;
}

export const PathInspectorPanel = ({
  project,
  selectedPartId,
  selectedPartName,
  selectedPath,
  selectedPoint,
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
  setBendDirection,
}: PathInspectorPanelProps) => (
  <div className="path-inspector stage-pane-stack">
    <div>
      <div className="section-title">Selection</div>
      <h3>{selectedPartName ?? "No body part selected"}</h3>
    </div>
    {selectedPath && (
      <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
        <div className="font-bold text-slate-800">Path</div>
        <div>{selectedPath.closed ? "Loop ready" : "Curve ready"}</div>
        <div>
          {selectedPoint !== null && selectedPath.points[selectedPoint]
            ? "Point selected."
            : "Drag the curve."}
        </div>
      </div>
    )}
    <div className="rig-helper" data-testid="quick-rig-helper">
      <h4 className="section-title">Motion</h4>
      <h3>Move part</h3>
      {selectedPartId && (
        <label
          className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${pathLocked || !selectedPath ? "opacity-50" : ""}`}
        >
          Start
          <select
            aria-label="Motion start"
            className="field mt-1"
            disabled={pathLocked || !selectedPath}
            value={selectedChainRootId ?? ""}
            onChange={(e) => updateChainRoot(e.target.value)}
          >
            {chainRootOptions.map((id) => (
              <option key={id} value={id}>
                {jointLabel(id)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selectedPartId && selectedPath && (
        <div className="flex flex-wrap gap-2" data-testid="ik-chain-root-options">
          {chainRootOptions.map((id) => (
            <button
              type="button"
              key={id}
              className={`btn-secondary ${id === selectedChainRootId ? "active" : ""}`}
              disabled={pathLocked}
              onClick={() => updateChainRoot(id)}
            >
              {jointLabel(id)}
            </button>
          ))}
        </div>
      )}
      {selectedPartId && (
        <label
          className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${pathLocked || !selectedPath ? "opacity-50" : ""}`}
        >
          Handle
          <select
            aria-label="Motion handle"
            className="field mt-1"
            disabled={pathLocked || !selectedPath}
            value={selectedIkJointId ?? ""}
            onChange={(e) => updateIkHandle(e.target.value)}
          >
            {jointOptions.map((id) => (
              <option key={id} value={id}>
                {motionChainOptionLabel(project, selectedPartId, id)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selectedPartId && (
        <div
          className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-slate-600"
          data-testid="ik-chain-summary"
          title={ikDescriptor ? "Motion target." : "Pick handle."}
        >
          <div className="font-bold text-slate-800">
            {ikDescriptor ? "Motion ready" : "Pick a handle"}
          </div>
        </div>
      )}
      <div className="fold-picker" data-testid="fold-direction-control">
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-slate-500">
            Bend
          </div>
          <div className="text-sm text-slate-600">
            {bendJoint
              ? `Bend ${bendJoint.bendDirection < 0 ? "left" : "right"}`
              : ikDescriptor?.kind === "two-joint-direct"
                ? "No bend"
                : "Pick elbow/knee"}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            aria-label="Fold left"
            className={`btn-secondary ${bendJoint && bendJoint.bendDirection < 0 ? "active" : ""}`}
            disabled={!bendJoint || bendJoint.locked}
            onClick={() => setBendDirection(-1)}
          >
            Left
          </button>
          <button
            aria-label="Fold right"
            className={`btn-secondary ${bendJoint && bendJoint.bendDirection >= 0 ? "active" : ""}`}
            disabled={!bendJoint || bendJoint.locked}
            onClick={() => setBendDirection(1)}
          >
            Right
          </button>
        </div>
      </div>
    </div>
  </div>
);
