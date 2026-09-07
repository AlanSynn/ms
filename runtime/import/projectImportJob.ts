import type { ProjectState } from "../../types";
import {
  characterPackageReferencedAssetFiles,
  loadCharacterPackage,
} from "../../utils/packageLoader";
import {
  validateProjectImportFile,
  validateCharacterPackageFiles,
  validateProjectImportShape,
} from "./projectImportPolicy";
import { autosaveByteLength } from "../../utils/autosaveFingerprint";
import { AUTOSAVE_SNAPSHOT_MAX_BYTES } from "../../utils/projectAutosaveFormat";
import { serializeProjectCompact } from "../../utils/projectSerialization";
import { readProjectFileCandidate } from "./projectFileCandidate";
import {
  validateCharacterPackageRasterFiles,
  validateProjectRasterSources,
} from "./projectRasterImportPolicy";
import { fitMechanismInWorkerJob } from "../fitting/mechanismFitJob";
import { mechanismBoardPlacementErrors } from "../../utils/fabrication";

export type ProjectImportInput =
  | { kind: "project"; file: File }
  | { kind: "character-package"; files: File[] };

export type ProjectImportWorkerRequest = {
  type: "import";
  generationId: number;
  input: ProjectImportInput;
};

export type ProjectImportWorkerResponse =
  | {
      type: "result";
      generationId: number;
      project: ProjectState;
      sourceName: string;
    }
  | { type: "error"; generationId: number; message: string };

export const validateImportedProjectPersistence = (
  project: ProjectState,
  sourceLabel = "Project",
) => {
  validateProjectImportShape(project);
  const bytes = autosaveByteLength(serializeProjectCompact(project));
  if (bytes > AUTOSAVE_SNAPSHOT_MAX_BYTES) {
    throw new Error(
      `${sourceLabel} expands beyond the 6 MB browser autosave limit.`,
    );
  }
  return bytes;
};

export const validateCharacterPackageProjectPersistence = (
  project: ProjectState,
) => validateImportedProjectPersistence(project, "Character package");

export const fitImportedMechanismsToBoard = (project: ProjectState) => {
  let fittedProject = project;
  for (
    let mechanismIndex = 0;
    mechanismIndex < fittedProject.mechanisms.length;
    mechanismIndex += 1
  ) {
    const importedMechanism = fittedProject.mechanisms[mechanismIndex];
    if (!mechanismBoardPlacementErrors(fittedProject, importedMechanism).length) {
      continue;
    }
    const targetPathId = importedMechanism.targetPathId &&
        fittedProject.paths[importedMechanism.targetPathId]
      ? importedMechanism.targetPathId
      : undefined;
    const attempts = targetPathId
      ? (["path", "sheet"] as const)
      : (["sheet"] as const);
    let fittedMechanism = importedMechanism;
    let placementErrors = mechanismBoardPlacementErrors(
      fittedProject,
      fittedMechanism,
    );
    for (const mode of attempts) {
      fittedMechanism = fitMechanismInWorkerJob(
        fittedProject,
        importedMechanism,
        mode,
        mode === "path" ? targetPathId : undefined,
      );
      placementErrors = mechanismBoardPlacementErrors(
        fittedProject,
        fittedMechanism,
      );
      if (!placementErrors.length) break;
    }
    if (placementErrors.length) {
      const cells = fittedProject.settings.physicalKit.boardCells;
      throw new Error(
        `Cannot import ${importedMechanism.id}: no valid ${cells}x${cells} board placement. ${placementErrors[0]}`,
      );
    }
    fittedProject = {
      ...fittedProject,
      mechanisms: fittedProject.mechanisms.map((mechanism, index) =>
        index === mechanismIndex ? fittedMechanism : mechanism
      ),
    };
  }
  return fittedProject;
};

export const runProjectImportJob = async (input: ProjectImportInput) => {
  if (input.kind === "character-package") {
    const { assets } = validateCharacterPackageFiles(input.files);
    const partsFile = input.files.find((file) =>
      file.name.split(/[\\/]/).pop() === "parts_info.json"
      || (file as File & { webkitRelativePath?: string }).webkitRelativePath
        ?.replaceAll("\\", "/")
        .endsWith("/parts_info.json")
    );
    if (!partsFile) {
      throw new Error("Missing parts_info.json in selected package files");
    }
    const partsInfo = JSON.parse(await partsFile.text());
    await validateCharacterPackageRasterFiles(
      characterPackageReferencedAssetFiles(partsInfo, assets),
    );
    const project = fitImportedMechanismsToBoard(
      await loadCharacterPackage(input.files),
    );
    validateProjectRasterSources(project);
    validateCharacterPackageProjectPersistence(project);
    return {
      project,
      sourceName: "Character package",
    };
  }
  validateProjectImportFile(input.file);
  const document = JSON.parse(await input.file.text());
  const project = readProjectFileCandidate(document);
  return {
    project,
    sourceName: input.file.name,
  };
};
