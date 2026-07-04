import type { MechanismConfig, MechanismType } from "../../../types";

export type MechanismParamMeta = {
  key: keyof MechanismConfig;
  label: string;
  min: number;
  max: number;
  step?: number;
};

export const MECHANISM_PARAM_META: MechanismParamMeta[] = [
  { key: "anchorX", label: "anchor X", min: -260, max: 260, step: 40 },
  { key: "anchorY", label: "anchor Y", min: -260, max: 260, step: 40 },
  { key: "groundAngle", label: "ground angle", min: -180, max: 180 },
  { key: "crankLength", label: "crank", min: 10, max: 180 },
  { key: "groundLength", label: "ground", min: 0, max: 280 },
  { key: "couplerLength", label: "coupler", min: 0, max: 320 },
  { key: "rockerLength", label: "rocker / gear", min: 0, max: 220 },
  { key: "sliderOffset", label: "slider offset", min: -120, max: 120 },
  { key: "couplerPointDist", label: "output dist", min: 0, max: 220 },
  { key: "couplerPointAngle", label: "output angle", min: -180, max: 180 },
  { key: "gearRatio", label: "gear ratio", min: -6, max: 6, step: 0.1 },
  { key: "rodLength", label: "rod length", min: 10, max: 260 },
  { key: "speed2", label: "second speed", min: -5, max: 5, step: 0.1 },
  { key: "phase", label: "phase", min: -3.14, max: 3.14, step: 0.01 },
];

const compactParametricKeys: Partial<
  Record<MechanismType, Array<keyof MechanismConfig>>
> = {
  "4bar": ["crankLength", "couplerLength", "rockerLength"],
  gear: [
    "crankLength",
    "rockerLength",
    "gearRatio",
    "gearTrainRadii",
    "groundLength",
    "couplerPointDist",
    "couplerPointAngle",
    "speed2",
  ],
  gear_linkage: [
    "crankLength",
    "rockerLength",
    "couplerLength",
    "gearRatio",
    "gearTrainRadii",
    "groundLength",
    "couplerPointDist",
    "couplerPointAngle",
    "speed2",
  ],
};

export const shouldShowMechanismParam = (
  type: MechanismType,
  key: keyof MechanismConfig,
) => {
  if (compactParametricKeys[type]?.includes(key)) return false;
  if (key === "speed2") return type === "5bar";
  if (key === "phase")
    return ["5bar", "gear", "gear_linkage", "planetary_gear"].includes(type);
  if (key === "gearRatio") return false;
  if (key === "rodLength") return ["5bar", "6bar", "piston"].includes(type);
  if (key === "groundLength")
    return ![
      "cam",
      "yoke",
      "rack-pinion",
      "gear",
      "gear_linkage",
      "planetary_gear",
    ].includes(type);
  if (key === "couplerLength")
    return !["cam", "gear", "planetary_gear", "yoke", "rack-pinion"].includes(
      type,
    );
  return true;
};

export const clampMechanismParam = (
  key: keyof MechanismConfig,
  value: number,
) => {
  const param = MECHANISM_PARAM_META.find((item) => item.key === key);
  if (!param) return value;
  return Math.max(param.min, Math.min(param.max, value));
};
