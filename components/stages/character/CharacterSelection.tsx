import { useRef, type Dispatch, type SetStateAction } from "react";
import type {
  AppStage,
  BodyPartLayer,
  CanvasViewport,
  ProjectAction,
  ProjectState,
  SceneObject,
} from "../../../types";
import { type ClassroomLessonTemplate, uid } from "../../../utils/project";
import { sceneObjectFromImageFile } from "../../../utils/sceneObjectImage";
import { CanvasZoomToolbar } from "../../AppShell";
import { ThreePuppetPreview } from "../../ThreePuppetPreview";
import {
  EditorStageFrame,
  StageLeftSummary,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import { CharacterImportControls } from "./CharacterImportControls";
import {
  CharacterImportReviewDialog,
  CharacterImportStatusDock,
  type PendingCharacterReview,
} from "./CharacterImportOverlays";
import { CharacterLessonOwnership } from "./CharacterLessonOwnership";
import { CharacterSetupPanel } from "./CharacterSetupPanel";
import { SceneObjectInspector } from "./SceneObjectInspector";

export const CharacterSelection = ({
  project,
  dispatch,
  pendingCharacter,
  onOpenGettingStarted,
  onAccept,
  onDiscard,
  onProcess,
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
  pendingCharacter: PendingCharacterReview | null;
  onOpenGettingStarted: () => void;
  onAccept: () => void;
  onDiscard: () => void;
  onProcess: (file: File) => void;
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
  const reviewedProject = pendingCharacter?.project ?? project;
  const packageInputRef = useRef<HTMLInputElement>(null);
  const objectInputRef = useRef<HTMLInputElement>(null);
  const onnxInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const partPanelProject = pendingCharacter ? reviewedProject : project;
  const partPanelDisabled = Boolean(pendingCharacter);
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
    sceneObjectFromImageFile(file, uid("object"))
      .then((object) => dispatch({ type: "upsert_scene_object", object }))
      .catch((error) =>
        dispatch({
          type: "set_processing",
          processing: {
            stage: "error",
            message: error instanceof Error ? error.message : "Object image could not load.",
            progress: 0,
          },
        }),
      );
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
                showClassroomChecklist={false}
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
                    {reviewedProject.partOrder.some((id) =>
                      Boolean(reviewedProject.parts[id]?.textureUrl),
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
                  onnxInputRef={onnxInputRef}
                  importInputRef={importInputRef}
                  onOpenGettingStarted={onOpenGettingStarted}
                  onAddSceneObject={addSceneObject}
                  sceneObjectDisabled={partPanelDisabled}
                  onPackage={onPackage}
                  onProcess={onProcess}
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
                  <div className="section-title">Body parts</div>
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
                <ThreePuppetPreview
                  project={reviewedProject}
                  skeleton={reviewedProject.skeleton}
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
              </div>,
            ),
          }}
        />
      </section>
      <CharacterImportStatusDock
        project={project}
        reviewedProject={reviewedProject}
      />
      <CharacterImportReviewDialog
        pendingCharacter={pendingCharacter}
        onAccept={onAccept}
        onDiscard={onDiscard}
      />
    </>
  );
};
