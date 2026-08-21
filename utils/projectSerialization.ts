import type { ProjectState } from "../types";

export const APP_STATE_VERSION = 1;

export const projectForPersistence = ({
  lastExport: _lastExport,
  ...project
}: ProjectState): ProjectState => project;

const versionedProject = (project: ProjectState) => ({
  ...projectForPersistence(project),
  version: APP_STATE_VERSION,
});

/** Human-readable portable project files. */
export const serializeProject = (project: ProjectState): string =>
  JSON.stringify(versionedProject(project), null, 2);

/** Compact browser autosave bytes; the persisted ProjectState shape is unchanged. */
export const serializeProjectCompact = (project: ProjectState): string =>
  JSON.stringify(versionedProject(project));
