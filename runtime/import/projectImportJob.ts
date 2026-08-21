import type { ProjectState } from "../../types";
import { loadCharacterPackage } from "../../utils/packageLoader";
import { loadProjectSnapshot } from "../../utils/project";
import {
  validateProjectImportFile,
  validateProjectImportShape,
} from "./projectImportPolicy";
import { autosaveByteLength } from "../../utils/autosaveFingerprint";
import { AUTOSAVE_SNAPSHOT_MAX_BYTES } from "../../utils/projectAutosaveFormat";
import { serializeProjectCompact } from "../../utils/projectSerialization";

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
    const project = await loadCharacterPackage(input.files);
    validateCharacterPackageProjectPersistence(project);
    return {
      project,
      sourceName: "Character package",
    };
  }
  validateProjectImportFile(input.file);
  const raw = JSON.parse(await input.file.text());
  validateProjectImportShape(raw);
  return {
    project: loadProjectSnapshot(raw),
    sourceName: input.file.name,
  };
};
