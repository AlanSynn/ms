import type { ProjectState } from "../../types";

/**
 * A Design family fit is an additive mechanism upsert. Existing mechanism
 * commits may finish while it is in flight, so they are not cancellation
 * authority. Geometry, binding, project, or fabrication-kit changes are.
 */
export const designFamilyFitAuthorityChanged = (
  previous: ProjectState,
  next: ProjectState,
) =>
  previous.metadata.id !== next.metadata.id ||
  previous.selectedPathId !== next.selectedPathId ||
  previous.paths !== next.paths ||
  previous.parts !== next.parts ||
  previous.partOrder !== next.partOrder ||
  previous.sceneObjects !== next.sceneObjects ||
  previous.sceneObjectOrder !== next.sceneObjectOrder ||
  previous.skeleton !== next.skeleton ||
  previous.settings.fabricationReadyMode !==
    next.settings.fabricationReadyMode ||
  previous.settings.physicalKit !== next.settings.physicalKit;
