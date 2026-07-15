import { useState } from "react";
import { Sparkles } from "lucide-react";
import { ClassroomExampleVideo } from "../../ui/ClassroomExampleVideo";
import { StageLeftSummary } from "../stageLayout";
import type {
  AppStage,
  MechanismConfig,
  MechanismType,
  ProjectAction,
  ProjectState,
} from "../../../types";
import { mechanismBindingWarnings, mechanismDriverIdentity } from "../../../utils/motion";
import { fitMechanismToTargetPathResult } from "../../../utils/mechanismRecommendations";
import { compactStudentActionForFabricationDiagnostic } from "../../../utils/fabricationReadiness";
import { resolveMechanismEditAttempt } from "../../../utils/mechanismEditAuthority";
import { pathOwnedTargetFields } from "../../../utils/pathTargets";
import {
  classroomAssessmentFor,
  classroomCueTitleFor,
  classroomUseExampleFor,
  formatClassroomAssessmentPrompt,
} from "../../../utils/classroomContent";
import {
  FOUNDRY_MECHANISM_TYPES,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
  mechanismTemplateLabel,
} from "../../../utils/mechanismTemplates";
import {
  createDefaultMechanism,
  mechanismWithGeneratedPath,
  uid,
} from "../../../utils/project";

type DesignWorkflowPanelProps = {
  project: ProjectState;
  selectedMechanism?: MechanismConfig;
  showTrace: boolean;
  setShowTrace: (v: boolean) => void;
  onRecommendations: () => void;
  onBlueprint: () => void;
  goStage: (stage: AppStage) => void;
  dispatch: (action: ProjectAction) => void;
};

export const DesignWorkflowPanel = ({
  project,
  selectedMechanism,
  showTrace,
  setShowTrace,
  onRecommendations,
  onBlueprint,
  goStage,
  dispatch,
}: DesignWorkflowPanelProps) => {
  const [addBlocker, setAddBlocker] = useState<string | null>(null);
  const selectedLibrary = selectedMechanism
    ? MECHANISM_LIBRARY[selectedMechanism.type]
    : undefined;
  const selectedAssessment = selectedMechanism
    ? classroomAssessmentFor(
        selectedMechanism.type,
        project.settings.classroomAssessmentKey,
        "design",
      )
    : undefined;
  const selectedUseExample = selectedMechanism
    ? classroomUseExampleFor(selectedMechanism.type)
    : undefined;
  const bindingWarnings = mechanismBindingWarnings(project);
  const bindingWarningMessages = Array.from(
    new Set(Object.values(bindingWarnings).flat()),
  );
  const addLibraryMechanism = (type: MechanismType) => {
    setAddBlocker(null);
    const activeMechanism =
      project.mechanisms.find((mechanism) => mechanism.id === project.selectedMechanismId) ??
      selectedMechanism ??
      project.mechanisms[0];
    const replacementMechanismId = activeMechanism?.id;
    const path = project.selectedPathId
      ? project.paths[project.selectedPathId]
      : undefined;
    const pathFields = path ? pathOwnedTargetFields(path) : undefined;
    const replacementSeed = replacementMechanismId
      ? project.mechanisms.find((mechanism) => mechanism.id === replacementMechanismId)
      : activeMechanism;
    const replacementTargetFields = replacementSeed
      ? {
          targetPartId: replacementSeed.targetPartId,
          targetSceneObjectId: replacementSeed.targetSceneObjectId,
          targetPathId: replacementSeed.targetPathId,
          targetAnchorJointId: replacementSeed.targetAnchorJointId,
          activeVisualPartIds: replacementSeed.activeVisualPartIds,
        }
      : {};
    const preservedTargetFields = pathFields ?? replacementTargetFields;
    const base = {
      ...createDefaultMechanism(type, replacementMechanismId ?? uid("mech")),
      ...(path ? pathFields : replacementTargetFields),
    };
    const pathDriver = path
      ? mechanismDriverIdentity(project, {
          ...base,
          ...pathFields,
          visible: true,
          enabled: true,
        })
      : undefined;
    const pathOccupied = Boolean(
      pathDriver &&
        project.mechanisms.some(
          (mechanism) =>
            mechanism.id !== replacementMechanismId &&
            mechanismDriverIdentity(project, mechanism) === pathDriver,
        ),
    );
    const fitResult =
      path && path.points.length >= 3 && !pathOccupied
        ? fitMechanismToTargetPathResult(
            project,
            {
              ...base,
              ...pathFields,
            },
            path.id,
          )
        : undefined;
    const nextMechanismRaw = fitResult?.mechanism ?? mechanismWithGeneratedPath(base);
    const nextMechanism = replacementMechanismId
      ? {
          ...nextMechanismRaw,
          id: replacementMechanismId,
          ...preservedTargetFields,
        }
      : nextMechanismRaw;

    if (fitResult && !fitResult.accepted) {
      setAddBlocker(
        compactStudentActionForFabricationDiagnostic(fitResult.blockers[0]) ??
          "Fit blocked.",
      );
      return;
    } else {
      setAddBlocker(null);
    }

    const attempt = resolveMechanismEditAttempt(
      project,
      replacementMechanismId ? replacementSeed : undefined,
      nextMechanism,
    );
    if (attempt.status === "rejected") {
      setAddBlocker(attempt.blocker);
      return;
    }

    dispatch({
      type: "upsert_mechanism",
      mechanism: attempt.mechanism,
      replaceMechanismId: replacementMechanismId,
    });
  };

  return (
    <div className="stage-pane-stack">
      <StageLeftSummary
        project={project}
        title="Design"
        stage="design"
        goStage={goStage}
      >
        <div className="flex flex-wrap gap-2">
          <button
            className={`btn-secondary ${showTrace ? "active" : ""}`}
            data-testid="design-toggle-trace"
            onClick={() => setShowTrace(!showTrace)}
          >
            Trace
          </button>
          <button className="btn-primary" onClick={onRecommendations}>
            <Sparkles size={16} /> Recommend
          </button>
        </div>
        <h4 className="section-title mt-4">Mechanisms</h4>
        <select
          aria-label="Mechanism instance"
          className="field"
          value={selectedMechanism?.id ?? ""}
          onChange={(e) =>
            dispatch({
              type: "set_mechanisms",
              mechanisms: project.mechanisms,
              selectedMechanismId: e.target.value,
            })
          }
        >
          {project.mechanisms.map((m) => (
            <option key={m.id} value={m.id}>
              {mechanismTemplateLabel(m.type)}
            </option>
          ))}
        </select>
        <div className="mt-3 flex flex-wrap gap-2">
          {FOUNDRY_MECHANISM_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="chip"
              data-testid={`design-mechanism-family-${type}`}
              title={mechanismTemplateLabel(type)}
              onClick={() => addLibraryMechanism(type)}
            >
              {mechanismTemplateLabel(type)}
            </button>
          ))}
        </div>
        {addBlocker && (
          <div className="warning" data-testid="design-add-blocker">
            {addBlocker}
          </div>
        )}
        {selectedLibrary && (
          <div
            className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600"
            data-testid="design-mechanism-library"
          >
            <div className="font-bold text-slate-800">Template</div>
            <div>{selectedLibrary.label}</div>
          </div>
        )}
        {selectedLibrary && (
          <div
            className="sensemaking-cue"
            data-testid="design-visible-sensemaking"
            data-sensemaking-check={
              selectedLibrary.classroomSensemaking.studentCheck
            }
            data-sensemaking-answer={
              selectedLibrary.classroomSensemaking.expectedAnswer
            }
            data-sensemaking-evidence={
              selectedLibrary.classroomSensemaking.evidenceCue
            }
            data-sensemaking-clip={selectedLibrary.classroomSensemaking.clipSlot}
          >
            <span className="cue-title">{classroomCueTitleFor("design")}</span>
            <strong>
              {selectedLibrary.classroomSensemaking.directTranslation}
            </strong>
            <small>{selectedLibrary.classroomSensemaking.tryThis}</small>
            {selectedAssessment && (
              <small
                data-testid="classroom-assessment-prompt"
                data-assessment-key={project.settings.classroomAssessmentKey}
                data-assessment-kind={selectedAssessment.kind}
              >
                {formatClassroomAssessmentPrompt(selectedAssessment)}
              </small>
            )}
          </div>
        )}
        {selectedUseExample && <ClassroomExampleVideo example={selectedUseExample} />}
        {bindingWarningMessages.map((warning) => (
          <div className="warning" key={warning}>
            {warning}
          </div>
        ))}
        <button className="btn-primary w-full" onClick={onBlueprint}>
          Blueprint
        </button>
      </StageLeftSummary>
    </div>
  );
};
