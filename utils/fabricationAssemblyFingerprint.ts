import type { FabricationRecipe } from '../types';

export type AssemblyStepFingerprint = {
    index: number;
    label: string;
    role: string;
    boardCoordinate: string;
    zMm: number;
    coords: string[];
    coordRoles: string[];
    stack: Array<{ order: number; label: string; role: string; part?: string }>;
};

export const assemblyStepFingerprint = (step: FabricationRecipe['assemblySteps'][number]): AssemblyStepFingerprint => ({
    index: step.index,
    label: step.label,
    role: step.role,
    boardCoordinate: step.boardCoordinate,
    zMm: step.zMm,
    coords: [...(step.coords ?? [])],
    coordRoles: [...(step.coordRoles ?? [])],
    stack: (step.stack ?? []).map(item => ({
        order: item.order,
        label: item.label,
        role: item.role,
        part: item.part
    }))
});
