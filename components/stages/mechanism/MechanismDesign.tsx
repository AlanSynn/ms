import React, { useMemo, useState } from "react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { MechanismParametricEditor } from "./MechanismParametricEditor";
import { MiniNumber, Toggle } from "../../ui/InspectorControls";
import {
  EditorStageFrame,
  StageLeftSummary,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import type {
  AppStage,
  MechanismConfig,
  MechanismType,
  ProjectAction,
  ProjectState,
} from "../../../types";
import { sampleFeasibleRange } from "../../../utils/fabrication";
import {
  describeMotionChain,
  mechanismBindingWarnings,
  motionAnchorJointIds,
  motionChainOptionLabel,
  preferredMotionJointId,
} from "../../../utils/motion";
import { fitMechanismToTargetPath } from "../../../utils/mechanismRecommendations";
import {
  AUTHORABLE_MECHANISM_TYPES,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
  mechanismTemplateLabel,
} from "../../../utils/mechanismTemplates";
import {
  createDefaultMechanism,
  mechanismWithGeneratedPath,
  uid,
} from "../../../utils/project";
import {
  MECHANISM_PARAM_META,
  shouldShowMechanismParam,
} from "./mechanismParamPolicy";

import { DesignFoundryPreview } from "./DesignFoundryPreview";

export const MechanismDesign = ({
  project,
  selectedMechanism,
  updateMechanism,
  dispatch,
  showTrace,
  setShowTrace,
  angle,
  onOptimize,
  onRecommendations,
  optimizerBusy,
  exportSvg,
  exportDxf,
  onBlueprint,
  goStage,
}: {
  project: ProjectState;
  selectedMechanism?: MechanismConfig;
  updateMechanism: (id: string, updates: Partial<MechanismConfig>) => void;
  dispatch: (action: ProjectAction) => void;
  showTrace: boolean;
  setShowTrace: (v: boolean) => void;
  angle: number;
  onOptimize: () => void;
  onRecommendations: () => void;
  optimizerBusy: boolean;
  exportSvg: () => void;
  exportDxf: () => void;
  onBlueprint: () => void;
  goStage: (stage: AppStage) => void;
}) => {
  const selectedLibrary = selectedMechanism
    ? MECHANISM_LIBRARY[selectedMechanism.type]
    : undefined;
  const selectedRange = selectedMechanism
    ? sampleFeasibleRange(selectedMechanism)
    : undefined;
  const bindingWarnings = mechanismBindingWarnings(project);
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
  const selectedTargetPath = selectedMechanism?.targetPathId
    ? project.paths[selectedMechanism.targetPathId]
    : undefined;
  const selectedTargetChain = selectedMechanism?.targetPartId
    ? describeMotionChain(
        project,
        selectedMechanism.targetPartId,
        selectedTargetAnchor,
        { rootJointId: selectedTargetPath?.chainRootJointId },
      )
    : undefined;
  const updateTargetPart = (partId: string) => {
    if (!selectedMechanism) return;
    const targetPartId = partId || undefined;
    const targetPath = targetPartId
      ? Object.values(project.paths).find(
          (path) => path.partId === targetPartId,
        )
      : undefined;
    updateMechanism(selectedMechanism.id, {
      targetPartId,
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
  const addLibraryMechanism = (type: MechanismType) => {
    const base = createDefaultMechanism(type, uid("mech"));
    const path = project.selectedPathId
      ? project.paths[project.selectedPathId]
      : undefined;
    const mechanism =
      path && path.points.length >= 3
        ? fitMechanismToTargetPath(
            project,
            { ...base, targetPathId: path.id, targetPartId: path.partId },
            path.id,
          )
        : mechanismWithGeneratedPath(base);
    dispatch({ type: "upsert_mechanism", mechanism });
  };
  return (
    <EditorStageFrame
      stage="design"
      className="design-stage-frame"
      layout={{
        workflow: workflowPane(
          <div className="stage-pane-stack">
            <StageLeftSummary
              project={project}
              title="Design"
              stage="design"
              goStage={goStage}
            >
              <div className="flex flex-wrap gap-2">
                <button
                  className={`btn-secondary ${showTrace ? "active" : ""}`}
                  onClick={() => setShowTrace(!showTrace)}
                >
                  Trace
                </button>
                <button className="btn-primary" onClick={onRecommendations}>
                  <Sparkles size={16} /> Recommend
                </button>
              </div>
              <h4 className="section-title mt-4">Mechanisms</h4>
              <select
                aria-label="Mechanism instance"
                className="field"
                value={selectedMechanism?.id ?? ""}
                onChange={(e) =>
                  dispatch({
                    type: "set_mechanisms",
                    mechanisms: project.mechanisms,
                    selectedMechanismId: e.target.value,
                  })
                }
              >
                {project.mechanisms.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} · {m.type}
                  </option>
                ))}
              </select>
              <div className="mt-3 flex flex-wrap gap-2">
                {AUTHORABLE_MECHANISM_TYPES.map((type) => (
                  <button
                    key={type}
                    className="chip"
                    title={mechanismTemplateLabel(type)}
                    onClick={() => addLibraryMechanism(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
              {selectedLibrary && (
                <div
                  className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600"
                  data-testid="design-mechanism-library"
                >
                  <div className="font-bold text-slate-800">Template</div>
                  <div>{selectedLibrary.label}</div>
                  <div data-testid="design-feasibility">
                    {selectedRange?.warning ?? "360°"}
                  </div>
                </div>
              )}
              {selectedLibrary && (
                <div
                  className="sensemaking-cue"
                  data-testid="design-visible-sensemaking"
                  data-sensemaking-check={
                    selectedLibrary.classroomSensemaking.studentCheck
                  }
                  data-sensemaking-answer={
                    selectedLibrary.classroomSensemaking.expectedAnswer
                  }
                  data-sensemaking-evidence={
                    selectedLibrary.classroomSensemaking.evidenceCue
                  }
                  data-sensemaking-clip={
                    selectedLibrary.classroomSensemaking.clipSlot
                  }
                >
                  <span className="cue-title">Why it moves</span>
                  <strong>
                    {selectedLibrary.classroomSensemaking.directTranslation}
                  </strong>
                  <small>{selectedLibrary.classroomSensemaking.tryThis}</small>
                </div>
              )}
              {Object.entries(bindingWarnings).map(([id, warnings]) =>
                warnings.length ? (
                  <div className="warning" key={id}>
                    {id}: {warnings.join("; ")}
                  </div>
                ) : null,
              )}
              <button className="btn-primary w-full" onClick={onBlueprint}>
                Blueprint
              </button>
            </StageLeftSummary>
          </div>,
        ),
        canvas: canvasPane(
          <DesignFoundryPreview
            project={project}
            mechanism={selectedMechanism}
            angle={angle}
            showTrace={showTrace}
          />,
        ),
        inspector: inspectorPane(
          <div className="stage-pane-stack">
            <div>
              <div className="section-title">Mechanism</div>
              <h3>
                {selectedMechanism
                  ? `${selectedMechanism.id} · ${mechanismTemplateLabel(selectedMechanism.type)}`
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
                <div className="section-title">Target</div>
                <select
                  aria-label="Mechanism target part"
                  className="field"
                  value={selectedMechanism.targetPartId ?? ""}
                  onChange={(e) => updateTargetPart(e.target.value)}
                >
                  <option value="">No target</option>
                  {project.partOrder.map((id) => (
                    <option key={id} value={id}>
                      {project.parts[id].name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Mechanism target path"
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
                    .filter(
                      (p) =>
                        !selectedMechanism.targetPartId ||
                        p.partId === selectedMechanism.targetPartId,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id} · {p.points.length} pts
                      </option>
                    ))}
                </select>
                {selectedMechanism.targetPartId && project.skeleton && (
                  <select
                    aria-label="Mechanism target anchor"
                    className="field"
                    value={selectedTargetAnchor ?? ""}
                    onChange={(e) =>
                      updateMechanism(selectedMechanism.id, {
                        targetAnchorJointId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Default anchor</option>
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
                {selectedTargetChain && (
                  <div
                    className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-slate-600"
                    data-testid="mechanism-ik-chain-summary"
                    title={selectedTargetChain.helper}
                  >
                    <div className="font-bold text-slate-800">
                      {selectedTargetChain.label}
                    </div>
                  </div>
                )}
                <MechanismParametricEditor
                  mechanism={selectedMechanism}
                  onChange={(updates) =>
                    updateMechanism(selectedMechanism.id, updates)
                  }
                  testId="design-parametric-editor"
                />
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
                {selectedRange?.warning && (
                  <div className="warning">{selectedRange.warning}</div>
                )}
                {selectedMechanism.warnings?.map((w, i) => (
                  <div className="warning" key={`${w}-${i}`}>
                    {w}
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-primary"
                    disabled={optimizerBusy}
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
          </div>,
        ),
      }}
    />
  );
};
