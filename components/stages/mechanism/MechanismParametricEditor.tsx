import React, { useMemo, useRef } from "react";

import type {
  ConnectionSelectionRole,
  MechanismConfig,
  PhysicalKitSettings,
} from "../../../types";
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
  gearTrainResolvedCenterDistance,
  normalizeCamProfileSamples,
} from "../../../utils/kinematics";
import {
  mechanismMotionCompletes,
  safeMechanismUpdate,
} from "./mechanismParamPolicy";
import {
  connectionSelectionAccepted,
  normalizeMechanismConnectionSelections,
} from "../../../utils/mechanismConnectionSelections";

type FabricationGearOption = (typeof FABRICATION_GEAR_SPECS)[number];
type FabricationLinkageOption = (typeof FABRICATION_LINKAGE_SPECS)[number];

const defaultKitPitchMm = () => FABRICATION_LINKAGE_SPECS[0]?.pitchMm ?? 20;
const kitGridPitchMm = (kit?: PhysicalKitSettings) =>
  Math.max(1, kit?.gridPitchMm ?? defaultKitPitchMm());
const gearSpecForSceneRadius = (radius: number) =>
  fabricationGearSpecForPitchRadius(Math.abs(radius) / SCENE_PX_PER_MM);
const gearSceneRadiusForKey = (
  key: string,
  specs: readonly FabricationGearOption[] = FABRICATION_GEAR_SPECS,
) =>
  (
    specs.find((spec) => spec.key === key) ??
    specs[1] ??
    specs[0] ??
    FABRICATION_GEAR_SPECS[0]
  ).pitchRadiusMm * SCENE_PX_PER_MM;
const linkageSceneLengthForCells = (cells: number) =>
  (FABRICATION_LINKAGE_SPECS.find((spec) => spec.cells === cells) ?? FABRICATION_LINKAGE_SPECS[0]).lengthMm * SCENE_PX_PER_MM;
const linkageCellsForSceneLength = (length: number) =>
  fabricationLinkageSpecForSceneLength(length).cells;
const gearOptionLabel = (teeth: number) => `${teeth} teeth`;
const linkageOptionLabel = (holeCount: number) => `${holeCount}-hole`;
const connectionRoleLabel = (role: ConnectionSelectionRole): string => {
  switch (role) {
    case "4bar.input-joint":
      return "Input joint";
    case "4bar.output-joint":
      return "Output joint";
    case "gear_linkage.drive-pin":
      return "Drive pin";
    case "gear_linkage.output-pin":
      return "Output pin";
  }
};
type SafeOption<T> = { item: T; working: boolean; current: boolean };
const unsafeOptionLabel = (label: string, current: boolean) =>
  current ? `${label} · current` : `${label} · locked`;

export const MechanismParametricEditor = ({
  mechanism,
  kit,
  onChange,
  testId,
}: {
  mechanism: MechanismConfig;
  kit?: PhysicalKitSettings;
  onChange: (updates: Partial<MechanismConfig>) => void;
  testId?: string;
}) => {
  const kitPitchMm = kitGridPitchMm(kit);
  const gearSpecs = FABRICATION_GEAR_SPECS;
  const linkageSpecs = FABRICATION_LINKAGE_SPECS;
  const radii =
    mechanism.type === "gear" || mechanism.type === "gear_linkage"
      ? gearTrainPitchRadii(mechanism)
      : [];
  const withResolvedGearGround = (updates: Partial<MechanismConfig>) => {
    if (mechanism.type !== "gear" && mechanism.type !== "gear_linkage")
      return updates;
    const nextMechanism = { ...mechanism, ...updates };
    return {
      ...updates,
      groundLength: gearTrainResolvedCenterDistance(nextMechanism),
    } satisfies Partial<MechanismConfig>;
  };
  const gearRadiusUpdates = (index: number, key: string) => {
    const next =
      radii.length >= 2
        ? [...radii]
        : [mechanism.crankLength, mechanism.rockerLength];
    next[index] = gearSceneRadiusForKey(key, gearSpecs);
    return withResolvedGearGround({
      crankLength: next[0],
      rockerLength: next.at(-1) ?? next[0],
      gearTrainRadii: next,
    });
  };
  const updateGearRadius = (index: number, key: string) => {
    const updates = gearRadiusUpdates(index, key);
    const endpointGearEdit =
      mechanism.type === "gear_linkage" &&
      (index === 0 || index === Math.max(0, radii.length - 1));
    if (!endpointGearEdit && !safeMechanismUpdate(mechanism, updates, kit)) return;
    onChange(updates);
  };
  const idlerGearUpdatesForKey = (key: string) => {
    const next =
      radii.length >= 2
        ? [...radii]
        : [mechanism.crankLength, mechanism.rockerLength];
    next.splice(
      Math.max(1, next.length - 1),
      0,
      gearSceneRadiusForKey(key, gearSpecs),
    );
    return withResolvedGearGround({
      crankLength: next[0],
      rockerLength: next.at(-1) ?? next[0],
      gearTrainRadii: next,
    });
  };
  const idlerGearOptions = gearSpecs.map((spec) => ({
    key: spec.key,
    updates: idlerGearUpdatesForKey(spec.key),
  })).filter(({ updates }) => safeMechanismUpdate(mechanism, updates, kit));
  const idlerGearUpdates = () =>
    idlerGearOptions.find((option) => option.key === "g24")?.updates ??
    idlerGearOptions[0]?.updates ??
    idlerGearUpdatesForKey("g24");
  const addIdlerGear = () => {
    const updates = idlerGearUpdates();
    if (!safeMechanismUpdate(mechanism, updates, kit)) return;
    onChange(updates);
  };
  const removeIdlerGear = () => {
    if (radii.length <= 2) return;
    const next = [...radii];
    next.splice(next.length - 2, 1);
    onChange(
      withResolvedGearGround({
        crankLength: next[0],
        rockerLength: next.at(-1) ?? next[0],
        gearTrainRadii: next,
      }),
    );
  };
  const renderGearControls =
    radii.length >= 2 &&
    (mechanism.type === "gear" || mechanism.type === "gear_linkage");
  const renderLinkageControls =
    mechanism.type === "4bar" || mechanism.type === "gear_linkage";
  const endpointGearOptions =
    mechanism.type === "gear_linkage"
      ? gearSpecs.filter(
          (spec) => spec.attachmentHoleCentersMm.length > 0,
        )
      : gearSpecs;
  const safeLinkageOptions = (
    key: "crankLength" | "couplerLength" | "rockerLength",
  ): SafeOption<FabricationLinkageOption>[] => {
    const currentCells = linkageCellsForSceneLength(
      Number(mechanism[key] ?? 0),
    );
    return linkageSpecs.map((spec) => {
      const updates = {
        [key]: linkageSceneLengthForCells(spec.cells),
      } as Partial<MechanismConfig>;
      const current = spec.cells === currentCells;
      return {
        item: spec,
        current,
        working: current
          ? mechanismMotionCompletes(mechanism)
          : safeMechanismUpdate(mechanism, updates, kit),
      };
    });
  };
  const safeGearOptions = (
    index: number,
    options: readonly FabricationGearOption[],
    selected: string,
  ): SafeOption<FabricationGearOption>[] =>
    options.map((spec) => {
      const current = spec.key === selected;
      return {
        item: spec,
        current,
        working: current
          ? mechanismMotionCompletes(mechanism)
          : safeMechanismUpdate(
              mechanism,
              gearRadiusUpdates(index, spec.key),
              kit,
            ),
      };
    });
  const pairedLinkOptions = (): SafeOption<
    FabricationLinkageOption
  >[] => {
    const currentCells = linkageCellsForSceneLength(
      mechanism.couplerLength,
    );
    return linkageSpecs.map((spec) => {
      const updates = {
        couplerLength: linkageSceneLengthForCells(spec.cells),
      };
      const current = spec.cells === currentCells;
      return {
        item: spec,
        current,
        working: current
          ? mechanismMotionCompletes(mechanism)
          : safeMechanismUpdate(mechanism, updates, kit),
      };
    });
  };
  const linkageLockCount =
    mechanism.type === "4bar"
      ? (["crankLength", "couplerLength", "rockerLength"] as const)
          .flatMap((key) => safeLinkageOptions(key))
          .filter((option) => !option.working).length
      : mechanism.type === "gear_linkage"
        ? pairedLinkOptions().filter((option) => !option.working).length
        : 0;
  const gearLockCount = renderGearControls
    ? radii.reduce((count, radius, index) => {
        const isOutput = index === radii.length - 1;
        const options =
          mechanism.type === "gear_linkage" && (index === 0 || isOutput)
            ? endpointGearOptions
            : gearSpecs;
        return (
          count +
          safeGearOptions(
            index,
            options,
            gearSpecForSceneRadius(radius).key,
          ).filter((option) => !option.working).length
        );
      }, 0)
    : 0;
  const hasLockedMotionOptions = linkageLockCount + gearLockCount > 0;
  const connectionState = useMemo(
    () =>
      normalizeMechanismConnectionSelections(
        mechanism,
        mechanism.connectionSelections,
        mechanism.connectionSelectionValidation,
      ),
    [mechanism],
  );
  const connectionConfirmations = Object.entries(connectionState.connectionSelections ?? {}).map(([role, selection]) => ({
    role,
    label: connectionRoleLabel(role as ConnectionSelectionRole),
    part: selection.kind === "linkage-hole" ? selection.linkageKey : selection.gearKey,
    hole: selection.holeIndex,
  }));
  const acceptedFourBarInput =
    mechanism.type === "4bar" &&
    connectionSelectionAccepted(
      connectionState.connectionSelectionValidation,
      "4bar.input-joint",
    );
  const acceptedFourBarOutput =
    mechanism.type === "4bar" &&
    connectionSelectionAccepted(
      connectionState.connectionSelectionValidation,
      "4bar.output-joint",
    );
  const canAddIdlerGear = idlerGearOptions.length > 0;
  if (!renderGearControls && !renderLinkageControls && mechanism.type !== "cam")
    return null;
  return (
    <div
      className="inspector-control-card compact-parametric-editor"
      data-testid={testId ?? "mechanism-parametric-editor"}
      data-kit-grid-pitch-mm={kitPitchMm}
      data-link-option-scene-lengths={linkageSpecs
        .map((spec) => spec.lengthMm * SCENE_PX_PER_MM)
        .join(",")}
      data-gear-option-scene-radii={gearSpecs
        .map((spec) => spec.pitchRadiusMm * SCENE_PX_PER_MM)
        .join(",")}
    >
      {connectionConfirmations.length > 0 && (
        <div className="mb-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-black uppercase tracking-wider text-blue-700">
          {connectionConfirmations.map((item) => (
            <div key={item.role}>
              {item.label}: {item.part} #{item.hole}
            </div>
          ))}
        </div>
      )}
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
                : gearSpecs;
            const selected = gearSpecForSceneRadius(radius).key;
            const safeOptions = safeGearOptions(index, options, selected);
            const activeValue = safeOptions.some(
              (option) => option.item.key === selected,
            )
              ? selected
              : safeOptions[0]?.item.key;
            const lockedCount = safeOptions.filter(
              (option) => !option.working,
            ).length;
            return (
              <label
                key={`${label}-${index}`}
                className="block text-xs font-black uppercase tracking-wider text-slate-500"
                data-locked-motion-options={lockedCount}
              >
                <span>{label.replace(" size", "")}</span>
                <select
                  aria-label={label}
                  className="field mt-1"
                  value={activeValue}
                  data-motion-safe-options={
                    safeOptions.filter((option) => option.working).length
                  }
                  data-locked-motion-options={lockedCount}
                  onChange={(event) =>
                    updateGearRadius(index, event.target.value)
                  }
                >
                  {safeOptions.map(({ item: spec, working, current }) => (
                    <option
                      key={spec.key}
                      value={spec.key}
                      disabled={!working && !current}
                      data-motion-safe={working ? "true" : "false"}
                    >
                      {working
                        ? gearOptionLabel(spec.teeth)
                        : unsafeOptionLabel(
                            gearOptionLabel(spec.teeth),
                            current,
                          )}
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
              disabled={!canAddIdlerGear}
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
          <div className="section-title">Link holes</div>
          {mechanism.type === "4bar" &&
            (
              [
                ["Input link length", "crankLength"],
                ["Coupler link length", "couplerLength"],
                ["Output link length", "rockerLength"],
              ] as const
            ).map(([label, key]) => {
              const safeOptions = safeLinkageOptions(key);
              const currentValue = linkageCellsForSceneLength(
                Number(mechanism[key] ?? 0),
              );
              const lockedCount = safeOptions.filter(
                (option) => !option.working,
              ).length;
              const connectionLocked =
                (key === "crankLength" && acceptedFourBarInput) ||
                (key === "rockerLength" && acceptedFourBarOutput);
              return (
                <label
                  key={key}
                  className="block text-xs font-black uppercase tracking-wider text-slate-500"
                  data-locked-motion-options={lockedCount}
                >
                  <span>{label.replace(" length", "")}</span>
                  <select
                    aria-label={label}
                    className="field mt-1"
                    value={currentValue}
                    data-motion-safe-options={
                      safeOptions.filter((option) => option.working).length
                    }
                    data-locked-motion-options={lockedCount}
                    disabled={connectionLocked}
                    onChange={(event) => {
                      if (connectionLocked) return;
                      const updates = {
                        [key]: linkageSceneLengthForCells(
                          Number(event.target.value),
                        ),
                      } as Partial<MechanismConfig>;
                      if (!safeMechanismUpdate(mechanism, updates, kit)) return;
                      onChange(updates);
                    }}
                  >
                    {safeOptions.map(({ item: spec, working, current }) => {
                      const labelText = linkageOptionLabel(
                        spec.holeCentersMm.length,
                      );
                      return (
                        <option
                          key={spec.key}
                          value={spec.cells}
                          disabled={!working && !current}
                          data-motion-safe={working ? "true" : "false"}
                        >
                          {working
                            ? labelText
                            : unsafeOptionLabel(labelText, current)}
                        </option>
                      );
                    })}
                  </select>
                </label>
              );
            })}
          {mechanism.type === "gear_linkage" && (
            <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
              <span>Paired links</span>
              <select
                aria-label="Paired link length"
                className="field mt-1"
                value={linkageCellsForSceneLength(
                  mechanism.couplerLength,
                )}
                data-motion-safe-options={
                  pairedLinkOptions().filter((option) => option.working).length
                }
                data-locked-motion-options={
                  pairedLinkOptions().filter((option) => !option.working).length
                }
                onChange={(event) => {
                  const updates = {
                    couplerLength: linkageSceneLengthForCells(
                      Number(event.target.value),
                    ),
                  };
                  if (!safeMechanismUpdate(mechanism, updates, kit)) return;
                  onChange(updates);
                }}
              >
                {pairedLinkOptions().map(({ item: spec, working, current }) => {
                  const labelText = linkageOptionLabel(
                    spec.holeCentersMm.length,
                  );
                  return (
                    <option
                      key={spec.key}
                      value={spec.cells}
                      disabled={!working && !current}
                      data-motion-safe={working ? "true" : "false"}
                    >
                      {working
                        ? labelText
                        : unsafeOptionLabel(labelText, current)}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          {hasLockedMotionOptions && (
            <div
              className="motion-option-lock-note"
              data-testid="mechanism-motion-option-locks"
            >
              Locked choices may jam.
            </div>
          )}
        </div>
      )}
      {mechanism.type === "cam" && (
        <div className="mt-3">
          <CamProfileEditor
            mechanism={mechanism}
            kit={kit}
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
  mechanism,
  kit,
  samples,
  onChange,
}: {
  mechanism: MechanismConfig;
  kit?: PhysicalKitSettings;
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
  const commitProfile = (nextProfile: number[]) => {
    if (
      !safeMechanismUpdate(mechanism, { camProfileSamples: nextProfile }, kit)
    )
      return;
    onChange(nextProfile);
  };
  const updatePoint = (index: number, value: number) =>
    commitProfile(
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
          onClick={() =>
            commitProfile(defaultCamProfileSamples(profile.length))
          }
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
      <div className="motion-option-lock-note mt-2">Safe profile only.</div>
    </div>
  );
};
