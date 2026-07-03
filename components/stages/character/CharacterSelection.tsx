import { useRef, type Dispatch, type SetStateAction } from "react";
import type {
  AppStage,
  BodyPartLayer,
  CanvasViewport,
  ProjectAction,
  ProjectState,
} from "../../../types";
import type { ClassroomLessonTemplate } from "../../../utils/project";
import {
  fabricablePartOutlinePoints,
  partLandmarkLocalPoints,
} from "../../../utils/partGeometry";
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

export const CharacterSelection = ({
  project,
  dispatch,
  pendingCharacter,
  replaceCharacter,
  setReplaceCharacter,
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
  replaceCharacter: boolean;
  setReplaceCharacter: (v: boolean) => void;
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
  const onnxInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const partPanelProject = pendingCharacter ? reviewedProject : project;
  const partPanelDisabled = Boolean(pendingCharacter);
  const editableParts = partPanelProject.partOrder
    .map((id) => partPanelProject.parts[id])
    .filter((part): part is BodyPartLayer => Boolean(part));
  const selectedEditablePart =
    (!partPanelDisabled && project.selectedPartId
      ? project.parts[project.selectedPartId]
      : undefined) ?? editableParts[0];
  const selectedPartId = selectedEditablePart?.id ?? "";
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
                </div>
                <CharacterLessonOwnership
                  activeClassroomLesson={activeClassroomLesson}
                  partPanelDisabled={partPanelDisabled}
                  onEditCharacter={onEditCharacter}
                  onResetLesson={resetLesson}
                />
                <CharacterImportControls
                  packageInputRef={packageInputRef}
                  onnxInputRef={onnxInputRef}
                  importInputRef={importInputRef}
                  onOpenGettingStarted={onOpenGettingStarted}
                  onPackage={onPackage}
                  onProcess={onProcess}
                  onImport={onImport}
                  replaceCharacter={replaceCharacter}
                  setReplaceCharacter={setReplaceCharacter}
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
                      const joints = partLandmarkLocalPoints(
                        part,
                        partPanelProject.skeleton,
                      );
                      const outline = fabricablePartOutlinePoints(part, joints);
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
                            <small>
                              {part.anchorJointId} · {outline.length} outline
                              pts
                            </small>
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
                />
              </div>,
            ),
            inspector: inspectorPane(
              <div className="stage-pane-stack character-inspector">
                <CharacterSetupPanel
                  selectedEditablePart={selectedEditablePart}
                  partPanelProject={partPanelProject}
                  partPanelDisabled={partPanelDisabled}
                  project={project}
                  dispatch={dispatch}
                />
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
