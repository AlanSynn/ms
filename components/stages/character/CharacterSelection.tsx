import {
  lazy,
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AppStage,
  BodyPartLayer,
  CanvasViewport,
  ProjectAction,
  ProjectState,
  SceneObject,
} from "../../../types";
import { type ClassroomLessonTemplate, uid } from "../../../utils/project";
import { createSceneObjectImageWorkerClient } from "../../../runtime/import/sceneObjectImageWorkerClient";
import { CanvasZoomToolbar } from "../../AppShell";
import { DeferredThreePuppetPreview } from "../../DeferredThreePuppetPreview";
import {
  EditorStageFrame,
  StageLeftSummary,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import { CharacterImportControls } from "./CharacterImportControls";
import { CharacterLessonOwnership } from "./CharacterLessonOwnership";
import { ContextHelp } from "../../ui/ContextHelp";
import type { CharacterImportProgressStore } from "../../../runtime/import/characterImportProgressStore";

const loadCharacterImportOverlays = () => import("./CharacterImportOverlays");
const CharacterImportReviewBoundary = lazy(async () => ({
  default: (await loadCharacterImportOverlays()).CharacterImportReviewBoundary,
}));
const CharacterImportStatusDock = lazy(async () => ({
  default: (await loadCharacterImportOverlays()).CharacterImportStatusDock,
}));
const CharacterSetupPanel = lazy(async () => ({
  default: (await import("./CharacterSetupPanel")).CharacterSetupPanel,
}));
const SceneObjectInspector = lazy(async () => ({
  default: (await import("./SceneObjectInspector")).SceneObjectInspector,
}));

const CharacterInspectorPlaceholder = ({
  name,
}: {
  name: string;
}) => (
  <section
    className="character-setup-panel"
    data-testid="character-setup-panel"
    aria-busy="true"
  >
    <div className="section-title">Part</div>
    <div className="mt-1 text-sm font-extrabold text-slate-800">{name}</div>
  </section>
);

export const CharacterSelection = ({
  project,
  dispatch,
  characterImportProgress,
  onOpenGettingStarted,
  onAccept,
  onDiscard,
  onPackage,
  onImport,
  onEditCharacter,
  onSaveSkeleton,
  activeClassroomLesson,
  resetLesson,
  goStage,
  viewport,
  setViewport,
}: {
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
  characterImportProgress: CharacterImportProgressStore;
  onOpenGettingStarted: () => void;
  onAccept: () => void;
  onDiscard: () => void;
  onPackage: (files: FileList | File[]) => void;
  onImport: (file: File) => void;
  onEditCharacter: () => void;
  onSaveSkeleton: () => void;
  activeClassroomLesson?: ClassroomLessonTemplate;
  resetLesson: () => void;
  goStage: (stage: AppStage) => void;
  viewport: CanvasViewport;
  setViewport: Dispatch<SetStateAction<CanvasViewport>>;
}) => {
  const packageInputRef = useRef<HTMLInputElement>(null);
  const objectInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [toolsReady, setToolsReady] = useState(false);
  const objectImageClient = useMemo(
    () => createSceneObjectImageWorkerClient(),
    [],
  );
  useEffect(() => () => objectImageClient.dispose(), [objectImageClient]);
  useEffect(() => {
    const host = window as typeof window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (host.requestIdleCallback) {
      const handle = host.requestIdleCallback(
        () => setToolsReady(true),
        { timeout: 900 },
      );
      return () => host.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(() => setToolsReady(true), 250);
    return () => window.clearTimeout(handle);
  }, []);
  const partPanelProject = project;
  const partPanelDisabled = false;
  const editableParts = partPanelProject.partOrder
    .map((id) => partPanelProject.parts[id])
    .filter((part): part is BodyPartLayer => Boolean(part));
  const sceneObjects = project.sceneObjectOrder
    .map((id) => project.sceneObjects[id])
    .filter((object): object is SceneObject => Boolean(object));
  const selectedSceneObject = project.selectedSceneObjectId
    ? project.sceneObjects[project.selectedSceneObjectId]
    : undefined;
  const selectedEditablePart =
    (!partPanelDisabled && project.selectedPartId
      ? project.parts[project.selectedPartId]
      : undefined) ?? editableParts[0];
  const selectedPartId = selectedEditablePart?.id ?? "";
  const addSceneObject = (file: File) => {
    objectImageClient.request(file, uid("object"), {
      complete: ({ object }) => startTransition(() =>
        dispatch({ type: "upsert_scene_object", object }),
      ),
      failed: (error) =>
        dispatch({
          type: "set_processing",
          processing: {
            stage: "error",
            message: error.message,
            progress: 0,
          },
        }),
    });
  };
  return (
    <>
      <section
        className="character-stage animate-rise"
        data-testid="character-screen"
      >
        <EditorStageFrame
          stage="character"
          className="character-editor-frame"
          layout={{
            workflow: workflowPane(
              <StageLeftSummary
                project={project}
                title="Character"
                stage="character"
                goStage={goStage}
              >
                <div
                  className="compact-workflow-row"
                  data-testid="character-workflow-summary"
                >
                  <span>{editableParts.length} parts</span>
                  <span>
                    {Object.keys(project.skeleton?.joints ?? {}).length} joints
                  </span>
                  <span>
                    {project.partOrder.some((id) =>
                      Boolean(project.parts[id]?.textureUrl),
                    )
                      ? "art on plates"
                      : "gray plates"}
                  </span>
                  <span>{sceneObjects.length} objects</span>
                </div>
                <CharacterLessonOwnership
                  activeClassroomLesson={activeClassroomLesson}
                  partPanelDisabled={partPanelDisabled}
                  onEditCharacter={onEditCharacter}
                  onResetLesson={resetLesson}
                />
                <CharacterImportControls
                  packageInputRef={packageInputRef}
                  objectInputRef={objectInputRef}
                  importInputRef={importInputRef}
                  onOpenGettingStarted={onOpenGettingStarted}
                  onAddSceneObject={addSceneObject}
                  sceneObjectDisabled={partPanelDisabled}
                  onPackage={onPackage}
                  onImport={onImport}
                />
                <details
                  className="advanced-panel mt-4"
                  data-testid="character-processing-panel"
                >
                  <summary>Tools</summary>
                  {partPanelDisabled && (
                    <p className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                      Choose new character.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="btn-secondary"
                      aria-label="Edit rig"
                      disabled={partPanelDisabled}
                      onClick={onEditCharacter}
                    >
                      Edit rig
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={partPanelDisabled}
                      onClick={onSaveSkeleton}
                    >
                      Save Skeleton
                    </button>
                  </div>
                </details>
                <section
                  className="character-part-list mt-4"
                  data-testid="character-part-list"
                  aria-label="Character body part list"
                >
                  <div className="section-title flex items-center gap-2">
                    Body parts
                    <ContextHelp helpId="character.bodySides" />
                  </div>
                  <div className="mt-2 grid gap-2">
                    {editableParts.map((part) => {
                      const isActive = part.id === selectedPartId;
                      return (
                        <button
                          key={part.id}
                          type="button"
                          data-testid={`character-part-item-${part.id}`}
                          className={`character-part-list-item ${isActive ? "active" : ""}`}
                          disabled={partPanelDisabled}
                          aria-pressed={isActive}
                          onClick={() =>
                            dispatch({ type: "select_part", partId: part.id })
                          }
                        >
                          <span
                            className="part-list-dot"
                            aria-hidden="true"
                            style={{ background: part.fillColor }}
                          />
                          <span className="min-w-0">
                            <strong>{part.name}</strong>
                            <small>{part.locked ? "Locked part" : "Editable part"}</small>
                          </span>
                          <span className="part-list-badges">
                            {part.textureUrl ? <b>art</b> : <b>plate</b>}
                            {part.locked && <b>lock</b>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
                <section
                  className="character-part-list mt-4"
                  data-testid="character-scene-object-list"
                  aria-label="Scene object list"
                >
                  <div className="section-title">Scene objects</div>
                  <div className="mt-2 grid gap-2">
                    {sceneObjects.length === 0 && (
                      <div className="rounded-2xl bg-slate-100 p-3 text-sm font-bold text-slate-500">
                        Props start here.
                      </div>
                    )}
                    {sceneObjects.map((object) => {
                      const isActive = object.id === project.selectedSceneObjectId;
                      return (
                        <button
                          key={object.id}
                          type="button"
                          data-testid={`scene-object-item-${object.id}`}
                          className={`character-part-list-item ${isActive ? "active" : ""}`}
                          disabled={partPanelDisabled}
                          aria-pressed={isActive}
                          onClick={() =>
                            dispatch({
                              type: "select_scene_object",
                              objectId: object.id,
                            })
                          }
                        >
                          <span
                            className="part-list-dot"
                            aria-hidden="true"
                            style={{ background: object.fillColor }}
                          />
                          <span className="min-w-0">
                            <strong>{object.name}</strong>
                            <small>{object.shape} · scene prop</small>
                          </span>
                          <span className="part-list-badges">
                            {!object.visible && <b>hide</b>}
                            {object.locked && <b>lock</b>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </StageLeftSummary>,
            ),
            canvas: canvasPane(
              <div
                className="character-preview-pane canvas-workspace"
                data-testid="character-preview-pane"
              >
                <CanvasZoomToolbar
                  viewport={viewport}
                  setViewport={setViewport}
                />
                <DeferredThreePuppetPreview
                  project={project}
                  skeleton={project.skeleton}
                  mechanisms={[]}
                  angle={0}
                  viewport={viewport}
                  setViewport={setViewport}
                  inputMode="always"
                  testId="character-three-puppet"
                  onSelectPart={(partId) => dispatch({ type: "select_part", partId })}
                  onSelectSceneObject={(objectId) =>
                    dispatch({ type: "select_scene_object", objectId })
                  }
                />
              </div>,
            ),
            inspector: inspectorPane(
              <div className="stage-pane-stack character-inspector">
                {toolsReady ? (
                  <Suspense fallback={
                    <CharacterInspectorPlaceholder
                      name={selectedSceneObject?.name ?? selectedEditablePart?.name ?? "No part"}
                    />
                  }>
                    {selectedSceneObject && !partPanelDisabled ? (
                      <SceneObjectInspector
                        object={selectedSceneObject}
                        dispatch={dispatch}
                      />
                    ) : (
                      <CharacterSetupPanel
                        selectedEditablePart={selectedEditablePart}
                        partPanelProject={partPanelProject}
                        partPanelDisabled={partPanelDisabled}
                        project={project}
                        dispatch={dispatch}
                      />
                    )}
                  </Suspense>
                ) : (
                  <CharacterInspectorPlaceholder
                    name={selectedSceneObject?.name ?? selectedEditablePart?.name ?? "No part"}
                  />
                )}
              </div>,
            ),
          }}
        />
      </section>
      {toolsReady && (
        <Suspense fallback={null}>
          <CharacterImportStatusDock
            project={project}
            progressStore={characterImportProgress}
          />
          <CharacterImportReviewBoundary
            progressStore={characterImportProgress}
            onAccept={onAccept}
            onDiscard={onDiscard}
          />
        </Suspense>
      )}
    </>
  );
};
