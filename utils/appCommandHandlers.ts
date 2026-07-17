import type { AppStage } from "../types";
import type { AppCommandHandlerMap } from "./appCommands";
import { recordStudyEvent } from "./studyTelemetry";

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
};

const withStudyCommand = (id: string, handler: () => void) => () => {
  recordStudyEvent("command.run", { id }, { level: "metrics" });
  handler();
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
}: CreateAppCommandHandlersOptions): AppCommandHandlerMap => ({
  "project.new": withStudyCommand("project.new", newProject),
  "project.open": withStudyCommand("project.open", openProject),
  "project.recoverAutosave": withStudyCommand("project.recoverAutosave", recoverAutosave),
  "project.save": withStudyCommand("project.save", saveProject),
  "project.saveAs": withStudyCommand("project.saveAs", saveProjectAs),
  "project.exportCopy": withStudyCommand("project.exportCopy", exportProjectCopy),
  "project.exportBlueprint": withStudyCommand("project.exportBlueprint", () => goStage("blueprint")),
  "project.resetLesson": withStudyCommand("project.resetLesson", resetLesson),
  "edit.undo": withStudyCommand("edit.undo", undoProject),
  "edit.redo": withStudyCommand("edit.redo", redoProject),
  "view.zoomIn": withStudyCommand("view.zoomIn", () => zoomCanvas(1.2)),
  "view.zoomOut": withStudyCommand("view.zoomOut", () => zoomCanvas(1 / 1.2)),
  "view.fit": withStudyCommand("view.fit", fitCanvas),
  "view.reset": withStudyCommand("view.reset", fitCanvas),
  "workspace.saveLayout": withStudyCommand("workspace.saveLayout", saveWorkspaceLayout),
  "workspace.restoreLayout": withStudyCommand("workspace.restoreLayout", restoreWorkspaceLayout),
  "workspace.resetLayout": withStudyCommand("workspace.resetLayout", resetWorkspaceLayout),
  "stage.character": withStudyCommand("stage.character", () => goStage("character")),
  "stage.path": withStudyCommand("stage.path", () => goStage("path")),
  "stage.foundry": withStudyCommand("stage.foundry", () => goStage("foundry")),
  "stage.design": withStudyCommand("stage.design", () => goStage("design")),
  "stage.blueprint": withStudyCommand("stage.blueprint", () => goStage("blueprint")),
  "stage.assembly": withStudyCommand("stage.assembly", () => goStage("assembly")),
  "options.preferences": withStudyCommand("options.preferences", () => goStage("options")),
  "help.shortcuts": withStudyCommand("help.shortcuts", openShortcuts),
  "help.about": withStudyCommand("help.about", openAbout),
});
