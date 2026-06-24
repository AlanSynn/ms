import { MechanismConfig, MechanismType, Point } from '../types';

export const MECHANISM_TYPES: MechanismType[] = [
    'crank',
    '4bar',
    'piston',
    'yoke',
    'quick-return',
    '5bar',
    'cam',
    'gear',
    'planetary_gear'
];

const MECHANISM_TYPE_SET = new Set<string>(MECHANISM_TYPES);

export const sanitizeMechanismType = (value: unknown, fallback: MechanismType = '4bar'): MechanismType =>
    typeof value === 'string' && MECHANISM_TYPE_SET.has(value) ? value as MechanismType : fallback;

export const sanitizeHexColor = (value: unknown, fallback = '#64748b'): string => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ? trimmed : fallback;
};

export const finiteNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
};

export const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = finiteNumber(value, fallback);
    return Math.min(max, Math.max(min, parsed));
};

export const svgNumber = (value: unknown, fallback = 0): string => {
    const parsed = finiteNumber(value, fallback);
    return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
};

export const sanitizePoint = (point: Point | unknown, fallback: Point = { x: 0, y: 0 }): Point => {
    const raw = point && typeof point === 'object' ? point as Partial<Point> : {};
    return {
        x: finiteNumber(raw.x, fallback.x),
        y: finiteNumber(raw.y, fallback.y)
    };
};

export const sanitizeMechanismRuntime = (mechanism: MechanismConfig): MechanismConfig => ({
    ...mechanism,
    type: sanitizeMechanismType(mechanism.type),
    visible: mechanism.visible !== false,
    enabled: mechanism.enabled !== false,
    color: sanitizeHexColor(mechanism.color, '#3b82f6'),
    anchorX: finiteNumber(mechanism.anchorX, 0),
    anchorY: finiteNumber(mechanism.anchorY, 0),
    groundAngle: finiteNumber(mechanism.groundAngle, 0),
    groundLength: finiteNumber(mechanism.groundLength, 0),
    crankLength: finiteNumber(mechanism.crankLength, 1),
    couplerLength: finiteNumber(mechanism.couplerLength, 0),
    rockerLength: finiteNumber(mechanism.rockerLength, 1),
    sliderOffset: finiteNumber(mechanism.sliderOffset, 0),
    couplerPointDist: finiteNumber(mechanism.couplerPointDist, 0),
    couplerPointAngle: finiteNumber(mechanism.couplerPointAngle, 0),
    speed1: finiteNumber(mechanism.speed1, 1),
    speed2: finiteNumber(mechanism.speed2, 1),
    gearRatio: mechanism.gearRatio === undefined ? undefined : finiteNumber(mechanism.gearRatio, 1),
    rodLength: mechanism.rodLength === undefined ? undefined : finiteNumber(mechanism.rodLength, 0),
    phase: finiteNumber(mechanism.phase, 0)
});
