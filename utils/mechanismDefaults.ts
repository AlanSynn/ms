import type { MechanismConfig, ProjectState } from "../types";
import { SCENE_PX_PER_MM } from "./coordinates";
import { FABRICATION_GEAR_SPECS, FABRICATION_RING_GEAR_SPEC } from "./fabricationContract";
import {
  defaultCamProfileSamples,
  gearTrainOutputRatio,
  planetaryCarrierOutputRatio,
  planetaryPlanetSpinRatio,
} from "./kinematics";
import { compileMechanismGraphFabrication } from "./mechanismCompiler";
import { REFERENCE_DEFAULTS } from "./mechanismReference";

const mechanismUid = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

const DEFAULT_DRIVE_GEAR_RADIUS = REFERENCE_DEFAULTS.gearTrain.driveRadius;
const DEFAULT_OUTPUT_GEAR_RADIUS = REFERENCE_DEFAULTS.gearTrain.outputRadius;
const defaultGearRadiusByTeeth = (teeth: number, fallbackMm: number) =>
  (FABRICATION_GEAR_SPECS.find((spec) => spec.teeth === teeth)?.pitchRadiusMm ??
    fallbackMm) * SCENE_PX_PER_MM;
const DEFAULT_PLANETARY_SUN_RADIUS = defaultGearRadiusByTeeth(
  FABRICATION_RING_GEAR_SPEC.compatibleSunTeeth,
  10,
);
const DEFAULT_PLANETARY_PLANET_RADIUS = defaultGearRadiusByTeeth(
  FABRICATION_RING_GEAR_SPEC.compatiblePlanetTeeth,
  30,
);
const DEFAULT_PLANETARY_CARRIER_RADIUS =
  DEFAULT_PLANETARY_SUN_RADIUS + DEFAULT_PLANETARY_PLANET_RADIUS;
export const DEFAULT_MECHANISM_ANCHOR = { x: -120, y: -40 } as const;

export const createDefaultMechanism = (
  type: MechanismConfig["type"] = "4bar",
  id = mechanismUid("mech"),
): MechanismConfig => ({
  id,
  type,
  visible: true,
  enabled: true,
  color:
    type === "5bar" ||
    type === "6bar" ||
    type === "gear" ||
    type === "gear_linkage" ||
    type === "planetary_gear" ||
    type === "rack-pinion"
      ? "#d97706"
      : type === "piston"
        ? "#059669"
        : type === "yoke" || type === "cam"
          ? "#f59e0b"
          : "#3b82f6",
  anchorX: DEFAULT_MECHANISM_ANCHOR.x,
  anchorY: DEFAULT_MECHANISM_ANCHOR.y,
  transform: {
    x: DEFAULT_MECHANISM_ANCHOR.x,
    y: DEFAULT_MECHANISM_ANCHOR.y,
    rotation: 0,
    scale: 1,
  },
  sceneAnchor: { ...DEFAULT_MECHANISM_ANCHOR },
  activeVisualPartIds: [],
  groundAngle: type === "cam" || type === "rack-pinion" ? 90 : 0,
  groundLength:
    type === "gear"
      ? DEFAULT_DRIVE_GEAR_RADIUS + DEFAULT_OUTPUT_GEAR_RADIUS
      : type === "gear_linkage"
        ? REFERENCE_DEFAULTS.gearLinkage.centerDistance
        : type === "planetary_gear"
          ? DEFAULT_PLANETARY_CARRIER_RADIUS
          : type === "piston" ||
              type === "yoke" ||
              type === "cam" ||
              type === "rack-pinion"
            ? 0
            : REFERENCE_DEFAULTS.fourBar.ground,
  crankLength:
    type === "6bar"
      ? 55
      : type === "5bar"
        ? 60
        : type === "gear" || type === "gear_linkage"
          ? DEFAULT_DRIVE_GEAR_RADIUS
          : type === "planetary_gear"
            ? DEFAULT_PLANETARY_SUN_RADIUS
            : type === "piston"
              ? REFERENCE_DEFAULTS.sliderCrank.crank
              : type === "cam"
                ? REFERENCE_DEFAULTS.cam.radius
                : type === "rack-pinion"
                  ? 42
                  : REFERENCE_DEFAULTS.fourBar.input,
  couplerLength:
    type === "6bar"
      ? 145
      : type === "piston"
        ? REFERENCE_DEFAULTS.sliderCrank.rod
        : type === "gear_linkage"
          ? REFERENCE_DEFAULTS.gearLinkage.outputLinkage
          : type === "yoke" ||
              type === "cam" ||
              type === "gear" ||
              type === "planetary_gear" ||
              type === "rack-pinion"
            ? 0
            : REFERENCE_DEFAULTS.fourBar.coupler,
  rockerLength:
    type === "6bar"
      ? 110
      : type === "5bar"
        ? 48
        : type === "quick-return"
          ? 130
          : type === "gear" || type === "gear_linkage"
            ? DEFAULT_OUTPUT_GEAR_RADIUS
            : type === "planetary_gear"
              ? DEFAULT_PLANETARY_PLANET_RADIUS
              : type === "cam"
                ? REFERENCE_DEFAULTS.cam.followerTravel
                : type === "rack-pinion"
                  ? 380
                  : type === "piston"
                    ? 0
                    : REFERENCE_DEFAULTS.fourBar.output,
  sliderOffset:
    type === "piston"
      ? REFERENCE_DEFAULTS.sliderCrank.guideOffset
      : type === "rack-pinion"
        ? 56
        : type === "cam"
          ? REFERENCE_DEFAULTS.cam.followerRadius
          : 0,
  couplerPointDist:
    type === "6bar"
      ? 100
      : type === "5bar"
        ? 90
        : type === "gear_linkage"
          ? REFERENCE_DEFAULTS.gearLinkage.handleRadius
          : type === "planetary_gear"
            ? REFERENCE_DEFAULTS.planetary.carrierRadius
            : type === "rack-pinion"
              ? 70
              : 78,
  couplerPointAngle:
    type === "piston" ||
    type === "yoke" ||
    type === "cam" ||
    type === "rack-pinion"
      ? 0
      : 40,
  assemblyMode: type === "4bar" || type === "6bar" ? "open" : undefined,
  speed1: 1,
  speed2:
    type === "5bar"
      ? -2
      : type === "gear" || type === "gear_linkage"
        ? gearTrainOutputRatio([
            DEFAULT_DRIVE_GEAR_RADIUS,
            DEFAULT_OUTPUT_GEAR_RADIUS,
          ])
        : type === "planetary_gear"
          ? planetaryPlanetSpinRatio(
              DEFAULT_PLANETARY_SUN_RADIUS,
              DEFAULT_PLANETARY_PLANET_RADIUS,
            )
          : 1,
  gearRatio:
    type === "gear" || type === "gear_linkage"
      ? gearTrainOutputRatio([
          DEFAULT_DRIVE_GEAR_RADIUS,
          DEFAULT_OUTPUT_GEAR_RADIUS,
        ])
      : type === "planetary_gear"
        ? planetaryCarrierOutputRatio(
            DEFAULT_PLANETARY_SUN_RADIUS,
            DEFAULT_PLANETARY_PLANET_RADIUS,
          )
        : undefined,
  gearTrainRadii:
    type === "gear" || type === "gear_linkage"
      ? [DEFAULT_DRIVE_GEAR_RADIUS, DEFAULT_OUTPUT_GEAR_RADIUS]
      : undefined,
  camProfileSamples: type === "cam" ? defaultCamProfileSamples() : undefined,
  driverGroupId: "driver-1",
  driverPhaseOffset: 0,
  rodLength:
    type === "6bar"
      ? 95
      : type === "piston"
        ? REFERENCE_DEFAULTS.sliderCrank.rod
        : 110,
  phase: 0,
  source: "manual",
  presetId: "balanced",
  recommendation: "balanced default",
  warnings: [],
});

export const foundryPreviewFromProject = (
  project: ProjectState,
): MechanismConfig => {
  const mechanism =
    project.mechanisms.find((item) => item.id === project.selectedMechanismId) ??
    project.mechanisms[0];
  return mechanism
    ? { ...mechanism, id: "foundry-preview" }
    : createDefaultMechanism("4bar", "foundry-preview");
};

export const mechanismRequiredParts = (
  mechanism: Pick<MechanismConfig, "type"> & Partial<MechanismConfig>,
) => {
  const compiled = compileMechanismGraphFabrication({
    ...createDefaultMechanism(mechanism.type, `required-parts-${mechanism.type}`),
    ...mechanism,
  });
  if (compiled.recipe) return compiled.recipe.requiredParts;
  const blocker = compiled.blocker ?? "Graph compiler blocked this mechanism";
  return [
    {
      name: `Fix: ${blocker}`,
      label: blocker,
      key: "compiler-blocker",
      category: "blocker" as const,
      quantity: 1,
    },
  ];
};
