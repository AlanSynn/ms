import React from "react";
import type { MechanismConfig, MechanismType } from "../../../types";
import {
  FOUNDRY_MECHANISM_TYPES,
  FOUNDRY_PRESETS,
  mechanismTemplateLabel,
} from "../../../utils/mechanismTemplates";
import { MiniNumber } from "../../ui/InspectorControls";
import { MechanismParametricEditor } from "../mechanism/MechanismParametricEditor";
import {
  MECHANISM_PARAM_META,
  shouldShowMechanismParam,
} from "../mechanism/mechanismParamPolicy";

export const FoundryInspectorPanel = ({
  foundry,
  libraryLabel,
  physicsRule,
  velocityMagnitude,
  forceMagnitude,
  simulationFriction,
  constraintError,
  simulationMassKg,
  foundryRigOpacity,
  foundryExplode,
  showForces,
  showVelocity,
  showTrail,
  showPathPreview,
  showSensemaking,
  onRigOpacityChange,
  onExplodeChange,
  onUpdateParams,
  onChangeParam,
  onSetMechanismType,
  onSetPreset,
  onToggleForces,
  onToggleVelocity,
  onToggleTrail,
  onTogglePathPreview,
  onToggleSensemaking,
  onHideSensemaking,
}: {
  foundry: MechanismConfig;
  libraryLabel: string;
  physicsRule: string;
  velocityMagnitude: number;
  forceMagnitude: number;
  simulationFriction: number;
  constraintError: number;
  simulationMassKg: number;
  foundryRigOpacity: number;
  foundryExplode: number;
  showForces: boolean;
  showVelocity: boolean;
  showTrail: boolean;
  showPathPreview: boolean;
  showSensemaking: boolean;
  onRigOpacityChange: (value: number) => void;
  onExplodeChange: (value: number) => void;
  onUpdateParams: (updates: Partial<MechanismConfig>) => void;
  onChangeParam: (key: keyof MechanismConfig, value: number) => void;
  onSetMechanismType: (type: MechanismType) => void;
  onSetPreset: (presetId: string) => void;
  onToggleForces: () => void;
  onToggleVelocity: () => void;
  onToggleTrail: () => void;
  onTogglePathPreview: () => void;
  onToggleSensemaking: () => void;
  onHideSensemaking: () => void;
}) => (
  <div className="stage-pane-stack">
    <div>
      <div className="section-title">Selected mechanism</div>
      <h3>{libraryLabel}</h3>
      <div
        className="physics-readout mt-3"
        data-testid="foundry-physics-readout"
      >
        <strong>Motion</strong>
        <span>{physicsRule}</span>
        <span>
          v {velocityMagnitude.toFixed(1)} · F {forceMagnitude.toFixed(1)} · μ{" "}
          {simulationFriction.toFixed(2)}
        </span>
        <span>
          constraint err {constraintError.toFixed(2)} · mass{" "}
          {simulationMassKg.toFixed(1)}kg
        </span>
      </div>
    </div>
    <div
      className="foundry-opacity-panel inspector-control-card"
      data-testid="foundry-opacity-panel"
    >
      <div>
        <span>Rig Opacity</span>
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
        <span>Exploded view</span>
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
    <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
      <div className="font-bold text-slate-800">Preview overlays</div>
      <div className="foundry-toolbar mt-2">
        <button
          type="button"
          className={`btn-secondary ${showForces ? "active" : ""}`}
          aria-pressed={showForces}
          onClick={onToggleForces}
        >
          Forces
        </button>
        <button
          type="button"
          className={`btn-secondary ${showVelocity ? "active" : ""}`}
          aria-pressed={showVelocity}
          onClick={onToggleVelocity}
        >
          Velocity
        </button>
        <button
          type="button"
          className={`btn-secondary ${showTrail ? "active" : ""}`}
          aria-pressed={showTrail}
          onClick={onToggleTrail}
        >
          Trail
        </button>
        <button
          type="button"
          className={`btn-secondary ${showPathPreview ? "active" : ""}`}
          aria-pressed={showPathPreview}
          onClick={onTogglePathPreview}
        >
          Path
        </button>
        <button
          type="button"
          className={`btn-secondary ${showSensemaking ? "active" : ""}`}
          aria-label="Show details"
          aria-pressed={showSensemaking}
          onClick={onToggleSensemaking}
        >
          Details
        </button>
        <button
          type="button"
          className="btn-secondary"
          aria-label="Hide details"
          onClick={onHideSensemaking}
        >
          Hide details
        </button>
      </div>
    </div>
  </div>
);
