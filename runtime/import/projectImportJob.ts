import type { ProjectState } from "../../types";
import { loadCharacterPackage } from "../../utils/packageLoader";
import { loadProjectSnapshot } from "../../utils/project";
import { validateProjectImportFile } from "./projectImportPolicy";

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

export const runProjectImportJob = async (input: ProjectImportInput) => {
  if (input.kind === "character-package") {
    return {
      project: await loadCharacterPackage(input.files),
      sourceName: "Character package",
    };
  }
  validateProjectImportFile(input.file);
  const raw = JSON.parse(await input.file.text());
  return {
    project: loadProjectSnapshot(raw),
    sourceName: input.file.name,
  };
};
