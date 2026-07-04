import React, { useMemo, useRef } from "react";

import type { MechanismConfig } from "../../../types";
import { SCENE_PX_PER_MM } from "../../../utils/coordinates";
import {
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
  fabricationGearSpecForPitchRadius,
  fabricationLinkageSpecForSceneLength,
} from "../../../utils/fabrication";
import {
  defaultCamProfileSamples,
  gearTrainPitchRadii,
  normalizeCamProfileSamples,
} from "../../../utils/kinematics";

const gearSpecForSceneRadius = (radius: number) =>
  fabricationGearSpecForPitchRadius(Math.abs(radius) / SCENE_PX_PER_MM);
const gearSceneRadiusForKey = (key: string) =>
  (
    FABRICATION_GEAR_SPECS.find((spec) => spec.key === key) ??
    FABRICATION_GEAR_SPECS[1]
  ).pitchRadiusMm * SCENE_PX_PER_MM;
const linkageSceneLengthForCells = (cells: number) =>
  (
    FABRICATION_LINKAGE_SPECS.find((spec) => spec.cells === cells) ??
    FABRICATION_LINKAGE_SPECS[1]
  ).lengthMm * SCENE_PX_PER_MM;
const linkageCellsForSceneLength = (length: number) =>
  fabricationLinkageSpecForSceneLength(length).cells;
const gearOptionLabel = (teeth: number) => `${teeth} teeth`;

export const MechanismParametricEditor = ({
  mechanism,
  onChange,
  testId,
}: {
  mechanism: MechanismConfig;
  onChange: (updates: Partial<MechanismConfig>) => void;
  testId?: string;
}) => {
  const radii =
    mechanism.type === "gear" || mechanism.type === "gear_linkage"
      ? gearTrainPitchRadii(mechanism)
      : [];
  const updateGearRadius = (index: number, key: string) => {
    const next =
      radii.length >= 2
        ? [...radii]
        : [mechanism.crankLength, mechanism.rockerLength];
    next[index] = gearSceneRadiusForKey(key);
    onChange({
      crankLength: next[0],
      rockerLength: next.at(-1) ?? next[0],
      gearTrainRadii: next,
    });
  };
  const addIdlerGear = () => {
    const next =
      radii.length >= 2
        ? [...radii]
        : [mechanism.crankLength, mechanism.rockerLength];
    next.splice(Math.max(1, next.length - 1), 0, gearSceneRadiusForKey("g24"));
    onChange({
      crankLength: next[0],
      rockerLength: next.at(-1) ?? next[0],
      gearTrainRadii: next,
    });
  };
  const removeIdlerGear = () => {
    if (radii.length <= 2) return;
    const next = [...radii];
    next.splice(next.length - 2, 1);
    onChange({
      crankLength: next[0],
      rockerLength: next.at(-1) ?? next[0],
      gearTrainRadii: next,
    });
  };
  const renderGearControls =
    radii.length >= 2 &&
    (mechanism.type === "gear" || mechanism.type === "gear_linkage");
  const renderLinkageControls =
    mechanism.type === "4bar" || mechanism.type === "gear_linkage";
  const endpointGearOptions =
    mechanism.type === "gear_linkage"
      ? FABRICATION_GEAR_SPECS.filter(
          (spec) => spec.attachmentHoleCentersMm.length > 0,
        )
      : FABRICATION_GEAR_SPECS;
  if (!renderGearControls && !renderLinkageControls && mechanism.type !== "cam")
    return null;
  return (
    <div
      className="inspector-control-card compact-parametric-editor"
      data-testid={testId ?? "mechanism-parametric-editor"}
    >
      {renderGearControls && (
        <div className="space-y-2">
          <div className="section-title">Gear sizes</div>
          {radii.map((radius, index) => {
            const isOutput = index === radii.length - 1;
            const label =
              index === 0
                ? "Drive gear size"
                : isOutput
                  ? "Output gear size"
                  : `Idler gear ${index} size`;
            const options =
              mechanism.type === "gear_linkage" && (index === 0 || isOutput)
                ? endpointGearOptions
                : FABRICATION_GEAR_SPECS;
            const selected = gearSpecForSceneRadius(radius).key;
            return (
              <label
                key={`${label}-${index}`}
                className="block text-xs font-black uppercase tracking-wider text-slate-500"
              >
                <span>{label.replace(" size", "")}</span>
                <select
                  aria-label={label}
                  className="field mt-1"
                  value={
                    options.some((spec) => spec.key === selected)
                      ? selected
                      : options[0].key
                  }
                  onChange={(event) =>
                    updateGearRadius(index, event.target.value)
                  }
                >
                  {options.map((spec) => (
                    <option key={spec.key} value={spec.key}>
                      {gearOptionLabel(spec.teeth)}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              aria-label="Add idler gear"
              onClick={addIdlerGear}
            >
              + idler
            </button>
            <button
              type="button"
              className="btn-secondary"
              aria-label="Remove idler gear"
              disabled={radii.length <= 2}
              onClick={removeIdlerGear}
            >
              − idler
            </button>
          </div>
        </div>
      )}
      {renderLinkageControls && (
        <div className="mt-3 space-y-2">
          <div className="section-title">Link sizes</div>
          {mechanism.type === "4bar" &&
            (
              [
                ["Input link length", "crankLength"],
                ["Coupler link length", "couplerLength"],
                ["Output link length", "rockerLength"],
              ] as const
            ).map(([label, key]) => (
              <label
                key={key}
                className="block text-xs font-black uppercase tracking-wider text-slate-500"
              >
                <span>{label.replace(" length", "")}</span>
                <select
                  aria-label={label}
                  className="field mt-1"
                  value={linkageCellsForSceneLength(
                    Number(mechanism[key] ?? 0),
                  )}
                  onChange={(event) =>
                    onChange({
                      [key]: linkageSceneLengthForCells(
                        Number(event.target.value),
                      ),
                    } as Partial<MechanismConfig>)
                  }
                >
                  {FABRICATION_LINKAGE_SPECS.map((spec) => (
                    <option key={spec.key} value={spec.cells}>
                      {spec.cells}-cell
                    </option>
                  ))}
                </select>
              </label>
            ))}
          {mechanism.type === "gear_linkage" && (
            <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
              <span>Paired links</span>
              <select
                aria-label="Paired link length"
                className="field mt-1"
                value={linkageCellsForSceneLength(mechanism.couplerLength)}
                onChange={(event) =>
                  onChange({
                    couplerLength: linkageSceneLengthForCells(
                      Number(event.target.value),
                    ),
                  })
                }
              >
                {FABRICATION_LINKAGE_SPECS.map((spec) => (
                  <option key={spec.key} value={spec.cells}>
                    {spec.cells}-cell
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {mechanism.type === "cam" && (
        <div className="mt-3">
          <CamProfileEditor
            samples={mechanism.camProfileSamples}
            onChange={(camProfileSamples) => onChange({ camProfileSamples })}
          />
        </div>
      )}
    </div>
  );
};

const CAM_PROFILE_MIN = 0.35;
const CAM_PROFILE_MAX = 1.65;
const clampCamProfileSample = (value: number) =>
  Math.max(CAM_PROFILE_MIN, Math.min(CAM_PROFILE_MAX, value));
const CamProfileEditor = ({
  samples,
  onChange,
}: {
  samples?: number[];
  onChange: (samples: number[]) => void;
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const activeIndexRef = useRef<number | null>(null);
  const profile = useMemo(() => normalizeCamProfileSamples(samples), [samples]);
  const width = 240;
  const height = 88;
  const pad = 12;
  const sampleToY = (value: number) =>
    pad +
    (1 - (value - CAM_PROFILE_MIN) / (CAM_PROFILE_MAX - CAM_PROFILE_MIN)) *
      (height - pad * 2);
  const pointX = (index: number) =>
    pad + (index / Math.max(1, profile.length - 1)) * (width - pad * 2);
  const eventIndex = (event: React.PointerEvent<SVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return activeIndexRef.current ?? 0;
    const t = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)),
    );
    return Math.max(
      0,
      Math.min(profile.length - 1, Math.round(t * (profile.length - 1))),
    );
  };
  const eventValue = (event: React.PointerEvent<SVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return profile[activeIndexRef.current ?? 0] ?? 1;
    const t = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)),
    );
    return clampCamProfileSample(
      CAM_PROFILE_MAX - t * (CAM_PROFILE_MAX - CAM_PROFILE_MIN),
    );
  };
  const updatePoint = (index: number, value: number) =>
    onChange(
      profile.map((sample, sampleIndex) =>
        sampleIndex === index ? clampCamProfileSample(value) : sample,
      ),
    );
  const profilePath = profile
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"} ${pointX(index).toFixed(1)} ${sampleToY(value).toFixed(1)}`,
    )
    .join(" ");
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white/80 p-3"
      data-testid="cam-profile-editor"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="section-title">Cam profile</div>
        <button
          type="button"
          className="btn-secondary compact"
          data-testid="cam-profile-reset"
          onClick={() => onChange(defaultCamProfileSamples(profile.length))}
        >
          Reset
        </button>
      </div>
      <svg
        ref={svgRef}
        data-testid="cam-profile-canvas"
        className="w-full touch-none rounded-xl bg-slate-50"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Editable cam lift profile"
        onPointerDown={(event) => {
          event.preventDefault();
          const index = eventIndex(event);
          activeIndexRef.current = index;
          event.currentTarget.setPointerCapture(event.pointerId);
          updatePoint(index, eventValue(event));
        }}
        onPointerMove={(event) => {
          const index = activeIndexRef.current;
          if (index === null) return;
          event.preventDefault();
          updatePoint(index, eventValue(event));
        }}
        onPointerUp={() => {
          activeIndexRef.current = null;
        }}
        onPointerLeave={() => {
          activeIndexRef.current = null;
        }}
      >
        <path
          d={`M ${pad} ${height - pad} H ${width - pad}`}
          stroke="#cbd5e1"
          strokeWidth="2"
        />
        <path
          d={profilePath}
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {profile.map((value, index) => (
          <circle
            key={index}
            data-testid={`cam-profile-point-${index}`}
            cx={pointX(index)}
            cy={sampleToY(value)}
            r={5}
            fill="#ffffff"
            stroke="#4f46e5"
            strokeWidth="2"
            onPointerDown={(event) => {
              event.preventDefault();
              activeIndexRef.current = index;
              event.currentTarget.setPointerCapture(event.pointerId);
              updatePoint(index, eventValue(event));
            }}
          />
        ))}
      </svg>
    </div>
  );
};

