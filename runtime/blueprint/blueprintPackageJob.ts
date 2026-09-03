import type { FabricationPackage, ProjectState } from "../../types";
import type { BuildPlanLaneV1 } from "../../utils/buildPlan";
import {
  createCharacterTemplateArtifact,
  createCustomPartsStlArtifact,
  createFabricationPackage,
} from "../../utils/fabrication";

export type BlueprintPackageWorkerRequest =
  | {
      type: "create-package";
      generationId: number;
      project: ProjectState;
      lane?: BuildPlanLaneV1;
      sourceProjectFingerprint: string;
    }
  | {
      type: "create-custom-parts-stl";
      generationId: number;
      project: ProjectState;
      sourceProjectFingerprint: string;
    }
  | {
      type: "create-character-template";
      generationId: number;
      project: ProjectState;
      sourceProjectFingerprint: string;
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
  | {
      type: "character-template-result";
      generationId: number;
      characterTemplatePdf: string;
      characterTemplateSvg: string;
      buildPlanSourceDigest: string;
      sourceProjectFingerprint: string;
    }
  | { type: "error"; generationId: number; message: string };

export const runBlueprintPackageJob = (
  project: ProjectState,
  options: { lane?: BuildPlanLaneV1; sourceProjectFingerprint?: string } = {},
) => createFabricationPackage(project, options);

export const runBlueprintCustomPartsStlJob = (project: ProjectState) =>
  createCustomPartsStlArtifact(project);

export const runBlueprintCharacterTemplateJob = (
  project: ProjectState,
  sourceProjectFingerprint?: string,
) => createCharacterTemplateArtifact(project, sourceProjectFingerprint);
