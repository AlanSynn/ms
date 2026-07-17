import type { ProjectAction, ProjectState } from "../types";

const PRIVATE_KEYS = new Set([
  "email",
  "phone",
  "address",
  "schoolId",
  "studentId",
  "userAgent",
  "ip",
  "ipAddress",
  "latitude",
  "longitude",
  "location",
  "geo",
  "name",
  "sourceImageName",
  "outputDir",
  "createdAt",
  "updatedAt",
  "message",
  "error",
  "warnings",
  "recommendation",
  "simulationSummary",
  "projectName",
  "sourceMedia",
  "classroomAssessmentKey",
  "originalSvgPath",
  "enhancedSvgPath",
  "textureUrl",
  "maskUrl",
  "sourceTextureUrl",
  "svg",
  "cutSheetPdf",
  "customPartsSvg",
  "customPartsPdf",
  "customPartsStl",
  "assemblyGuideHtml",
  "assemblyGuidePdf",
  "metadataJson",
  "jointMap",
  "hierarchy",
]);

const PRIVATE_SUFFIXES = ["Url", "Filename", "FileName", "Name", "Label"];
const PRIVATE_TEXT_KEYS = /^(?:title|instruction|description|actual|expected|summary|steps|note|comment|text)$/i;
const DIRECT_IDENTITY_VALUE = /(?:[^\s@]+@[^\s@]+\.[^\s@]+)|(?:\+?\d[\d ().-]{7,}\d)/;
const STATIC_ID_KEYS = new Set(["classroomLessonId", "presetId", "graphFamilyId"]);
const ENTITY_MAP_KEYS = new Set(["parts", "sceneObjects", "paths", "joints", "nodes", "constraints", "handles", "anchors"]);
const ENTITY_ID_ARRAY_KEYS = new Set(["bones", "partOrder", "sceneObjectOrder"]);

export const STUDY_EVENT_SCHEMA = "motionsmith-study-event-v1";
export const STUDY_SNAPSHOT_SCHEMA = "motionsmith-study-snapshot-v1";

const safeString = (value: string) => {
  if (/^(?:data|blob|file|https?):/i.test(value) || DIRECT_IDENTITY_VALUE.test(value)) return undefined;
  return value.length <= 256 ? value : undefined;
};

const hashEntityId = (value: string, salt: string) => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of `${salt}\0${value}`) {
    const code = character.charCodeAt(0);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
};

export const studyEntityAlias = (projectAlias: string, value: string) =>
  `ent_${hashEntityId(value, projectAlias)}`;

const isEntityIdKey = (key: string) =>
  !STATIC_ID_KEYS.has(key) && (key === "id" || key.endsWith("Id"));

const isEntityIdArrayKey = (key: string) =>
  ENTITY_ID_ARRAY_KEYS.has(key) || (!STATIC_ID_KEYS.has(key) && key.endsWith("Ids"));

const aliasStudyEntityIds = (
  value: unknown,
  projectAlias: string,
  key = "",
): unknown => {
  if (typeof value === "string") {
    return isEntityIdKey(key) || isEntityIdArrayKey(key)
      ? studyEntityAlias(projectAlias, value)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "string" && isEntityIdArrayKey(key)
        ? studyEntityAlias(projectAlias, item)
        : aliasStudyEntityIds(item, projectAlias, key),
    );
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
      ENTITY_MAP_KEYS.has(key) ? studyEntityAlias(projectAlias, childKey) : childKey,
      aliasStudyEntityIds(child, projectAlias, childKey),
    ]),
  );
};

export const scrubStudyValue = (
  value: unknown,
  key = "",
  depth = 0,
): unknown => {
  if (depth > 24 || PRIVATE_KEYS.has(key)) return undefined;
  if (PRIVATE_SUFFIXES.some((suffix) => key.endsWith(suffix)) || PRIVATE_TEXT_KEYS.test(key)) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return safeString(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 4096)
      .map((item) => scrubStudyValue(item, key, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .slice(0, 4096)
    .map(([childKey, childValue]) => [
      childKey,
      scrubStudyValue(childValue, childKey, depth + 1),
    ] as const)
    .filter(([, childValue]) => childValue !== undefined);
  return Object.fromEntries(entries);
};

const studySkeleton = (skeleton: ProjectState["skeleton"]) => skeleton
  ? {
      joints: skeleton.joints,
      bones: skeleton.bones,
      rootJointIds: skeleton.rootJointIds,
      metadata: { scale: skeleton.metadata.scale },
    }
  : null;

export const studyProjectSnapshot = (
  project: ProjectState,
  projectAlias: string,
) =>
  aliasStudyEntityIds(scrubStudyValue({
    version: project.version,
    metadata: {
      projectAlias,
      status: project.metadata.status,
      classroomLessonId: project.metadata.classroomLessonId,
      normalizationScale: project.metadata.normalizationScale,
    },
    parts: project.parts,
    partOrder: project.partOrder,
    sceneObjects: project.sceneObjects,
    sceneObjectOrder: project.sceneObjectOrder,
    skeleton: studySkeleton(project.skeleton),
    paths: project.paths,
    mechanisms: project.mechanisms,
    settings: {
      ...project.settings,
      classroomAssessmentKey: undefined,
    },
    selectedPartId: project.selectedPartId,
    selectedPathId: project.selectedPathId,
    selectedMechanismId: project.selectedMechanismId,
    selectedSceneObjectId: project.selectedSceneObjectId,
    processing: {
      stage: project.processing.stage,
      progress: project.processing.progress,
    },
    exportSummary: project.lastExport
      ? {
          recipeCount: project.lastExport.recipes.length,
          cutPartCount: project.lastExport.cutList.reduce(
            (total, item) => total + item.quantity,
            0,
          ),
          validationIssueCount: project.lastExport.validationIssues.length,
        }
      : undefined,
    characterPackage: project.characterPackage
      ? {
          present: true,
          replacementMode: project.characterPackage.replacementContext?.mode,
        }
      : undefined,
    foundryExportSummary: project.lastFoundryExport
      ? {
          mechanismType: project.lastFoundryExport.mechanismType,
          parameters: project.lastFoundryExport.parameters,
          generatedPath: project.lastFoundryExport.generatedPath,
          targetPartId: project.lastFoundryExport.targetPartId,
          targetSceneObjectId: project.lastFoundryExport.targetSceneObjectId,
          targetPathId: project.lastFoundryExport.targetPathId,
        }
      : undefined,
  }), projectAlias);

export const studyProjectAction = (action: ProjectAction, projectAlias = "prj_unset") => {
  if (action.type === "load_project") return { type: action.type };
  const safeAction = action.type === "set_skeleton"
    ? { type: action.type, skeleton: studySkeleton(action.skeleton) }
    : action;
  return aliasStudyEntityIds(scrubStudyValue(safeAction), projectAlias);
};

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const makeStudySnapshotRecords = (
  project: ProjectState,
  projectAlias: string,
  reason: string,
  snapshotId: string,
) => {
  const state = studyProjectSnapshot(project, projectAlias);
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  if (bytes.byteLength <= 240 * 1024) {
    return [{
      type: "project.snapshot",
      data: { reason, snapshotSchema: STUDY_SNAPSHOT_SCHEMA, state },
    }];
  }

  const chunkSize = 96 * 1024;
  const total = Math.ceil(bytes.byteLength / chunkSize);
  const records: Array<{ type: string; data: unknown }> = [{
    type: "project.snapshot.begin",
    data: { snapshotId, reason, snapshotSchema: STUDY_SNAPSHOT_SCHEMA, total, bytes: bytes.byteLength },
  }];
  for (let index = 0; index < total; index += 1) {
    const encoded = bytesToBase64Url(bytes.slice(index * chunkSize, (index + 1) * chunkSize));
    records.push({
      type: "project.snapshot.chunk",
      data: {
        snapshotId,
        index,
        total,
        encoding: "base64url-json",
        parts: encoded.match(/.{1,240}/g) ?? [],
      },
    });
  }
  return records;
};

export const studyProjectCounts = (project: ProjectState) => ({
  parts: project.partOrder.length,
  objects: project.sceneObjectOrder.length,
  paths: Object.keys(project.paths).length,
  mechanisms: project.mechanisms.length,
  validMechanisms: project.mechanisms.filter(
    (mechanism) => mechanism.enabled && !(mechanism.warnings?.length),
  ).length,
  hasSkeleton: Boolean(project.skeleton),
  hasExport: Boolean(project.lastExport),
});
