import type { AppStage, CanvasViewport, ProjectState } from "../types";
import { loadProjectSnapshot, serializeProject } from "./project";
import { normalizeCanvasViewport } from "./viewport";

export const STORAGE_KEYS = {
  autosave: "motionsmith.autosave",
  workspace: "motionsmith.workspace",
} as const;

const LEGACY_STORAGE_PREFIX = ["mech", "anim"].join("");
export const LEGACY_STORAGE_KEYS = {
  autosave: `${LEGACY_STORAGE_PREFIX}.autosave`,
  workspace: `${LEGACY_STORAGE_PREFIX}.workspace`,
} as const;

type StoredStorageValue = {
  value: string | null;
  fromLegacy: boolean;
};

export const readStorageWithLegacy = (
  key: string,
  legacyKey: string,
): StoredStorageValue => {
  const current = localStorage.getItem(key);
  if (current !== null) return { value: current, fromLegacy: false };
  const legacy = localStorage.getItem(legacyKey);
  return { value: legacy, fromLegacy: legacy !== null };
};

export const migrateStorageValue = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ponytail: migration is best-effort; legacy read fallback still works.
  }
};

const projectFileStem = (name: string) =>
  (name.trim() || "MotionSmith-project")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "MotionSmith-project";

export const projectSnapshotFileName = (projectName: string, suffix: string) =>
  `${projectFileStem(projectName)}${suffix}.motionsmith.json`;

export const writeAutosaveSnapshot = (project: ProjectState) => {
  try {
    localStorage.setItem(STORAGE_KEYS.autosave, serializeProject(project));
  } catch {
    // ponytail: browser autosave is best-effort; manual snapshot download stays available.
  }
};

export const readAutosaveProject = (): ProjectState | null => {
  const stored = readStorageWithLegacy(
    STORAGE_KEYS.autosave,
    LEGACY_STORAGE_KEYS.autosave,
  );
  if (!stored.value) return null;
  const project = loadProjectSnapshot(JSON.parse(stored.value));
  if (stored.fromLegacy) migrateStorageValue(STORAGE_KEYS.autosave, stored.value);
  return project;
};

export type WorkspaceLayoutSnapshot = {
  stage: AppStage;
  viewport: CanvasViewport;
  toolbarVisible: boolean;
  partPanelVisible: boolean;
};

export const writeWorkspaceLayoutSnapshot = (
  snapshot: WorkspaceLayoutSnapshot,
) => {
  localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify(snapshot));
};

type WorkspaceLayoutStorage = Partial<{
  stage: unknown;
  viewport: unknown;
  toolbarVisible: unknown;
  partPanelVisible: unknown;
}>;

export type RestoredWorkspaceLayout = {
  stage?: AppStage;
  viewport?: CanvasViewport;
  visibility?: {
    toolbarVisible: boolean;
    partPanelVisible: boolean;
  };
  warnings: string[];
};

type ReadWorkspaceLayoutOptions = {
  isAppStage: (value: unknown) => value is AppStage;
  currentToolbarVisible: boolean;
  currentPartPanelVisible: boolean;
};

export const readWorkspaceLayoutSnapshot = ({
  isAppStage,
  currentToolbarVisible,
  currentPartPanelVisible,
}: ReadWorkspaceLayoutOptions): RestoredWorkspaceLayout | null => {
  const stored = readStorageWithLegacy(
    STORAGE_KEYS.workspace,
    LEGACY_STORAGE_KEYS.workspace,
  );
  if (!stored.value) return null;

  const layout = JSON.parse(stored.value) as WorkspaceLayoutStorage;
  if (stored.fromLegacy) migrateStorageValue(STORAGE_KEYS.workspace, stored.value);

  const warnings: string[] = [];
  const restored: RestoredWorkspaceLayout = { warnings };

  if (layout.viewport !== undefined) {
    const viewport = normalizeCanvasViewport(layout.viewport);
    if (viewport) restored.viewport = viewport;
    else warnings.push("ignored invalid workspace viewport");
  }

  if (
    layout.toolbarVisible !== undefined ||
    layout.partPanelVisible !== undefined
  ) {
    const toolbarVisible =
      typeof layout.toolbarVisible === "boolean"
        ? layout.toolbarVisible
        : currentToolbarVisible;
    const partPanelVisible =
      typeof layout.partPanelVisible === "boolean"
        ? layout.partPanelVisible
        : currentPartPanelVisible;
    if (
      layout.toolbarVisible !== undefined &&
      typeof layout.toolbarVisible !== "boolean"
    ) {
      warnings.push("ignored invalid toolbar visibility");
    }
    if (
      layout.partPanelVisible !== undefined &&
      typeof layout.partPanelVisible !== "boolean"
    ) {
      warnings.push("ignored invalid panel visibility");
    }
    restored.visibility = { toolbarVisible, partPanelVisible };
  }

  if (layout.stage !== undefined) {
    if (isAppStage(layout.stage)) restored.stage = layout.stage;
    else warnings.push("ignored invalid workspace stage");
  }

  return restored;
};
