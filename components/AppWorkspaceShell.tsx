import type { ReactNode, RefObject } from "react";
import { Download, Upload } from "lucide-react";

import { AppStageRouter, type AppStageRouterProps } from "./AppStageRouter";
import {
  AboutDialog,
  GettingStartedDialog,
  OnnxCacheStatusPill,
  STAGES,
  ShortcutHelpDialog,
  TopCommandBar,
  WorkflowRail,
  WorkflowStatusStrip,
  type GuidedLessonTile,
  type StarterImageTemplate,
} from "./AppShell";
import { MechanismRecommendationSheet } from "./stages/path/MechanismRecommendationSheet";
import { TrackingModal } from "./TrackingModal";
import motionSmithIconUrl from "../resources/icons/AppIcon.png?url";
import type { AppStage, MechanismConfig, Point, ProjectState } from "../types";
import type { AppCommandHandlerMap } from "../utils/appCommands";
import type { WebOnnxCacheStatus } from "../utils/webOnnx";
import type { WorkflowStatus } from "../utils/workflowStatus";

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
  onnxCacheStatus: WebOnnxCacheStatus;
  cacheOnnxModel: () => void | Promise<void>;
  showGettingStarted: boolean;
  hideGettingStartedThisSession: boolean;
  starterTemplates: StarterImageTemplate[];
  guidedLessons: readonly GuidedLessonTile[];
  onLesson: (lessonId: string) => void;
  onStarterImage: (template: StarterImageTemplate) => void;
  onSample: () => void;
  onPackage: (files: FileList | File[]) => void | Promise<void>;
  onProcess: (file: File) => void | Promise<void>;
  onImport: (file: File) => void | Promise<void>;
  onHideGettingStartedThisSessionChange: (hidden: boolean) => void;
  onCloseGettingStarted: () => void;
  showShortcuts: boolean;
  onCloseShortcuts: () => void;
  showAbout: boolean;
  onCloseAbout: () => void;
  showRecommendations: boolean;
  onCloseRecommendations: () => void;
  onApplyRecommendation: (mechanism: MechanismConfig) => void;
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
  onnxCacheStatus,
  cacheOnnxModel,
  showGettingStarted,
  hideGettingStartedThisSession,
  starterTemplates,
  guidedLessons,
  onLesson,
  onStarterImage,
  onSample,
  onPackage,
  onProcess,
  onImport,
  onHideGettingStartedThisSessionChange,
  onCloseGettingStarted,
  showShortcuts,
  onCloseShortcuts,
  showAbout,
  onCloseAbout,
  showRecommendations,
  onCloseRecommendations,
  onApplyRecommendation,
  showTracking,
  onCloseTracking,
  onTransferTracking,
}: AppWorkspaceShellProps) => {
  const stageMeta = STAGES.find((item) => item.id === stage);
  const playerDock: ReactNode = stageRouterProps.playerDock;

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
                  <label className="btn-secondary cursor-pointer">
                    <Upload size={16} /> Import
                    <input
                      hidden
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) =>
                        importIfPresent(
                          event.currentTarget.files,
                          importProject,
                        )
                      }
                    />
                  </label>
                  <button
                    className="btn-secondary"
                    onClick={commandHandlers["project.save"]}
                  >
                    <Download size={16} /> Snapshot
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => goStage("blueprint")}
                  >
                    <Download size={16} /> Export
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
            accept="application/json,.motionsmith.json,.json"
            onChange={(event) =>
              importIfPresent(event.currentTarget.files, importProject)
            }
          />

          <AppStageRouter {...stageRouterProps} playerDock={playerDock} />
          <WorkflowStatusStrip {...workflowStatus} />
          <footer className="status-bar" data-testid="status-bar">
            <span>{commandStatus}</span>
            <OnnxCacheStatusPill
              status={onnxCacheStatus}
              onDownload={cacheOnnxModel}
            />
          </footer>
        </section>
      </div>
      {showGettingStarted && (
        <GettingStartedDialog
          starterTemplates={starterTemplates}
          guidedLessons={guidedLessons}
          hideForSession={hideGettingStartedThisSession}
          onLesson={onLesson}
          onStarterImage={onStarterImage}
          onSample={onSample}
          onProcess={onProcess}
          onImport={onImport}
          onHideForSessionChange={onHideGettingStartedThisSessionChange}
          onClose={onCloseGettingStarted}
        />
      )}
      {showShortcuts && <ShortcutHelpDialog onClose={onCloseShortcuts} />}
      {showAbout && <AboutDialog onClose={onCloseAbout} />}
      <MechanismRecommendationSheet
        isOpen={showRecommendations}
        project={project}
        selectedPart={stageRouterProps.selectedPart}
        selectedPath={stageRouterProps.selectedPath}
        onClose={onCloseRecommendations}
        onApply={onApplyRecommendation}
      />
      <TrackingModal
        isOpen={showTracking}
        onClose={onCloseTracking}
        onTransfer={onTransferTracking}
      />
    </main>
  );
};
