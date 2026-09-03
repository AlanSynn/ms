import {
  lazy,
  Suspense,
  useEffect,
  type ReactNode,
  type RefObject,
} from "react";
import { Download, Upload } from "lucide-react";

import { AppStageRouter, type AppStageRouterProps } from "./AppStageRouter";
import {
  AboutDialog,
  GettingStartedDialog,
  STAGES,
  ShortcutHelpDialog,
  TopCommandBar,
  WorkflowRail,
  WorkflowStatusStrip,
  type GuidedLessonTile,
} from "./AppShell";
import motionSmithIconUrl from "../src-tauri/icons/icon.png?url";
import type { AppStage, Point, ProjectState } from "../types";
import type { AppCommandHandlerMap } from "../utils/appCommands";
import type { WorkflowStatus } from "../utils/workflowStatus";

const loadTrackingModal = () => import("./TrackingModal");
const TrackingModal = lazy(async () => ({
  default: (await loadTrackingModal()).TrackingModal,
}));

export type AppWorkspaceShellProps = {
  themeClass: string;
  appShellRef: RefObject<HTMLDivElement | null>;
  projectInputRef: RefObject<HTMLInputElement | null>;
  project: ProjectState;
  stage: AppStage;
  goStage: (stage: AppStage) => void;
  onHome: () => void;
  commandHandlers: AppCommandHandlerMap;
  importProject: (file: File) => void | Promise<void>;
  stageRouterProps: AppStageRouterProps;
  workflowStatus: WorkflowStatus;
  commandStatus: string;
  showGettingStarted: boolean;
  hideGettingStartedThisSession: boolean;
  guidedLessons: readonly GuidedLessonTile[];
  onLesson: (lessonId: string, preparedProject?: ProjectState) => void;
  onSample: (preparedProject?: ProjectState) => void;
  onPackage: (files: FileList | File[]) => void | Promise<void>;
  onImport: (file: File) => void | Promise<void>;
  onHideGettingStartedThisSessionChange: (hidden: boolean) => void;
  onCloseGettingStarted: () => void;
  showShortcuts: boolean;
  onCloseShortcuts: () => void;
  showAbout: boolean;
  onCloseAbout: () => void;
  showTracking: boolean;
  onCloseTracking: () => void;
  onTransferTracking: (path: Point[]) => void;
};

const importIfPresent = (
  files: FileList | null,
  importProject: (file: File) => void | Promise<void>,
) => {
  const file = files?.[0];
  if (file) void importProject(file);
};

export const AppWorkspaceShell = ({
  themeClass,
  appShellRef,
  projectInputRef,
  project,
  stage,
  goStage,
  onHome,
  commandHandlers,
  importProject,
  stageRouterProps,
  workflowStatus,
  commandStatus,
  showGettingStarted,
  hideGettingStartedThisSession,
  guidedLessons,
  onLesson,
  onSample,
  onPackage,
  onImport,
  onHideGettingStartedThisSessionChange,
  onCloseGettingStarted,
  showShortcuts,
  onCloseShortcuts,
  showAbout,
  onCloseAbout,
  showTracking,
  onCloseTracking,
  onTransferTracking,
}: AppWorkspaceShellProps) => {
  const stageMeta = STAGES.find((item) => item.id === stage);
  const playerDock: ReactNode = stageRouterProps.playerDock;

  useEffect(() => {
    if (stage !== "path" || showTracking) return;
    const host = window as typeof window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (host.requestIdleCallback) {
      const handle = host.requestIdleCallback(
        () => void loadTrackingModal(),
        { timeout: 2_000 },
      );
      return () => host.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(() => void loadTrackingModal(), 500);
    return () => window.clearTimeout(handle);
  }, [showTracking, stage]);

  return (
    <main
      className={`min-h-screen overflow-hidden ${themeClass}`}
      data-theme={project.settings.theme}
    >
      <div
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(circle at 15% 10%, rgba(90,108,255,.12), transparent 28%), radial-gradient(circle at 85% 20%, rgba(90,108,255,.08), transparent 24%), linear-gradient(120deg, rgba(8,10,18,.04), transparent)",
        }}
      />
      <div ref={appShellRef} className="relative grid min-h-screen app-shell">
        <WorkflowRail stage={stage} goStage={goStage} onHome={onHome} />
        <section className="relative flex min-w-0 flex-col">
          <header className="app-header border-b border-slate-300/70 bg-white/50 backdrop-blur-xl">
            <button
              type="button"
              className="app-header-home"
              data-testid="header-home"
              onClick={onHome}
              aria-label="Home"
            >
              <img
                className="brand-kicker app-header-icon"
                src={motionSmithIconUrl}
                alt=""
                aria-hidden="true"
                decoding="async"
                draggable={false}
              />
              <h1 className="brand-title">MotionSmith</h1>
              <h2 className="current-stage-title">{stageMeta?.label}</h2>
            </button>
            <div className="app-header-actions">
              <TopCommandBar commandHandlers={commandHandlers} />
              {project.settings.toolbarVisible && (
                <div className="quick-toolbar" data-testid="quick-toolbar">
                  <button className="btn-secondary" onClick={commandHandlers["project.open"]}>
                    <Upload size={16} /> Open Project
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={commandHandlers["project.save"]}
                  >
                    <Download size={16} /> Save Project
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => goStage("blueprint")}
                  >
                    <Download size={16} /> Blueprint
                  </button>
                </div>
              )}
            </div>
          </header>
          <input
            ref={projectInputRef}
            data-testid="project-file-input"
            hidden
            type="file"
            accept="application/json,.motionsmith,.motionsmith.json,.json"
            onChange={(event) =>
              importIfPresent(event.currentTarget.files, importProject)
            }
          />

          <AppStageRouter
            {...stageRouterProps}
            playerDock={playerDock}
            suspendStageContent={showGettingStarted}
          />
          <WorkflowStatusStrip {...workflowStatus} />
          <footer className="status-bar" data-testid="status-bar">
            <span>{commandStatus}</span>
          </footer>
        </section>
      </div>
      {showGettingStarted && (
        <GettingStartedDialog
          guidedLessons={guidedLessons}
          hideForSession={hideGettingStartedThisSession}
          onLesson={onLesson}
          onSample={onSample}
          onPackage={onPackage}
          onImport={onImport}
          onHideForSessionChange={onHideGettingStartedThisSessionChange}
          onClose={onCloseGettingStarted}
        />
      )}
      {showShortcuts && <ShortcutHelpDialog onClose={onCloseShortcuts} />}
      {showAbout && <AboutDialog onClose={onCloseAbout} />}
      {showTracking && (
        <Suspense fallback={null}>
          <TrackingModal
            isOpen
            onClose={onCloseTracking}
            onTransfer={onTransferTracking}
            performancePreset={project.settings.performancePreset}
          />
        </Suspense>
      )}
    </main>
  );
};
