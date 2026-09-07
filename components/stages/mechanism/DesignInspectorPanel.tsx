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
import { resolvedMechanismOutputBindings } from "../../../utils/mechanismBindings";
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
import type { MechanismUpdateCallbacks } from "../../../hooks/useAppMechanismActions";

type DesignInspectorPanelProps = {
  project: ProjectState;
  selectedMechanism?: MechanismConfig;
  updateMechanism: (
    id: string,
    updates: Partial<MechanismConfig>,
    callbacks?: MechanismUpdateCallbacks,
  ) => void;
  dispatch: (action: ProjectAction) => void;
  optimizerBusy: boolean;
  onOptimize: () => void;
  onCancelOptimize: () => void;
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
  onCancelOptimize,
  exportSvg,
  exportDxf,
  onBlueprint,
}: DesignInspectorPanelProps) => {
  const [pendingBinding, setPendingBinding] = useState<{
    mechanismId: string;
    targetPartId?: string;
    targetSceneObjectId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
  }>();
  const [editRevision, setEditRevision] = useState(0);
  const revertPendingEdit = () => {
    setPendingBinding(undefined);
    setEditRevision((revision) => revision + 1);
  };
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
  const selectedBindingReady = selectedMechanism
    ? resolvedMechanismOutputBindings(project, selectedMechanism).some((binding) => {
        if (binding.enabled === false || !project.paths[binding.pathId]) return false;
        return binding.targetSceneObjectId
          ? Boolean(project.sceneObjects[binding.targetSceneObjectId])
          : binding.targetPartId
            ? Boolean(project.parts[binding.targetPartId])
            : false;
      })
    : false;
  const selectedBindingWarnings = selectedMechanism
    ? (bindingWarnings[selectedMechanism.id] ?? [])
    : [];
  const activePendingBinding =
    pendingBinding?.mechanismId === selectedMechanism?.id
      ? pendingBinding
      : undefined;
  const effectiveTargetPartId = activePendingBinding
    ? activePendingBinding.targetPartId
    : selectedMechanism?.targetPartId;
  const effectiveTargetSceneObjectId = activePendingBinding
    ? activePendingBinding.targetSceneObjectId
    : selectedMechanism?.targetSceneObjectId;
  const effectiveTargetPathId = activePendingBinding
    ? activePendingBinding.targetPathId
    : selectedMechanism?.targetPathId;
  const effectiveTargetAnchorJointId = activePendingBinding
    ? activePendingBinding.targetAnchorJointId
    : selectedMechanism?.targetAnchorJointId;
  useEffect(() => {
    if (!pendingBinding || !selectedMechanism) return;
    if (
      pendingBinding.mechanismId !== selectedMechanism.id ||
      (
        pendingBinding.targetPartId === selectedMechanism.targetPartId &&
        pendingBinding.targetSceneObjectId === selectedMechanism.targetSceneObjectId &&
        pendingBinding.targetPathId === selectedMechanism.targetPathId &&
        pendingBinding.targetAnchorJointId === selectedMechanism.targetAnchorJointId
      )
    ) {
      setPendingBinding(undefined);
    }
  }, [pendingBinding, selectedMechanism]);
  const targetAnchorOptions = effectiveTargetPartId
    ? motionAnchorJointIds(project, effectiveTargetPartId)
    : [];
  const selectedTargetAnchor = effectiveTargetPartId
    ? preferredMotionJointId(
        project,
        effectiveTargetPartId,
        effectiveTargetAnchorJointId,
      )
    : undefined;
  const targetSelectValue = effectiveTargetSceneObjectId
    ? `object:${effectiveTargetSceneObjectId}`
    : effectiveTargetPartId
      ? effectiveTargetPartId
      : "";
  const updateSelectedMechanism = (updates: Partial<MechanismConfig>) => {
    if (!selectedMechanism) return;
    updateMechanism(
      selectedMechanism.id,
      activePendingBinding
        ? {
            ...updates,
            targetPartId: effectiveTargetPartId,
            targetSceneObjectId: effectiveTargetSceneObjectId,
            targetPathId: effectiveTargetPathId,
            targetAnchorJointId: effectiveTargetAnchorJointId,
          }
        : updates,
      { failed: revertPendingEdit },
    );
  };
  const pathBelongsToSelection = (path: ProjectMotionPath) =>
    effectiveTargetSceneObjectId
      ? path.sceneObjectId === effectiveTargetSceneObjectId
      : !effectiveTargetPartId ||
        (!path.sceneObjectId && path.partId === effectiveTargetPartId);
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
    const targetAnchorJointId =
      targetPath?.targetAnchorJointId ??
      (targetPartId
        ? preferredMotionJointId(
            project,
            targetPartId,
            selectedMechanism.targetAnchorJointId,
            { preferDistalWhenRoot: true },
          )
        : undefined);
    setPendingBinding({
      mechanismId: selectedMechanism.id,
      targetPartId,
      targetSceneObjectId,
      targetPathId: targetPath?.id,
      targetAnchorJointId,
    });
    updateMechanism(selectedMechanism.id, {
      targetPartId,
      targetSceneObjectId,
      targetPathId: targetPath?.id,
      targetAnchorJointId,
    }, { failed: revertPendingEdit });
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
            onChange={(visible) => updateSelectedMechanism({ visible })}
          />
          <Toggle
            label="Enabled"
            checked={selectedMechanism.enabled !== false}
            onChange={(enabled) => updateSelectedMechanism({ enabled })}
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
            value={effectiveTargetPathId ?? ""}
            onChange={(e) => {
              const targetPathId = e.target.value || undefined;
              const targetPath = targetPathId
                ? project.paths[targetPathId]
                : undefined;
              setPendingBinding({
                mechanismId: selectedMechanism.id,
                targetPartId: targetPath?.sceneObjectId
                  ? undefined
                  : (targetPath?.partId ?? effectiveTargetPartId),
                targetSceneObjectId:
                  targetPath?.sceneObjectId ?? effectiveTargetSceneObjectId,
                targetPathId,
                targetAnchorJointId: targetPath?.sceneObjectId
                  ? undefined
                  : (targetPath?.targetAnchorJointId ?? effectiveTargetAnchorJointId),
              });
              updateMechanism(selectedMechanism.id, {
                targetPathId,
              }, { failed: revertPendingEdit });
            }}
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
          {effectiveTargetPartId && project.skeleton && (
            <select
              aria-label="Motion handle"
              className="field"
              value={selectedTargetAnchor ?? ""}
              onChange={(e) => {
                const targetAnchorJointId = e.target.value || undefined;
                setPendingBinding({
                  mechanismId: selectedMechanism.id,
                  targetPartId: effectiveTargetPartId,
                  targetSceneObjectId: effectiveTargetSceneObjectId,
                  targetPathId: effectiveTargetPathId,
                  targetAnchorJointId,
                });
                updateMechanism(selectedMechanism.id, {
                  targetPartId: effectiveTargetPartId,
                  targetSceneObjectId: effectiveTargetSceneObjectId,
                  targetPathId: effectiveTargetPathId,
                  targetAnchorJointId,
                }, { failed: revertPendingEdit });
              }}
            >
              <option value="">Default handle</option>
              {targetAnchorOptions.map((id) => (
                <option key={id} value={id}>
                  {motionChainOptionLabel(
                    project,
                    effectiveTargetPartId,
                    id,
                    { rootJointId: effectiveTargetPathId ? project.paths[effectiveTargetPathId]?.chainRootJointId : undefined },
                  )}
                </option>
              ))}
            </select>
          )}
          <MechanismParametricEditor
            key={`${selectedMechanism.id}-parametric-${editRevision}`}
            mechanism={selectedMechanism}
            onChange={updateSelectedMechanism}
            testId="design-parametric-editor"
          />
          {selectedFeasibilityStatus && selectedBindingReady && (
            <MechanismFeasibilityStatus
              status={selectedFeasibilityStatus}
              testId="design-feasibility-status"
            />
          )}
          {!selectedBindingReady && <div className="warning">Choose target and path.</div>}
          <div className="section-title">Parameters</div>
          {MECHANISM_PARAM_META.filter((p) =>
            shouldShowMechanismParam(selectedMechanism.type, p.key),
          ).map((p) => (
            <React.Fragment key={`${String(p.key)}-${editRevision}`}>
              <MiniNumber
                label={p.label}
                value={Number(selectedMechanism[p.key] ?? 0)}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(value) =>
                  updateSelectedMechanism({
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
              data-testid="design-fit-button"
              data-optimizer-worker="on-demand"
              aria-busy={optimizerBusy}
              onClick={optimizerBusy ? onCancelOptimize : onOptimize}
            >
              {optimizerBusy ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Sparkles size={16} />
              )}{" "}
              {optimizerBusy ? "Cancel" : "Fit"}
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
              aria-label="Blueprint"
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
