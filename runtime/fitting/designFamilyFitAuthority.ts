import type { ProjectState } from "../../types";

const appearanceFields = new Set([
  'artwork', 'textureUrl', 'maskUrl', 'sourceImageFrame', 'originalSvgPath',
  'enhancedSvgPath', 'fillColor', 'opacity', 'sourceImageName',
]);

const ownerGeometryChanged = (previous: Record<string, object>, next: Record<string, object>) => {
  if (previous === next) return false;
  const ids = Object.keys(previous);
  if (ids.length !== Object.keys(next).length) return true;
  return ids.some(id => {
    if (previous[id] === next[id]) return false;
    if (!next[id]) return true;
    const before = previous[id] as Record<string, unknown>;
    const after = next[id] as Record<string, unknown>;
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].some(key =>
      !appearanceFields.has(key) && !Object.is(before[key], after[key]));
  });
};

/**
 * A Design family fit can replace a motion's current mechanism. A later edit,
 * selection, or Undo must invalidate it before it can overwrite that state.
 */
export const designFamilyFitAuthorityChanged = (
  previous: ProjectState,
  next: ProjectState,
) =>
  previous.metadata.id !== next.metadata.id ||
  previous.mechanisms !== next.mechanisms ||
  previous.selectedMechanismId !== next.selectedMechanismId ||
  previous.selectedPathId !== next.selectedPathId ||
  previous.paths !== next.paths ||
  ownerGeometryChanged(previous.parts, next.parts) ||
  previous.partOrder !== next.partOrder ||
  ownerGeometryChanged(previous.sceneObjects, next.sceneObjects) ||
  previous.sceneObjectOrder !== next.sceneObjectOrder ||
  previous.skeleton !== next.skeleton ||
  previous.settings.fabricationReadyMode !==
    next.settings.fabricationReadyMode ||
  previous.settings.physicalKit !== next.settings.physicalKit;
