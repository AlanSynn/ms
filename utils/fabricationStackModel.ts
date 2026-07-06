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
import { REFERENCE_DEFAULTS, referenceRecipeForType } from './mechanismReference';

export type FabricationStackLayer = {
    label: string;
    role: 'base' | 'clip' | 'linkage' | 'spacer' | 'gear' | 'guide' | 'cam' | 'rack' | 'follower';
    color: string;
};

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
