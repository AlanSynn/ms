import { FABRICATION_SPACER_SPEC } from './fabricationContract';
import { isReferenceExportReady, referenceSupportWarning } from './mechanismReference';
import {
    fabricationBaseLayer,
    fabricationStackForMechanism,
    type FabricationStackLayer,
    type FabricationStackMechanism
} from './fabricationStackModel';

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

const isMovingStackLayer = (item: FabricationStackLayer) => !['clip', 'spacer', 'base'].includes(item.role);

export const validateFabricationStack = (mechanism: FabricationStackMechanism | FabricationStackLayer[]) => {
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

export const fabricationRenderPlanForMechanism = (mechanism: FabricationStackMechanism): FabricationRenderPlan => {
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
