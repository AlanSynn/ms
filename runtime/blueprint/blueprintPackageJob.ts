import type { FabricationPackage, ProjectState } from "../../types";
import {
  createCustomPartsStlArtifact,
  createFabricationPackage,
} from "../../utils/fabrication";

export type BlueprintPackageWorkerRequest =
  | {
      type: "create-package";
      generationId: number;
      project: ProjectState;
    }
  | {
      type: "create-custom-parts-stl";
      generationId: number;
      project: ProjectState;
    };

export type BlueprintPackageWorkerResponse =
  | {
      type: "result";
      generationId: number;
      fabricationPackage: FabricationPackage;
    }
  | {
      type: "stl-result";
      generationId: number;
      customPartsStl: string;
    }
  | { type: "error"; generationId: number; message: string };

export const runBlueprintPackageJob = (project: ProjectState) =>
  createFabricationPackage(project);

export const runBlueprintCustomPartsStlJob = (project: ProjectState) =>
  createCustomPartsStlArtifact(project);
