import React from "react";
import type { MechanismConfig, MechanismType } from "../../../types";
import { ClassroomExampleVideo } from "../../ui/ClassroomExampleVideo";
import { fabricationStackSummary } from "../../../utils/fabrication";
import {
  classroomAssessmentFor,
  classroomCueTitleFor,
  classroomUseExampleFor,
  formatClassroomAssessmentPrompt,
} from "../../../utils/classroomContent";
import {
  FOUNDRY_MECHANISM_TYPES,
  FOUNDRY_PRESETS,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
  mechanismTemplateLabel,
} from "../../../utils/mechanismTemplates";
import { MiniNumber } from "../../ui/InspectorControls";
import { MechanismParametricEditor } from "../mechanism/MechanismParametricEditor";
import {
  MECHANISM_PARAM_META,
  shouldShowMechanismParam,
} from "../mechanism/mechanismParamPolicy";

type FoundrySensemaking =
  (typeof MECHANISM_LIBRARY)[MechanismType]["classroomSensemaking"];

export const FoundryInspectorPanel = ({
  foundry,
  libraryLabel,
  classroomAssessmentKey,
  classroomSensemaking,
  foundryRigOpacity,
  foundryExplode,
  showSensemaking,
  onRigOpacityChange,
  onExplodeChange,
  onUpdateParams,
  onChangeParam,
  onSetMechanismType,
  onSetPreset,
  onToggleSensemaking,
}: {
  foundry: MechanismConfig;
  libraryLabel: string;
  classroomAssessmentKey: string;
  classroomSensemaking: FoundrySensemaking;
  foundryRigOpacity: number;
  foundryExplode: number;
  showSensemaking: boolean;
  onRigOpacityChange: (value: number) => void;
  onExplodeChange: (value: number) => void;
  onUpdateParams: (updates: Partial<MechanismConfig>) => void;
  onChangeParam: (key: keyof MechanismConfig, value: number) => void;
  onSetMechanismType: (type: MechanismType) => void;
  onSetPreset: (presetId: string) => void;
  onToggleSensemaking: () => void;
}) => {
  const assessment = classroomAssessmentFor(
    foundry.type,
    classroomAssessmentKey,
    "foundry",
  );
  const useExample = classroomUseExampleFor(foundry.type);

  return (
  <div className="stage-pane-stack">
    <div className="stage-pane-stack" data-testid="foundry-sensemaking-panel">
      <button
        type="button"
        className={`sensemaking-cue sensemaking-cue-button ${showSensemaking ? "active" : ""}`}
        data-testid="foundry-visible-sensemaking"
        data-sensemaking-check={classroomSensemaking.studentCheck}
        data-sensemaking-answer={classroomSensemaking.expectedAnswer}
        data-sensemaking-evidence={classroomSensemaking.evidenceCue}
        data-sensemaking-clip={classroomSensemaking.clipSlot}
        aria-expanded={showSensemaking}
        aria-label={showSensemaking ? "Hide details" : "Show details"}
        onClick={onToggleSensemaking}
      >
        <span className="cue-title">{classroomCueTitleFor("foundry")}</span>
        <strong>{classroomSensemaking.directTranslation}</strong>
        <small>{classroomSensemaking.tryThis}</small>
        <small
          data-testid="classroom-assessment-prompt"
          data-assessment-key={classroomAssessmentKey}
          data-assessment-kind={assessment.kind}
        >
          {formatClassroomAssessmentPrompt(assessment)}
        </small>
        <span className="blueprint-pill sensemaking-action-pill">
          {showSensemaking ? "Hide details" : "Show details"}
        </span>
      </button>
      {showSensemaking && (
        <div
          className="recommendation-card"
          data-testid="foundry-mechanism-library"
        >
          <div className="font-bold text-slate-800">{libraryLabel}</div>
          <div className="flex flex-wrap gap-2">
            <span className="blueprint-pill">
              {fabricationStackSummary(foundry)}
            </span>
            <span className="blueprint-pill">
              {classroomSensemaking.studentCheck}
            </span>
            <span className="blueprint-pill">
              {classroomSensemaking.evidenceCue}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {classroomSensemaking.teacherTakeaway}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {classroomSensemaking.commonHint}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Answer: {classroomSensemaking.expectedAnswer}
          </p>
        </div>
      )}
      <ClassroomExampleVideo example={useExample} />
    </div>
    <div
      className="compact-fabrication-stack"
      data-testid="foundry-fabrication-stack"
    >
      <strong>Stack</strong>
      <span>{fabricationStackSummary(foundry)}</span>
    </div>
    <div className="foundry-view-controls" data-testid="foundry-view-controls">
      <div className="section-title">View</div>
      <div className="foundry-view-controls-grid">
        <div
          className="foundry-opacity-panel inspector-control-card"
          data-testid="foundry-opacity-panel"
        >
          <div>
            <span>Rig opacity</span>
            <strong>{foundryRigOpacity}%</strong>
          </div>
          <input
            aria-label="Rig opacity"
            type="range"
            min="35"
            max="100"
            value={foundryRigOpacity}
            onChange={(event) => onRigOpacityChange(Number(event.target.value))}
          />
        </div>
        <div
          className="foundry-opacity-panel inspector-control-card"
          data-testid="foundry-explode-panel"
        >
          <div>
            <span>Explode</span>
            <strong>{foundryExplode}%</strong>
          </div>
          <input
            aria-label="Exploded view"
            type="range"
            min="0"
            max="100"
            value={foundryExplode}
            onChange={(event) => onExplodeChange(Number(event.target.value))}
          />
        </div>
      </div>
    </div>
    <MechanismParametricEditor
      mechanism={foundry}
      onChange={onUpdateParams}
      testId="foundry-parametric-editor"
    />
    <details className="advanced-panel">
      <summary>Mechanism options</summary>
      <div className="mt-3 space-y-3">
        <select
          aria-label="Foundry mechanism type"
          className="field"
          value={foundry.type}
          onChange={(event) =>
            onSetMechanismType(event.target.value as MechanismType)
          }
        >
          {FOUNDRY_MECHANISM_TYPES.map((type) => (
            <option key={type} value={type}>
              {mechanismTemplateLabel(type)}
            </option>
          ))}
        </select>
        <select
          aria-label="Foundry preset"
          className="field"
          value={foundry.presetId ?? "balanced"}
          onChange={(event) => onSetPreset(event.target.value)}
        >
          {Object.entries(FOUNDRY_PRESETS).map(([id, preset]) => (
            <option key={id} value={id}>
              {preset.label}
            </option>
          ))}
        </select>
        {MECHANISM_PARAM_META.filter((param) =>
          shouldShowMechanismParam(foundry.type, param.key),
        ).map((param) => (
          <React.Fragment key={String(param.key)}>
            <MiniNumber
              label={param.label}
              value={Number(foundry[param.key] ?? 0)}
              min={param.min}
              max={param.max}
              step={param.step}
              onChange={(value) => onChangeParam(param.key, value)}
            />
          </React.Fragment>
        ))}
      </div>
    </details>
  </div>
  );
};
