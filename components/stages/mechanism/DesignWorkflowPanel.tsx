import { startTransition, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { ClassroomExampleVideo } from "../../ui/ClassroomExampleVideo";
import { StageLeftSummary } from "../stageLayout";
import type {
  AppStage,
  BodyPartLayer,
  MechanismConfig,
  MechanismType,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../../../types";
import { mechanismBindingWarnings } from "../../../utils/motion";
import {
  classroomAssessmentFor,
  classroomCueTitleFor,
  classroomUseExampleFor,
  formatClassroomAssessmentPrompt,
} from "../../../utils/classroomContent";
import {
  ENABLED_AUTHORABLE_MECHANISM_TYPES,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
  isMechanismTypeEnabled,
  mechanismTemplateLabel,
} from "../../../utils/mechanismTemplates";
import {
  createDefaultMechanism,
  mechanismWithGeneratedPath,
  uid,
} from "../../../utils/project";
import { MechanismRecommendationSheet } from "../path/MechanismRecommendationSheet";
import {
  createMechanismRecommendationWorkerClient,
} from "../../../runtime/recommendations/mechanismRecommendationWorkerClient";
import { createMechanismFitJobInput } from "../../../runtime/fitting/mechanismFitJob";
import { createMechanismFitWorkerClient } from "../../../runtime/fitting/mechanismFitWorkerClient";

const DesignRecommendationControl = ({
  project,
  selectedPart,
  selectedPath,
  onApply,
}: {
  project: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  onApply: (mechanism: MechanismConfig) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const workerClient = useMemo(
    () => createMechanismRecommendationWorkerClient(),
    [],
  );

  useEffect(() => () => workerClient.dispose(), [workerClient]);

  return (
    <>
      <button
        className="btn-primary"
        data-recommendation-worker="on-demand"
        onClick={() => setIsOpen(true)}
      >
        <Sparkles size={16} /> Recommend
      </button>
      <MechanismRecommendationSheet
        isOpen={isOpen}
        project={project}
        selectedPart={selectedPart}
        selectedPath={selectedPath}
        onClose={() => {
          workerClient.cancel();
          setIsOpen(false);
        }}
        onApply={(mechanism) => {
          onApply(mechanism);
          setIsOpen(false);
        }}
        workerClient={workerClient}
      />
    </>
  );
};

type DesignWorkflowPanelProps = {
  project: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  selectedMechanism?: MechanismConfig;
  showTrace: boolean;
  setShowTrace: (v: boolean) => void;
  onApplyRecommendation: (mechanism: MechanismConfig) => void;
  onBlueprint: () => void;
  goStage: (stage: AppStage) => void;
  dispatch: (action: ProjectAction) => void;
};

export const DesignWorkflowPanel = ({
  project,
  selectedPart,
  selectedPath,
  selectedMechanism,
  showTrace,
  setShowTrace,
  onApplyRecommendation,
  onBlueprint,
  goStage,
  dispatch,
}: DesignWorkflowPanelProps) => {
  const [activeFamilyFit, setActiveFamilyFit] = useState<MechanismType>();
  const [familyFitError, setFamilyFitError] = useState(false);
  const familyFitClient = useMemo(() => createMechanismFitWorkerClient(), []);
  useEffect(() => () => familyFitClient.dispose(), [familyFitClient]);
  useEffect(() => {
    familyFitClient.cancel();
    setActiveFamilyFit(undefined);
  }, [familyFitClient, project.metadata.updatedAt]);
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
  const addLibraryMechanism = (type: MechanismType) => {
    if (!isMechanismTypeEnabled(type)) return;
    if (activeFamilyFit === type) {
      familyFitClient.cancel();
      setActiveFamilyFit(undefined);
      return;
    }
    const base = createDefaultMechanism(type, uid("mech"));
    const path = project.selectedPathId
      ? project.paths[project.selectedPathId]
      : undefined;
    if (!path || path.points.length < 3) {
      dispatch({
        type: "upsert_mechanism",
        mechanism: mechanismWithGeneratedPath(base),
      });
      return;
    }
    const candidate = {
      ...base,
      targetPathId: path.id,
      targetPartId: path.sceneObjectId ? undefined : path.partId,
      targetSceneObjectId: path.sceneObjectId,
    };
    setFamilyFitError(false);
    setActiveFamilyFit(type);
    familyFitClient.request(
      createMechanismFitJobInput(project, candidate, "path", path.id),
      {
        complete: ({ mechanism }) => {
          setActiveFamilyFit(undefined);
          startTransition(() =>
            dispatch({ type: "upsert_mechanism", mechanism }),
          );
        },
        failed: () => {
          setActiveFamilyFit(undefined);
          setFamilyFitError(true);
        },
      },
    );
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
          <DesignRecommendationControl
            project={project}
            selectedPart={selectedPart}
            selectedPath={selectedPath}
            onApply={onApplyRecommendation}
          />
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
          {ENABLED_AUTHORABLE_MECHANISM_TYPES.map((type) => (
            <button
              key={type}
              className="chip"
              title={mechanismTemplateLabel(type)}
              aria-busy={activeFamilyFit === type}
              data-testid={`design-add-${type}`}
              onClick={() => addLibraryMechanism(type)}
            >
              {activeFamilyFit === type
                ? "Cancel"
                : mechanismTemplateLabel(type)}
            </button>
          ))}
        </div>
        {familyFitError && <div className="warning">Fit failed. Try again.</div>}
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
        {Object.entries(bindingWarnings).map(([id, warnings]) =>
          warnings.length ? (
            <div className="warning" key={id}>
              {warnings.join("; ")}
            </div>
          ) : null,
        )}
        <button className="btn-primary w-full" onClick={onBlueprint}>
          Blueprint
        </button>
      </StageLeftSummary>
    </div>
  );
};
