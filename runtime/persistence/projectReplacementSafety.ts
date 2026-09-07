import type { ProjectState } from "../../types";
import { downloadBlob } from "../../utils/project";
import { projectSnapshotFileName } from "../../utils/projectPersistence";
import { createPortableProjectBlob } from "./projectDownloadJob";
import { projectHasStudentWork } from "./projectDecisionBoundary";

/** Called only after a candidate is valid. Cancel never changes the document. */
export const confirmProjectReplacement = (project: ProjectState, label: string) => {
  if (!projectHasStudentWork(project)) return true;
  const paths = Object.keys(project.paths).length;
  if (!window.confirm(
    `${label}? Current work has ${paths} paths and ${project.mechanisms.length} mechanisms. A recovery copy download will start first.`,
  )) return false;
  downloadBlob(
    projectSnapshotFileName(project.metadata.name, `-recovery-${Date.now()}`),
    createPortableProjectBlob(project),
  );
  return true;
};
