import type { ProjectState } from "../../types";
import {
  characterPackageReferencedAssetFiles,
  loadCharacterPackage,
} from "../../utils/packageLoader";
import { loadProjectSnapshot } from "../../utils/project";
import {
  validateProjectImportFile,
  validateCharacterPackageFiles,
  validateProjectImportShape,
} from "./projectImportPolicy";
import { autosaveByteLength } from "../../utils/autosaveFingerprint";
import { AUTOSAVE_SNAPSHOT_MAX_BYTES } from "../../utils/projectAutosaveFormat";
import { serializeProjectCompact } from "../../utils/projectSerialization";
import {
  validateCharacterPackageRasterFiles,
  validateProjectRasterSources,
} from "./projectRasterImportPolicy";

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

export const validateCharacterPackageProjectPersistence = (
  project: ProjectState,
) => {
  validateProjectImportShape(project);
  const bytes = autosaveByteLength(serializeProjectCompact(project));
  if (bytes > AUTOSAVE_SNAPSHOT_MAX_BYTES) {
    throw new Error(
      "Character package expands beyond the 6 MB browser autosave limit.",
    );
  }
  return bytes;
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
    const project = await loadCharacterPackage(input.files);
    validateProjectRasterSources(project);
    validateCharacterPackageProjectPersistence(project);
    return {
      project,
      sourceName: "Character package",
    };
  }
  validateProjectImportFile(input.file);
  const raw = JSON.parse(await input.file.text());
  validateProjectImportShape(raw);
  validateProjectRasterSources(raw);
  return {
    project: loadProjectSnapshot(raw),
    sourceName: input.file.name,
  };
};
