import type { FabricationPartRequirement, MechanismConfig, PhysicalKitSettings } from '../types';
import { compileMechanismGraphFabrication } from './mechanismCompiler';

export type MechanismInventory = {
    parts: number;
    holes: number;
    slots: number;
    gears: number;
    racks: number;
    cams: number;
    followers: number;
    endStops: number;
    compilerBlockers: number;
};

export const zeroMechanismInventory = (): MechanismInventory => ({
    parts: 0,
    holes: 0,
    slots: 0,
    gears: 0,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
    compilerBlockers: 0
});

const partText = (part: FabricationPartRequirement) =>
    [part.name, part.label, part.key, part.part, part.category].filter(Boolean).join(' ');

const countParts = (parts: FabricationPartRequirement[], pattern: RegExp) =>
    parts.reduce((total, part) => total + (pattern.test(partText(part)) ? part.quantity : 0), 0);

const renderedHoleCount = (part: FabricationPartRequirement) => {
    const text = partText(part);
    const holeMatch = text.match(/(\d+)-hole link/i);
    if (holeMatch) return Number(holeMatch[1]) * part.quantity;
    if (/gear|cam|follower|slider|guide|rack|fastener|spacer/i.test(text)) return part.quantity;
    return 0;
};

export const mechanismInventoryFromParts = (parts: FabricationPartRequirement[]): MechanismInventory => ({
    parts: parts.reduce((total, part) => total + part.quantity, 0),
    holes: parts.reduce((total, part) => total + renderedHoleCount(part), 0),
    slots: countParts(parts, /guide|slot/i),
    gears: countParts(parts, /gear/i),
    racks: countParts(parts, /rack/i),
    cams: countParts(parts, /cam/i),
    followers: countParts(parts, /follower|slider/i),
    endStops: countParts(parts, /stop/i),
    compilerBlockers: countParts(parts, /blocker|fix:/i)
});

export const mechanismInventoryForMechanism = (
    mechanism: MechanismConfig,
    kit?: PhysicalKitSettings
): MechanismInventory => {
    const recipe = compileMechanismGraphFabrication(mechanism, kit).recipe;
    return recipe
        ? mechanismInventoryFromParts(recipe.requiredParts)
        : { ...zeroMechanismInventory(), parts: 1, compilerBlockers: 1 };
};
