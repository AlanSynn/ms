import type { ClassroomLessonTemplate } from "../../../utils/project";

export const CharacterLessonOwnership = ({
  activeClassroomLesson,
  partPanelDisabled,
  onEditCharacter,
  onResetLesson,
}: {
  activeClassroomLesson?: ClassroomLessonTemplate;
  partPanelDisabled: boolean;
  onEditCharacter: () => void;
  onResetLesson: () => void;
}) => {
  if (!activeClassroomLesson) return null;

  return (
    <section
      className="lesson-ownership-cluster mt-4"
      data-testid="character-make-it-yours"
      aria-label="Make it yours"
      data-change-cue={activeClassroomLesson.changeCue}
      data-build-cue={activeClassroomLesson.buildCue}
    >
      <div className="lesson-ownership-head">
        <div className="section-title">Make it yours</div>
        <span>{activeClassroomLesson.outcome}</span>
      </div>
      <div className="lesson-ownership-cues">
        <span>Select a part</span>
        <span>Place joints</span>
      </div>
      <div className="lesson-ownership-actions">
        <button
          type="button"
          className="btn-secondary"
          disabled={partPanelDisabled}
          onClick={onEditCharacter}
        >
          Edit rig
        </button>
        <button type="button" className="btn-secondary" onClick={onResetLesson}>
          Reset
        </button>
      </div>
    </section>
  );
};
