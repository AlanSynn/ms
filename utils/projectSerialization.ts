import type { ProjectState } from "../types";
import {
  mechanismOutputBindings,
  mechanismWithOutputBindings,
} from "./mechanismBindings";

export const APP_STATE_VERSION = 2 as const;
export const PORTABLE_PROJECT_FORMAT = "motionsmith-project" as const;

export type PortableProjectDocument = {
  format: typeof PORTABLE_PROJECT_FORMAT;
  schemaVersion: typeof APP_STATE_VERSION;
  savedAt: string;
  manifest: {
    projectId: string;
    projectName: string;
    revision: number;
    pathIds: string[];
    mechanismIds: string[];
  };
  integrity: {
    algorithm: "fnv1a32";
    contentFingerprint: string;
  };
  project: ProjectState;
};

export const projectForPersistence = ({
  lastExport: _lastExport,
  ...project
}: ProjectState): ProjectState => project;

const persistedMetadata = (metadata: ProjectState["metadata"]) => {
  const next = { ...metadata };
  if (typeof next.sourceImageName === "string") {
    next.sourceImageName = next.sourceImageName.slice(0, 240);
  } else {
    delete next.sourceImageName;
  }
  return next;
};

const versionedProject = (project: ProjectState) => ({
  ...projectForPersistence(project),
  metadata: persistedMetadata(project.metadata),
  parts: Object.fromEntries(
    Object.entries(project.parts).map(([id, part]) => [
      id,
      {
        ...part,
        maskUrl:
          typeof part.maskUrl === "string" && part.maskUrl.startsWith("data:image/")
            ? part.maskUrl
            : undefined,
      },
    ]),
  ),
  version: APP_STATE_VERSION,
  revision: project.revision ?? 0,
  paths: Object.fromEntries(
    Object.entries(project.paths).map(([id, path]) => [
      id,
      { ...path, smoothness: path.smoothness ?? 0 },
    ]),
  ),
  pathOrder: [
    ...(project.pathOrder ?? []).filter((id) => Boolean(project.paths[id])),
    ...Object.keys(project.paths).filter((id) => !(project.pathOrder ?? []).includes(id)),
  ],
  mechanisms: project.mechanisms.map((mechanism) =>
    mechanismWithOutputBindings(
      { ...mechanism, outputs: mechanism.outputs ?? [] },
      mechanismOutputBindings(mechanism),
    ),
  ),
});

const fingerprintText = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const serializedProjectContent = (project: ProjectState) =>
  JSON.stringify(versionedProject(project));

export const projectContentFingerprint = (project: ProjectState) =>
  fingerprintText(serializedProjectContent(project));

const portableDocument = (project: ProjectState): PortableProjectDocument => {
  const persisted = versionedProject(project);
  return {
    format: PORTABLE_PROJECT_FORMAT,
    schemaVersion: APP_STATE_VERSION,
    savedAt: new Date().toISOString(),
    manifest: {
      projectId: persisted.metadata.id,
      projectName: persisted.metadata.name,
      revision: persisted.revision,
      pathIds: persisted.pathOrder ?? Object.keys(persisted.paths),
      mechanismIds: persisted.mechanisms.map((mechanism) => mechanism.id),
    },
    integrity: {
      algorithm: "fnv1a32",
      contentFingerprint: fingerprintText(JSON.stringify(persisted)),
    },
    project: persisted,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const projectStateFromPortableDocument = (value: unknown): unknown => {
  if (!isRecord(value) || value.format === undefined) return value;
  if (value.format !== PORTABLE_PROJECT_FORMAT) {
    throw new Error("Unsupported project file format.");
  }
  if (value.schemaVersion !== APP_STATE_VERSION || !isRecord(value.project)) {
    throw new Error("This project was created by a newer MotionSmith version.");
  }
  const integrity = isRecord(value.integrity) ? value.integrity : {};
  const expected = integrity.contentFingerprint;
  const actual = fingerprintText(JSON.stringify(value.project));
  if (integrity.algorithm !== 'fnv1a32' || typeof expected !== "string" || expected !== actual) {
    throw new Error("Project file integrity check failed. The original project is unchanged.");
  }
  const manifest = isRecord(value.manifest) ? value.manifest : {};
  const metadata = isRecord(value.project.metadata) ? value.project.metadata : {};
  const paths = isRecord(value.project.paths) ? value.project.paths : {};
  const mechanisms = Array.isArray(value.project.mechanisms) ? value.project.mechanisms : [];
  if (manifest.projectId !== metadata.id || manifest.projectName !== metadata.name || manifest.revision !== value.project.revision ||
    JSON.stringify(manifest.pathIds) !== JSON.stringify(value.project.pathOrder ?? Object.keys(paths)) ||
    JSON.stringify(manifest.mechanismIds) !== JSON.stringify(mechanisms.map(item => isRecord(item) ? item.id : undefined))) {
    throw new Error('Project file manifest disagrees with its content.');
  }
  return value.project;
};

const resumableProjectContent = (project: ProjectState) => {
  const persisted = versionedProject(project);
  return {
    version: persisted.version,
    revision: persisted.revision,
    metadata: persisted.metadata,
    parts: persisted.parts,
    partOrder: persisted.partOrder,
    sceneObjects: persisted.sceneObjects,
    sceneObjectOrder: persisted.sceneObjectOrder,
    skeleton: persisted.skeleton,
    paths: persisted.paths,
    pathOrder: persisted.pathOrder,
    motionTimeline: persisted.motionTimeline,
    mechanisms: persisted.mechanisms,
    settings: persisted.settings,
    selectedPartId: persisted.selectedPartId,
    selectedPathId: persisted.selectedPathId,
    selectedMechanismId: persisted.selectedMechanismId,
    selectedSceneObjectId: persisted.selectedSceneObjectId,
    characterPackage: persisted.characterPackage,
    lastFoundryExport: persisted.lastFoundryExport,
  };
};

const firstDifferentPath = (
  before: unknown,
  after: unknown,
  path = "project",
): string | undefined => {
  if (Object.is(before, after)) return undefined;
  if (
    before === null ||
    after === null ||
    typeof before !== "object" ||
    typeof after !== "object" ||
    Array.isArray(before) !== Array.isArray(after)
  ) {
    return path;
  }
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  for (const key of new Set([
    ...Object.keys(beforeRecord),
    ...Object.keys(afterRecord),
  ])) {
    if (!(key in beforeRecord) || !(key in afterRecord)) return `${path}.${key}`;
    const difference = firstDifferentPath(
      beforeRecord[key],
      afterRecord[key],
      `${path}.${key}`,
    );
    if (difference) return difference;
  }
  return undefined;
};

const canonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  );
};

const resumableProjectJson = (project: ProjectState) =>
  JSON.stringify(canonicalJsonValue(resumableProjectContent(project)));

export const assertProjectRoundTrip = (
  source: ProjectState,
  reopened: ProjectState,
) => {
  const before = resumableProjectJson(source);
  const after = resumableProjectJson(reopened);
  if (before !== after) {
    const field = firstDifferentPath(JSON.parse(before), JSON.parse(after));
    throw new Error(
      `Project save verification failed${field ? ` (${field} differs)` : ""}. No file was downloaded and the project is unchanged.`,
    );
  }
};

/** Human-readable portable project files. */
export const serializeProject = (project: ProjectState): string =>
  JSON.stringify(portableDocument(project), null, 2);

/** Compact browser autosave bytes; the persisted ProjectState shape is unchanged. */
export const serializeProjectCompact = (project: ProjectState): string =>
  JSON.stringify(versionedProject(project));
