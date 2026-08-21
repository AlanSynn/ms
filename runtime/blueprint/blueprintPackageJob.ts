import type { FabricationPackage, ProjectState } from "../../types";
import { createFabricationPackage } from "../../utils/fabrication";

export type BlueprintPackageWorkerRequest = {
  type: "create-package";
  generationId: number;
  project: ProjectState;
};

export type BlueprintPackageWorkerResponse =
  | {
      type: "result";
      generationId: number;
      fabricationPackage: FabricationPackage;
    }
  | { type: "error"; generationId: number; message: string };

export const runBlueprintPackageJob = (project: ProjectState) =>
  createFabricationPackage(project);
