import type { MechanismConfig, MechanismType } from '../types';
import { sampleFeasibleRange } from './fabrication';

export type MechanismParamMeta = {
  key: keyof MechanismConfig;
  label: string;
  min: number;
  max: number;
  step?: number;
};

export const MECHANISM_PARAM_META: MechanismParamMeta[] = [
  { key: 'anchorX', label: 'anchor X', min: -260, max: 260, step: 40 },
  { key: 'anchorY', label: 'anchor Y', min: -260, max: 260, step: 40 },
  { key: 'groundAngle', label: 'ground angle', min: -180, max: 180 },
  { key: 'crankLength', label: 'crank', min: 10, max: 180 },
  { key: 'groundLength', label: 'ground', min: 0, max: 280 },
  { key: 'couplerLength', label: 'coupler', min: 0, max: 320 },
  { key: 'rockerLength', label: 'rocker / gear', min: 0, max: 220 },
  { key: 'sliderOffset', label: 'slider offset', min: -120, max: 120 },
  { key: 'couplerPointDist', label: 'output dist', min: 0, max: 220 },
  { key: 'couplerPointAngle', label: 'output angle', min: -180, max: 180 },
  { key: 'gearRatio', label: 'gear ratio', min: -6, max: 6, step: 0.1 },
  { key: 'rodLength', label: 'rod length', min: 10, max: 260 },
  { key: 'speed2', label: 'second speed', min: -5, max: 5, step: 0.1 },
  { key: 'phase', label: 'phase', min: -3.14, max: 3.14, step: 0.01 },
];

const compactParametricKeys: Partial<Record<MechanismType, Array<keyof MechanismConfig>>> = {
  '4bar': ['crankLength', 'couplerLength', 'rockerLength'],
  gear: [
    'crankLength',
    'rockerLength',
    'gearRatio',
    'gearTrainRadii',
    'groundLength',
    'couplerPointDist',
    'couplerPointAngle',
    'speed2',
  ],
  gear_linkage: [
    'crankLength',
    'rockerLength',
    'couplerLength',
    'gearRatio',
    'gearTrainRadii',
    'groundLength',
    'couplerPointDist',
    'couplerPointAngle',
    'speed2',
  ],
};

export const shouldShowMechanismParam = (type: MechanismType, key: keyof MechanismConfig) => {
  if (type === 'cam') return false;
  if (type === 'piston') return false;
  if (type === 'planetary_gear') return key === 'phase';
  if (compactParametricKeys[type]?.includes(key)) return false;
  if (key === 'speed2') return type === '5bar';
  if (key === 'phase') return ['5bar', 'gear', 'gear_linkage', 'planetary_gear'].includes(type);
  if (key === 'gearRatio') return false;
  if (key === 'rodLength') return ['5bar', '6bar', 'piston'].includes(type);
  if (key === 'groundLength') return !['cam', 'yoke', 'rack-pinion', 'gear', 'gear_linkage', 'planetary_gear'].includes(type);
  if (key === 'couplerLength') return !['cam', 'gear', 'planetary_gear', 'yoke', 'rack-pinion'].includes(type);
  return true;
};

export const clampMechanismParam = (key: keyof MechanismConfig, value: number) => {
  const param = MECHANISM_PARAM_META.find(item => item.key === key);
  if (!param) return value;
  return Math.max(param.min, Math.min(param.max, value));
};

const MOTION_SAFE_PARAM_SAMPLES = 28;
const MOTION_SAFE_RANGE_STEPS = 24;
const MOTION_AUTHORITY_SAMPLES = 48;

export const mechanismMotionCompletes = (mechanism: MechanismConfig) =>
  sampleFeasibleRange(mechanism, MOTION_SAFE_PARAM_SAMPLES).warning === null;

export const mechanismEditIsSafe = (mechanism: MechanismConfig) =>
  sampleFeasibleRange(mechanism, MOTION_AUTHORITY_SAMPLES).warning === null;

export const motionSafeParamRange = (mechanism: MechanismConfig, key: keyof MechanismConfig) => {
  const param = MECHANISM_PARAM_META.find(item => item.key === key);
  if (!param) return undefined;
  const current = Number(mechanism[key] ?? 0);
  if (!Number.isFinite(current)) return { min: param.min, max: param.max, locked: false, currentSafe: true };
  const values = Array.from(
    { length: MOTION_SAFE_RANGE_STEPS + 1 },
    (_, index) => param.min + ((param.max - param.min) * index) / MOTION_SAFE_RANGE_STEPS,
  );
  values.push(current);
  const sorted = [...new Set(values.map(value => Number(value.toFixed(4))))].sort((a, b) => a - b);
  const safeAt = (value: number) => mechanismEditIsSafe({ ...mechanism, [key]: value });
  const currentSafe = safeAt(current);
  if (!currentSafe) return { min: param.min, max: param.max, locked: true, currentSafe: false };
  const currentIndex = sorted.findIndex(value => value >= current);
  let min = current;
  for (let index = Math.max(0, currentIndex - 1); index >= 0; index -= 1) {
    if (!safeAt(sorted[index])) break;
    min = sorted[index];
  }
  let max = current;
  for (let index = Math.max(0, currentIndex); index < sorted.length; index += 1) {
    if (!safeAt(sorted[index])) break;
    max = sorted[index];
  }
  return { min, max, locked: min > param.min || max < param.max, currentSafe };
};

export const clampMechanismParamForMotion = (
  mechanism: MechanismConfig,
  key: keyof MechanismConfig,
  value: number,
) => {
  const range = motionSafeParamRange(mechanism, key);
  const clamped = clampMechanismParam(key, value);
  const bounded = range?.currentSafe ? Math.max(range.min, Math.min(range.max, clamped)) : clamped;
  return mechanismEditIsSafe({ ...mechanism, [key]: bounded }) ? bounded : Number(mechanism[key] ?? 0);
};

const motionAuthorityKeys = new Set<keyof MechanismConfig>([
  'crankLength',
  'groundLength',
  'couplerLength',
  'rockerLength',
  'sliderOffset',
  'couplerPointDist',
  'couplerPointAngle',
  'assemblyMode',
  'speed1',
  'speed2',
  'gearRatio',
  'gearTrainRadii',
  'camProfileSamples',
  'driverPhaseOffset',
  'rodLength',
  'phase',
  'outputGearRadius',
  'showOutputGear',
]);

export const mechanismUpdateChangesMotion = (updates: Partial<MechanismConfig>) =>
  Object.keys(updates).some(key => motionAuthorityKeys.has(key as keyof MechanismConfig));

const isFiniteScalarParam = (key: keyof MechanismConfig, value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && MECHANISM_PARAM_META.some(param => param.key === key);

export const safeMechanismUpdate = (mechanism: MechanismConfig, updates: Partial<MechanismConfig>) =>
  !mechanismUpdateChangesMotion(updates) || mechanismEditIsSafe({ ...mechanism, ...updates });

export const constrainMechanismUpdate = (
  mechanism: MechanismConfig,
  updates: Partial<MechanismConfig>,
): Partial<MechanismConfig> => {
  if (!mechanismUpdateChangesMotion(updates)) return updates;
  if (safeMechanismUpdate(mechanism, updates)) return updates;

  const constrained: Partial<MechanismConfig> = {};
  (Object.entries(updates) as Array<[keyof MechanismConfig, unknown]>).forEach(([key, value]) => {
    if (!motionAuthorityKeys.has(key)) {
      (constrained as Record<keyof MechanismConfig, unknown>)[key] = value;
      return;
    }
    if (!isFiniteScalarParam(key, value)) return;
    const nextValue = clampMechanismParamForMotion({ ...mechanism, ...constrained }, key, value);
    if (nextValue !== mechanism[key]) {
      (constrained as Record<keyof MechanismConfig, unknown>)[key] = nextValue;
    }
  });
  return constrained;
};
