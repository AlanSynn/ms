import { useCallback, useState } from "react";
import type {
  AppStage,
  FoundryExportPackage,
  GlobalConfig,
  MechanismEditFeedback,
  MechanismConfig,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../types";
import {
  generateProjectReadyDXF,
  generateProjectReadySVG,
} from "../utils/exporter";
import { preferredMotionJointId } from "../utils/motion";
import {
  applyProjectActionResult,
  downloadText,
  mechanismWithGeneratedPath,
} from "../utils/project";
import {
  fitMechanismToTargetPathResult,
  fitRecommendedMechanismToSheet,
  normalizeGearMeshMechanism,
} from "../utils/mechanismRecommendations";
import {
  constrainMechanismUpdate,
  resolveMechanismEditAttempt,
} from "../utils/mechanismEditAuthority";
import { compactStudentActionForFabricationDiagnostic } from "../utils/fabricationReadiness";
import { isReferenceExportReady } from "../utils/mechanismReference";
import { resolveFoundryTransaction } from "../utils/foundryTransaction";
import {
  MECHANISM_BINDING_BLOCKER,
  mechanismForTargetFields,
  pathOwnedTargetFields,
} from "../utils/pathTargets";
import { recordStageNavigationOpened } from "../utils/appStageNavigation";

const GENERATED_PATH_GEOMETRY_KEYS = new Set<keyof MechanismConfig>([
  "anchorX",
  "anchorY",
  "groundAngle",
  "crankLength",
  "groundLength",
  "couplerLength",
  "rockerLength",
  "sliderOffset",
  "couplerPointDist",
  "couplerPointAngle",
  "assemblyMode",
  "speed1",
  "speed2",
  "gearRatio",
  "gearTrainRadii",
  "camProfileSamples",
  "driverGroupId",
  "driverPhaseOffset",
  "rodLength",
  "phase",
  "transform",
  "sceneAnchor",
  "outputGearRadius",
  "showOutputGear",
  "connectionSelections",
]);

const changesGeneratedPathGeometry = (updates: Partial<MechanismConfig>) =>
  Object.keys(updates).some((key) =>
    GENERATED_PATH_GEOMETRY_KEYS.has(key as keyof MechanismConfig),
  );

const changesOnlyMechanismPlacement = (updates: Partial<MechanismConfig>) => {
  const keys = Object.keys(updates);
  return keys.length > 0 && keys.every((key) => key === "anchorX" || key === "anchorY");
};

const hasStoredGeneratedPath = (mechanism: MechanismConfig) =>
  Boolean(mechanism.foundryExport || mechanism.generatedPath?.length);

export const useAppMechanismActions = ({
  project,
  dispatch,
  selectedPath,
  selectedMechanism,
  foundry,
  angle,
  setStage,
  setCommandStatus,
  setShowRecommendations,
}: {
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
  selectedPath?: ProjectMotionPath;
  selectedMechanism?: MechanismConfig;
  foundry: MechanismConfig;
  mechanismConfig: GlobalConfig;
  angle: number;
  setStage: (stage: AppStage) => void;
  setCommandStatus: (status: string) => void;
  setShowRecommendations: (show: boolean) => void;
}) => {
  const [optimizerBusy, setOptimizerBusy] = useState(false);
  const [mechanismEditFeedback, setMechanismEditFeedback] =
    useState<MechanismEditFeedback | null>(null);

  const updateMechanism = useCallback(
    (id: string, updates: Partial<MechanismConfig>) => {
      const mechanism = project.mechanisms.find((m) => m.id === id);
      if (!mechanism) return false;
      const nextUpdates = { ...updates };
      const pathUpdate = updates.targetPathId
        ? project.paths[updates.targetPathId]
        : undefined;
      if (pathUpdate) {
        Object.assign(nextUpdates, pathOwnedTargetFields(pathUpdate));
      } else if (updates.targetPartId !== undefined) {
        const pathId = updates.targetPathId ?? mechanism.targetPathId;
        if (
          pathId &&
          (project.paths[pathId]?.sceneObjectId ||
            project.paths[pathId]?.partId !== updates.targetPartId)
        )
          nextUpdates.targetPathId = undefined;
        nextUpdates.targetSceneObjectId = undefined;
        nextUpdates.targetAnchorJointId = updates.targetPartId
          ? preferredMotionJointId(project, updates.targetPartId, undefined, {
              preferDistalWhenRoot: true,
            })
          : undefined;
      }
      if (!pathUpdate && updates.targetSceneObjectId !== undefined) {
        const pathId = updates.targetPathId ?? mechanism.targetPathId;
        if (
          pathId &&
          project.paths[pathId]?.sceneObjectId !== updates.targetSceneObjectId
        )
          nextUpdates.targetPathId = undefined;
        nextUpdates.targetPartId = undefined;
        nextUpdates.targetAnchorJointId = undefined;
      }
      const constrainedUpdates = constrainMechanismUpdate(
        mechanism,
        nextUpdates,
        project.settings.physicalKit,
      );
      if (
        Object.keys(nextUpdates).length > 0 &&
        Object.keys(constrainedUpdates).length === 0
      ) {
        const blocker = updates.connectionSelections
          ? "Fix: Choose anchor"
          : "Change blocked";
        setMechanismEditFeedback({
          mechanismId: id,
          blocker,
          recoveryCandidates: {
            targetPartIds: [],
            targetSceneObjectIds: [],
            targetPathIds: [],
            targetAnchorJointIds: [],
          },
        });
        setCommandStatus(blocker);
        return false;
      }
      const next = { ...mechanism, ...constrainedUpdates };
      const normalized = constrainedUpdates.connectionSelections ||
          changesOnlyMechanismPlacement(constrainedUpdates)
        ? next
        : changesGeneratedPathGeometry(constrainedUpdates)
          ? normalizeGearMeshMechanism(next)
          : next;
      const attempt = resolveMechanismEditAttempt(project, mechanism, normalized);
      if (attempt.status === "rejected") {
        const blocker = updates.connectionSelections
          ? MECHANISM_BINDING_BLOCKER
          : attempt.blocker;
        setMechanismEditFeedback({
          mechanismId: id,
          blocker,
          recoveryCandidates: attempt.recoveryCandidates,
        });
        setCommandStatus(blocker);
        return false;
      }
      const preserveGeneratedPath =
        hasStoredGeneratedPath(mechanism) &&
        !changesGeneratedPathGeometry(constrainedUpdates);
      const fitResult = constrainedUpdates.targetPathId
        ? fitMechanismToTargetPathResult(
            project,
            attempt.mechanism,
            constrainedUpdates.targetPathId,
          )
        : undefined;
      if (fitResult && !fitResult.accepted) {
        if (fitResult.recoveryCandidates) {
          setMechanismEditFeedback({
            mechanismId: id,
            blocker: fitResult.blockers[0] ?? MECHANISM_BINDING_BLOCKER,
            recoveryCandidates: fitResult.recoveryCandidates,
          });
        }
        setCommandStatus(fitResult.blockers[0] ?? MECHANISM_BINDING_BLOCKER);
        return false;
      }
      const fitted = fitResult?.mechanism ?? mechanismWithGeneratedPath(
              {
                ...attempt.mechanism,
                activeVisualPartIds: attempt.mechanism.targetPartId
                  ? [attempt.mechanism.targetPartId]
                  : [],
              },
              {
                preserveGeneratedPath,
                kit: project.settings.physicalKit,
              },
            );
      const committedAttempt = resolveMechanismEditAttempt(
        project,
        mechanism,
        fitted,
      );
      if (committedAttempt.status === "rejected") {
        const blocker = updates.connectionSelections
          ? MECHANISM_BINDING_BLOCKER
          : committedAttempt.blocker;
        setMechanismEditFeedback({
          mechanismId: id,
          blocker,
          recoveryCandidates: committedAttempt.recoveryCandidates,
        });
        setCommandStatus(blocker);
        return false;
      }
      const action = {
        type: "upsert_mechanism" as const,
        mechanism: committedAttempt.mechanism,
      };
      const actionResult = applyProjectActionResult(project, action);
      const appliedMechanism = actionResult.state.mechanisms.find(
        (candidate) => candidate.id === mechanism.id,
      );
      const appliedRequestedUpdates = Object.keys(constrainedUpdates).every(
        (key) =>
          JSON.stringify(
            appliedMechanism?.[key as keyof MechanismConfig],
          ) === JSON.stringify(constrainedUpdates[key as keyof MechanismConfig]),
      );
      if (!actionResult.applied || !appliedMechanism || !appliedRequestedUpdates) {
        const blocker = updates.connectionSelections
          ? MECHANISM_BINDING_BLOCKER
          : "Change blocked";
        setMechanismEditFeedback(null);
        setCommandStatus(blocker);
        return false;
      }
      dispatch(action);
      setMechanismEditFeedback(null);
      return true;
    },
    [dispatch, project, setCommandStatus],
  );

  const optimizeSelectedMechanism = useCallback(async () => {
    const fitPath = selectedMechanism?.targetPathId
      ? project.paths[selectedMechanism.targetPathId]
      : selectedPath;
    if (!selectedMechanism || !fitPath || fitPath.points.length < 3) return;
    setOptimizerBusy(true);
    try {
      const result = fitMechanismToTargetPathResult(
        project,
        selectedMechanism,
        fitPath.id,
      );
      if (!result.accepted) {
        if (result.recoveryCandidates) {
          setMechanismEditFeedback({
            mechanismId: selectedMechanism.id,
            blocker: result.blockers[0] ?? MECHANISM_BINDING_BLOCKER,
            recoveryCandidates: result.recoveryCandidates,
          });
        }
        setCommandStatus(
          compactStudentActionForFabricationDiagnostic(result.blockers[0]) ??
            result.blockers[0] ??
            "Fit blocked.",
        );
        return;
      }
      dispatch({ type: "upsert_mechanism", mechanism: result.mechanism });
      setMechanismEditFeedback(null);
    } finally {
      setOptimizerBusy(false);
    }
  }, [
    dispatch,
    project,
    selectedMechanism,
    selectedPath,
    setCommandStatus,
  ]);

  const exportMechanismSvg = useCallback(() => {
    const result = generateProjectReadySVG(project, angle);
    if (!result.ok) {
      setCommandStatus(result.blockers[0] ?? "Project not ready");
      return;
    }
    downloadText(
      `mechanisms-${Date.now()}.svg`,
      result.artifact,
      "image/svg+xml",
    );
    setCommandStatus("Exported mechanism SVG");
  }, [angle, project, setCommandStatus]);

  const exportMechanismDxf = useCallback(() => {
    const result = generateProjectReadyDXF(project, angle);
    if (!result.ok) {
      setCommandStatus(result.blockers[0] ?? "Project not ready");
      return;
    }
    downloadText(
      `mechanisms-${Date.now()}.dxf`,
      result.artifact,
      "application/dxf",
    );
    setCommandStatus("Exported mechanism DXF");
  }, [angle, project, setCommandStatus]);

  const exportFoundryMechanism = useCallback(
    (pkg: FoundryExportPackage) => {
      const pkgPath = pkg.targetPathId ? project.paths[pkg.targetPathId] : undefined;
      const targetFields = pkgPath
        ? pathOwnedTargetFields(pkgPath)
        : {
            targetPartId: pkg.targetPartId,
            targetSceneObjectId: pkg.targetSceneObjectId,
            targetPathId: pkg.targetPathId,
            targetAnchorJointId: pkg.targetAnchorJointId,
            activeVisualPartIds: pkg.targetPartId ? [pkg.targetPartId] : [],
          };
      const existingTarget = mechanismForTargetFields(project, targetFields);
      const fittedFoundryParameters =
        pkg.parameters as Partial<MechanismConfig>;
      const rawMechanism = mechanismWithGeneratedPath(
        {
          ...foundry,
          ...fittedFoundryParameters,
          id: existingTarget?.id ?? pkg.mechanismId,
          anchorX: pkg.pivot.x,
          anchorY: pkg.pivot.y,
          color: fittedFoundryParameters.color ?? foundry.color,
          ...targetFields,
          presetId: pkg.metadata.selectedPreset,
          recommendation: pkg.metadata.recommendation,
          source: "foundry",
          generatedPath: pkg.generatedPath,
          warnings: pkg.warnings,
        },
        {
          preserveGeneratedPath: true,
          kit: project.settings.physicalKit,
        },
      );
      const fittedMechanism = fitRecommendedMechanismToSheet(
        project,
        rawMechanism,
      );
      const generatedPath =
        fittedMechanism.generatedPath ??
        rawMechanism.generatedPath ??
        pkg.generatedPath;
      const candidate = mechanismWithGeneratedPath(
        {
          ...fittedMechanism,
          generatedPath,
          warnings: [
            ...new Set([
              ...(fittedMechanism.warnings ?? []),
              ...(pkg.warnings ?? []),
            ]),
          ],
        },
        {
          preserveGeneratedPath: true,
          kit: project.settings.physicalKit,
        },
      );
      const intent = isReferenceExportReady(candidate.type)
        ? "fabrication-package"
        : "simulation-only";
      const result = resolveFoundryTransaction({
        project,
        candidate,
        intent,
        allowSoftReadinessBlockers: intent === 'fabrication-package',
        generatePackage: intent === "fabrication-package"
          ? (accepted) => ({
              ...pkg,
              mechanismId: accepted.id,
              mechanismType: accepted.type,
              parameters: { ...accepted },
              pivot: {
                x: accepted.anchorX ?? pkg.pivot.x,
                y: accepted.anchorY ?? pkg.pivot.y,
              },
              outputPoint: accepted.generatedPath?.[0] ?? pkg.outputPoint,
              generatedPath: accepted.generatedPath ?? pkg.generatedPath,
            })
          : undefined,
      });
      if (result.status === "ready") {
        setCommandStatus("Package generation required");
        return;
      }
      dispatch({ type: "commit_mechanism_candidate", result });
      if (result.status === "committed") {
        setMechanismEditFeedback(null);
        setCommandStatus(
          result.blocker ?? (intent === "fabrication-package"
            ? "Mechanism package ready"
            : "Mechanism ready"),
        );
        recordStageNavigationOpened("design", "mechanism_commit");
        setStage("design");
      } else {
        if (result.recoveryCandidates) {
          setMechanismEditFeedback({
            mechanismId: result.mechanism.id,
            blocker: result.blocker ?? MECHANISM_BINDING_BLOCKER,
            recoveryCandidates: result.recoveryCandidates,
          });
        }
        setCommandStatus(result.blocker ?? "Mechanism blocked");
      }
    },
    [dispatch, foundry, project, setCommandStatus, setStage],
  );

  const applyRecommendedMechanism = useCallback(
    (mechanism: MechanismConfig) => {
      const previous = project.mechanisms.find((item) => item.id === mechanism.id);
      const attempt = resolveMechanismEditAttempt(project, previous, mechanism);
      if (attempt.status === "rejected") {
        setMechanismEditFeedback({
          mechanismId: mechanism.id,
          blocker: attempt.blocker,
          recoveryCandidates: attempt.recoveryCandidates,
        });
        setCommandStatus(attempt.blocker);
        return;
      }
      dispatch({ type: "upsert_mechanism", mechanism: attempt.mechanism });
      setMechanismEditFeedback(null);
      setShowRecommendations(false);
      recordStageNavigationOpened("design", "recommendation_accept");
      setStage("design");
    },
    [dispatch, project, setCommandStatus, setShowRecommendations, setStage],
  );

  return {
    optimizerBusy,
    mechanismEditFeedback,
    updateMechanism,
    optimizeSelectedMechanism,
    exportMechanismSvg,
    exportMechanismDxf,
    exportFoundryMechanism,
    applyRecommendedMechanism,
  };
};
