import type { BodyPartLayer, PhysicalKitSettings, Point, ProjectState } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';
import { characterPinPlan } from './characterPinPlan';
import { partWorldPointToLocal } from './partGeometry';

export type CharacterFabricationHole = {
  jointId: string;
  center: Point;
  radius: number;
};

/** A physical drill stays kit-sized when the entire flat piece is resized. */
export const characterFabricationHoleRadius = (
  part: BodyPartLayer,
  kit: Pick<PhysicalKitSettings, 'holeDiameterMm'>,
) => kit.holeDiameterMm * SCENE_PX_PER_MM / (2 * Math.max(0.001, part.transform.scale));

const cache = new WeakMap<ProjectState, ReadonlyMap<string, readonly CharacterFabricationHole[]>>();

/**
 * Assembly's canonical fixed/free pins define real cut holes. Skeleton landmarks
 * may guide silhouette editing, but are never additional drilling instructions.
 */
export const characterFabricationHoles = (
  project: ProjectState,
): ReadonlyMap<string, readonly CharacterFabricationHole[]> => {
  const cached = cache.get(project);
  if (cached) return cached;
  const { fixedPins, freePivots } = characterPinPlan(project);
  const result = new Map<string, CharacterFabricationHole[]>();
  for (const pin of [...fixedPins, ...freePivots]) {
    for (const partId of pin.partIds) {
      const part = project.parts[partId];
      if (!part || part.visible === false) continue;
      const holes = result.get(partId) ?? [];
      if (!holes.some(hole => hole.jointId === pin.jointId)) {
        holes.push({ jointId: pin.jointId, center: partWorldPointToLocal(part, pin.scene),
          radius: characterFabricationHoleRadius(part, project.settings.physicalKit) });
      }
      result.set(partId, holes);
    }
  }
  cache.set(project, result);
  return result;
};
