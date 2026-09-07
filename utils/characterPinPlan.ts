import type { BodyPartLayer, ProjectState } from '../types';
import { partLandmarkJointIds } from './partGeometry';
import type { BuildPlanCharacterPinV1 } from './buildPlanTypes';

export type CharacterPin = Pick<BuildPlanCharacterPinV1, 'jointId' | 'scene' | 'partIds' | 'partNames'>;

/** Canonical joint-to-part pin projection shared by physical views and exports. */
export const characterPinPlan = (project: ProjectState): {
    visibleParts: BodyPartLayer[];
    fixedPins: CharacterPin[];
    freePivots: CharacterPin[];
} => {
    const skeleton = project.skeleton;
    if (!skeleton) return { visibleParts: [], fixedPins: [], freePivots: [] };
    const visibleParts = project.partOrder
        .map(id => project.parts[id])
        .filter((part): part is BodyPartLayer => Boolean(part) && part.visible !== false);
    const jointToParts = new Map<string, BodyPartLayer[]>();
    for (const part of visibleParts) {
        const jointIds = new Set([part.anchorJointId, ...partLandmarkJointIds(part, skeleton)]);
        for (const jointId of jointIds) {
            if (!skeleton.joints[jointId]) continue;
            const parts = jointToParts.get(jointId) ?? [];
            parts.push(part);
            jointToParts.set(jointId, parts);
        }
    }

    const anchorJointIds = [...new Set(
        visibleParts.map(part => part.anchorJointId).filter(jointId => Boolean(skeleton.joints[jointId]))
    )];
    const fixedJointIds = [...new Set([
        ...anchorJointIds.filter(jointId => skeleton.joints[jointId]?.locked),
        'hip',
        'torso',
        ...skeleton.rootJointIds,
        anchorJointIds[0]
    ].filter((jointId): jointId is string => Boolean(jointId && skeleton.joints[jointId])))]
        .slice(0, Math.min(2, Math.max(1, anchorJointIds.length)));
    const fixedSet = new Set(fixedJointIds);
    const createPin = (jointId: string): CharacterPin => {
        const joint = skeleton.joints[jointId];
        const parts = jointToParts.get(jointId) ?? visibleParts.filter(part => part.anchorJointId === jointId);
        return {
            jointId,
            scene: { ...joint.position },
            partIds: [...new Set(parts.map(part => part.id))],
            partNames: [...new Set(parts.map(part => part.name))]
        };
    };
    const fixedPins = fixedJointIds.map(createPin);
    const freePivots = anchorJointIds
        .filter(jointId => !fixedSet.has(jointId))
        .map(createPin);
    return { visibleParts, fixedPins, freePivots };
};
