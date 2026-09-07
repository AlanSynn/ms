import type { BodyPartLayer, FabricationPackage, ProjectState, SceneObject } from "../../types";
import { buildPlanSourceDigest } from "../../utils/buildPlan";
import { projectContentFingerprint } from "../../utils/projectSerialization";

const partWithoutArtwork = (part: BodyPartLayer): BodyPartLayer => {
  const {
    textureUrl: _textureUrl,
    maskUrl: _maskUrl,
    originalSvgPath: _originalSvgPath,
    enhancedSvgPath: _enhancedSvgPath,
    artwork: _artwork,
    ...geometry
  } = part;
  return geometry;
};

const sceneObjectWithoutArtwork = (sceneObject: SceneObject): SceneObject => {
  const { textureUrl: _textureUrl, artwork: _artwork, ...geometry } = sceneObject;
  return geometry;
};

export const projectWithoutBlueprintArtwork = (
  project: ProjectState,
): ProjectState => ({
  ...project,
  parts: Object.fromEntries(
    Object.entries(project.parts).map(([id, part]) => [id, partWithoutArtwork(part)]),
  ),
  sceneObjects: Object.fromEntries(
    Object.entries(project.sceneObjects).map(([id, sceneObject]) => [
      id,
      sceneObjectWithoutArtwork(sceneObject),
    ]),
  ),
});

/** Keep worker responses proportional to generated geometry, not embedded artwork. */
export const blueprintPackageWithoutSceneArtwork = (
  fabricationPackage: FabricationPackage,
): FabricationPackage => ({
  ...fabricationPackage,
  sceneSnapshot: {
    ...fabricationPackage.sceneSnapshot,
    parts: Object.fromEntries(
      Object.entries(fabricationPackage.sceneSnapshot.parts).map(([id, part]) => [
        id,
        partWithoutArtwork(part),
      ]),
    ),
    sceneObjects: Object.fromEntries(
      Object.entries(fabricationPackage.sceneSnapshot.sceneObjects).map(
        ([id, sceneObject]) => [id, sceneObjectWithoutArtwork(sceneObject)],
      ),
    ),
  },
});

const restoredPartArtwork = (
  part: BodyPartLayer,
  source: BodyPartLayer | undefined,
): BodyPartLayer => source ? {
  ...part,
  textureUrl: source.textureUrl,
  maskUrl: source.maskUrl,
  originalSvgPath: source.originalSvgPath,
  enhancedSvgPath: source.enhancedSvgPath,
  artwork: source.artwork,
  sourceImageFrame: source.sourceImageFrame,
} : part;

const restoredSceneObjectArtwork = (
  sceneObject: SceneObject,
  source: SceneObject | undefined,
): SceneObject => source ? {
  ...sceneObject,
  textureUrl: source.textureUrl,
  artwork: source.artwork,
} : sceneObject;

/** Reattach the canonical main-thread string references after the worker returns. */
export const restoreBlueprintPackageSceneArtwork = (
  fabricationPackage: FabricationPackage,
  project: ProjectState,
): FabricationPackage => {
  if (fabricationPackage.sourceProjectFingerprint !== projectContentFingerprint(project) ||
      fabricationPackage.buildPlanSourceDigest !== buildPlanSourceDigest(project, 'complete', fabricationPackage.buildPlanLane)) {
    throw new Error('Project changed. Build the current artwork again.');
  }
  return {
    ...fabricationPackage,
    sceneSnapshot: {
      ...fabricationPackage.sceneSnapshot,
      parts: Object.fromEntries(
        Object.entries(fabricationPackage.sceneSnapshot.parts).map(([id, part]) => [
          id,
          restoredPartArtwork(part, project.parts[id]),
        ]),
      ),
      sceneObjects: Object.fromEntries(
        Object.entries(fabricationPackage.sceneSnapshot.sceneObjects).map(
          ([id, sceneObject]) => [
            id,
            restoredSceneObjectArtwork(sceneObject, project.sceneObjects[id]),
          ],
        ),
      ),
    },
  };
};
