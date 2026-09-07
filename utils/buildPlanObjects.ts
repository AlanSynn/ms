import type { ProjectState } from '../types';
import { ownerLocalToScene } from './artwork';
import { buildTargetArtworkReference } from './buildPlanArtwork';
import { cuttableObjectHasOutline } from './fabricationOutlineIssues';
import type { BuildPlanObjectsV1, BuildPlanPartV1, BuildPlanSectionV1, BuildPlanStepV1 } from './buildPlanTypes';

export { cuttableObjectHasOutline } from './fabricationOutlineIssues';

/** An unattached prop receives a cut/placement step, never invented hardware. */
export const buildObjectBuildSectionV1 = (project: ProjectState) => {
    const owners = project.sceneObjectOrder.flatMap(id => {
        const object = project.sceneObjects[id];
        return object && object.visible !== false && object.fabrication === 'cuttable' && cuttableObjectHasOutline(object)
            ? [object] : [];
    });
    const parts: BuildPlanObjectsV1['parts'] = owners.map(object => ({
        id: object.id,
        ref: `object:part:${encodeURIComponent(object.id)}`,
        sourceSceneObjectId: object.id,
        name: object.name,
        fillColor: object.fillColor,
        outline: object.contourPoints!.map(point => ownerLocalToScene(point, object.transform)),
        pivot: ownerLocalToScene({ x: 0, y: 0 }, object.transform),
        localToScene: { ...object.transform },
        artwork: buildTargetArtworkReference(object, 'scene-object'),
    }));
    const steps: BuildPlanStepV1[] = parts.flatMap((part, index) => [
        { phase: 'cut-object' as const, label: `Cut ${part.name}`, instruction: `Cut ${part.name} along the outer line.` },
        { phase: 'place-object' as const, label: `Place ${part.name}`, instruction: `Place ${part.name} to match the scene.` },
    ].map((step, stepIndex) => ({
        ...step,
        id: `${part.ref}:step:${step.phase}`,
        order: index * 2 + stepIndex + 1,
        index: index * 2 + stepIndex + 1,
        sectionId: 'objects',
        scope: 'object' as const,
        action: step.phase,
        motion: 'none' as const,
        coords: [], coordRoles: [], zMm: 0, stack: [], partRefs: [part.ref], pinIds: [],
    })));
    const partRefs = parts.map(part => part.ref);
    const stepIds = steps.map(step => step.id);
    const objects: BuildPlanObjectsV1 = { id: 'objects', parts, partRefs, stepIds };
    const buildParts: BuildPlanPartV1[] = parts.map(part => ({
        ref: part.ref, kind: 'object', name: part.name, displayName: part.name,
        quantity: 1, sourceSceneObjectId: part.sourceSceneObjectId,
    }));
    const section: BuildPlanSectionV1 = { id: 'objects', kind: 'object', label: 'Objects', partRefs, stepIds };
    return { objects, parts: buildParts, steps, section };
};
