import type { ProjectState } from "../../types";
import { serializeProject } from "../../utils/projectSerialization";

export const PORTABLE_PROJECT_MIME_TYPE = "application/json";

export const createPortableProjectBlob = (project: ProjectState) =>
  new Blob([serializeProject(project)], { type: PORTABLE_PROJECT_MIME_TYPE });
