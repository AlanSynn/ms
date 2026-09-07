import type { AppStage } from "../types";
import type { AppCommandHandlerMap } from "./appCommands";

type CreateAppCommandHandlersOptions = {
  newProject: () => void;
  openProject: () => void;
  recoverAutosave: () => void;
  saveProject: () => void;
  saveProjectAs: () => void;
  exportProjectCopy: () => void;
  resetLesson: () => void;
  undoProject: () => void;
  redoProject: () => void;
  zoomCanvas: (factor: number) => void;
  fitCanvas: () => void;
  saveWorkspaceLayout: () => void;
  restoreWorkspaceLayout: () => void;
  resetWorkspaceLayout: () => void;
  goStage: (stage: AppStage) => void;
  openShortcuts: () => void;
  openAbout: () => void;
  openFindFeature?: () => void;
  openFeedback?: () => void;
  openWhatsNew?: () => void;
};

export const createAppCommandHandlers = ({
  newProject,
  openProject,
  recoverAutosave,
  saveProject,
  saveProjectAs,
  exportProjectCopy,
  resetLesson,
  undoProject,
  redoProject,
  zoomCanvas,
  fitCanvas,
  saveWorkspaceLayout,
  restoreWorkspaceLayout,
  resetWorkspaceLayout,
  goStage,
  openShortcuts,
  openAbout,
  openFindFeature = () => undefined,
  openFeedback = () => undefined,
  openWhatsNew = () => undefined,
}: CreateAppCommandHandlersOptions): AppCommandHandlerMap => ({
  "project.new": newProject,
  "project.open": openProject,
  "project.recoverAutosave": recoverAutosave,
  "project.save": saveProject,
  "project.saveAs": saveProjectAs,
  "project.exportCopy": exportProjectCopy,
  "project.exportBlueprint": () => goStage("blueprint"),
  "project.resetLesson": resetLesson,
  "edit.undo": undoProject,
  "edit.redo": redoProject,
  "view.zoomIn": () => zoomCanvas(1.2),
  "view.zoomOut": () => zoomCanvas(1 / 1.2),
  "view.fit": fitCanvas,
  "view.reset": fitCanvas,
  "workspace.saveLayout": saveWorkspaceLayout,
  "workspace.restoreLayout": restoreWorkspaceLayout,
  "workspace.resetLayout": resetWorkspaceLayout,
  "stage.project": () => goStage("project"),
  "stage.character": () => goStage("character"),
  "stage.path": () => goStage("path"),
  "stage.foundry": () => goStage("foundry"),
  "stage.design": () => goStage("design"),
  "stage.blueprint": () => goStage("blueprint"),
  "stage.assembly": () => goStage("assembly"),
  "options.preferences": () => goStage("options"),
  "help.shortcuts": openShortcuts,
  "help.about": openAbout,
  "help.findFeature": openFindFeature,
  "help.feedback": openFeedback,
  "help.whatsNew": openWhatsNew,
});
