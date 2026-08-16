import type {
  AppStage,
  CanvasViewport,
} from "../types";
import { normalizeCanvasViewport } from "./viewport";
import {
  AUTOSAVE_STORAGE_KEYS,
  LEGACY_STORAGE_KEYS,
  browserStorage,
  readStorageWithLegacy,
  type AutosaveStorage,
} from "./projectAutosaveFormat";

export { readStorageWithLegacy } from "./projectAutosaveFormat";
export { LEGACY_STORAGE_KEYS } from "./projectAutosaveFormat";
export type {
  AutosaveFailureReason,
  AutosaveRecovery,
  AutosaveRecoveryOutcome,
  AutosaveStorage,
  AutosaveWriteResult,
} from "./projectAutosaveFormat";
export {
  commitAutosaveSnapshot,
  markAutosaveDirty,
  prepareAutosaveSnapshot,
  writeAutosaveSnapshot,
} from "./projectAutosaveTransactions";
export type {
  AutosaveDirtyResult,
  AutosavePreparationResult,
  PreparedAutosaveSnapshot,
} from "./projectAutosaveTransactions";
export { readAutosaveProject } from "./projectAutosaveRecovery";
export type { AutosaveProjectReadResult } from "./projectAutosaveRecovery";

export const STORAGE_KEYS = {
  ...AUTOSAVE_STORAGE_KEYS,
  workspace: "motionsmith.workspace",
} as const;

export const migrateStorageValue = (
  key: string,
  value: string,
  storage: AutosaveStorage = browserStorage(),
) => {
  try {
    storage.setItem(key, value);
  } catch {
    // Workspace migration remains a compatibility fallback; autosave migration
    // below reports its completion state instead of hiding a failed commit.
  }
};

const projectFileStem = (name: string) =>
  (name.trim() || "MotionSmith-project")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "MotionSmith-project";

export const projectSnapshotFileName = (projectName: string, suffix: string) =>
  `${projectFileStem(projectName)}${suffix}.motionsmith.json`;

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
  if (layout.toolbarVisible !== undefined || layout.partPanelVisible !== undefined) {
    const toolbarVisible =
      typeof layout.toolbarVisible === "boolean"
        ? layout.toolbarVisible
        : currentToolbarVisible;
    const partPanelVisible =
      typeof layout.partPanelVisible === "boolean"
        ? layout.partPanelVisible
        : currentPartPanelVisible;
    if (layout.toolbarVisible !== undefined && typeof layout.toolbarVisible !== "boolean") {
      warnings.push("ignored invalid toolbar visibility");
    }
    if (layout.partPanelVisible !== undefined && typeof layout.partPanelVisible !== "boolean") {
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
