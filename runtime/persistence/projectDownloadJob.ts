import type { ProjectState } from "../../types";
import {
  assertProjectRoundTrip,
  serializeProject,
} from "../../utils/projectSerialization";
import { PROJECT_IMPORT_LIMITS } from "../import/projectImportPolicy";
import { readProjectFileCandidate } from "../import/projectFileCandidate";

export const PORTABLE_PROJECT_MIME_TYPE =
  "application/vnd.motionsmith.project+json";

export const createPortableProjectBlob = (project: ProjectState) => {
  const serialized = serializeProject(project);
  const blob = new Blob([serialized], { type: PORTABLE_PROJECT_MIME_TYPE });
  if (blob.size > PROJECT_IMPORT_LIMITS.projectBytes) {
    throw new Error("Project is larger than the 12 MB classroom file limit.");
  }
  const reopened = readProjectFileCandidate(JSON.parse(serialized));
  assertProjectRoundTrip(project, reopened);
  return blob;
};
