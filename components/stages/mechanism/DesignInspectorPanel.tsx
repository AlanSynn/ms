import React, { useEffect, useState } from "react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { MechanismParametricEditor } from "./MechanismParametricEditor";
import { MiniNumber, Toggle } from "../../ui/InspectorControls";
import type {
  MechanismConfig,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../../../types";
import {
  motionAnchorJointIds,
  motionChainOptionLabel,
  preferredMotionJointId,
} from "../../../utils/motion";
import {
  getInspectorBindingWarnings,
  getInspectorFeasibleRange,
} from "../../../utils/mechanismInspectorAnalysis";
import { feasibilityStatusForRange } from "../../../utils/fabrication";
import { mechanismTemplateLabel } from "../../../utils/mechanismTemplates";
import {
  MECHANISM_PARAM_META,
  shouldShowMechanismParam,
} from "./mechanismParamPolicy";
import { MechanismFeasibilityStatus } from "./MechanismFeasibilityStatus";
import { prepareMechanismOptimizerWorker } from "../../../runtime/optimizer/mechanismOptimizerWorkerClient";

type DesignInspectorPanelProps = {
  project: ProjectState;
  selectedMechanism?: MechanismConfig;
  updateMechanism: (id: string, updates: Partial<MechanismConfig>) => void;
  dispatch: (action: ProjectAction) => void;
  optimizerBusy: boolean;
  onOptimize: () => void;
  exportSvg: () => void;
  exportDxf: () => void;
  onBlueprint: () => void;
};

export const DesignInspectorPanel = ({
  project,
  selectedMechanism,
  updateMechanism,
  dispatch,
  optimizerBusy,
  onOptimize,
  exportSvg,
  exportDxf,
  onBlueprint,
}: DesignInspectorPanelProps) => {
  const [workerPrepared, setWorkerPrepared] = useState(false);
  useEffect(() => {
    let mounted = true;
    void prepareMechanismOptimizerWorker().then(() => {
      if (mounted) setWorkerPrepared(true);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const selectedRange = selectedMechanism
    ? getInspectorFeasibleRange(selectedMechanism)
    : undefined;
  const selectedFeasibilityStatus = selectedRange
    ? feasibilityStatusForRange(selectedRange)
    : undefined;
  const motionWarning = selectedRange?.warning
    ? selectedRange.warning.startsWith("No motion")
      ? "No full motion. Try reset or smaller links."
      : "Motion may jam. Try a smaller move."
    : null;
  const bindingWarnings = getInspectorBindingWarnings(project);
  const selectedBindingWarnings = selectedMechanism
    ? (bindingWarnings[selectedMechanism.id] ?? [])
    : [];
  const targetAnchorOptions = selectedMechanism?.targetPartId
    ? motionAnchorJointIds(project, selectedMechanism.targetPartId)
    : [];
  const selectedTargetAnchor = selectedMechanism?.targetPartId
    ? preferredMotionJointId(
        project,
        selectedMechanism.targetPartId,
        selectedMechanism.targetAnchorJointId,
      )
    : undefined;
  const targetSelectValue = selectedMechanism?.targetSceneObjectId
    ? `object:${selectedMechanism.targetSceneObjectId}`
    : selectedMechanism?.targetPartId
      ? selectedMechanism.targetPartId
      : "";
  const pathBelongsToSelection = (path: ProjectMotionPath) =>
    selectedMechanism?.targetSceneObjectId
      ? path.sceneObjectId === selectedMechanism.targetSceneObjectId
      : !selectedMechanism?.targetPartId ||
        (!path.sceneObjectId && path.partId === selectedMechanism.targetPartId);
  const updateTarget = (value: string) => {
    if (!selectedMechanism) return;
    const targetSceneObjectId = value.startsWith("object:")
      ? value.slice("object:".length)
      : undefined;
    const targetPartId = value && !targetSceneObjectId ? value : undefined;
    const targetPath = targetPartId
      ? Object.values(project.paths).find(
          (path) => !path.sceneObjectId && path.partId === targetPartId,
        )
      : targetSceneObjectId
        ? Object.values(project.paths).find(
            (path) => path.sceneObjectId === targetSceneObjectId,
          )
        : undefined;
    updateMechanism(selectedMechanism.id, {
      targetPartId,
      targetSceneObjectId,
      targetPathId: targetPath?.id,
      targetAnchorJointId:
        targetPath?.targetAnchorJointId ??
        (targetPartId
          ? preferredMotionJointId(
              project,
              targetPartId,
              selectedMechanism.targetAnchorJointId,
              { preferDistalWhenRoot: true },
            )
          : undefined),
    });
  };

  return (
    <div className="stage-pane-stack">
      <div>
        <div className="section-title">Mechanism</div>
        <h3>
          {selectedMechanism
            ? mechanismTemplateLabel(selectedMechanism.type)
            : "No mechanism"}
        </h3>
      </div>
      {selectedMechanism && (
        <>
          <Toggle
            label="Visible"
            checked={selectedMechanism.visible}
            onChange={(visible) =>
              updateMechanism(selectedMechanism.id, { visible })
            }
          />
          <Toggle
            label="Enabled"
            checked={selectedMechanism.enabled !== false}
            onChange={(enabled) =>
              updateMechanism(selectedMechanism.id, { enabled })
            }
          />
          <div className="section-title">Move</div>
          <select
            aria-label="Mechanism target"
            className="field"
            value={targetSelectValue}
            onChange={(e) => updateTarget(e.target.value)}
          >
            <option value="">No target</option>
            <optgroup label="Body parts">
              {project.partOrder.map((id) => (
                <option key={id} value={id}>
                  {project.parts[id].name}
                </option>
              ))}
            </optgroup>
            {project.sceneObjectOrder.length > 0 && (
              <optgroup label="Scene objects">
                {project.sceneObjectOrder.map((id) => {
                  const object = project.sceneObjects[id];
                  return object ? (
                    <option key={id} value={`object:${id}`}>
                      {object.name}
                    </option>
                  ) : null;
                })}
              </optgroup>
            )}
          </select>
          <select
            aria-label="Mechanism motion path"
            className="field"
            value={selectedMechanism.targetPathId ?? ""}
            onChange={(e) =>
              updateMechanism(selectedMechanism.id, {
                targetPathId: e.target.value || undefined,
              })
            }
          >
            <option value="">No path</option>
            {Object.values(project.paths)
              .filter(pathBelongsToSelection)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sceneObjectId
                    ? `${project.sceneObjects[p.sceneObjectId]?.name ?? "Object"} path`
                    : project.parts[p.partId]?.name
                      ? `${project.parts[p.partId].name} path`
                      : "Motion path"}
                </option>
              ))}
          </select>
          {selectedMechanism.targetPartId && project.skeleton && (
            <select
              aria-label="Motion handle"
              className="field"
              value={selectedTargetAnchor ?? ""}
              onChange={(e) =>
                updateMechanism(selectedMechanism.id, {
                  targetAnchorJointId: e.target.value || undefined,
                })
              }
            >
              <option value="">Default handle</option>
              {targetAnchorOptions.map((id) => (
                <option key={id} value={id}>
                  {motionChainOptionLabel(
                    project,
                    selectedMechanism.targetPartId,
                    id,
                  )}
                </option>
              ))}
            </select>
          )}
          <MechanismParametricEditor
            mechanism={selectedMechanism}
            onChange={(updates) =>
              updateMechanism(selectedMechanism.id, updates)
            }
            testId="design-parametric-editor"
          />
          {selectedFeasibilityStatus && (
            <MechanismFeasibilityStatus
              status={selectedFeasibilityStatus}
              testId="design-feasibility-status"
            />
          )}
          <div className="section-title">Parameters</div>
          {MECHANISM_PARAM_META.filter((p) =>
            shouldShowMechanismParam(selectedMechanism.type, p.key),
          ).map((p) => (
            <React.Fragment key={String(p.key)}>
              <MiniNumber
                label={p.label}
                value={Number(selectedMechanism[p.key] ?? 0)}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(value) =>
                  updateMechanism(selectedMechanism.id, {
                    [p.key]: value,
                  } as Partial<MechanismConfig>)
                }
              />
            </React.Fragment>
          ))}
          {selectedBindingWarnings.map((w, i) => (
            <div className="warning" key={`binding-${w}-${i}`}>
              {w}
            </div>
          ))}
          {motionWarning && <div className="warning">{motionWarning}</div>}
          {selectedMechanism.warnings?.map((w, i) => (
            <div className="warning" key={`${w}-${i}`}>
              {w}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              data-optimizer-worker-prepared={workerPrepared ? "true" : "false"}
              disabled={optimizerBusy || !workerPrepared}
              aria-busy={optimizerBusy || !workerPrepared}
              onClick={onOptimize}
            >
              {optimizerBusy ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Sparkles size={16} />
              )}{" "}
              Fit
            </button>
            <button
              className="btn-secondary"
              onClick={() =>
                dispatch({
                  type: "delete_mechanism",
                  mechanismId: selectedMechanism.id,
                })
              }
            >
              <Trash2 size={16} /> Delete
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={exportSvg}>
              SVG
            </button>
            <button className="btn-secondary" onClick={exportDxf}>
              DXF
            </button>
            <button
              className="btn-primary"
              aria-label="Export Blueprint"
              onClick={onBlueprint}
            >
              Blueprint
            </button>
          </div>
        </>
      )}
    </div>
  );
};
