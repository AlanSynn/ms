import type { Point } from '../types';

export const FABRICATION_SOURCE_SSOT = 'fabrication/generate_fabrication_templates.py' as const;
export const FABRICATION_SCHEMA_VERSION = 'automataii.fabrication.v1' as const;
export const FABRICATION_PROFILE_KEY = 'motionsmith-ms4n' as const;
export const FABRICATION_DEFAULT_GRID_PITCH_MM = 20;
export const FABRICATION_HOLE_DIAMETER_MM = 4;
export const FABRICATION_HOLE_RADIUS_MM = FABRICATION_HOLE_DIAMETER_MM / 2;
export const FABRICATION_GEAR_RADIUS_PER_TOOTH_MM = 1.25;
export const FABRICATION_LINKAGE_WIDTH_MM = 14;
export const FABRICATION_LINKAGE_RADIUS_MM = FABRICATION_LINKAGE_WIDTH_MM / 2;
export const FABRICATION_LINKAGE_MARGIN_MM = 7;
export const FABRICATION_BOARD_ROWS = 15;
export const FABRICATION_BOARD_COLUMNS = 15;

export type FabricationGearKey = 'g8' | 'g24' | 'g40' | 'g56';

type GearPreset = {
    key: FabricationGearKey;
    label: string;
    path: string;
    teeth: number;
};

export type FabricationGearSpec = GearPreset & {
    pitchRadiusMm: number;
    rootRadiusMm: number;
    outerRadiusMm: number;
    holeDiameterMm: number;
    attachmentHoleCentersMm: Point[];
};

export type FabricationLinkageSpec = {
    source: typeof FABRICATION_SOURCE_SSOT;
    key: `linkage-${number}-cell`;
    label: string;
    path: string;
    cells: number;
    lengthMm: number;
    widthMm: number;
    radiusMm: number;
    marginMm: number;
    pitchMm: number;
    holeDiameterMm: number;
    holeCentersMm: Point[];
    viewBoxWidthMm: number;
    viewBoxHeightMm: number;
};

export type FabricationSpacerSpec = {
    source: typeof FABRICATION_SOURCE_SSOT;
    key: 's10';
    label: string;
    path: string;
    outerDiameterMm: number;
    innerDiameterMm: number;
    holeDiameterMm: number;
    holeCentersMm: Point[];
    stackable: boolean;
};

export type FabricationRingGearSpec = {
    source: typeof FABRICATION_SOURCE_SSOT;
    key: 'ring-g8-g24';
    label: string;
    path: string;
    compatibleSunTeeth: number;
    compatiblePlanetTeeth: number;
    internalTeeth: number;
    pitchRadiusMm: number;
    innerTipRadiusMm: number;
    innerRootRadiusMm: number;
    outerRadiusMm: number;
    mountRadiusMm: number;
    holeDiameterMm: number;
    mountHoleCentersMm: Point[];
};

const GEAR_PRESETS: readonly GearPreset[] = [
    { key: 'g8', label: 'G1 / 1-space gear', path: 'gears/gear-8t.svg', teeth: 8 },
    { key: 'g24', label: 'G3 / 3-space gear', path: 'gears/gear-24t.svg', teeth: 24 },
    { key: 'g40', label: 'G5 / 5-space gear', path: 'gears/gear-40t.svg', teeth: 40 },
    { key: 'g56', label: 'G7 / 7-space gear', path: 'gears/gear-56t.svg', teeth: 56 }
] as const;

export const FABRICATION_LINKAGE_LENGTH_CELLS = [2, 4, 6, 8] as const;

const roundHalfEven = (value: number, decimals = 3) => {
    const factor = 10 ** decimals;
    const scaled = value * factor;
    const floor = Math.floor(scaled);
    const fraction = scaled - floor;
    if (Math.abs(fraction - 0.5) < 1e-9) return (floor % 2 === 0 ? floor : floor + 1) / factor;
    return Math.round(scaled) / factor;
};

const roundPoint = (point: Point): Point => ({ x: roundHalfEven(point.x), y: roundHalfEven(point.y) });

export const fabricationGearRadiusForTeeth = (teeth: number, pitchMm = FABRICATION_DEFAULT_GRID_PITCH_MM) =>
    teeth * FABRICATION_GEAR_RADIUS_PER_TOOTH_MM * (pitchMm / FABRICATION_DEFAULT_GRID_PITCH_MM);

export const fabricationGearAttachmentOffsetsMm = (pitchRadiusMm: number, pitchMm = FABRICATION_DEFAULT_GRID_PITCH_MM): Point[] => {
    const scale = pitchMm / FABRICATION_DEFAULT_GRID_PITCH_MM;
    const toothDepth = FABRICATION_GEAR_RADIUS_PER_TOOTH_MM * scale;
    const rootRadius = Math.max(FABRICATION_HOLE_RADIUS_MM + 8, pitchRadiusMm - toothDepth * 1.25);
    const usableRadius = rootRadius - FABRICATION_HOLE_RADIUS_MM - 4;
    if (usableRadius < pitchMm) return [];
    const maxCells = Math.floor(usableRadius / pitchMm);
    const points: Point[] = [];
    for (let yCell = -maxCells; yCell <= maxCells; yCell += 1) {
        for (let xCell = -maxCells; xCell <= maxCells; xCell += 1) {
            if (xCell === 0 && yCell === 0) continue;
            const x = xCell * pitchMm;
            const y = yCell * pitchMm;
            if (Math.hypot(x, y) <= usableRadius + 1e-9) points.push({ x, y });
        }
    }
    return points
        .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.y - b.y || a.x - b.x)
        .map(roundPoint);
};

const fabricationGearSpecFromPreset = (preset: GearPreset, pitchMm = FABRICATION_DEFAULT_GRID_PITCH_MM): FabricationGearSpec => {
    const scale = pitchMm / FABRICATION_DEFAULT_GRID_PITCH_MM;
    const pitchRadiusMm = fabricationGearRadiusForTeeth(preset.teeth, pitchMm);
    const toothDepth = FABRICATION_GEAR_RADIUS_PER_TOOTH_MM * scale;
    const rootRadiusMm = Math.max(FABRICATION_HOLE_RADIUS_MM + 8, pitchRadiusMm - toothDepth * 1.25);
    const outerRadiusMm = pitchRadiusMm + toothDepth * 1.2;
    return {
        ...preset,
        pitchRadiusMm: roundHalfEven(pitchRadiusMm),
        rootRadiusMm: roundHalfEven(rootRadiusMm),
        outerRadiusMm: roundHalfEven(outerRadiusMm),
        holeDiameterMm: FABRICATION_HOLE_DIAMETER_MM,
        attachmentHoleCentersMm: fabricationGearAttachmentOffsetsMm(pitchRadiusMm, pitchMm)
    };
};

export const FABRICATION_GEAR_SPECS: readonly FabricationGearSpec[] = GEAR_PRESETS.map(preset => fabricationGearSpecFromPreset(preset));

export const fabricationGearSpecForPitchRadius = (pitchRadius: number): FabricationGearSpec => {
    const radius = Math.max(0, Math.abs(pitchRadius));
    return FABRICATION_GEAR_SPECS.reduce((best, spec) =>
        Math.abs(spec.pitchRadiusMm - radius) < Math.abs(best.pitchRadiusMm - radius) ? spec : best
    );
};

export const fabricationLinkageSpecForCells = (cells: number, pitchMm = FABRICATION_DEFAULT_GRID_PITCH_MM): FabricationLinkageSpec => {
    const safeCells = Math.max(1, Math.round(cells));
    const lengthMm = safeCells * pitchMm;
    const x1 = FABRICATION_LINKAGE_MARGIN_MM + FABRICATION_LINKAGE_RADIUS_MM;
    const y = FABRICATION_LINKAGE_MARGIN_MM + FABRICATION_LINKAGE_RADIUS_MM;
    return {
        source: FABRICATION_SOURCE_SSOT,
        key: `linkage-${safeCells}-cell`,
        label: `${safeCells}-cell linkage`,
        path: `linkages/linkage-${safeCells}-cell.svg`,
        cells: safeCells,
        lengthMm: roundHalfEven(lengthMm),
        widthMm: FABRICATION_LINKAGE_WIDTH_MM,
        radiusMm: FABRICATION_LINKAGE_RADIUS_MM,
        marginMm: FABRICATION_LINKAGE_MARGIN_MM,
        pitchMm: roundHalfEven(pitchMm),
        holeDiameterMm: FABRICATION_HOLE_DIAMETER_MM,
        holeCentersMm: Array.from({ length: safeCells + 1 }, (_, index) => ({ x: roundHalfEven(x1 + index * pitchMm), y: roundHalfEven(y) })),
        viewBoxWidthMm: roundHalfEven(lengthMm + FABRICATION_LINKAGE_MARGIN_MM * 2 + FABRICATION_LINKAGE_WIDTH_MM),
        viewBoxHeightMm: roundHalfEven(FABRICATION_LINKAGE_WIDTH_MM + FABRICATION_LINKAGE_MARGIN_MM * 2 + 6)
    };
};

export const FABRICATION_LINKAGE_SPECS: readonly FabricationLinkageSpec[] = FABRICATION_LINKAGE_LENGTH_CELLS.map(cells => fabricationLinkageSpecForCells(cells));

export const FABRICATION_SPACER_SPEC: FabricationSpacerSpec = {
    source: FABRICATION_SOURCE_SSOT,
    key: 's10',
    label: 'S10 spacer',
    path: 'spacers/spacer-s10.svg',
    outerDiameterMm: 10,
    innerDiameterMm: FABRICATION_HOLE_DIAMETER_MM,
    holeDiameterMm: FABRICATION_HOLE_DIAMETER_MM,
    holeCentersMm: [{ x: 9, y: 9 }],
    stackable: true
};

export const fabricationRingGearSpecForPitchRadius = (pitchRadiusMm = 70, pitchMm = FABRICATION_DEFAULT_GRID_PITCH_MM): FabricationRingGearSpec => {
    const sun = GEAR_PRESETS[0];
    const planet = GEAR_PRESETS[1];
    const internalTeeth = sun.teeth + 2 * planet.teeth;
    const scale = pitchRadiusMm / fabricationGearRadiusForTeeth(internalTeeth, pitchMm);
    const pitchRadius = pitchRadiusMm;
    const toothDepth = FABRICATION_GEAR_RADIUS_PER_TOOTH_MM * (pitchMm / FABRICATION_DEFAULT_GRID_PITCH_MM) * scale;
    const innerTipRadiusMm = Math.max(FABRICATION_HOLE_RADIUS_MM + 12 * scale, pitchRadius - toothDepth * 1.15);
    const innerRootRadiusMm = pitchRadius + toothDepth * 0.85;
    const mountRadiusMm = pitchMm * 4 * scale;
    const outerRadiusMm = Math.max(innerRootRadiusMm + 14 * scale, mountRadiusMm + FABRICATION_HOLE_RADIUS_MM * scale + 8 * scale);
    return {
        source: FABRICATION_SOURCE_SSOT,
        key: 'ring-g8-g24',
        label: 'R56 internal ring gear',
        path: 'ring_gears/ring-g8-g24.svg',
        compatibleSunTeeth: sun.teeth,
        compatiblePlanetTeeth: planet.teeth,
        internalTeeth,
        pitchRadiusMm: roundHalfEven(pitchRadius),
        innerTipRadiusMm: roundHalfEven(innerTipRadiusMm),
        innerRootRadiusMm: roundHalfEven(innerRootRadiusMm),
        outerRadiusMm: roundHalfEven(outerRadiusMm),
        mountRadiusMm: roundHalfEven(mountRadiusMm),
        holeDiameterMm: FABRICATION_HOLE_DIAMETER_MM,
        mountHoleCentersMm: [
            { x: 0, y: -mountRadiusMm },
            { x: -mountRadiusMm, y: 0 },
            { x: mountRadiusMm, y: 0 },
            { x: 0, y: mountRadiusMm }
        ].map(roundPoint)
    };
};

export const FABRICATION_RING_GEAR_SPEC = fabricationRingGearSpecForPitchRadius();
