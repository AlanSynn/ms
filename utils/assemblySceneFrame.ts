import type { FabricationRecipe, MechanismConfig, PhysicalKitSettings, Point, ProjectState } from '../types';
import type {
    AssemblyLane,
    AssemblyMotionKind,
    AssemblyPlaybackStep,
    CharacterAssemblyPlan,
    CharacterAssemblyStep
} from './assemblyPlayback';
import { isBoardFixedCoordRole } from './mechanismReference';
import { buildProjectMechanismSceneContract, type MechanismSceneContract } from './mechanismSceneContract';

export const ASSEMBLY_SCENE_FRAME_VERSION = 1;

export type AssemblySceneFrameKind = 'mechanism' | 'character';
export type AssemblyBoardMode = 'hidden' | 'reference' | 'active';

export type AssemblySceneVisiblePart = {
    id: string;
    label: string;
    role: string;
    zMm?: number;
    active: boolean;
};

export type AssemblySceneFrame = {
    version: typeof ASSEMBLY_SCENE_FRAME_VERSION;
    kind: AssemblySceneFrameKind;
    phase: string;
    stepIndex: number;
    label: string;
    motion: AssemblyMotionKind;
    explodeAxis: 'z' | 'none';
    boardMode: AssemblyBoardMode;
    progress: number;
    instruction: string;
    check?: string;
    activePartIds: string[];
    activeBoardCoords: string[];
    floatingReferenceCoords: string[];
    activeScenePoints?: Point[];
    floatingReferencePoints?: Point[];
    visibleParts: AssemblySceneVisiblePart[];
    kitProfileKey?: PhysicalKitSettings['profileKey'];
    lane?: AssemblyLane;
    mechanismContract?: MechanismSceneContract;
};

export const withAssemblySceneProgress = (
    frame: AssemblySceneFrame | undefined,
    progress: number
): AssemblySceneFrame | undefined => {
    if (!frame || frame.progress === progress) return frame;
    return { ...frame, progress };
};

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const boardModeForMechanismStep = (step: AssemblyPlaybackStep, activeBoardCoords: string[]): AssemblyBoardMode => {
    if (['mount-to-board', 'connect-character', 'test-motion'].includes(step.phase)) return 'active';
    if (activeBoardCoords.length) return 'reference';
    return 'hidden';
};

export const buildMechanismAssemblySceneFrame = ({
    recipe,
    mechanism,
    project,
    step,
    lane,
    kit,
    progress = 0
}: {
    recipe: FabricationRecipe;
    mechanism: MechanismConfig;
    project: ProjectState;
    step: AssemblyPlaybackStep;
    lane: AssemblyLane;
    kit: PhysicalKitSettings;
    progress?: number;
}): AssemblySceneFrame => {
    const activeBoardCoords = unique(step.coords.filter((_, index) => isBoardFixedCoordRole(step.coordRoles[index] ?? '')));
    const floatingReferenceCoords = unique(step.coords.filter((_, index) => !isBoardFixedCoordRole(step.coordRoles[index] ?? '')));
    const mechanismContract = buildProjectMechanismSceneContract(project, mechanism.id, recipe);
    const stackParts = step.stack.map((item) => ({
        id: `${step.index}:${item.order}:${item.label}`,
        label: item.label,
        role: item.role,
        zMm: step.zMm,
        active: true
    }));
    const visibleParts = stackParts.length
        ? stackParts
        : (mechanismContract?.layers ?? []).map((layer) => ({
            id: layer.id,
            label: layer.label,
            role: layer.role,
            zMm: layer.z,
            active: step.phase !== 'prepare-parts' && step.phase !== 'export'
        }));

    return {
        version: ASSEMBLY_SCENE_FRAME_VERSION,
        kind: 'mechanism',
        phase: step.phase,
        stepIndex: step.index,
        label: step.label,
        motion: step.motion,
        explodeAxis: step.motion === 'explode_z' ? 'z' : 'none',
        boardMode: boardModeForMechanismStep(step, activeBoardCoords),
        progress,
        instruction: step.instruction,
        check: step.check,
        activePartIds: unique(visibleParts.filter((part) => part.active).map((part) => part.id)),
        activeBoardCoords,
        floatingReferenceCoords,
        visibleParts,
        kitProfileKey: kit.profileKey,
        lane,
        mechanismContract
    };
};

const motionForCharacterStep = (step: CharacterAssemblyStep): AssemblyMotionKind => {
    if (step.phase === 'test-character') return 'scrub_time';
    if (step.phase === 'attach-character') return 'connect_travel_xy';
    if (step.phase === 'fixed-pins' || step.phase === 'free-pivots') return 'explode_z';
    return 'none';
};

export const buildCharacterAssemblySceneFrame = ({
    plan,
    step,
    kit,
    progress = 0
}: {
    plan: CharacterAssemblyPlan;
    step: CharacterAssemblyStep;
    kit: PhysicalKitSettings;
    progress?: number;
}): AssemblySceneFrame => {
    const activePins = [...plan.fixedPins, ...plan.freePivots].filter((pin) => step.pinIds.includes(pin.id));
    const activeBoardCoords = unique(activePins.map((pin) => pin.boardCoordinate ?? ''));
    const activeScenePoints = activePins.filter(pin => pin.role === 'fixed_pin').map(pin => pin.scene);
    const floatingReferencePoints = activePins.filter(pin => pin.role !== 'fixed_pin').map(pin => pin.scene);
    const activePartIds = step.phase === 'character-parts'
        ? plan.parts.map((part) => part.id)
        : unique(activePins.flatMap((pin) => pin.partIds));
    const visibleParts = plan.parts.map((part) => ({
        id: part.id,
        label: part.name,
        role: 'character-part',
        active: activePartIds.includes(part.id)
    }));

    return {
        version: ASSEMBLY_SCENE_FRAME_VERSION,
        kind: 'character',
        phase: step.phase,
        stepIndex: step.index,
        label: step.label,
        motion: motionForCharacterStep(step),
        explodeAxis: step.phase === 'fixed-pins' || step.phase === 'free-pivots' ? 'z' : 'none',
        boardMode: step.phase === 'character-parts' ? 'hidden' : 'active',
        progress,
        instruction: step.instruction,
        check: step.check,
        activePartIds,
        activeBoardCoords,
        floatingReferenceCoords: [],
        activeScenePoints,
        floatingReferencePoints,
        visibleParts,
        kitProfileKey: kit.profileKey
    };
};
