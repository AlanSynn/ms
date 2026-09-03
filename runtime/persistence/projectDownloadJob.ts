import type { ProjectState } from "../../types";
import {
  assertProjectRoundTrip,
  projectStateFromPortableDocument,
  serializeProject,
} from "../../utils/projectSerialization";
import { loadProjectSnapshot } from "../../utils/project";
import {
  PROJECT_IMPORT_LIMITS,
  validateProjectImportShape,
} from "../import/projectImportPolicy";

export const PORTABLE_PROJECT_MIME_TYPE =
  "application/vnd.motionsmith.project+json";

export const createPortableProjectBlob = (project: ProjectState) => {
  const serialized = serializeProject(project);
  const blob = new Blob([serialized], { type: PORTABLE_PROJECT_MIME_TYPE });
  if (blob.size > PROJECT_IMPORT_LIMITS.projectBytes) {
    throw new Error("Project is larger than the 6 MB classroom limit.");
  }
  const raw = projectStateFromPortableDocument(JSON.parse(serialized));
  validateProjectImportShape(raw);
  const reopened = loadProjectSnapshot(raw);
  assertProjectRoundTrip(project, reopened);
  return blob;
};
