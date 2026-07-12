import type { MechanismConfig } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';
import {
    FABRICATION_LINKAGE_SPECS,
    FABRICATION_SPACER_SPEC,
    fabricationGearSpecForPitchRadius,
    fabricationLinkageSpecForCells,
    fabricationPartDisplayLabel,
    type FabricationLinkageSpec
} from './fabricationContract';
import { gearTrainPitchRadii } from './kinematics';
import {
    packFabricationRenderPlan,
    type FabricationLayerShape,
    type FabricationRenderKind,
    type FabricationRenderPlan
} from './mechanismFabricationZStack';
import { REFERENCE_DEFAULTS, isReferenceExportReady, referenceRecipeForType, referenceSupportWarning } from './mechanismReference';

export type FabricationStackLayer = FabricationLayerShape;

export type FabricationStackMechanism = Pick<MechanismConfig, 'type'> & Partial<Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'couplerLength' | 'gearTrainRadii'>>;

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

export const fabricationLinkageSpecForSceneLength = (sceneLength: number, pitchMm = 20, minHoleCount = 2): FabricationLinkageSpec => {
    const lengthMm = Math.max(0, Math.abs(sceneLength) / SCENE_PX_PER_MM);
    const targetCells = Math.max(1, Math.round(lengthMm / Math.max(1, pitchMm)));
    const candidates = FABRICATION_LINKAGE_SPECS.filter(spec => spec.holeCentersMm.length >= Math.max(2, minHoleCount));
    const available = candidates.length ? candidates : FABRICATION_LINKAGE_SPECS;
    const nearestCells = available.reduce((best, spec) =>
        Math.abs(spec.cells - targetCells) < Math.abs(best.cells - targetCells) ? spec : best
    ).cells;
    return fabricationLinkageSpecForCells(nearestCells, pitchMm);
};

export const fabricationStackForMechanism = (mechanism: FabricationStackMechanism): FabricationStackLayer[] => {
    const linked = (...middle: FabricationStackLayer[]) => [layer('Back Clip', 'clip'), ...middle, layer('Front Clip', 'clip')];
    const spacer = () => layer(FABRICATION_SPACER_SPEC.label, 'spacer');
    const recipe = referenceRecipeForType(mechanism.type);
    if (!recipe.exportReady) return [];
    const gearLabelForRadius = (role: 'Drive' | 'Output' | 'Idler', radius: number, index?: number) => {
        const spec = fabricationGearSpecForPitchRadius(Math.abs(radius) / SCENE_PX_PER_MM);
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
    if (mechanism.type === '4bar') {
        const inputSpec = fabricationLinkageSpecForSceneLength(mechanism.crankLength ?? REFERENCE_DEFAULTS.fourBar.input, REFERENCE_DEFAULTS.pitchMm, 3);
        const couplerSpec = fabricationLinkageSpecForSceneLength(mechanism.couplerLength ?? REFERENCE_DEFAULTS.fourBar.coupler, REFERENCE_DEFAULTS.pitchMm, 4);
        const outputSpec = fabricationLinkageSpecForSceneLength(mechanism.rockerLength ?? REFERENCE_DEFAULTS.fourBar.output, REFERENCE_DEFAULTS.pitchMm, 3);
        return linked(
            layer(`Input L${inputSpec.cells} linkage`, 'linkage'),
            spacer(),
            layer(`Coupler L${couplerSpec.cells} linkage`, 'linkage'),
            spacer(),
            layer(`Output L${outputSpec.cells} linkage`, 'linkage')
        );
    }
    if (mechanism.type === 'cam') {
        return [
            layer('Crank handle', 'linkage'),
            layer('Axle peg', 'spacer'),
            layer('Paper washer', 'spacer'),
            layer('Cam spacer', 'spacer'),
            layer('Swappable cam disk', 'cam'),
            layer('Paper washer', 'spacer'),
            layer('Cam lock disk', 'clip'),
            layer('U-channel guide cartridge', 'guide'),
            layer('Preassembled gravity follower module', 'follower')
        ];
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

export const fabricationStackSummary = (mechanism: FabricationStackMechanism) =>
    fabricationStackForMechanism(mechanism).map(item => item.label).join(' → ');

export const readableFabricationStackSummary = (mechanism: FabricationStackMechanism) =>
    fabricationStackForMechanism(mechanism).map(item => fabricationPartDisplayLabel(item.label)).join(' → ');

const isMovingStackLayer = (item: FabricationStackLayer) => !['clip', 'spacer', 'base'].includes(item.role);
const CAM_MODULE_STACK_REQUIRED_LABELS = [
    'Crank handle',
    'Axle peg',
    'Paper washer',
    'Cam spacer',
    'Swappable cam disk',
    'Cam lock disk',
    'U-channel guide cartridge',
    'Preassembled gravity follower module'
] as const;
const isCamModuleStack = (stack: FabricationStackLayer[]) =>
    stack.some(item => item.label === 'Swappable cam disk')
    && stack.some(item => item.label === 'U-channel guide cartridge')
    && stack.some(item => item.label === 'Preassembled gravity follower module');

const validateCamModuleStack = (stack: FabricationStackLayer[], mechanism?: FabricationStackMechanism) => {
    const errors: string[] = [];
    const labels = stack.map(item => item.label);
    if (stack.some(item => item.role === 'base' || /base board|backplate/i.test(item.label))) errors.push('cam module stack must reuse the 15x15 pegboard, not include a separate base');
    CAM_MODULE_STACK_REQUIRED_LABELS.forEach(label => {
        if (!labels.includes(label)) errors.push(`cam module stack is missing ${label}`);
    });
    if (labels.some(label => /Back Clip|Front Clip|S10 spacer|Eccentric cam|Round follower|2-hole bracket/i.test(label))) {
        errors.push('cam module stack must use pegboard gravity cam modules, not the old generic cam stack');
    }
    if (mechanism && labels.join(' → ') !== fabricationStackForMechanism(mechanism).map(item => item.label).join(' → ')) {
        errors.push(`${mechanism.type} stack must match mechanism-reference order: ${fabricationStackForMechanism(mechanism).map(item => item.label).join(' → ')}`);
    }
    return errors;
};

export const validateFabricationStack = (mechanism: FabricationStackMechanism | FabricationStackLayer[]) => {
    const stack = Array.isArray(mechanism) ? mechanism : fabricationStackForMechanism(mechanism);
    const errors: string[] = [];
    if (!Array.isArray(mechanism) && !isReferenceExportReady(mechanism.type)) errors.push(referenceSupportWarning(mechanism.type) ?? `${mechanism.type}: not fabrication-ready`);
    if (!stack.length) return errors;
    if ((!Array.isArray(mechanism) && mechanism.type === 'cam') || isCamModuleStack(stack)) {
        return [...errors, ...validateCamModuleStack(stack, Array.isArray(mechanism) ? undefined : mechanism)];
    }
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

export const fabricationRenderPlanForMechanism = (mechanism: FabricationStackMechanism): FabricationRenderPlan => {
    const stack = fabricationStackForMechanism(mechanism);
    const validationErrors = validateFabricationStack(mechanism);
    const occurrenceByRole = new Map<FabricationStackLayer['role'], number>();
    const layers = stack.map((item, stackIndex) => {
        const occurrence = occurrenceByRole.get(item.role) ?? 0;
        occurrenceByRole.set(item.role, occurrence + 1);
        return {
            ...item,
            source: 'fabrication-stack' as const,
            stackIndex,
            occurrence,
            renderKind: renderKindForRole(item.role)
        };
    });
    return packFabricationRenderPlan({
        graphId: `fabrication-stack:${mechanism.type}`,
        layers,
        validationErrors
    });
};
