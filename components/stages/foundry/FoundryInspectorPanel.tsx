import React from "react";
import type { MechanismConfig, MechanismType } from "../../../types";
import { ClassroomExampleVideo } from "../../ui/ClassroomExampleVideo";
import {
  fabricationStackSummary,
  readableFabricationStackSummary,
} from "../../../utils/fabrication";
import {
  classroomAssessmentFor,
  classroomUseExampleFor,
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
  clampMechanismParamForMotion,
  motionSafeParamRange,
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
  const readableStack = readableFabricationStackSummary(foundry);

  return (
  <div className="stage-pane-stack">
    <div
      className="stage-pane-stack foundry-sensemaking-panel"
      data-testid="foundry-sensemaking-panel"
    >
      <button
        type="button"
        className={`foundry-question-card ${showSensemaking ? "active" : ""}`}
        data-testid="foundry-visible-sensemaking"
        data-sensemaking-check={classroomSensemaking.studentCheck}
        data-sensemaking-answer={classroomSensemaking.expectedAnswer}
        data-sensemaking-evidence={classroomSensemaking.evidenceCue}
        data-sensemaking-clip={classroomSensemaking.clipSlot}
        aria-expanded={showSensemaking}
        aria-label={showSensemaking ? "Hide hint" : "Hint"}
        onClick={onToggleSensemaking}
      >
        <span className="foundry-question-label">Question</span>
        <strong
          className="foundry-question-text"
          data-testid="classroom-assessment-prompt"
          data-assessment-key={classroomAssessmentKey}
          data-assessment-kind={assessment.kind}
        >
          {assessment.prompt}
        </strong>
        <small className="foundry-motion-line">
          Motion: {classroomSensemaking.directTranslation}
        </small>
        <span className="foundry-question-chips" aria-hidden="true">
          <span>Try: {classroomSensemaking.tryThis}</span>
          <span>Look: {classroomSensemaking.evidenceCue}</span>
        </span>
        <span className="blueprint-pill sensemaking-action-pill foundry-hint-pill">
          {showSensemaking ? "Hide hint" : "Hint"}
        </span>
      </button>
      {showSensemaking && (
        <div
          className="recommendation-card foundry-hint-card"
          data-testid="foundry-mechanism-library"
        >
          <div>
            <span className="foundry-question-label">Mechanism</span>
            <strong>{libraryLabel}</strong>
          </div>
          <dl>
            <div>
              <dt>Hint</dt>
              <dd>{classroomSensemaking.commonHint}</dd>
            </div>
            <div>
              <dt>Check</dt>
              <dd>{classroomSensemaking.studentCheck}</dd>
            </div>
            <div>
              <dt>Watch</dt>
              <dd>{classroomSensemaking.evidenceCue}</dd>
            </div>
          </dl>
          <p className="foundry-answer-line">
            Answer: {classroomSensemaking.expectedAnswer}
          </p>
        </div>
      )}
      <div className="foundry-use-example">
        <ClassroomExampleVideo example={useExample} />
      </div>
    </div>
    <div
      className="compact-fabrication-stack"
      data-testid="foundry-fabrication-stack"
    >
      <strong>Stack</strong>
      <span
        title={fabricationStackSummary(foundry)}
        data-stack-raw={fabricationStackSummary(foundry)}
      >
        {readableStack}
      </span>
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
        ).map((param) => {
          const safeRange = motionSafeParamRange(foundry, param.key);
          return (
            <React.Fragment key={String(param.key)}>
              <MiniNumber
                label={param.label}
                value={Number(foundry[param.key] ?? 0)}
                min={safeRange?.min ?? param.min}
                max={safeRange?.max ?? param.max}
                step={param.step}
                disabled={safeRange?.currentSafe === false}
                onChange={(value) =>
                  onChangeParam(
                    param.key,
                    clampMechanismParamForMotion(foundry, param.key, value),
                  )
                }
              />
              {safeRange?.locked && (
                <div className="motion-option-lock-note">Safe range only.</div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </details>
  </div>
  );
};
