import { BodyPartLayer, FabricationIssue, FabricationPackage, FabricationRecipe, MechanismConfig, Point, ProjectState } from '../types';
import { calculateLinkage, gearTrainOutputRatio, gearTrainPitchCenterDistance, gearTrainResolvedCenterDistance, gearTrainPitchRadii, generateCurvePoints, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio, planetaryRingPitchRadius as kinematicPlanetaryRingPitchRadius } from './kinematics';
import { boardToScene, SCENE_PX_PER_MM, sceneToBoardRaw, sceneToSvg, sceneBoundsForSheet } from './coordinates';
import { mechanismRequiredParts } from './project';
import { REFERENCE_DEFAULTS, isReferenceExportReady, referenceRecipeForType, referenceStepCoordinateCallout, referenceSupportWarning } from './mechanismReference';
import { mechanismBindingWarnings, preferredMotionJointId } from './motion';
import { svgNumber } from './sanitize';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, partOutlineBounds, pointInsideOutline } from './partGeometry';

import {
    FABRICATION_GEAR_SPECS,
    FABRICATION_HOLE_RADIUS_MM,
    FABRICATION_LINKAGE_SPECS,
    FABRICATION_LINKAGE_WIDTH_MM,
    FABRICATION_RING_GEAR_SPEC,
    FABRICATION_SOURCE_SSOT,
    FABRICATION_SPACER_SPEC,
    fabricationBoardColumnLabel,
    fabricationBoardCoordinateCallout,
    fabricationBoardRowLabel,
    fabricationGearSpecForPitchRadius as sharedFabricationGearSpecForPitchRadius,
    fabricationLinkageSpecForCells as sharedFabricationLinkageSpecForCells,
    fabricationPartDisplayLabel,
    fabricationRingGearSpecForPitchRadius,
    type FabricationGearSpec,
    type FabricationLinkageSpec,
    type FabricationRingGearSpec,
    type FabricationSpacerSpec
} from './fabricationContract';

export {
    FABRICATION_GEAR_SPECS,
    FABRICATION_HOLE_RADIUS_MM,
    FABRICATION_LINKAGE_SPECS,
    FABRICATION_LINKAGE_WIDTH_MM,
    FABRICATION_RING_GEAR_SPEC,
    FABRICATION_SOURCE_SSOT,
    FABRICATION_SPACER_SPEC,
    fabricationBoardColumnLabel,
    fabricationBoardCoordinateCallout,
    fabricationBoardRowLabel,
    fabricationPartDisplayLabel
};
export type { FabricationGearSpec, FabricationLinkageSpec, FabricationRingGearSpec, FabricationSpacerSpec };

export type FabricationGearProfile = {
    source: typeof FABRICATION_SOURCE_SSOT;
    preset: FabricationGearSpec;
    pitchRadius: number;
    rootRadius: number;
    outerRadius: number;
    teeth: number;
    axleHoleRadius: number;
    attachmentHoleCenters: Point[];
    outlinePoints: Point[];
};

export const fabricationGearSpecForPitchRadius = sharedFabricationGearSpecForPitchRadius;
export const fabricationLinkageSpecForCells = sharedFabricationLinkageSpecForCells;

export const PLANETARY_GEAR_SYNTAX = 'ring-fixed-sun-input-carrier-output' as const;
export const PLANETARY_GEAR_PLANET_COUNT = 1;

const positiveSceneRadius = (value: number, fallback = 1) => Math.max(1, Math.abs(Number.isFinite(value) ? value : fallback));

export const planetaryCarrierPitchRadius = (mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'groundLength'>) =>
    Math.max(1, mechanism.groundLength || positiveSceneRadius(mechanism.crankLength) + positiveSceneRadius(mechanism.rockerLength));

export const planetaryRingPitchRadius = (mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength'>) =>
    kinematicPlanetaryRingPitchRadius(mechanism.crankLength, mechanism.rockerLength);

export const planetaryGearRadii = (mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength'>): number[] => [
    positiveSceneRadius(mechanism.crankLength),
    ...Array.from({ length: PLANETARY_GEAR_PLANET_COUNT }, () => positiveSceneRadius(mechanism.rockerLength)),
    planetaryRingPitchRadius(mechanism)
];

export const planetaryPlanetCenters = (origin: Point, mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'groundLength'>, carrierAngleRad = 0): Point[] => {
    const radius = planetaryCarrierPitchRadius(mechanism);
    return Array.from({ length: PLANETARY_GEAR_PLANET_COUNT }, (_, index) => {
        const angle = carrierAngleRad + (Math.PI * 2 * index) / PLANETARY_GEAR_PLANET_COUNT;
        return { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
    });
};

export const planetaryGearConventionForMechanism = (mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'groundLength'>) => ({
    source: FABRICATION_SOURCE_SSOT,
    syntax: PLANETARY_GEAR_SYNTAX,
    fixedMember: 'ring' as const,
    inputMember: 'sun' as const,
    outputMember: 'carrier' as const,
    planetCount: PLANETARY_GEAR_PLANET_COUNT,
    sunPitchRadius: positiveSceneRadius(mechanism.crankLength),
    planetPitchRadius: positiveSceneRadius(mechanism.rockerLength),
    carrierPitchRadius: planetaryCarrierPitchRadius(mechanism),
    ringPitchRadius: planetaryRingPitchRadius(mechanism),
    carrierOutputRatio: planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength),
    planetSpinRatio: planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength),
    pitchRadii: planetaryGearRadii(mechanism)
});

export const FABRICATION_LINKAGE_ROLE_MIN_HOLES: Record<keyof FabricationLinkageRoleLengths, number> = {
    base: 3,
    driver: 3,
    coupler: 4,
    output: 3,
    effector: 2,
    follower: 2
};

export const fabricationLinkageSpecForSceneLength = (sceneLength: number, pitchMm = 20, minHoleCount = 2): FabricationLinkageSpec => {
    const lengthMm = Math.max(0, Math.abs(sceneLength) / SCENE_PX_PER_MM);
    const targetCells = Math.max(1, Math.round(lengthMm / Math.max(1, pitchMm)));
    const candidates = FABRICATION_LINKAGE_SPECS.filter(spec => spec.holeCentersMm.length >= Math.max(2, minHoleCount));
    const available = candidates.length ? candidates : FABRICATION_LINKAGE_SPECS;
    const nearestCells = available.reduce((best, spec) =>
        Math.abs(spec.cells - targetCells) < Math.abs(best.cells - targetCells) ? spec : best
    ).cells;
    return sharedFabricationLinkageSpecForCells(nearestCells, pitchMm);
};

export type FabricationLinkageRoleLengths = {
    base: number;
    driver: number;
    coupler: number;
    output: number;
    effector: number;
    follower: number;
};

export const fabricationLinkageHoleCountForSceneLength = (sceneLength: number, pitchMm = 20, minHoleCount = 2) =>
    fabricationLinkageSpecForSceneLength(sceneLength, pitchMm, minHoleCount).holeCentersMm.length;

const minimumSceneLinkageLength = (value: number, fallback = 20) => Math.max(1, Math.abs(Number.isFinite(value) ? value : fallback));

/**
 * Scene-unit linkage blank lengths used before dynamic transforms.
 *
 * This is intentionally fabrication-facing, not renderer-facing: every Three/2D
 * linkage blank should start from the physical span it represents so the drilled
 * holes match the generated SVG linkage templates from
 * fabrication/generate_fabrication_templates.py instead of being stretched from a
 * shorter visual placeholder.
 */
export const fabricationLinkageSceneLengthsForMechanism = (mechanism: Pick<MechanismConfig, 'type' | 'groundLength' | 'crankLength' | 'couplerLength' | 'rockerLength' | 'couplerPointDist' | 'rodLength'>): FabricationLinkageRoleLengths => {
    const output = minimumSceneLinkageLength(Math.max(20, mechanism.couplerPointDist));
    const follower = minimumSceneLinkageLength(Math.max(20, mechanism.rodLength ?? mechanism.couplerPointDist));
    const standard: FabricationLinkageRoleLengths = {
        base: minimumSceneLinkageLength(mechanism.groundLength),
        driver: minimumSceneLinkageLength(mechanism.crankLength),
        coupler: minimumSceneLinkageLength(mechanism.couplerLength),
        output: minimumSceneLinkageLength(mechanism.rockerLength),
        effector: output,
        follower
    };
    if (mechanism.type === 'planetary_gear') {
        const carrier = planetaryCarrierPitchRadius(mechanism);
        return {
            base: carrier,
            driver: carrier,
            coupler: carrier,
            output: carrier,
            effector: output,
            follower
        };
    }
    if (mechanism.type === 'gear') {
        return { ...standard, driver: output, coupler: output, output, effector: output };
    }
    if (mechanism.type === 'gear_linkage') {
        const handle = minimumSceneLinkageLength(Math.max(20, mechanism.couplerPointDist));
        const link = minimumSceneLinkageLength(Math.max(20, mechanism.couplerLength));
        return { ...standard, driver: handle, coupler: link, output: link, effector: link };
    }
    if (mechanism.type === 'rack-pinion') {
        return { ...standard, output, effector: output };
    }
    return standard;
};

export const fabricationLinkageHoleCountsForMechanism = (mechanism: Parameters<typeof fabricationLinkageSceneLengthsForMechanism>[0], pitchMm = 20) => {
    const lengths = fabricationLinkageSceneLengthsForMechanism(mechanism);
    return Object.fromEntries(Object.entries(lengths).map(([role, length]) => [
        role,
        fabricationLinkageHoleCountForSceneLength(length, pitchMm, FABRICATION_LINKAGE_ROLE_MIN_HOLES[role as keyof FabricationLinkageRoleLengths])
    ])) as Record<keyof FabricationLinkageRoleLengths, number>;
};

const scalePoint = (point: Point, scale: number): Point => ({ x: point.x * scale, y: point.y * scale });

export const fabricationGearProfileForPitchRadius = (pitchRadius: number, presetPitchRadiusMm = pitchRadius): FabricationGearProfile => {
    const safePitchRadius = Math.max(0.001, Math.abs(pitchRadius));
    const preset = fabricationGearSpecForPitchRadius(presetPitchRadiusMm);
    const scale = safePitchRadius / preset.pitchRadiusMm;
    const rootRadius = preset.rootRadiusMm * scale;
    const outerRadius = preset.outerRadiusMm * scale;
    const toothAngle = (Math.PI * 2) / preset.teeth;
    const outlinePoints: Point[] = [];
    for (let i = 0; i < preset.teeth; i += 1) {
        const base = i * toothAngle;
        [
            { angle: base, radius: rootRadius },
            { angle: base + toothAngle * 0.25, radius: outerRadius },
            { angle: base + toothAngle * 0.5, radius: outerRadius },
            { angle: base + toothAngle * 0.75, radius: rootRadius }
        ].forEach(({ angle, radius }) => outlinePoints.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }));
    }
    return {
        source: FABRICATION_SOURCE_SSOT,
        preset,
        pitchRadius: safePitchRadius,
        rootRadius,
        outerRadius,
        teeth: preset.teeth,
        axleHoleRadius: (preset.holeDiameterMm * scale) / 2,
        attachmentHoleCenters: preset.attachmentHoleCentersMm.map(point => scalePoint(point, scale)),
        outlinePoints
    };
};

const svgPathFromPoints = (points: Point[]): string => points.length
    ? `M ${points.map(point => `${svgNumber(point.x)} ${svgNumber(point.y)}`).join(' L ')} Z`
    : '';

const circlePathD = (radius: number, cx = 0, cy = 0): string => {
    const r = Math.max(0.001, Math.abs(radius));
    return `M ${svgNumber(cx + r)} ${svgNumber(cy)} A ${svgNumber(r)} ${svgNumber(r)} 0 1 0 ${svgNumber(cx - r)} ${svgNumber(cy)} A ${svgNumber(r)} ${svgNumber(r)} 0 1 0 ${svgNumber(cx + r)} ${svgNumber(cy)} Z`;
};

export const fabricationGearPathD = (pitchRadius: number, presetPitchRadiusMm = pitchRadius): string => {
    const profile = fabricationGearProfileForPitchRadius(pitchRadius, presetPitchRadiusMm);
    return [
        svgPathFromPoints(profile.outlinePoints),
        circlePathD(profile.axleHoleRadius),
        ...profile.attachmentHoleCenters.map(point => circlePathD(profile.axleHoleRadius, point.x, point.y))
    ].join(' ');
};

export type FabricationRingGearProfile = {
    source: typeof FABRICATION_SOURCE_SSOT;
    key: 'ring-g8-g24';
    internalTeeth: number;
    outerRadius: number;
    pitchRadius: number;
    tipRadius: number;
    rootRadius: number;
    mountHoleCenters: Point[];
    mountHoleRadius: number;
};

export const fabricationRingGearProfileForPitchRadius = (pitchRadius: number): FabricationRingGearProfile => {
    const safePitchRadius = Math.max(0.001, Math.abs(pitchRadius));
    const preset = fabricationRingGearSpecForPitchRadius(safePitchRadius);
    return {
        source: FABRICATION_SOURCE_SSOT,
        key: preset.key,
        internalTeeth: preset.internalTeeth,
        outerRadius: preset.outerRadiusMm,
        pitchRadius: preset.pitchRadiusMm,
        tipRadius: preset.innerTipRadiusMm,
        rootRadius: preset.innerRootRadiusMm,
        mountHoleCenters: preset.mountHoleCentersMm,
        mountHoleRadius: FABRICATION_HOLE_RADIUS_MM * (preset.pitchRadiusMm / FABRICATION_RING_GEAR_SPEC.pitchRadiusMm)
    };
};

export const fabricationRingInnerGearOutlinePoints = (pitchRadius: number): Point[] => {
    const profile = fabricationRingGearProfileForPitchRadius(pitchRadius);
    const toothAngle = (Math.PI * 2) / profile.internalTeeth;
    const points: Point[] = [];
    for (let i = 0; i < profile.internalTeeth; i += 1) {
        const base = i * toothAngle;
        [
            { angle: base, radius: profile.rootRadius },
            { angle: base + toothAngle * 0.25, radius: profile.tipRadius },
            { angle: base + toothAngle * 0.5, radius: profile.tipRadius },
            { angle: base + toothAngle * 0.75, radius: profile.rootRadius }
        ].forEach(({ angle, radius }) => points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }));
    }
    return points;
};

export const fabricationRingGearPathD = (pitchRadius: number): string => {
    const profile = fabricationRingGearProfileForPitchRadius(pitchRadius);
    const mountHoleRadius = profile.mountHoleRadius;
    return [
        circlePathD(profile.outerRadius),
        svgPathFromPoints(fabricationRingInnerGearOutlinePoints(pitchRadius)),
        ...profile.mountHoleCenters.map(point => circlePathD(mountHoleRadius, point.x, point.y))
    ].join(' ');
};

export type FabricationStackLayer = {
    label: string;
    role: 'base' | 'clip' | 'linkage' | 'spacer' | 'gear' | 'guide' | 'cam' | 'rack' | 'follower';
    color: string;
};

export type FabricationRenderKind = 'base' | 'clip' | 'linkage' | 'spacer' | 'gear' | 'guide' | 'cam' | 'rack' | 'follower';

export type FabricationRenderLayer = FabricationStackLayer & {
    source: 'fabrication-stack';
    stackIndex: number;
    occurrence: number;
    z: number;
    renderKind: FabricationRenderKind;
};

export type FabricationRenderPlan = {
    base: FabricationRenderLayer;
    layers: FabricationRenderLayer[];
    stackSummary: string;
    roleSummary: string;
    occurrenceSummary: string;
    colorSummary: string;
    zSummary: string;
    validationErrors: string[];
};

export const FABRICATION_RENDER_BASE_Z = 0.22;
export const FABRICATION_RENDER_LAYER_Z_STEP = 0.56;
export const FABRICATION_RENDER_PART_DEPTH = 0.40;
export const FABRICATION_RENDER_MIN_CLEARANCE = Number((FABRICATION_RENDER_LAYER_Z_STEP - FABRICATION_RENDER_PART_DEPTH).toFixed(2));

export const STACK_COLORS: Record<FabricationStackLayer['role'], string> = {
    base: '#e2e8f0',
    clip: '#334155',
    linkage: '#60a5fa',
    spacer: '#f59e0b',
    gear: '#8b5cf6',
    guide: '#10b981',
    cam: '#f97316',
    rack: '#14b8a6',
    follower: '#f472b6'
};

const layer = (label: string, role: FabricationStackLayer['role']): FabricationStackLayer => ({ label, role, color: STACK_COLORS[role] });

export const fabricationBaseLayer = (): FabricationStackLayer => layer('Base board', 'base');

export const fabricationStackForMechanism = (mechanism: Pick<MechanismConfig, 'type'> & Partial<Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'couplerLength' | 'gearTrainRadii'>>): FabricationStackLayer[] => {
    const linked = (...middle: FabricationStackLayer[]) => [layer('Back Clip', 'clip'), ...middle, layer('Front Clip', 'clip')];
    const spacer = () => layer(FABRICATION_SPACER_SPEC.label, 'spacer');
    const recipe = referenceRecipeForType(mechanism.type);
    if (!recipe.exportReady) return [];
    const gearLabelForRadius = (role: 'Drive' | 'Output' | 'Idler', radius: number, index?: number) => {
        const spec = sharedFabricationGearSpecForPitchRadius(Math.abs(radius) / SCENE_PX_PER_MM);
        return `${role} ${spec.label}${role === 'Idler' && index ? ` ${index}` : ''}`;
    };
    const gearStackLayers = (fallbackDrive: number, fallbackOutput: number) => {
        const radii = gearTrainPitchRadii({
            crankLength: mechanism.crankLength ?? fallbackDrive,
            rockerLength: mechanism.rockerLength ?? fallbackOutput,
            gearTrainRadii: mechanism.gearTrainRadii
        });
        const gearLayers: FabricationStackLayer[] = [layer(gearLabelForRadius('Drive', radii[0]), 'gear')];
        radii.slice(1, -1).forEach((radius, index) => gearLayers.push(spacer(), layer(gearLabelForRadius('Idler', radius, index + 1), 'gear')));
        gearLayers.push(spacer(), layer(gearLabelForRadius('Output', radii.at(-1) ?? radii[0]), 'gear'));
        return gearLayers;
    };
    if (mechanism.type === 'gear') {
        return linked(...gearStackLayers(REFERENCE_DEFAULTS.gearTrain.driveRadius, REFERENCE_DEFAULTS.gearTrain.outputRadius));
    }
    if (mechanism.type === 'gear_linkage') {
        const linkageSpec = fabricationLinkageSpecForSceneLength(mechanism.couplerLength ?? REFERENCE_DEFAULTS.gearLinkage.outputLinkage);
        return linked(
            ...gearStackLayers(REFERENCE_DEFAULTS.gearLinkage.driveRadius, REFERENCE_DEFAULTS.gearLinkage.outputRadius),
            spacer(),
            layer(`Drive L${linkageSpec.cells} linkage`, 'linkage'),
            spacer(),
            layer(`Output L${linkageSpec.cells} linkage`, 'linkage')
        );
    }
    const roleForLabel = (labelText: string): FabricationStackLayer['role'] => {
        if (/gear|ring|sun|planet/i.test(labelText)) return 'gear';
        if (/cam/i.test(labelText)) return 'cam';
        if (/follower|slider block/i.test(labelText)) return 'follower';
        if (/guide|bracket/i.test(labelText)) return 'guide';
        return 'linkage';
    };
    return linked(...recipe.stackLabels.flatMap((labelText, index) => [
        ...(index > 0 ? [spacer()] : []),
        layer(labelText, roleForLabel(labelText))
    ]));
};

export const fabricationStackSummary = (mechanism: Pick<MechanismConfig, 'type'> & Partial<Pick<MechanismConfig, 'gearTrainRadii'>>) => fabricationStackForMechanism(mechanism).map(item => item.label).join(' → ');
export const readableFabricationStackSummary = (mechanism: Pick<MechanismConfig, 'type'> & Partial<Pick<MechanismConfig, 'gearTrainRadii'>>) =>
    fabricationStackForMechanism(mechanism).map(item => fabricationPartDisplayLabel(item.label)).join(' → ');

const recipeBoardCallout = (recipe: Pick<FabricationRecipe, 'boardCoordinate' | 'board'>) =>
    fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board);

const recipeTargetCallout = (recipe: Pick<FabricationRecipe, 'targetPartName' | 'targetPartId' | 'targetPathId' | 'targetAnchorJointId'>) => [
    recipe.targetPartName || recipe.targetPartId,
    recipe.targetPathId,
    recipe.targetAnchorJointId
].filter(Boolean).join(' · ');

const mechanismTypeLabel = (type: MechanismConfig['type']) =>
    referenceRecipeForType(type).title || type.replace(/[-_]/g, ' ');

const readableStepCoordinateCallout = (step: FabricationRecipe['assemblySteps'][number]) =>
    referenceStepCoordinateCallout(step).replace(/\b([A-O](?:[1-9]|1[0-5]))\b/g, coord => fabricationBoardCoordinateCallout(coord));

const isMovingStackLayer = (item: FabricationStackLayer) => !['clip', 'spacer', 'base'].includes(item.role);

export const validateFabricationStack = (mechanism: (Pick<MechanismConfig, 'type'> & Partial<Pick<MechanismConfig, 'gearTrainRadii'>>) | FabricationStackLayer[]) => {
    const stack = Array.isArray(mechanism) ? mechanism : fabricationStackForMechanism(mechanism);
    const errors: string[] = [];
    if (!Array.isArray(mechanism) && !isReferenceExportReady(mechanism.type)) errors.push(referenceSupportWarning(mechanism.type) ?? `${mechanism.type}: not fabrication-ready`);
    if (!stack.length) return errors;
    if (stack.some(item => item.role === 'base')) errors.push('moving stack must not include Base board');
    if (stack[0]?.role !== 'clip') errors.push('moving stack must start with a back clip');
    if (stack.at(-1)?.role !== 'clip') errors.push('moving stack must end with a front clip');
    if (!stack.some(item => item.role === 'spacer')) errors.push(`moving stack must include at least one ${FABRICATION_SPACER_SPEC.label}`);
    stack.slice(1, -1).forEach((item, index, middle) => {
        if (item.role === 'clip') errors.push(`${item.label} clip may only appear at stack ends`);
        if (item.role === 'spacer') {
            const prev = index > 0 ? middle[index - 1] : stack[0];
            const next = index < middle.length - 1 ? middle[index + 1] : stack.at(-1);
            if (!prev || !next || !isMovingStackLayer(prev) || !isMovingStackLayer(next)) errors.push(`${item.label} must sit between two moving layers`);
        }
        const next = index < middle.length - 1 ? middle[index + 1] : stack.at(-1);
        if (isMovingStackLayer(item) && next && isMovingStackLayer(next)) errors.push(`${item.label} and ${next.label} need a ${FABRICATION_SPACER_SPEC.label} between them`);
    });
    stack.filter(item => item.role === 'spacer').forEach(item => {
        if (item.label !== FABRICATION_SPACER_SPEC.label) errors.push(`spacer layers must use ${FABRICATION_SPACER_SPEC.label}`);
    });
    if (!Array.isArray(mechanism) && isReferenceExportReady(mechanism.type)) {
        const expectedLabels = fabricationStackForMechanism(mechanism).map(item => item.label).join(' → ');
        const actualLabels = stack.map(item => item.label).join(' → ');
        if (actualLabels !== expectedLabels) errors.push(`${mechanism.type} stack must match mechanism-reference order: ${expectedLabels}`);
    }
    return errors;
};

const renderKindForRole = (role: FabricationStackLayer['role']): FabricationRenderKind => role === 'base' ? 'base' : role;

export const fabricationRenderPlanForMechanism = (mechanism: Pick<MechanismConfig, 'type'> & Partial<Pick<MechanismConfig, 'gearTrainRadii'>>): FabricationRenderPlan => {
    const stack = fabricationStackForMechanism(mechanism);
    const validationErrors = validateFabricationStack(mechanism);
    const occurrenceByRole = new Map<FabricationStackLayer['role'], number>();
    const makeRenderLayer = (item: FabricationStackLayer, stackIndex: number): FabricationRenderLayer => {
        const occurrence = occurrenceByRole.get(item.role) ?? 0;
        occurrenceByRole.set(item.role, occurrence + 1);
        return {
            ...item,
            source: 'fabrication-stack',
            stackIndex,
            occurrence,
            z: stackIndex === -1 ? 0 : FABRICATION_RENDER_BASE_Z + stackIndex * FABRICATION_RENDER_LAYER_Z_STEP,
            renderKind: renderKindForRole(item.role)
        };
    };
    const base: FabricationRenderLayer = {
        ...fabricationBaseLayer(),
        source: 'fabrication-stack',
        stackIndex: -1,
        occurrence: 0,
        z: 0,
        renderKind: 'base'
    };
    const layers = stack.map(makeRenderLayer);
    return {
        base,
        layers,
        stackSummary: layers.map(item => item.label).join(' → '),
        roleSummary: layers.map(item => item.role).join('>'),
        occurrenceSummary: layers.map(item => `${item.role}#${item.occurrence}:${item.label}`).join('>'),
        colorSummary: layers.map(item => item.color).join(','),
        zSummary: layers.map(item => item.z.toFixed(2)).join(','),
        validationErrors
    };
};

export const prefabAssemblySteps = (mechanism: MechanismConfig, boardCoordinate: string): FabricationRecipe['assemblySteps'] => {
    const recipe = referenceRecipeForType(mechanism.type);
    if (recipe.exportReady && recipe.assemblySteps.length) {
        return recipe.assemblySteps.map(step => ({
            ...step,
            boardCoordinate: step.boardCoordinate || boardCoordinate,
            zMm: step.zMm ?? 0
        }));
    }
    const plan = fabricationRenderPlanForMechanism(mechanism);
    const moduleLabel = `${mechanismTypeLabel(mechanism.type)} prebuilt module`;
    return [
        {
            index: 1,
            label: moduleLabel,
            role: 'prefab-module',
            boardCoordinate,
            zMm: 0,
            coords: [boardCoordinate],
            coordRoles: ['board'],
            action: 'snap-module',
            instruction: `Mount ${mechanismTypeLabel(mechanism.type)} at ${boardCoordinate}.`
        },
        ...plan.layers.map((layer, index) => ({
            index: index + 2,
            label: fabricationPartDisplayLabel(layer.label),
            role: layer.role,
            boardCoordinate,
            zMm: Number((layer.z * 10).toFixed(1)),
            coords: [boardCoordinate],
            coordRoles: ['stack'],
            action: 'stack-layer',
            instruction: layer.role === 'clip'
                ? `Lock ${fabricationPartDisplayLabel(layer.label)} at ${boardCoordinate}.`
                : layer.role === 'spacer'
                    ? `Insert ${fabricationPartDisplayLabel(layer.label)} at ${boardCoordinate}.`
                    : `Place ${fabricationPartDisplayLabel(layer.label)} at ${boardCoordinate}.`
        }))
    ];
};

export const sampleFeasibleRange = (mechanism: MechanismConfig, samples = 96) => {
    let valid = 0;
    const validSamples: boolean[] = [];
    const loops = mechanism.type === '5bar' || mechanism.type === '6bar' || mechanism.type === 'planetary_gear' ? 8 : 1;
    const baseSamples = Math.max(1, Math.round(samples));
    const totalSamples = baseSamples * loops;
    for (let i = 0; i <= totalSamples; i++) {
        const angle = (i / totalSamples) * Math.PI * 2;
        validSamples[i] = calculateLinkage(mechanism, angle).isValid;
        if (validSamples[i]) valid++;
    }
    const intervals: Array<{ startDeg: number; endDeg: number }> = [];
    let start: number | null = null;
    validSamples.forEach((ok, i) => {
        if (ok && start === null) start = i;
        if ((!ok || i === totalSamples) && start !== null) {
            const end = ok && i === totalSamples ? i : i - 1;
            intervals.push({ startDeg: Math.round(start * 360 / totalSamples), endDeg: Math.round(end * 360 / totalSamples) });
            start = null;
        }
    });
    const intervalText = intervals.map(i => `${i.startDeg}°–${i.endDeg}°`).join(', ');
    return {
        percentValid: valid / (totalSamples + 1),
        startDeg: intervals[0]?.startDeg ?? 0,
        endDeg: intervals.at(-1)?.endDeg ?? 0,
        intervals,
        warning: valid === totalSamples + 1 ? null : valid === 0 ? 'No motion' : `Motion ${Math.round((valid / (totalSamples + 1)) * 100)}% · ${intervalText}`
    };
};

const physicalTolerance = (value: number) => Math.max(1, Math.abs(value) * 0.03);

const closePhysicalValue = (actual: number, expected: number) =>
    Math.abs(actual - expected) <= physicalTolerance(expected || actual || 1);

const closeToBoardPitch = (sceneLength: number) => {
    const pitch = REFERENCE_DEFAULTS.pitchMm * SCENE_PX_PER_MM;
    const cells = Math.max(1, Math.round(Math.abs(sceneLength) / Math.max(1, pitch)));
    return closePhysicalValue(Math.abs(sceneLength), cells * pitch);
};

const closeToFabricationLinkage = (sceneLength: number, minHoleCount = 2) => {
    const spec = fabricationLinkageSpecForSceneLength(sceneLength, REFERENCE_DEFAULTS.pitchMm, minHoleCount);
    return closePhysicalValue(Math.abs(sceneLength), spec.lengthMm * SCENE_PX_PER_MM);
};

const uniqueMessages = (items: string[]) => [...new Set(items.filter(Boolean))];

export const validateMechanismPreviewReadiness = (mechanism: MechanismConfig): string[] => {
    const errors = [...validateFabricationStack(mechanism)];
    const recipe = referenceRecipeForType(mechanism.type);
    if (!recipe.exportReady) errors.push(recipe.reason ?? 'not fabrication-ready.');

    const physicalNumbers = [
        mechanism.crankLength,
        mechanism.couplerLength,
        mechanism.groundLength,
        mechanism.rockerLength,
        mechanism.sliderOffset,
        mechanism.couplerPointDist,
        mechanism.couplerPointAngle
    ];
    if (mechanism.type === '5bar' || mechanism.type === '6bar' || mechanism.type === 'piston') physicalNumbers.push(mechanism.rodLength ?? Number.NaN);
    if (mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear') physicalNumbers.push(mechanism.gearRatio ?? Number.NaN, mechanism.speed2 ?? Number.NaN);
    if (!physicalNumbers.every(Number.isFinite)) errors.push('bad dimension.');
    if ((mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear') && (mechanism.gearRatio ?? 0) === 0) errors.push('gear ratio 0.');

    if (mechanism.type === '4bar') {
        const lengthsAreFabricationSnapped =
            closeToBoardPitch(mechanism.groundLength) &&
            closeToFabricationLinkage(mechanism.crankLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.driver) &&
            closeToFabricationLinkage(mechanism.couplerLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.coupler) &&
            closeToFabricationLinkage(mechanism.rockerLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.output);
        if (!lengthsAreFabricationSnapped) errors.push('snap four-bar linkage lengths.');
    }

    if (mechanism.type === 'gear') {
        const pitchSpan = gearTrainPitchCenterDistance(mechanism);
        const resolvedSpan = gearTrainResolvedCenterDistance(mechanism);
        if (!closePhysicalValue(Math.abs(mechanism.groundLength), pitchSpan) || !closePhysicalValue(resolvedSpan, pitchSpan)) {
            errors.push('snap gear pitch.');
        }
    }
    if (mechanism.type === 'gear_linkage') {
        const radii = gearTrainPitchRadii(mechanism);
        const pitchSpan = gearTrainPitchCenterDistance(mechanism);
        const resolvedSpan = gearTrainResolvedCenterDistance(mechanism);
        const actualGround = Math.abs(mechanism.groundLength);
        if (radii.length > 2) {
            if (!closePhysicalValue(actualGround, pitchSpan) || !closePhysicalValue(resolvedSpan, pitchSpan)) errors.push('snap gear pitch.');
        } else {
            if (actualGround <= pitchSpan + physicalTolerance(pitchSpan)) {
                errors.push('gear linkage endpoint gears must be separated; add idler gears for meshing.');
            }
            if (!closePhysicalValue(actualGround, resolvedSpan)) errors.push('snap gear pitch.');
        }
    }
    if (mechanism.type === 'planetary_gear') {
        const expectedCarrier = Math.abs(mechanism.crankLength) + Math.abs(mechanism.rockerLength);
        const expectedRing = Math.abs(mechanism.crankLength) + Math.abs(mechanism.rockerLength) * 2;
        if (!closePhysicalValue(Math.abs(mechanism.groundLength), expectedCarrier)) errors.push('planetary carrier radius must equal sun plus planet.');
        if (!closePhysicalValue(planetaryRingPitchRadius(mechanism), expectedRing)) errors.push('planetary ring radius must equal sun plus two planet radii.');
    }

    const range = sampleFeasibleRange(mechanism);
    if (range.warning?.startsWith('No motion')) errors.push('No motion.');
    return uniqueMessages(errors);
};

export const validateForFabrication = (project: ProjectState) => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const issues: FabricationIssue[] = [];
    const add = (severity: FabricationIssue['severity'], message: string, extra: Partial<FabricationIssue> = {}) => {
        const target = severity === 'error' ? errors : warnings;
        if (target.includes(message)) return;
        issues.push({ severity, message, recoveryStage: severity === 'error' ? 'design' : 'blueprint', recoveryAction: 'Review item', ...extra });
        target.push(message);
    };
    const sheet = sceneBoundsForSheet(project.settings.physicalKit);
    const snapTolerance = project.settings.physicsSnapMode === 'fast' ? 4 : project.settings.physicsSnapMode === 'high' ? 0.25 : 0.5;
    const fabricationSeverity: FabricationIssue['severity'] = project.settings.fabricationReadyMode ? 'error' : 'warning';
    const insideSheet = (p: { x: number; y: number }) => p.x >= sheet.x && p.x <= sheet.x + sheet.width && p.y >= sheet.y && p.y <= sheet.y + sheet.height;
    if (!project.partOrder.length) add('error', 'No character in scene.', { recoveryStage: 'character', recoveryAction: 'Load a character package' });
    const activeMechanisms = project.mechanisms.filter(m => m.visible && m.enabled !== false);
    if (!activeMechanisms.length) add('error', 'No enabled mechanism to export.', { recoveryStage: 'design', recoveryAction: 'Enable or add a mechanism' });
    const bindingWarnings = mechanismBindingWarnings(project, activeMechanisms);
    project.partOrder.forEach(partId => {
        const part = project.parts[partId];
        if (!part?.visible) return;
        const corners = [
            { x: part.transform.x + part.bounds.x * part.transform.scale, y: part.transform.y + part.bounds.y * part.transform.scale },
            { x: part.transform.x + (part.bounds.x + part.bounds.width) * part.transform.scale, y: part.transform.y + part.bounds.y * part.transform.scale },
            { x: part.transform.x + part.bounds.x * part.transform.scale, y: part.transform.y + (part.bounds.y + part.bounds.height) * part.transform.scale },
            { x: part.transform.x + (part.bounds.x + part.bounds.width) * part.transform.scale, y: part.transform.y + (part.bounds.y + part.bounds.height) * part.transform.scale }
        ];
        if (corners.some(p => !insideSheet(p))) add('warning', `${part.id}: visible part extends outside sheet bounds.`, { partId, recoveryStage: 'path', recoveryAction: 'Move part inside sheet' });
    });
    activeMechanisms.forEach(m => {
        validateMechanismPreviewReadiness(m).forEach(message => add('error', `${m.id}: ${message}`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Choose ready template' }));
        (bindingWarnings[m.id] ?? []).forEach(message => add('error', `${m.id}: ${message}`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Rebind mechanism target' }));
        if (!m.id) add('error', 'Mechanism missing per-instance id.', { recoveryStage: 'design', recoveryAction: 'Select or recreate mechanism' });
        if (!m.targetPartId || !m.targetPathId) add('error', `${m.id}: choose target + path.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Choose target + path' });
        if (m.targetPartId && !project.parts[m.targetPartId]) add('error', `${m.id}: missing target part ${m.targetPartId}.`, { mechanismId: m.id, partId: m.targetPartId, recoveryStage: 'design', recoveryAction: 'Choose existing part' });
        if (m.targetPathId) {
            const path = project.paths[m.targetPathId];
            if (!path) add('error', `${m.id}: missing path ${m.targetPathId}.`, { mechanismId: m.id, pathId: m.targetPathId, recoveryStage: 'path', recoveryAction: 'Choose valid path' });
            else if (m.targetPartId && path.partId !== m.targetPartId) add('error', `${m.id}: path belongs to ${path.partId}.`, { mechanismId: m.id, pathId: m.targetPathId, partId: m.targetPartId, recoveryStage: 'design', recoveryAction: 'Rebind target path' });
        }
        const physicalNumbers = [m.crankLength, m.couplerLength, m.groundLength, m.rockerLength, m.sliderOffset, m.couplerPointDist, m.couplerPointAngle];
        if (m.type === '5bar' || m.type === '6bar' || m.type === 'piston') physicalNumbers.push(m.rodLength ?? Number.NaN);
        if (m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') physicalNumbers.push(m.gearRatio ?? Number.NaN, m.speed2 ?? Number.NaN);
        if (!physicalNumbers.every(Number.isFinite)) add('error', `${m.id}: bad dimension.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Fix dimensions' });
        if ((m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') && (m.gearRatio ?? 0) === 0) add('error', `${m.id}: gear ratio 0.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Choose non-zero ratio' });
        if (m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') {
            const expectedCenterDistance = m.type === 'gear'
                ? gearTrainPitchCenterDistance(m)
                : m.type === 'gear_linkage'
                    ? gearTrainResolvedCenterDistance(m)
                    : m.crankLength + m.rockerLength;
            if (Math.abs(m.groundLength - expectedCenterDistance) > Math.max(1, expectedCenterDistance * 0.03)) {
                add(fabricationSeverity, `${m.id}: snap gear pitch.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Snap gear pitch' });
            }
        }
        if (m.type === 'rack-pinion' && Math.abs(m.sliderOffset) < Math.max(2, m.crankLength * 0.8)) add('warning', `${m.id}: rack guide too close.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Move rack guide' });
        if (m.type === 'rack-pinion' && m.rockerLength < m.crankLength * (2 * Math.PI + 2)) add(fabricationSeverity, `${m.id}: rack too short.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Lengthen rack' });
        const range = sampleFeasibleRange(m);
        if (range.warning?.startsWith('No motion')) add('error', `${m.id}: ${range.warning}.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Adjust' });
        else if (range.warning) add('warning', `${m.id}: ${range.warning}`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Review partial motion' });
        if (!Number.isFinite(m.anchorX) || !Number.isFinite(m.anchorY)) {
            add('error', `${m.id}: missing board anchor.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Drag to board' });
            return;
        }
        const board = sceneToBoardRaw({ x: m.anchorX!, y: m.anchorY! }, project.settings.physicalKit);
        const boardScene = board.valid ? boardToScene(board.col, board.row, project.settings.physicalKit) : null;
        if (!board.valid) add(fabricationSeverity, `${m.id}: off board at ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move onto board' });
        else if (boardScene && Math.hypot(boardScene.x - m.anchorX!, boardScene.y - m.anchorY!) > snapTolerance) add(fabricationSeverity, `${m.id}: anchor off grid at ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Snap to hole' });
        else if (board.col <= 0 || board.row <= 0 || board.col >= project.settings.physicalKit.boardCells - 1 || board.row >= project.settings.physicalKit.boardCells - 1) {
            add('warning', `${m.id}: near board edge ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move inward' });
        }
        const path = generateCurvePoints(m, 72).points;
        if (path.some(p => !insideSheet(p))) add('error', `${m.id}: path outside sheet.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Resize or move' });
    });
    return { warnings, errors, issues };
};

const createRecipe = (project: ProjectState, mechanism: MechanismConfig): FabricationRecipe => {
    if (!Number.isFinite(mechanism.anchorX) || !Number.isFinite(mechanism.anchorY)) throw new Error(`${mechanism.id}: missing board coordinate anchor.`);
    const board = sceneToBoardRaw({ x: mechanism.anchorX!, y: mechanism.anchorY! }, project.settings.physicalKit);
    const boardScene = board.valid ? boardToScene(board.col, board.row, project.settings.physicalKit) : { x: mechanism.anchorX!, y: mechanism.anchorY! };
    const targetPart = mechanism.targetPartId ? project.parts[mechanism.targetPartId] : undefined;
    const targetPath = mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
    const targetAnchorJointId = preferredMotionJointId(project, mechanism.targetPartId, mechanism.targetAnchorJointId);
    const range = sampleFeasibleRange(mechanism);
    const assemblySteps = prefabAssemblySteps(mechanism, board.label);
    const warnings = [...new Set([
        ...(mechanism.warnings ?? []),
        ...((mechanism.fabricationMetadata as { warnings?: string[] } | undefined)?.warnings ?? []),
        ...(range.warning ? [range.warning] : []),
        ...((targetPart && !targetPart.visible) ? ['Target part hidden'] : [])
    ])];
    return {
        mechanismId: mechanism.id,
        type: mechanism.type,
        targetPartId: mechanism.targetPartId,
        targetPathId: mechanism.targetPathId,
        targetAnchorJointId,
        targetPartName: targetPart?.name,
        targetPathPointCount: targetPath?.points.length,
        boardCoordinate: board.label,
        board,
        sceneAnchor: { x: mechanism.anchorX!, y: mechanism.anchorY! },
        offsetFromBoardMm: { x: (mechanism.anchorX! - boardScene.x) / SCENE_PX_PER_MM, y: (mechanism.anchorY! - boardScene.y) / SCENE_PX_PER_MM },
        requiredParts: mechanism.fabricationMetadata?.requiredParts ?? mechanismRequiredParts(mechanism),
        steps: [
            `Place ${mechanism.id} main axle at ${fabricationBoardCoordinateCallout(board.label, board)}.`,
            `Kit: ${mechanismTypeLabel(mechanism.type)} module · ${project.settings.physicalKit.boardCells}×${project.settings.physicalKit.boardCells}.`,
            `Stack: ${readableFabricationStackSummary(mechanism)}.`,
            mechanism.type === 'cam'
                ? `Cam + follower · ${mechanism.groundAngle ?? 90}° · lift ${(mechanism.rockerLength || mechanism.crankLength).toFixed(0)}.`
                : mechanism.type === 'rack-pinion'
                    ? `Pinion + rack · offset ${mechanism.sliderOffset.toFixed(0)} · stops.`
                    : mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear'
                        ? `Gears: ratio ${mechanism.type === 'planetary_gear' ? planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength).toFixed(2) : gearTrainOutputRatio(mechanism).toFixed(2)}.`
                        : `${mechanismTypeLabel(mechanism.type)}: crank ${mechanism.crankLength.toFixed(0)} · coupler ${mechanism.couplerLength.toFixed(0)}.`,
            targetPart ? `Output: ${targetPart.name} · ${targetPath?.id ?? 'no path'}.` : 'Output: standalone.',
            warnings.length ? `Fix: ${warnings.join('; ')}` : 'Ready.'
        ],
        assemblySteps,
        warnings
    };
};


export const makeBlueprintSvg = (project: ProjectState, recipes: FabricationRecipe[]) => {
    const kit = project.settings.physicalKit;
    const bounds = sceneBoundsForSheet(kit);
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch));
    const label = (value: unknown, max = 24) => {
        const text = String(value);
        return esc(text.length > max ? `${text.slice(0, max - 1)}…` : text);
    };
    const requiredParts = Array.from(recipes.flatMap(recipe => recipe.requiredParts).reduce((map, part) => {
        map.set(part.name, (map.get(part.name) ?? 0) + part.quantity);
        return map;
    }, new Map<string, number>()).entries());
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 680" width="900" height="680" data-blueprint-source="fabrication-contract">`;
    svg += `<metadata>${esc(JSON.stringify({ project: project.metadata.name, profile: kit.profileKey, gridPitchMm: kit.gridPitchMm, mechanisms: recipes.map(r => r.mechanismId) }))}</metadata>`;
    svg += `<rect width="900" height="680" fill="#f8fafc"/>`;
    svg += `<style><![CDATA[text{font-family:Manrope,Inter,Arial,sans-serif}.caps{font-size:11px;font-weight:900;letter-spacing:.14em;fill:#64748b}.body{font-size:11px;font-weight:800;fill:#1f2937}.muted{fill:#64748b}.chip{fill:#eef2ff;stroke:#c4b5fd;stroke-width:1}.sheet{fill:#fff;stroke:#0f172a;stroke-width:1.5}.hole{fill:#cbd5e1}.anchor{fill:#ef4444;stroke:#fff;stroke-width:2.5}.callout{fill:#fff7ed;stroke:#fed7aa;stroke-width:1.1}]]></style>`;
    const sheet = { x: 450 + bounds.x, y: 340 - bounds.y - bounds.height, width: bounds.width, height: bounds.height };
    svg += `<rect x="${svgNumber(sheet.x)}" y="${svgNumber(sheet.y)}" width="${svgNumber(sheet.width)}" height="${svgNumber(sheet.height)}" class="sheet"/>`;
    for (let c = 0; c < kit.boardCells; c += 1) {
        for (let r = 0; r < kit.boardCells; r += 1) {
            const recipe = recipes.find(item => item.board.valid !== false && item.board.col === c && item.board.row === r);
            const { x, y } = sceneToSvg(boardToScene(c, r, kit));
            if (r === 0) svg += `<text x="${svgNumber(x)}" y="${svgNumber(y - 16)}" font-size="8" font-weight="900" text-anchor="middle" fill="#64748b">${esc(fabricationBoardColumnLabel(c))}</text>`;
            if (c === 0) svg += `<text x="${svgNumber(x - 16)}" y="${svgNumber(y + 3)}" font-size="8" font-weight="900" text-anchor="end" fill="#64748b">${esc(fabricationBoardRowLabel(r))}</text>`;
            svg += `<circle cx="${svgNumber(x)}" cy="${svgNumber(y)}" r="${recipe ? 5 : 2}" class="${recipe ? 'anchor' : 'hole'}"/>`;
            if (recipe) {
                const boardCallout = fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board);
                const title = `${referenceRecipeForType(recipe.type).title} · ${boardCallout}`;
                svg += `<g data-recipe-anchor="${esc(recipe.mechanismId)}" data-board-callout="${esc(boardCallout)}"><rect x="${svgNumber(Math.min(742, x + 9))}" y="${svgNumber(y - 19)}" width="132" height="24" rx="12" class="callout"/><text x="${svgNumber(Math.min(750, x + 17))}" y="${svgNumber(y - 3)}" class="body">${label(title, 22)}</text></g>`;
            }
        }
    }
    svg += `<text x="30" y="54" class="caps">KIT PARTS</text>`;
    (requiredParts.length ? requiredParts.slice(0, 14) : [['No mechanism module', 0] as [string, number]]).forEach(([name, quantity], index) => {
        const y = 82 + index * 30;
        svg += `<rect x="28" y="${svgNumber(y - 17)}" width="178" height="23" rx="11.5" class="chip"/>`;
        svg += `<text x="42" y="${svgNumber(y - 1)}" class="body">${label(fabricationPartDisplayLabel(name), 18)}${quantity ? ` × ${quantity}` : ''}</text>`;
    });
    svg += `</svg>`;
    return svg;
};


export const makeBlueprintPreviewSvg = (project: ProjectState, recipes: FabricationRecipe[]) => {
    const kit = project.settings.physicalKit;
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch));
    const safeColor = (value: string | undefined) => /^#[0-9a-fA-F]{3,8}$/.test(value ?? '') ? value : '#64748b';
    const label = (value: unknown, max = 28) => {
        const text = String(value);
        return esc(text.length > max ? `${text.slice(0, max - 1)}…` : text);
    };
    const partOutline = (part: BodyPartLayer, x: number, y: number, width: number, height: number, index: number) => {
        const landmarks = partLandmarkLocalPoints(part, project.skeleton);
        const outline = fabricablePartOutlinePoints(part, landmarks);
        if (outline.length < 3) return '';
        const bounds = partOutlineBounds(outline);
        const scale = Math.min(width / Math.max(1, bounds.width), (height - 14) / Math.max(1, bounds.height));
        const ox = (width - bounds.width * scale) / 2 - bounds.minX * scale;
        const oy = 7 - bounds.minY * scale;
        const xy = (point: Point) => `${svgNumber(ox + point.x * scale)} ${svgNumber(oy + point.y * scale)}`;
        const d = `M ${xy(outline[0])} ${outline.slice(1).map(point => `L ${xy(point)}`).join(' ')} Z`;
        const holes = landmarks
            .filter(point => point.x >= bounds.minX - 1 && point.x <= bounds.maxX + 1 && point.y >= bounds.minY - 1 && point.y <= bounds.maxY + 1)
            .map(point => `<circle cx="${svgNumber(ox + point.x * scale)}" cy="${svgNumber(oy + point.y * scale)}" r="${svgNumber(Math.max(2.2, kit.holeDiameterMm * 0.72))}" fill="#ffffff" stroke="#334155" stroke-width="1.2"/>`)
            .join('');
        return `<g data-cut-part="${esc(part.id)}" transform="translate(${svgNumber(x)} ${svgNumber(y)})"><rect width="${svgNumber(width)}" height="${svgNumber(height)}" rx="16" class="part-tile"/><path d="${d}" fill="#f8fafc" stroke="#172033" stroke-width="1.3"/><path d="${d}" fill="${esc(safeColor(part.fillColor))}" opacity="0.34"/>${holes}<circle cx="18" cy="18" r="10" class="part-number"/><text x="18" y="22" text-anchor="middle" class="number-label">${index + 1}</text></g>`;
    };
    const requiredParts = Array.from(recipes.flatMap(recipe => recipe.requiredParts).reduce((map, part) => {
        map.set(part.name, (map.get(part.name) ?? 0) + part.quantity);
        return map;
    }, new Map<string, number>()).entries());
    const parts = project.partOrder.map(id => project.parts[id]).filter((part): part is BodyPartLayer => Boolean(part?.visible));
    const cells = Math.max(1, kit.boardCells);
    const pitch = Math.min(34, 462 / Math.max(1, cells - 1));
    const boardX = 350;
    const boardY = 132;
    const boardSize = pitch * Math.max(0, cells - 1);
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 680" width="900" height="680" data-blueprint-source="fabrication-contract" data-blueprint-visual-mode="board-hero">`;
    svg += `<metadata>${esc(JSON.stringify({ project: project.metadata.name, profile: kit.profileKey, gridPitchMm: kit.gridPitchMm, recipes: recipes.map(r => ({ id: r.mechanismId, type: r.type, board: r.boardCoordinate })) }))}</metadata>`;
    svg += `<rect width="900" height="680" fill="#f8fafc"/>`;
    svg += `<style><![CDATA[text{font-family:Manrope,Inter,Arial,sans-serif}.caps{font-size:12px;font-weight:900;letter-spacing:.16em;fill:#64748b}.body{font-size:12px;font-weight:800;fill:#1f2937}.muted{fill:#64748b}.board-label{font-size:10px;font-weight:900;fill:#64748b}.hole{fill:#cbd5e1}.anchor{fill:#ef4444;stroke:white;stroke-width:3}.anchor-ring{fill:rgba(239,68,68,.12);stroke:#ef4444;stroke-width:2.6}.part-card,.kit-card{fill:white;stroke:#e2e8f0;stroke-width:1.4}.part-tile{fill:#ffffff;stroke:#e2e8f0;stroke-width:1}.board-card{fill:white;stroke:#0f172a;stroke-width:1.8}.board-shadow{fill:#e2e8f0}.callout{fill:#fff7ed;stroke:#fed7aa;stroke-width:1.2}.chip{fill:#eef2ff;stroke:#c4b5fd;stroke-width:1}.part-number,.recipe-number{fill:#8b5cf6;stroke:#fff;stroke-width:2}.number-label{font-size:10px;font-weight:900;fill:#fff}.step-dot{fill:#ede9fe;stroke:#8b5cf6;stroke-width:1.4}.trace{fill:none;stroke:#8b5cf6;stroke-width:2;stroke-dasharray:8 8;opacity:.52}]]></style>`;
    svg += `<g data-blueprint-flow="visual-summary"><circle cx="38" cy="36" r="10" class="step-dot"/><path d="M54 36H96" class="trace"/><circle cx="112" cy="36" r="10" class="step-dot"/><path d="M128 36H170" class="trace"/><circle cx="186" cy="36" r="10" class="step-dot"/><text x="210" y="41" class="caps">CUT · PLACE · BUILD</text></g>`;
    svg += `<g data-blueprint-parts-panel"><text x="32" y="76" class="caps">PARTS</text><rect x="24" y="94" width="244" height="382" rx="22" class="part-card"/>`;
    if (parts.length) {
        parts.slice(0, 8).forEach((part, index) => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            svg += partOutline(part, 42 + col * 108, 114 + row * 84, 92, 70, index);
        });
        if (parts.length > 8) svg += `<text x="42" y="456" class="body muted">+${parts.length - 8}</text>`;
    } else {
        svg += `<rect x="64" y="206" width="164" height="74" rx="18" fill="#f8fafc" stroke="#e2e8f0"/><text x="146" y="249" text-anchor="middle" class="body muted">No cuts</text>`;
    }
    svg += `</g>`;
    svg += `<g data-blueprint-kit-panel"><text x="32" y="514" class="caps">KIT</text><rect x="24" y="532" width="244" height="108" rx="22" class="kit-card"/>`;
    const kitLines = requiredParts.length ? requiredParts.slice(0, 6) : [['No mechanism module', 0] as [string, number]];
    kitLines.forEach(([name, quantity], index) => {
        const x = 42 + (index % 2) * 106;
        const y = 558 + Math.floor(index / 2) * 30;
        svg += `<rect x="${x}" y="${svgNumber(y - 17)}" width="92" height="23" rx="11.5" class="chip"/>`;
        svg += `<text x="${x + 10}" y="${svgNumber(y - 1)}" class="body">${label(fabricationPartDisplayLabel(name), 10)}${quantity ? ` ×${quantity}` : ''}</text>`;
    });
    svg += `</g>`;

    svg += `<g data-blueprint-board-hero"><text x="${boardX - 30}" y="76" class="caps">BOARD</text><text x="${boardX + 28}" y="76" class="body muted">${cells}×${cells} · ${kit.gridPitchMm}mm</text>`;
    svg += `<rect x="${boardX - 36}" y="${boardY - 36}" width="${boardSize + 72}" height="${boardSize + 72}" rx="28" class="board-shadow" opacity=".48" transform="translate(8 10)"/>`;
    svg += `<rect x="${boardX - 36}" y="${boardY - 36}" width="${boardSize + 72}" height="${boardSize + 72}" rx="28" class="board-card"/>`;
    for (let c = 0; c < cells; c += 1) {
        for (let r = 0; r < cells; r += 1) {
            const x = boardX + c * pitch;
            const y = boardY + r * pitch;
            const atCell = recipes.filter(recipe => recipe.board.valid !== false && recipe.board.col === c && recipe.board.row === r);
            if (r === 0) svg += `<text x="${svgNumber(x)}" y="${svgNumber(boardY - 50)}" text-anchor="middle" class="board-label">${esc(fabricationBoardColumnLabel(c))}</text>`;
            if (c === 0) svg += `<text x="${svgNumber(boardX - 48)}" y="${svgNumber(y + 3)}" text-anchor="end" class="board-label">${esc(fabricationBoardRowLabel(r))}</text>`;
            svg += `<circle cx="${svgNumber(x)}" cy="${svgNumber(y)}" r="${atCell.length ? 5.5 : 2.4}" class="${atCell.length ? 'anchor' : 'hole'}"/>`;
            if (atCell.length) {
                atCell.slice(0, 2).forEach((recipe, index) => {
                    const boardCallout = fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board);
                    const calloutX = Math.min(806, x + 18);
                    const calloutY = Math.max(112, y - 22 + index * 27);
                    const recipeNumber = recipes.findIndex(item => item.mechanismId === recipe.mechanismId) + 1;
                    svg += `<g data-recipe-anchor="${esc(recipe.mechanismId)}" data-board-callout="${esc(boardCallout)}" data-recipe-number="${recipeNumber}"><circle cx="${svgNumber(x)}" cy="${svgNumber(y)}" r="17" class="anchor-ring"/><rect x="${svgNumber(calloutX)}" y="${svgNumber(calloutY - 15)}" width="78" height="24" rx="12" class="callout"/><circle cx="${svgNumber(calloutX + 13)}" cy="${svgNumber(calloutY - 3)}" r="10" class="recipe-number"/><text x="${svgNumber(calloutX + 13)}" y="${svgNumber(calloutY + 1)}" text-anchor="middle" class="number-label">${recipeNumber}</text><text x="${svgNumber(calloutX + 29)}" y="${svgNumber(calloutY + 1)}" class="body">${esc(boardCallout.split(' · ')[0])}</text></g>`;
                });
            }
        }
    }
    if (!recipes.length) svg += `<rect x="${svgNumber(boardX + boardSize / 2 - 84)}" y="${svgNumber(boardY + boardSize / 2 - 24)}" width="168" height="48" rx="24" class="chip"/><text x="${svgNumber(boardX + boardSize / 2)}" y="${svgNumber(boardY + boardSize / 2 + 4)}" text-anchor="middle" class="body muted">Add mechanism</text>`;
    svg += `</g></svg>`;
    return svg;
};

type CharacterPrintPart = {
    part: BodyPartLayer;
    sourceCenterMm: Point;
    printCenterMm: Point;
    outlineMm: Point[];
    holeMm: Point[];
};

const transformedPartPoint = (part: BodyPartLayer, point: Point): Point => {
    const angle = (part.transform.rotation * Math.PI) / 180;
    const scale = Math.max(0.001, part.transform.scale);
    const x = point.x * scale;
    const y = point.y * scale;
    return {
        x: part.transform.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: part.transform.y + x * Math.sin(angle) + y * Math.cos(angle)
    };
};

const printBoundsForPoints = (points: Point[]) => {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys)
    };
};

const buildCharacterPrintLayout = (project: ProjectState) => {
    const kit = project.settings.physicalKit;
    const parts = project.partOrder.map(id => project.parts[id]).filter((part): part is BodyPartLayer => Boolean(part?.visible));
    const source = parts.map(part => {
        const landmarks = partLandmarkLocalPoints(part, project.skeleton);
        const outline = fabricablePartOutlinePoints(part, landmarks);
        if (outline.length < 3) return null;
        const outlineScene = outline.map(point => transformedPartPoint(part, point));
        const holeScene = landmarks
            .filter(point => pointInsideOutline(point, outline, 0.5))
            .map(point => transformedPartPoint(part, point));
        const bounds = printBoundsForPoints(outlineScene);
        return {
            part,
            outlineScene,
            holeScene,
            centerScene: {
                x: (bounds.minX + bounds.maxX) / 2,
                y: (bounds.minY + bounds.maxY) / 2
            }
        };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!source.length) return { parts: [] as CharacterPrintPart[], scale: 1, holeRadiusMm: kit.holeDiameterMm / 2 };

    const allScene = source.flatMap(item => item.outlineScene);
    const allBounds = printBoundsForPoints(allScene);
    const characterCenter = {
        x: (allBounds.minX + allBounds.maxX) / 2,
        y: (allBounds.minY + allBounds.maxY) / 2
    };
    const explodeScene = 10 * SCENE_PX_PER_MM;
    const rawItems = source.map(item => {
        const dx = item.centerScene.x - characterCenter.x;
        const dy = item.centerScene.y - characterCenter.y;
        const length = Math.hypot(dx, dy) || 1;
        const offset = { x: (dx / length) * explodeScene, y: (dy / length) * explodeScene };
        const toRawMm = (point: Point) => ({ x: (point.x + offset.x) / SCENE_PX_PER_MM, y: -(point.y + offset.y) / SCENE_PX_PER_MM });
        const sourceCenterMm = { x: item.centerScene.x / SCENE_PX_PER_MM, y: -item.centerScene.y / SCENE_PX_PER_MM };
        return {
            part: item.part,
            sourceCenterMm,
            printCenterRawMm: toRawMm(item.centerScene),
            outlineRawMm: item.outlineScene.map(toRawMm),
            holeRawMm: item.holeScene.map(toRawMm)
        };
    });
    const rawBounds = printBoundsForPoints(rawItems.flatMap(item => item.outlineRawMm));
    const margin = 12;
    const titleBand = 18;
    const footerBand = 10;
    const availableWidth = Math.max(1, kit.sheetWidthMm - margin * 2);
    const availableHeight = Math.max(1, kit.sheetHeightMm - titleBand - footerBand);
    const scale = Math.min(1, availableWidth / Math.max(1, rawBounds.width), availableHeight / Math.max(1, rawBounds.height));
    const offset = {
        x: kit.sheetWidthMm / 2 - ((rawBounds.minX + rawBounds.maxX) / 2) * scale,
        y: titleBand + availableHeight / 2 - ((rawBounds.minY + rawBounds.maxY) / 2) * scale
    };
    const toPageMm = (point: Point) => ({ x: offset.x + point.x * scale, y: offset.y + point.y * scale });
    return {
        scale,
        holeRadiusMm: Math.max(0.5, (kit.holeDiameterMm / 2) * scale),
        parts: rawItems.map(item => ({
            part: item.part,
            sourceCenterMm: toPageMm(item.sourceCenterMm),
            printCenterMm: toPageMm(item.printCenterRawMm),
            outlineMm: item.outlineRawMm.map(toPageMm),
            holeMm: item.holeRawMm.map(toPageMm)
        }))
    };
};

const makeCustomPartsSvg = (project: ProjectState) => {
    const kit = project.settings.physicalKit;
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch));
    const layout = buildCharacterPrintLayout(project);
    const point = (p: Point) => `${svgNumber(p.x)} ${svgNumber(p.y)}`;
    const path = (points: Point[]) => points.length ? `M ${point(points[0])} ${points.slice(1).map(p => `L ${point(p)}`).join(' ')} Z` : '';
    const items = layout.parts.map(({ part, outlineMm, holeMm, sourceCenterMm, printCenterMm }) => {
        const d = path(outlineMm);
        const holes = holeMm
            .map(p => `<circle cx="${svgNumber(p.x)}" cy="${svgNumber(p.y)}" r="${svgNumber(layout.holeRadiusMm)}" fill="#ffffff" stroke="#334155" stroke-width="0.45"/>`)
            .join('');
        return `<g data-part-id="${esc(part.id)}">
<line x1="${svgNumber(sourceCenterMm.x)}" y1="${svgNumber(sourceCenterMm.y)}" x2="${svgNumber(printCenterMm.x)}" y2="${svgNumber(printCenterMm.y)}" stroke="#cbd5e1" stroke-width="0.35" stroke-dasharray="1.8 1.8"/>
<path d="${d}" fill="#f8fafc" stroke="#172033" stroke-width="0.5"/>
<path d="${d}" fill="${esc(part.fillColor)}" opacity="0.18"/>
${holes}
</g>`;
    }).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${kit.sheetWidthMm}mm" height="${kit.sheetHeightMm}mm" viewBox="0 0 ${kit.sheetWidthMm} ${kit.sheetHeightMm}" data-character-print-page="letter" data-character-print-mode="whole-character-exploded">
<metadata>${esc(JSON.stringify({ project: project.metadata.name, mode: 'custom-parts', printMode: 'whole-character-exploded', page: 'letter', units: 'mm', scale: layout.scale, source: 'fabricablePartOutlinePoints' }))}</metadata>
<rect width="100%" height="100%" fill="#ffffff"/>
<rect x="6" y="6" width="${svgNumber(kit.sheetWidthMm - 12)}" height="${svgNumber(kit.sheetHeightMm - 12)}" rx="6" fill="none" stroke="#dbe3f0" stroke-width="0.5"/>
<text x="10" y="12" font-family="Inter,Arial" font-size="5" font-weight="900" fill="#172033">MotionSmith character cut sheet</text>
<text x="10" y="${svgNumber(kit.sheetHeightMm - 8)}" font-family="Inter,Arial" font-size="3.4" font-weight="700" fill="#64748b">${layout.parts.length} parts · ${kit.holeDiameterMm}mm holes · one letter page</text>
<g data-character-exploded-sheet>
${items}
</g>
</svg>`;
};

const stlNum = (value: number) => Number.isFinite(value) ? Number(value.toFixed(4)) : 0;

const makeCustomPartsStl = (project: ProjectState) => {
    const thicknessMm = 2.4;
    const holeRadiusMm = Math.max(0.5, project.settings.physicalKit.holeDiameterMm / 2);
    const cellMm = Math.max(1, Math.min(2, holeRadiusMm * 0.75));
    const facets: string[] = [];
    const vertex = (x: number, y: number, z: number) => `      vertex ${stlNum(x)} ${stlNum(y)} ${stlNum(z)}`;
    const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
        facets.push(`  facet normal 0 0 0\n    outer loop\n${vertex(...a)}\n${vertex(...b)}\n${vertex(...c)}\n    endloop\n  endfacet`);
    };
    const edge = (a: [number, number], b: [number, number]) => {
        tri([a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], thicknessMm]);
        tri([a[0], a[1], 0], [b[0], b[1], thicknessMm], [a[0], a[1], thicknessMm]);
    };
    let cursorX = 0;
    project.partOrder.forEach(partId => {
        const part = project.parts[partId];
        if (!part?.visible) return;
        const landmarks = partLandmarkLocalPoints(part, project.skeleton);
        const outline = fabricablePartOutlinePoints(part, landmarks);
        if (outline.length < 3) return;
        const bounds = partOutlineBounds(outline);
        const outlineMm = outline.map(p => ({ x: (p.x - bounds.minX) / SCENE_PX_PER_MM, y: (p.y - bounds.minY) / SCENE_PX_PER_MM }));
        const holesMm = landmarks
            .filter(p => pointInsideOutline(p, outline, 0.5))
            .map(p => ({ x: (p.x - bounds.minX) / SCENE_PX_PER_MM, y: (p.y - bounds.minY) / SCENE_PX_PER_MM }));
        const cols = Math.ceil(bounds.width / SCENE_PX_PER_MM / cellMm);
        const rows = Math.ceil(bounds.height / SCENE_PX_PER_MM / cellMm);
        const occupied = new Set<string>();
        const inside = (x: number, y: number) => pointInsideOutline({ x, y }, outlineMm, cellMm * 0.75)
            && !holesMm.some(hole => Math.hypot(x - hole.x, y - hole.y) < holeRadiusMm);
        for (let col = 0; col < cols; col += 1) {
            for (let row = 0; row < rows; row += 1) {
                const cx = (col + 0.5) * cellMm;
                const cy = (row + 0.5) * cellMm;
                if (inside(cx, cy)) occupied.add(`${col}:${row}`);
            }
        }
        const hasCell = (col: number, row: number) => occupied.has(`${col}:${row}`);
        occupied.forEach(key => {
            const [col, row] = key.split(':').map(Number);
            const x0 = cursorX + col * cellMm;
            const y0 = row * cellMm;
            const x1 = cursorX + (col + 1) * cellMm;
            const y1 = (row + 1) * cellMm;
            tri([x0, y0, thicknessMm], [x1, y0, thicknessMm], [x1, y1, thicknessMm]);
            tri([x0, y0, thicknessMm], [x1, y1, thicknessMm], [x0, y1, thicknessMm]);
            tri([x0, y0, 0], [x1, y1, 0], [x1, y0, 0]);
            tri([x0, y0, 0], [x0, y1, 0], [x1, y1, 0]);
            if (!hasCell(col - 1, row)) edge([x0, y0], [x0, y1]);
            if (!hasCell(col + 1, row)) edge([x1, y1], [x1, y0]);
            if (!hasCell(col, row - 1)) edge([x1, y0], [x0, y0]);
            if (!hasCell(col, row + 1)) edge([x0, y1], [x1, y1]);
        });
        cursorX += bounds.width / SCENE_PX_PER_MM + 12;
    });
    return `solid motionsmith_custom_parts_with_${project.settings.physicalKit.holeDiameterMm}mm_holes\n${facets.join('\n')}\nendsolid motionsmith_custom_parts\n`;
};

const makeCustomPartsPdf = (project: ProjectState) => {
    const kit = project.settings.physicalKit;
    const layout = buildCharacterPrintLayout(project);
    const page = { width: 612, height: 792, margin: 38 };
    const pageScale = Math.min(page.width / kit.sheetWidthMm, page.height / kit.sheetHeightMm);
    const toPdf = (point: Point) => ({ x: point.x * pageScale, y: page.height - point.y * pageScale });
    const border = {
        x: 6 * pageScale,
        y: page.height - (kit.sheetHeightMm - 6) * pageScale,
        width: (kit.sheetWidthMm - 12) * pageScale,
        height: (kit.sheetHeightMm - 12) * pageScale
    };
    const commands: string[] = [
        `BT /F1 14 Tf ${num(page.margin)} ${num(page.height - 32)} Td (${pdfText('MotionSmith character cut sheet')}) Tj ET`,
        `BT /F1 8 Tf ${num(page.margin)} ${num(page.height - 48)} Td (${pdfText(`${project.metadata.name} / whole-character-exploded / letter page / ${kit.holeDiameterMm}mm holes`)}) Tj ET`,
        `0.86 0.89 0.94 RG 0.5 w ${num(border.x)} ${num(border.y)} ${num(border.width)} ${num(border.height)} re S`
    ];
    layout.parts.forEach(({ part, outlineMm, holeMm, sourceCenterMm, printCenterMm }) => {
        const source = toPdf(sourceCenterMm);
        const target = toPdf(printCenterMm);
        commands.push(`0.80 0.84 0.90 RG 0.35 w ${num(source.x)} ${num(source.y)} m ${num(target.x)} ${num(target.y)} l S`);
        const mapped = outlineMm.map(toPdf);
        if (mapped.length) {
            commands.push('0.10 0.16 0.28 RG 0.97 0.98 1.00 rg 0.7 w');
            commands.push(`${num(mapped[0].x)} ${num(mapped[0].y)} m ${mapped.slice(1).map(p => `${num(p.x)} ${num(p.y)} l`).join(' ')} h B`);
            const label = toPdf(printCenterMm);
            commands.push(`0.29 0.33 0.43 rg BT /F1 6 Tf ${num(label.x + 5)} ${num(label.y)} Td (${pdfText(part.name)}) Tj ET`);
        }
        holeMm.forEach(point => {
            const center = toPdf(point);
            const radius = Math.max(1.2, layout.holeRadiusMm * pageScale);
            commands.push('0.10 0.16 0.28 RG 1 1 1 rg 0.5 w');
            commands.push(`${circlePath(center.x, center.y, radius)} B`);
        });
    });
    commands.push(`0.39 0.45 0.55 rg BT /F1 7 Tf ${num(page.margin)} ${num(30)} Td (${pdfText(`${layout.parts.length} parts on one letter page`)}) Tj ET`);
    return makePdfDocument(commands.join('\n'));
};


const makeExplodedStackSvg = (recipe: FabricationRecipe | undefined, esc: (value: unknown) => string) => {
    const stack = recipe ? fabricationStackForMechanism(recipe) : [];
    const base = fabricationBaseLayer();
    const rows = stack.length ? stack : [layer('Back Clip', 'clip'), layer('Input linkage', 'linkage'), layer(FABRICATION_SPACER_SPEC.label, 'spacer'), layer('Output linkage', 'linkage'), layer('Front Clip', 'clip')];
    const shapeFor = (item: FabricationStackLayer, x: number, y: number) => {
        const fill = item.color;
        const stroke = item.role === 'clip' ? '#0f172a' : '#334155';
        if (item.role === 'gear' || item.role === 'cam') return `<circle cx="${x + 72}" cy="${y + 18}" r="30" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="${x + 72}" cy="${y + 18}" r="8" fill="#fff" stroke="#334155" stroke-width="3"/>`;
        if (item.role === 'spacer') return `<circle cx="${x + 72}" cy="${y + 18}" r="20" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="${x + 72}" cy="${y + 18}" r="8" fill="#fff"/>`;
        if (item.role === 'base' || item.role === 'guide') return `<rect x="${x}" y="${y}" width="180" height="36" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
        if (item.role === 'rack') return `<rect x="${x}" y="${y + 5}" width="170" height="26" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="3"/><path d="M ${x + 14} ${y + 5} ${Array.from({ length: 12 }, (_, i) => `L ${x + 24 + i * 12} ${i % 2 ? y + 5 : y - 6}`).join(' ')}" fill="none" stroke="#334155" stroke-width="2"/>`;
        return `<rect x="${x}" y="${y}" width="190" height="36" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="${x + 28}" cy="${y + 18}" r="8" fill="#fff" stroke="#334155" stroke-width="3"/><circle cx="${x + 162}" cy="${y + 18}" r="8" fill="#fff" stroke="#334155" stroke-width="3"/>`;
    };
    const items = rows.map((item, index) => {
        const x = 110 + index * 44;
        const y = 360 - index * 38;
        const labelX = 565;
        const labelY = 410 - index * 31;
        return `<g>
<line x1="${x + 72}" y1="${y + 18}" x2="${labelX - 22}" y2="${labelY - 4}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6 8"/>
${shapeFor(item, x, y)}
	<text x="${labelX}" y="${labelY}" class="guide-label">Z+${index + 1} ${esc(fabricationPartDisplayLabel(item.label))}</text>
	<text x="${labelX}" y="${labelY + 18}" class="guide-muted">${esc(item.role)}</text>
	</g>`;
    }).join('');
    return `<svg class="exploded-guide" viewBox="0 0 900 520" role="img" aria-label="Exploded view assembly order">
<defs>
<pattern id="guide-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="#dbeafe" stroke-width="1"/></pattern>
<filter id="guide-shadow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="10" dy="14" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.14"/></filter>
</defs>
<rect width="900" height="520" rx="28" fill="#ffffff"/>
<rect width="900" height="520" fill="url(#guide-grid)" opacity="0.55"/>
<path d="M 80 462 C 230 410, 330 356, 490 382 S 660 444, 818 356" fill="none" stroke="#6366f1" stroke-width="7" stroke-linecap="round" stroke-dasharray="18 15" opacity=".62"/>
<text x="646" y="354" class="guide-blue">Path projection</text>
<g transform="translate(38 36)">
<rect width="330" height="74" rx="20" fill="#ffffff" stroke="#c7d2fe" stroke-width="2"/>
<text x="22" y="25" class="guide-title">Exploded view</text>
	<text x="22" y="47" class="guide-muted">Stack: listed low-Z board side to high-Z fastener side</text>
	<text x="22" y="64" class="guide-muted">Z=0 board · ${recipe ? esc(recipe.mechanismId) : 'pending recipe'}</text>
	</g>
	<g transform="translate(86 426)">
	<rect width="310" height="36" rx="9" fill="${base.color}" stroke="#334155" stroke-width="3"/>
	<text x="18" y="24" class="guide-muted">Z=0 ${esc(base.label)}</text>
	</g>
	<g filter="url(#guide-shadow)">${items}</g>
<line x1="92" y1="458" x2="438" y2="130" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8 10"/>
<text x="70" y="486" class="guide-muted">Board-side S10 spacers lift moving parts before the fastener head.</text>
${recipe ? `<text x="40" y="505" class="guide-muted">Recipe: ${esc(recipe.mechanismId)} · ${esc(mechanismTypeLabel(recipe.type))} · anchor ${esc(recipeBoardCallout(recipe))}</text>` : ''}
</svg>`;
};

const makeAssemblyGuideHtml = (project: ProjectState, recipes: FabricationRecipe[], warnings: string[]) => {
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
    const firstRecipe = recipes[0];
    const explodedSvg = makeExplodedStackSvg(firstRecipe, esc);
    const recipeSections = recipes.map(recipe => {
        const target = recipeTargetCallout(recipe);
        return `<section>
<h2>${esc(recipe.mechanismId)} · ${esc(mechanismTypeLabel(recipe.type))}</h2>
<p><strong>Board:</strong> ${esc(recipeBoardCallout(recipe))}</p>
${target ? `<p class="target-chip"><strong>Target:</strong> ${esc(target)}</p>` : ''}
${recipe.warnings.length ? `<p><strong>Fix:</strong> ${recipe.warnings.map(esc).join('; ')}</p>` : '<p><strong>OK</strong></p>'}
<h3>Required parts</h3><ul>${recipe.requiredParts.map(part => `<li>${esc(fabricationPartDisplayLabel(part.name))} × ${part.quantity}</li>`).join('')}</ul>
<h3>15×15 board kit assembly</h3><ol class="stepper" data-testid="prefab-assembly-steps">${recipe.assemblySteps.map(step => `<li class="assembly-step" style="--i:${step.index}"><strong>${step.index}. ${esc(fabricationPartDisplayLabel(step.label))}</strong><span>${esc(fabricationPartDisplayLabel(step.instruction))}</span><em>${esc(step.role)} · ${esc(readableStepCoordinateCallout(step))} · Z ${step.zMm.toFixed(1)}mm</em></li>`).join('')}</ol>
</section>`;
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(project.metadata.name)} assembly</title><style>
body{margin:0;background:#f8f9ff;color:#172033;font-family:Inter,Arial,sans-serif;}
.page{max-width:980px;margin:0 auto;padding:28px;}
.print-actions{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:16px;align-items:center;margin:-28px -28px 20px;padding:14px 28px;background:rgba(255,255,255,.94);border-bottom:1px solid #dbe3f0;backdrop-filter:blur(12px);}
button{border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#172033;padding:10px 16px;font-weight:800;cursor:pointer;}
h1{margin:0;font-size:40px;line-height:.98;letter-spacing:-.05em;} h2{margin:0 0 10px;font-size:24px;} h3{margin:18px 0 8px;}
.subtitle{color:#64748b;font-weight:750;}
.exploded-guide{display:block;width:100%;margin:22px 0;border:1px solid #dbe3f0;border-radius:28px;background:#fff;box-shadow:0 22px 70px rgba(15,23,42,.10);}
.guide-title{font-size:20px;font-weight:900;fill:#172033}.guide-label{font-size:18px;font-weight:900;fill:#64748b}.guide-muted{font-size:14px;font-weight:800;fill:#64748b}.guide-blue{font-size:18px;font-weight:900;fill:#4f46e5}
.warning{border:1px solid #fed7aa;border-radius:14px;background:#fff7ed;padding:12px;margin:10px 0;font-weight:750;}
.target-chip{display:inline-flex;gap:8px;border:1px solid #c7d2fe;border-radius:999px;background:#eef2ff;padding:8px 12px;font-weight:850;color:#334155;}
section{break-inside:avoid;margin:18px 0;padding:20px;border:1px solid #dbe3f0;border-radius:22px;background:#fff;box-shadow:0 16px 46px rgba(15,23,42,.06);}
li{margin:.32rem 0;line-height:1.42;}
.stepper{display:grid;gap:10px;padding-left:0;list-style:none}.assembly-step{display:grid;gap:3px;border:1px solid #dbe3f0;border-radius:16px;padding:10px 12px;background:linear-gradient(135deg,#fff,#f8f9ff);animation:step-rise .8s ease both;animation-delay:calc(var(--i) * 90ms)}.assembly-step span{font-weight:750;color:#334155}.assembly-step em{font-style:normal;color:#64748b;font-weight:800;font-size:12px}@keyframes step-rise{from{opacity:.25;transform:translateY(12px)}to{opacity:1;transform:none}}
@media print{body{background:#fff}.page{max-width:none;padding:10mm}.print-actions{display:none}.exploded-guide,section{box-shadow:none}section{page-break-inside:avoid}}
</style></head><body><main class="page"><div class="print-actions"><strong>Printable assembly guide</strong><button onclick="window.print()">Print guide</button></div><h1>${esc(project.metadata.name)} assembly guide</h1><p class="subtitle">Profile ${esc(project.settings.physicalKit.profileKey)} · ${project.settings.physicalKit.gridPitchMm}mm grid · exploded view.</p>${explodedSvg}${warnings.map(w => `<p class="warning"><strong>Fix:</strong> ${esc(w)}</p>`).join('')}${recipeSections}</main></body></html>`;
};

const makePdfDocument = (content: string) => {
    const objects = [
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
        '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
        `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach(obj => { offsets.push(pdf.length); pdf += `${obj}\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\n`;
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
};

const pdfText = (value: unknown) => String(value)
    .replace(/·/g, '/')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/[()\\]/g, '\\$&')
    .slice(0, 120);

const num = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '0';

const circlePath = (x: number, y: number, r: number) => {
    const k = r * 0.5522847498;
    return `${num(x + r)} ${num(y)} m ${num(x + r)} ${num(y + k)} ${num(x + k)} ${num(y + r)} ${num(x)} ${num(y + r)} c ${num(x - k)} ${num(y + r)} ${num(x - r)} ${num(y + k)} ${num(x - r)} ${num(y)} c ${num(x - r)} ${num(y - k)} ${num(x - k)} ${num(y - r)} ${num(x)} ${num(y - r)} c ${num(x + k)} ${num(y - r)} ${num(x + r)} ${num(y - k)} ${num(x + r)} ${num(y)} c h`;
};

const hexRgb = (value: string | undefined) => {
    const safe = /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value! : '#5a6cff';
    const r = parseInt(safe.slice(1, 3), 16) / 255;
    const g = parseInt(safe.slice(3, 5), 16) / 255;
    const b = parseInt(safe.slice(5, 7), 16) / 255;
    return `${num(r)} ${num(g)} ${num(b)}`;
};

const makeCutSheetPdf = (project: ProjectState, recipes: FabricationRecipe[]) => {
    const kit = project.settings.physicalKit;
    const bounds = sceneBoundsForSheet(kit);
    const page = { width: 612, height: 792, margin: 38, titleY: 760 };
    const scale = Math.min((page.width - page.margin * 2) / bounds.width, (page.height - 150) / bounds.height);
    const origin = { x: page.width / 2, y: 390 };
    const toPdf = (p: { x: number; y: number }) => ({ x: origin.x + p.x * scale, y: origin.y + p.y * scale });
    const sheetLeft = origin.x + bounds.x * scale;
    const sheetBottom = origin.y + bounds.y * scale;
    const commands: string[] = [
        `BT /F1 14 Tf ${page.margin} ${page.titleY} Td (Cut sheet: ${pdfText(project.metadata.name)}) Tj ET`,
        `BT /F1 9 Tf ${page.margin} ${page.titleY - 18} Td (Profile ${pdfText(kit.profileKey)} / ${kit.gridPitchMm}mm pitch / ${kit.boardCells}x${kit.boardCells} board holes) Tj ET`,
        '0.92 0.95 1.00 rg 0.10 0.16 0.28 RG 1.1 w',
        `${num(sheetLeft)} ${num(sheetBottom)} ${num(bounds.width * scale)} ${num(bounds.height * scale)} re B`
    ];
    for (let c = 0; c < kit.boardCells; c++) {
        for (let r = 0; r < kit.boardCells; r++) {
            const recipe = recipes.find(x => x.board.valid !== false && x.board.col === c && x.board.row === r);
            const p = toPdf(boardToScene(c, r, kit));
            if (r === 0) commands.push(`0.40 0.46 0.57 rg BT /F1 6 Tf ${num(p.x - 4)} ${num(p.y + 13)} Td (${pdfText(fabricationBoardColumnLabel(c))}) Tj ET`);
            if (c === 0) commands.push(`0.40 0.46 0.57 rg BT /F1 6 Tf ${num(p.x - 20)} ${num(p.y - 2)} Td (${pdfText(fabricationBoardRowLabel(r))}) Tj ET`);
            commands.push(recipe ? '0.94 0.27 0.27 rg' : '0.62 0.68 0.78 rg');
            commands.push(`${circlePath(p.x, p.y, recipe ? 3.8 : 1.7)} f`);
            if (recipe) commands.push(`0.10 0.16 0.28 rg BT /F1 7 Tf ${num(p.x + 6)} ${num(p.y + 5)} Td (${pdfText(`${recipe.mechanismId} ${recipeBoardCallout(recipe)}`)}) Tj ET`);
        }
    }
    project.mechanisms.filter(m => m.visible && m.enabled !== false).forEach(m => {
        const points = generateCurvePoints(m, 48).points.map(toPdf);
        if (points.length > 1) {
            commands.push(`${hexRgb(m.color)} RG 0.9 w`);
            commands.push(`${num(points[0].x)} ${num(points[0].y)} m ${points.slice(1).map(p => `${num(p.x)} ${num(p.y)} l`).join(' ')} S`);
        }
    });
    recipes.slice(0, 12).forEach((recipe, index) => {
        commands.push(`0.10 0.16 0.28 rg BT /F1 8 Tf ${page.margin} ${118 - index * 10} Td (${pdfText(`${recipe.mechanismId}: ${mechanismTypeLabel(recipe.type)} anchor ${recipeBoardCallout(recipe)}`)}) Tj ET`);
    });
    return makePdfDocument(commands.join('\n'));
};

const makeSimplePdf = (title: string, lines: string[]) => {
    const text = [title, ...lines].slice(0, 46);
    const content = `BT /F1 14 Tf 50 760 Td ${text.map((line, i) => `${i ? '0 -16 Td ' : ''}(${pdfText(line)}) Tj`).join(' ')} ET`;
    return makePdfDocument(content);
};

const makeAssemblyGuidePdf = (project: ProjectState, recipes: FabricationRecipe[], warnings: string[]) => makeSimplePdf(
    `${project.metadata.name} Printable assembly guide`,
    [
        'Exploded view / Base board below / Clip -> Linkage or Gear -> Spacer -> Linkage -> Clip',
        `Stack: ${recipes[0] ? readableFabricationStackSummary(recipes[0]) : 'pending recipe'}`,
        'Path projection / Z=0 Base / spacer-separated moving layers',
        `Profile ${project.settings.physicalKit.profileKey} / ${project.settings.physicalKit.gridPitchMm}mm grid`,
        ...warnings.map(warning => `Warning: ${warning}`),
        ...recipes.flatMap(recipe => [
            `${recipe.mechanismId} / ${mechanismTypeLabel(recipe.type)} / anchor ${recipeBoardCallout(recipe)}`,
            `Target: ${recipeTargetCallout(recipe) || 'none'}`,
            `Required parts: ${recipe.requiredParts.map(part => `${fabricationPartDisplayLabel(part.name)} x ${part.quantity}`).join(', ')}`,
            ...recipe.assemblySteps.map(step => `Kit step ${step.index}: ${fabricationPartDisplayLabel(step.label)} / ${readableStepCoordinateCallout(step)} / Z ${step.zMm.toFixed(1)}mm`)
        ])
    ]
);

export const createFabricationPackage = (project: ProjectState): FabricationPackage => {
    const validation = validateForFabrication(project);
    if (validation.errors.length) throw new Error(validation.errors.join('\n'));
    const recipes = project.mechanisms.filter(m => m.visible && m.enabled !== false).map(m => createRecipe(project, m));
    const cutList = Array.from(
        recipes.flatMap(r => r.requiredParts).reduce((map, item) => {
            map.set(item.name, (map.get(item.name) ?? 0) + item.quantity);
            return map;
        }, new Map<string, number>())
    ).map(([name, quantity]) => ({ name, quantity }));

    const metadata = {
        projectId: project.metadata.id,
        projectName: project.metadata.name,
        createdAt: new Date().toISOString(),
        profile: project.settings.physicalKit,
        validationIssues: validation.issues,
        sceneSnapshot: { metadata: project.metadata, paths: project.paths, mechanisms: project.mechanisms },
        recipes: recipes.map(r => ({
            mechanismId: r.mechanismId,
            type: r.type,
            targetPartId: r.targetPartId,
            targetPathId: r.targetPathId,
            targetAnchorJointId: r.targetAnchorJointId,
            targetPartName: r.targetPartName,
            targetPathPointCount: r.targetPathPointCount,
            boardCoordinate: r.boardCoordinate,
            board: r.board,
            sceneAnchor: r.sceneAnchor,
            offsetFromBoardMm: r.offsetFromBoardMm,
            requiredParts: r.requiredParts,
            warnings: r.warnings,
            steps: r.steps,
            assemblySteps: r.assemblySteps
        }))
    };
    const createdAt = metadata.createdAt;
    return {
        id: `fab-${Date.now().toString(36)}`,
        createdAt,
        projectName: project.metadata.name,
        sceneSnapshot: {
            metadata: project.metadata,
            parts: project.parts,
            partOrder: project.partOrder,
            skeleton: project.skeleton,
            paths: project.paths,
            mechanisms: project.mechanisms,
            settings: project.settings
        },
        recipes,
        cutList,
        warnings: validation.warnings,
        validationIssues: validation.issues,
        svg: makeBlueprintSvg(project, recipes),
        cutSheetPdf: makeCutSheetPdf(project, recipes),
        customPartsSvg: makeCustomPartsSvg(project),
        customPartsPdf: makeCustomPartsPdf(project),
        customPartsStl: makeCustomPartsStl(project),
        assemblyGuideHtml: makeAssemblyGuideHtml(project, recipes, validation.warnings),
        assemblyGuidePdf: makeAssemblyGuidePdf(project, recipes, validation.warnings),
        metadataJson: JSON.stringify(metadata, null, 2)
    };
};
