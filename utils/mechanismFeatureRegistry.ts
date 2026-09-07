import type { JointState, MechanismConfig, MechanismOutputPort, MechanismType } from '../types';
import type { FabricationRenderPlan } from './fabricationRenderPlan';
import type { FabricationStackLayer } from './fabricationStackModel';
import { fabricationRenderPlanForMechanism } from './fabricationRenderPlan';
import { fabricationStackForMechanism } from './fabricationStackModel';
import { sampleFeasibleRange } from './fabricationReadiness';
import { calculateLinkage } from './kinematics';
import { ALL_MECHANISM_TYPES, MECHANISM_TEMPLATE_LIBRARY } from './mechanismTemplates';
import { createDefaultMechanism, mechanismRequiredParts } from './project';
import { mechanismOutputPortsForType } from './mechanismBindings';

export type MechanismFeatureRole = 'driver' | 'linkage' | 'linear-guide' | 'gear-train' | 'cam-follower' | 'compound';
export type MechanismProjectionRole = 'rotary' | 'linear' | 'compound';
export type MechanismDragHandle = 'P1' | 'P2' | 'J1' | 'J2' | 'Effector' | 'Aux';
export type MechanismFeasibleRange = ReturnType<typeof sampleFeasibleRange>;

export type MechanismFeatureIssue = {
    severity: 'error' | 'warning';
    message: string;
};

export type MechanismInteractionPolicy = {
    role: MechanismFeatureRole;
    editableParameters: Array<keyof MechanismConfig>;
    draggableHandles: MechanismDragHandle[];
    writesProjectState: true;
};

export type MechanismProjectionHint = {
    role: MechanismProjectionRole;
    source: 'mechanism-feature-registry';
    zStackUsesFabricationPlan: true;
};

export type MechanismPhysicsHint = {
    role: MechanismFeatureRole;
    source: 'mechanism-feature-registry';
    solver: 'kinematic-derived';
    preservesProjectState: true;
};

export interface MechanismFeatureContract {
    type: MechanismType;
    label: string;
    sense: string;
    goodFor: string;
    constraint: string;
    authorable: boolean;
    defaults: (id?: string) => MechanismConfig;
    requiredParts: (mechanism: MechanismConfig) => Array<{ name: string; quantity: number }>;
    outputPorts: (mechanism: MechanismConfig) => readonly MechanismOutputPort[];
    sampleKinematics: (mechanism: MechanismConfig, angleRad: number) => JointState;
    sampleFeasibleRange: (mechanism: MechanismConfig, samples?: number) => MechanismFeasibleRange;
    fabricationStack: (mechanism: MechanismConfig) => FabricationStackLayer[];
    fabricationPlan: (mechanism: MechanismConfig) => FabricationRenderPlan;
    interactionPolicy: (mechanism: MechanismConfig) => MechanismInteractionPolicy;
    projectionHints: (mechanism: MechanismConfig) => MechanismProjectionHint[];
    physicsHints: (mechanism: MechanismConfig) => MechanismPhysicsHint[];
    validate: (mechanism: MechanismConfig) => MechanismFeatureIssue[];
}

const roleForType = (type: MechanismType): MechanismFeatureRole => {
    switch (type) {
        case 'crank':
            return 'driver';
        case 'piston':
        case 'yoke':
        case 'rack-pinion':
            return 'linear-guide';
        case 'gear':
        case 'gear_linkage':
        case 'planetary_gear':
            return 'gear-train';
        case 'cam':
            return 'cam-follower';
        case '5bar':
        case '6bar':
            return 'compound';
        default:
            return 'linkage';
    }
};

const projectionRoleForType = (type: MechanismType): MechanismProjectionRole => {
    switch (roleForType(type)) {
        case 'linear-guide':
            return 'linear';
        case 'compound':
            return 'compound';
        default:
            return 'rotary';
    }
};

const editableParametersForType = (type: MechanismType): Array<keyof MechanismConfig> => {
    const base: Array<keyof MechanismConfig> = ['crankLength', 'groundLength', 'couplerLength', 'rockerLength', 'phase'];
    switch (type) {
        case '4bar':
            return ['crankLength', 'groundLength', 'couplerLength', 'rockerLength', 'couplerPointDist', 'couplerPointAngle', 'driverPhaseOffset'];
        case 'piston':
            return [];
        case 'yoke':
        case 'rack-pinion':
            return ['crankLength', 'sliderOffset', 'rodLength', 'rockerLength', 'phase'];
        case 'gear':
            return ['gearTrainRadii', 'driverGroupId', 'driverPhaseOffset', 'phase'];
        case 'gear_linkage':
            return ['gearTrainRadii', 'couplerPointDist', 'couplerLength', 'driverGroupId', 'driverPhaseOffset', 'phase'];
        case 'planetary_gear':
            return ['phase'];
        case 'cam':
            return ['camProfileSamples'];
        case '5bar':
            return [...base, 'rodLength', 'speed1', 'speed2'];
        case '6bar':
            return [...base, 'rodLength'];
        default:
            return base;
    }
};

const draggableHandlesForType = (type: MechanismType): MechanismDragHandle[] => {
    const base: MechanismDragHandle[] = ['P1', 'J1'];
    switch (type) {
        case '4bar':
        case 'piston':
        case 'yoke':
        case 'quick-return':
            return [...base, 'P2', 'J2', 'Effector'];
        case 'gear':
        case 'gear_linkage':
            return ['P1'];
        case '5bar':
        case '6bar':
            return [...base, 'P2', 'J2', 'Aux', 'Effector'];
        case 'cam':
            return [...base, 'P2'];
        case 'planetary_gear':
            return ['P1'];
        case 'rack-pinion':
            return [...base, 'Effector'];
        default:
            return base;
    }
};

const validateFeature = (type: MechanismType, mechanism: MechanismConfig): MechanismFeatureIssue[] => {
    const issues: MechanismFeatureIssue[] = [];
    if (mechanism.type !== type) {
        issues.push({ severity: 'error', message: `Feature ${type} cannot validate ${mechanism.type}` });
        return issues;
    }

    fabricationRenderPlanForMechanism(mechanism).validationErrors.forEach(message => {
        issues.push({ severity: 'error', message });
    });

    const range = sampleFeasibleRange(mechanism, 24);
    if (range.warning) issues.push({ severity: 'warning', message: range.warning });

    return issues;
};

const buildFeature = (type: MechanismType): MechanismFeatureContract => {
    const metadata = MECHANISM_TEMPLATE_LIBRARY[type];
    return {
        type,
        ...metadata,
        defaults: (id = `${type}-default`) => createDefaultMechanism(type, id),
        requiredParts: mechanismRequiredParts,
        outputPorts: () => mechanismOutputPortsForType(type),
        sampleKinematics: calculateLinkage,
        sampleFeasibleRange,
        fabricationStack: fabricationStackForMechanism,
        fabricationPlan: fabricationRenderPlanForMechanism,
        interactionPolicy: () => ({
            role: roleForType(type),
            editableParameters: editableParametersForType(type),
            draggableHandles: draggableHandlesForType(type),
            writesProjectState: true
        }),
        projectionHints: () => [{
            role: projectionRoleForType(type),
            source: 'mechanism-feature-registry',
            zStackUsesFabricationPlan: true
        }],
        physicsHints: () => [{
            role: roleForType(type),
            source: 'mechanism-feature-registry',
            solver: 'kinematic-derived',
            preservesProjectState: true
        }],
        validate: mechanism => validateFeature(type, mechanism)
    };
};

export const MECHANISM_FEATURE_REGISTRY = Object.fromEntries(
    ALL_MECHANISM_TYPES.map(type => [type, buildFeature(type)])
) as Record<MechanismType, MechanismFeatureContract>;

export const mechanismFeature = (type: MechanismType): MechanismFeatureContract => MECHANISM_FEATURE_REGISTRY[type];

export const validateMechanismFeatureRegistry = (): string[] => {
    const expected = new Set(ALL_MECHANISM_TYPES);
    const actual = Object.keys(MECHANISM_FEATURE_REGISTRY) as MechanismType[];
    const errors: string[] = [];

    ALL_MECHANISM_TYPES.forEach(type => {
        const feature = MECHANISM_FEATURE_REGISTRY[type];
        const metadata = MECHANISM_TEMPLATE_LIBRARY[type];
        if (!feature) errors.push(`${type}: missing feature contract`);
        if (!metadata) errors.push(`${type}: missing template metadata`);
        if (feature && metadata && feature.label !== metadata.label) errors.push(`${type}: label must mirror template metadata`);
        const ports = feature?.outputPorts(feature.defaults(`${type}-port-check`)) ?? [];
        if (!ports.length) errors.push(`${type}: missing fabricable output port`);
        if (new Set(ports.map(port => port.id)).size !== ports.length) errors.push(`${type}: duplicate output port id`);
        ports.forEach(port => {
            if (!port.fabricable || port.capacity < 1) errors.push(`${type}:${port.id}: invalid output port contract`);
        });
    });

    actual.forEach(type => {
        if (!expected.has(type)) errors.push(`${type}: feature registry has an unknown mechanism type`);
    });

    return errors;
};
