import type {
    ConnectionSelection,
    ConnectionSelectionRole,
    JointState,
    MechanismConfig,
    MechanismType,
} from '../types';
import type { FabricationRenderPlan } from './fabrication';
import { sampleFeasibleRange } from './fabrication';
import { calculateLinkage } from './kinematics';
import { compileMechanismRenderPlan } from './mechanismCompiler';
import {
    CONNECTION_SELECTION_ROLE_POLICIES,
    connectionSelectionRolesForMechanism,
} from './mechanismConnectionSelections';
import { ALL_MECHANISM_TYPES, MECHANISM_TEMPLATE_LIBRARY } from './mechanismTemplates';
import { createDefaultMechanism, mechanismRequiredParts } from './project';

export type MechanismFeatureRole = 'driver' | 'linkage' | 'linear-guide' | 'gear-train' | 'cam-follower' | 'compound';
export type MechanismProjectionRole = 'rotary' | 'linear' | 'compound';
export type MechanismDragHandle = 'P1' | 'P2' | 'J1' | 'J2' | 'Effector' | 'Aux';
export type MechanismConnectionKind = ConnectionSelection['kind'];
export type MechanismConnectionPolicy = {
    authored: Partial<Record<ConnectionSelectionRole, MechanismConnectionKind>>;
    fixed: string[];
    derived: string[];
    blocked: string[];
};
export type MechanismFeasibleRange = ReturnType<typeof sampleFeasibleRange>;

export type MechanismFeatureIssue = {
    severity: 'error' | 'warning';
    message: string;
};

export type MechanismInteractionPolicy = {
    role: MechanismFeatureRole;
    editableParameters: Array<keyof MechanismConfig>;
    draggableHandles: MechanismDragHandle[];
    connectionPolicy: MechanismConnectionPolicy;
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
    sampleKinematics: (mechanism: MechanismConfig, angleRad: number) => JointState;
    sampleFeasibleRange: (mechanism: MechanismConfig, samples?: number) => MechanismFeasibleRange;
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

const authoredConnectionPolicyForType = (
    type: MechanismType,
): Partial<Record<ConnectionSelectionRole, MechanismConnectionKind>> =>
    Object.fromEntries(
        connectionSelectionRolesForMechanism(type).map((role) => [
            role,
            CONNECTION_SELECTION_ROLE_POLICIES[role].kind,
        ]),
    ) as Partial<Record<ConnectionSelectionRole, MechanismConnectionKind>>;

const connectionPolicyForType = (type: MechanismType): MechanismConnectionPolicy => {
    switch (type) {
        case '4bar':
            return {
                authored: authoredConnectionPolicyForType(type),
                fixed: ['4bar.input-ground', '4bar.output-ground'],
                derived: ['4bar.coupler', '4bar.effector', '4bar.aux'],
                blocked: []
            };
        case 'gear_linkage':
            return {
                authored: authoredConnectionPolicyForType(type),
                fixed: ['gear_linkage.drive-center', 'gear_linkage.output-center'],
                derived: ['gear_linkage.connector-link', 'gear_linkage.aux'],
                blocked: []
            };
        case 'gear':
            return { authored: authoredConnectionPolicyForType(type), fixed: ['gear.drive-axle', 'gear.output-axle'], derived: ['gear.mesh', 'gear.phase', 'gear.output'], blocked: [] };
        case 'planetary_gear':
            return { authored: authoredConnectionPolicyForType(type), fixed: ['planetary_gear.sun-axle', 'planetary_gear.ring-gear'], derived: ['planetary_gear.planet-gear', 'planetary_gear.carrier', 'planetary_gear.output'], blocked: [] };
        case 'cam':
            return { authored: authoredConnectionPolicyForType(type), fixed: ['cam.cam-axle', 'cam.follower-guide'], derived: ['cam.cam-profile-contact', 'cam.follower', 'cam.effector'], blocked: [] };
        case 'piston':
            return { authored: authoredConnectionPolicyForType(type), fixed: ['piston.crank-ground', 'piston.slider-guide'], derived: ['piston.crank', 'piston.connecting-rod', 'piston.slider', 'piston.effector'], blocked: [] };
        case 'crank':
            return { authored: {}, fixed: ['crank.ground'], derived: ['crank.link', 'crank.effector'], blocked: [] };
        case 'yoke':
        case 'quick-return':
        case '5bar':
        case '6bar':
        case 'rack-pinion':
            return { authored: {}, fixed: [], derived: [], blocked: ['non-authorable'] };
        default:
            return { authored: {}, fixed: [], derived: [], blocked: [] };
    }
};

const validateFeature = (type: MechanismType, mechanism: MechanismConfig): MechanismFeatureIssue[] => {
    const issues: MechanismFeatureIssue[] = [];
    if (mechanism.type !== type) {
        issues.push({ severity: 'error', message: `Feature ${type} cannot validate ${mechanism.type}` });
        return issues;
    }

    compileMechanismRenderPlan(mechanism).validationErrors.forEach(message => {
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
        sampleKinematics: calculateLinkage,
        sampleFeasibleRange,
        fabricationPlan: compileMechanismRenderPlan,
        interactionPolicy: () => ({
            role: roleForType(type),
            editableParameters: editableParametersForType(type),
            draggableHandles: draggableHandlesForType(type),
            connectionPolicy: connectionPolicyForType(type),
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
    });

    actual.forEach(type => {
        if (!expected.has(type)) errors.push(`${type}: feature registry has an unknown mechanism type`);
    });

    return errors;
};
