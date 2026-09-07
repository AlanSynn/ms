import type { BodyPartLayer, Bounds, ProjectState, SceneObject } from '../types';
import { artworkForOwner } from './artwork';
import type { BuildPlanArtworkV1, BuildPlanScopeV1 } from './buildPlanTypes';

const hashText = (value: string) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const appearanceCache = new WeakMap<BodyPartLayer | SceneObject, string>();

/** Artwork identity includes imported bytes and substrate, independently of geometry. */
export const buildTargetArtworkRevision = (owner: BodyPartLayer | SceneObject) => {
    const cached = appearanceCache.get(owner);
    if (cached) return cached;
    const revision = hashText(JSON.stringify({
        document: owner.artwork,
        sourceImageFrame: 'sourceImageFrame' in owner ? owner.sourceImageFrame : undefined,
        texture: owner.textureUrl,
        baseColor: owner.fillColor,
    }));
    appearanceCache.set(owner, revision);
    return revision;
};

export const buildTargetArtworkReference = (
    owner: BodyPartLayer | SceneObject,
    ownerKind: BuildPlanArtworkV1['ownerKind'],
): BuildPlanArtworkV1 => ({
    ownerKind,
    ownerId: owner.id,
    revision: buildTargetArtworkRevision(owner),
    frame: { ...artworkForOwner(owner).frame } as Bounds,
});

export const buildPlanArtworkSourceDigest = (
    project: ProjectState,
    scope: BuildPlanScopeV1 = 'complete',
) => hashText(JSON.stringify({
    parts: project.partOrder.flatMap(id => {
        const part = project.parts[id];
        return part && part.visible !== false ? [[id, buildTargetArtworkRevision(part)]] : [];
    }),
    objects: scope === 'complete' ? project.sceneObjectOrder.flatMap(id => {
        const object = project.sceneObjects[id];
        return object && object.visible !== false && object.fabrication === 'cuttable'
            ? [[id, buildTargetArtworkRevision(object)]] : [];
    }) : [],
}));
