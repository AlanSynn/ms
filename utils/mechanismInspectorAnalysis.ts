import type {
  MechanismConfig,
  ProjectState,
} from "../types";
import {
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
  fabricationGearSpecForPitchRadius,
  fabricationLinkageSpecForSceneLength,
  fabricationStackSummary,
  readableFabricationStackSummary,
  sampleFeasibleRange,
} from "./fabrication";
import { SCENE_PX_PER_MM } from "./coordinates";
import { gearTrainPitchRadii } from "./kinematics";
import { mechanismBindingWarnings } from "./motion";

export type InspectorSemanticRevision = string;

const objectRevisions = new WeakMap<object, InspectorSemanticRevision>();
let nextRevision = 1;

/**
 * ProjectState and MechanismConfig are immutable accepted revisions. Identity
 * is therefore an exact semantic revision token without serializing a hot-path
 * object or using a collision-prone structural hash. Playback phase lives in
 * the separate clock and does not create a new token.
 */
export const inspectorSemanticRevisionFor = (
  value: object | undefined | null,
): InspectorSemanticRevision => {
  if (!value) return "inspector-null";
  const cached = objectRevisions.get(value);
  if (cached) return cached;
  const revision = `inspector-revision-${nextRevision++}`;
  objectRevisions.set(value, revision);
  return revision;
};

export const inspectorRevisionKey = (...values: readonly (object | undefined | null)[]) =>
  values.map(inspectorSemanticRevisionFor).join("|");

export class BoundedInspectorCache<T> {
  private readonly entries = new Map<string, T>();

  public constructor(private readonly capacity = 32) {}

  public get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  public set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  public clear() {
    this.entries.clear();
  }

  public get size() {
    return this.entries.size;
  }
}

const rangeCache = new BoundedInspectorCache<ReturnType<typeof sampleFeasibleRange>>();
const bindingCache = new BoundedInspectorCache<ReturnType<typeof mechanismBindingWarnings>>();

export const getInspectorFeasibleRange = (mechanism: MechanismConfig) => {
  const key = inspectorRevisionKey(mechanism);
  const cached = rangeCache.get(key);
  if (cached) return cached;
  const value = sampleFeasibleRange(mechanism);
  rangeCache.set(key, value);
  return value;
};

export const getInspectorBindingWarnings = (project: ProjectState) => {
  const key = inspectorRevisionKey(project);
  const cached = bindingCache.get(key);
  if (cached) return cached;
  const value = mechanismBindingWarnings(project);
  bindingCache.set(key, value);
  return value;
};

export type InspectorStackSummary = Readonly<{
  raw: string;
  readable: string;
}>;

const stackCache = new BoundedInspectorCache<InspectorStackSummary>();

export const getInspectorStackSummary = (
  mechanism: MechanismConfig,
): InspectorStackSummary => {
  const key = inspectorRevisionKey(mechanism);
  const cached = stackCache.get(key);
  if (cached) return cached;
  const value = Object.freeze({
    raw: fabricationStackSummary(mechanism),
    readable: readableFabricationStackSummary(mechanism),
  });
  stackCache.set(key, value);
  return value;
};

export type InspectorGearControl = Readonly<{
  index: number;
  label: string;
  selected: string;
  options: readonly (typeof FABRICATION_GEAR_SPECS)[number][];
}>;

export type InspectorLinkageControl = Readonly<{
  key: "crankLength" | "couplerLength" | "rockerLength";
  label: string;
  value: number;
  options: typeof FABRICATION_LINKAGE_SPECS;
}>;

export type InspectorParametricModel = Readonly<{
  radii: readonly number[];
  renderGearControls: boolean;
  renderLinkageControls: boolean;
  endpointGearOptions: readonly (typeof FABRICATION_GEAR_SPECS)[number][];
  gearControls: readonly InspectorGearControl[];
  linkageControls: readonly InspectorLinkageControl[];
  pairedLinkValue: number;
  pairedLinkOptions: typeof FABRICATION_LINKAGE_SPECS;
}>;

const gearSceneRadiusForKey = (key: string) =>
  (
    FABRICATION_GEAR_SPECS.find((spec) => spec.key === key) ??
    FABRICATION_GEAR_SPECS[1]
  ).pitchRadiusMm * SCENE_PX_PER_MM;

const linkageCellsForSceneLength = (length: number) =>
  fabricationLinkageSpecForSceneLength(length).cells;

const parametricCache = new BoundedInspectorCache<InspectorParametricModel>();

export const getInspectorParametricModel = (
  mechanism: MechanismConfig,
): InspectorParametricModel => {
  const key = inspectorRevisionKey(mechanism);
  const cached = parametricCache.get(key);
  if (cached) return cached;

  const radii =
    mechanism.type === "gear" || mechanism.type === "gear_linkage"
      ? gearTrainPitchRadii(mechanism)
      : [];
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
  const gearControls = renderGearControls
    ? radii.map((radius, index) => {
        const isOutput = index === radii.length - 1;
        const options =
          mechanism.type === "gear_linkage" && (index === 0 || isOutput)
            ? endpointGearOptions
            : FABRICATION_GEAR_SPECS;
        return {
          index,
          label:
            index === 0
              ? "Drive gear size"
              : isOutput
                ? "Output gear size"
                : `Idler gear ${index} size`,
          selected: fabricationGearSpecForPitchRadius(
            Math.abs(radius) / SCENE_PX_PER_MM,
          ).key,
          options,
        };
      })
    : [];
  const linkageControls =
    mechanism.type === "4bar"
      ? (
          [
            ["Input link length", "crankLength"],
            ["Coupler link length", "couplerLength"],
            ["Output link length", "rockerLength"],
          ] as const
        ).map(([label, key]) => ({
          label,
          key,
          value: linkageCellsForSceneLength(Number(mechanism[key] ?? 0)),
          options: FABRICATION_LINKAGE_SPECS,
        }))
      : [];
  const model = Object.freeze({
    radii,
    renderGearControls,
    renderLinkageControls,
    endpointGearOptions,
    gearControls,
    linkageControls,
    pairedLinkValue: linkageCellsForSceneLength(mechanism.couplerLength),
    pairedLinkOptions: FABRICATION_LINKAGE_SPECS,
  });
  parametricCache.set(key, model);
  return model;
};

export const clearInspectorAnalysisCaches = () => {
  rangeCache.clear();
  bindingCache.clear();
  stackCache.clear();
  parametricCache.clear();
};

export const inspectorAnalysisCacheSizes = () => ({
  ranges: rangeCache.size,
  bindings: bindingCache.size,
  stacks: stackCache.size,
  parametric: parametricCache.size,
});
