import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ProjectAction, ProjectState } from "../../../types";
import { localPivotOffsetForScene } from "../../../utils/coordinates";
import {
  describeMotionChain,
  motionAnchorJointIds,
  motionChainOptionLabel,
  motionChainRootJointIds,
} from "../../../utils/motion";
import { uid } from "../../../utils/project";
import { MiniNumber, Toggle } from "../../ui/InspectorControls";

export const SkeletonInspector = ({
  project,
  dispatch,
}: {
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
}) => {
  const joints = Object.values(project.skeleton?.joints ?? {});
  const selected = project.selectedPartId
    ? project.parts[project.selectedPartId]
    : undefined;
  const [selectedJointId, setSelectedJointId] = useState(
    selected?.anchorJointId ?? joints[0]?.id ?? "",
  );
  useEffect(() => {
    if (!project.skeleton?.joints[selectedJointId])
      setSelectedJointId(selected?.anchorJointId ?? joints[0]?.id ?? "");
  }, [joints, project.skeleton, selected?.anchorJointId, selectedJointId]);
  const anchorJoint = selected
    ? project.skeleton?.joints[selected.anchorJointId]
    : undefined;
  const joint =
    project.skeleton?.joints[selectedJointId] ?? anchorJoint ?? joints[0];
  const selectedHandleIds = selected ? motionAnchorJointIds(project, selected.id) : [];
  const defaultDescriptor = selected
    ? describeMotionChain(project, selected.id)
    : undefined;
  const defaultHandleId = defaultDescriptor?.targetJointId;
  const defaultRootId = defaultDescriptor?.rootJointId;
  const defaultRootIds =
    selected && defaultHandleId
      ? motionChainRootJointIds(project, selected.id, defaultHandleId)
      : [];
  const jointName = (id?: string) =>
    id ? (project.skeleton?.joints[id]?.name || id).replaceAll("_", " ") : "";

  return (
    <div>
      <h4 className="section-title">Motion setup</h4>
      {selected && (
        <div
          className="mt-3 rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-slate-600"
          data-testid="character-motion-preset-summary"
          data-default-handle={defaultHandleId ?? ""}
          data-default-root={defaultRootId ?? ""}
          data-chain-kind={defaultDescriptor?.kind ?? "invalid"}
          data-handle-count={selectedHandleIds.length}
          data-root-count={defaultRootIds.length}
        >
          <div className="font-bold text-slate-800">
            New path defaults
          </div>
          {defaultDescriptor?.jointCount ? (
            <>
              <div>{defaultDescriptor.jointIds.map(jointName).join(" → ")}</div>
              <div className="mt-1 text-xs text-slate-500">
                {defaultDescriptor.jointCount} {defaultDescriptor.jointCount === 1 ? "joint" : "joints"}
              </div>
            </>
          ) : <div>Pick a part with joints.</div>}
        </div>
      )}
      {joint && (
        <div className="mt-3 space-y-3">
          <details className="advanced-panel">
            <summary>Edit skeleton</summary>
            <div className="mt-3 space-y-3">
              {selected && (
                <>
                  <label
                    className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${selected.locked ? "opacity-50" : ""}`}
                  >
                    Part pivot
                    <select
                      aria-label="Part pivot"
                      className="field mt-1"
                      disabled={selected.locked}
                      value={selected.anchorJointId}
                      onChange={(e) => {
                        const anchor =
                          project.skeleton?.joints[e.target.value]?.position;
                        dispatch({
                          type: "update_part",
                          partId: selected.id,
                          updates: {
                            anchorJointId: e.target.value,
                            localPivotOffset: anchor
                              ? localPivotOffsetForScene(selected, anchor)
                              : selected.localPivotOffset,
                            localPivotJointId: e.target.value,
                          },
                        });
                      }}
                    >
                      {joints.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name || j.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2" data-testid="character-motion-handles">
                    {selectedHandleIds.map((id) => (
                      <span key={id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                        {motionChainOptionLabel(project, selected.id, id, { rootJointId: defaultRootId })}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
                Edit joint
                <select
                  className="field mt-1"
                  value={joint.id}
                  onChange={(e) => setSelectedJointId(e.target.value)}
                >
                  {joints.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.id}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${joint.locked ? "opacity-50" : ""}`}
              >
                Parent joint
                <select
                  className="field mt-1"
                  disabled={joint.locked}
                  value={joint.parentId ?? ""}
                  onChange={(e) =>
                    dispatch({
                      type: "update_joint",
                      jointId: joint.id,
                      updates: { parentId: e.target.value || null },
                    })
                  }
                >
                  <option value="">Root</option>
                  {joints
                    .filter((j) => j.id !== joint.id)
                    .map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.id}
                      </option>
                    ))}
                </select>
              </label>
              <MiniNumber
                label="Joint X"
                value={joint.position.x}
                min={-320}
                max={320}
                disabled={joint.locked}
                onChange={(x) =>
                  dispatch({
                    type: "update_joint",
                    jointId: joint.id,
                    updates: { position: { ...joint.position, x } },
                  })
                }
              />
              <MiniNumber
                label="Joint Y"
                value={joint.position.y}
                min={-320}
                max={320}
                disabled={joint.locked}
                onChange={(y) =>
                  dispatch({
                    type: "update_joint",
                    jointId: joint.id,
                    updates: { position: { ...joint.position, y } },
                  })
                }
              />
              <Toggle
                label="Locked"
                checked={joint.locked}
                onChange={(locked) =>
                  dispatch({
                    type: "update_joint",
                    jointId: joint.id,
                    updates: { locked },
                  })
                }
              />
              <div className="flex gap-2">
                <button
                  className={`btn-secondary ${joint.bendDirection < 0 ? "active" : ""}`}
                  disabled={joint.locked}
                  onClick={() =>
                    dispatch({
                      type: "update_joint",
                      jointId: joint.id,
                      updates: { bendDirection: -1 },
                    })
                  }
                >
                  Fold left
                </button>
                <button
                  className={`btn-secondary ${joint.bendDirection >= 0 ? "active" : ""}`}
                  disabled={joint.locked}
                  onClick={() =>
                    dispatch({
                      type: "update_joint",
                      jointId: joint.id,
                      updates: { bendDirection: 1 },
                    })
                  }
                >
                  Fold right
                </button>
              </div>
              <MiniNumber
                label="Bend direction"
                value={joint.bendDirection}
                min={-1}
                max={1}
                step={0.1}
                disabled={joint.locked}
                onChange={(bendDirection) =>
                  dispatch({
                    type: "update_joint",
                    jointId: joint.id,
                    updates: { bendDirection },
                  })
                }
              />
              <button
                className="btn-secondary"
                disabled={
                  joint.locked || project.skeleton?.rootJointIds.includes(joint.id)
                }
                onClick={() =>
                  dispatch({ type: "remove_joint", jointId: joint.id })
                }
              >
                <Trash2 size={16} /> Remove joint
              </button>
              <button
                className="btn-secondary"
                onClick={() =>
                  dispatch({
                    type: "add_joint",
                    joint: {
                      id: uid("joint"),
                      name: "new joint",
                      position: { x: 0, y: 0 },
                      parentId: joint?.id ?? null,
                      locked: false,
                      bendDirection: 1,
                    },
                  })
                }
              >
                <Plus size={16} /> Add joint
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
};
