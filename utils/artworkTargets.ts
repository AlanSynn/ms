import type { BodyPartLayer, Point, ProjectState, SceneObject } from '../types';
import { createDefaultSceneObject } from './project';
import { characterFabricationHoles } from './characterFabricationHoles';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints } from './partGeometry';
import { attachmentRingOutline, convexOutline, validatePhysicalOutline } from './shapeEditing';

/** Every newly drawn prop starts with a real, editable, cuttable outline. */
export const createDrawableObject = (id: string): SceneObject => ({
  ...createDefaultSceneObject('block', id), name: 'My object',
  bounds: { width: 80, height: 80 }, fillColor: '#ffffff', opacity: 1,
  contourSource: 'user', fabrication: 'cuttable',
  contourPoints: [{ x: -40, y: -40 }, { x: 40, y: -40 }, { x: 40, y: 40 }, { x: -40, y: 40 }],
});

/** Ordinary existing presets remain paintable; authored contours take priority. */
export const sceneObjectOutline = (object: SceneObject): Point[] => {
  if (object.contourPoints?.length) return object.contourPoints;
  const { width, height } = object.bounds;
  if (object.shape === 'star') return Array.from({ length: 10 }, (_, index) => {
    const radius = Math.min(width, height) * (index % 2 ? .23 : .5);
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const radius = Math.min(width, height) * (object.shape === 'cloud' ? .34 : .2);
  return Array.from({ length: 4 }, (_, corner) => {
    const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - radius);
    const cy = (corner < 2 ? 1 : -1) * (height / 2 - radius);
    return Array.from({ length: 9 }, (_, index) => {
      const angle = (corner * Math.PI / 2) + index * Math.PI / 16;
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    });
  }).flat();
};

/** Starter rig is an unpainted scaffold; lesson baselines retain their own art. */
export const unpaintedStarter = (project: ProjectState): ProjectState => {
  const holes = characterFabricationHoles(project);
  return {
    ...project,
    parts: Object.fromEntries(Object.entries(project.parts).map(([id, part]) => {
      const { textureUrl: _texture, maskUrl: _mask, originalSvgPath: _original, enhancedSvgPath: _enhanced,
        sourceImageFrame: _sourceFrame, artwork: _artwork, ...physical } = part;
      const attachments = holes.get(id) ?? [];
      const outline = fabricablePartOutlinePoints(part, partLandmarkLocalPoints(part, project.skeleton));
      if (validatePhysicalOutline(outline, { attachments }).ok) return [id, { ...physical, opacity: 1 } satisfies BodyPartLayer];
      // This is explicit scaffold creation only. Existing lessons and Save/Print
      // never call this constructor to repair the student's authoritative shape.
      const candidate = convexOutline([...outline, ...attachments.flatMap(attachmentRingOutline)]);
      const checked = validatePhysicalOutline(candidate, { attachments });
      if (!checked.ok) throw new Error(`Cannot create ${part.name}: ${checked.blocker}`);
      return [id, { ...physical, opacity: 1, contourPoints: checked.points, contourSource: 'user' } satisfies BodyPartLayer];
    })),
    characterPackage: undefined,
  };
};
