import type { ProjectState, SceneObject } from '../types';
import { characterFabricationHoles } from './characterFabricationHoles';
import { validatePhysicalOutline } from './shapeEditing';

export const cuttableObjectHasOutline = (object: SceneObject) =>
    validatePhysicalOutline(object.contourPoints).ok;

/** Explicit user contours are never repaired or omitted during any print path. */
export const characterFabricationOutlineIssues = (project: ProjectState) => {
    const holes = characterFabricationHoles(project);
    return project.partOrder.flatMap(partId => {
        const part = project.parts[partId];
        if (!part?.visible || part.contourSource !== 'user') return [];
        const result = validatePhysicalOutline(part.contourPoints, { attachments: holes.get(part.id) });
        return 'blocker' in result ? [{ partId, message: `${part.name}: ${result.blocker}` }] : [];
    });
};
