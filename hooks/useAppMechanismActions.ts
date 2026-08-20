import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AppStage,
  BodyPartLayer,
  FoundryExportPackage,
  GlobalConfig,
  MechanismConfig,
  ProjectAction,
  ProjectMotionPath,
  SceneObject,
  ProjectState,
} from "../types";
import { generateDXF, generateSVG } from "../utils/exporter";
import { createMechanismOptimizerJobInput } from "../runtime/optimizer/mechanismOptimizerJob";
import { createMechanismOptimizerWorkerClient } from "../runtime/optimizer/mechanismOptimizerWorkerClient";
import { createMechanismFitJobInput } from "../runtime/fitting/mechanismFitJob";
import {
  createMechanismFitWorkerClient,
  type MechanismFitWorkerClient,
} from "../runtime/fitting/mechanismFitWorkerClient";
import { mechanismPathFitIsUsable, preferredMotionJointId } from "../utils/motion";
import {
  downloadText,
  invalidateMechanismPathFit,
  mechanismWithGeneratedPath,
} from "../utils/project";
import {
  normalizeGearMeshMechanism,
} from "../utils/mechanismRecommendations";

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
  "targetPartId",
  "targetSceneObjectId",
  "targetPathId",
  "targetAnchorJointId",
  "rodLength",
  "phase",
  "transform",
  "sceneAnchor",
  "outputGearRadius",
  "showOutputGear",
]);

const changesGeneratedPathGeometry = (updates: Partial<MechanismConfig>) =>
  Object.keys(updates).some((key) =>
    GENERATED_PATH_GEOMETRY_KEYS.has(key as keyof MechanismConfig),
  );

const hasStoredGeneratedPath = (mechanism: MechanismConfig) =>
  Boolean(mechanism.foundryExport || mechanism.generatedPath?.length);

export const useAppMechanismActions = ({
  project,
  dispatch,
  selectedPart,
  selectedSceneObject,
  selectedPath,
  selectedMechanism,
  foundry,
  mechanismConfig,
  angle,
  setStage,
  setCommandStatus,
  mechanismFitClient: providedMechanismFitClient,
}: {
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  selectedPath?: ProjectMotionPath;
  selectedMechanism?: MechanismConfig;
  foundry: MechanismConfig;
  mechanismConfig: GlobalConfig;
  angle: number;
  setStage: (stage: AppStage) => void;
  setCommandStatus: (status: string) => void;
  mechanismFitClient?: MechanismFitWorkerClient;
}) => {
  const [optimizerBusy, setOptimizerBusy] = useState(false);
  const optimizerClient = useMemo(
    () => createMechanismOptimizerWorkerClient(),
    [],
  );
  const mechanismFitClient = useMemo(
    () => providedMechanismFitClient ?? createMechanismFitWorkerClient(),
    [providedMechanismFitClient],
  );
  const optimizerScheduleRef = useRef<{
    generation: number;
    firstFrame?: number;
    secondFrame?: number;
  }>({ generation: 0 });
  const cancelScheduledOptimizer = useCallback(() => {
    const scheduled = optimizerScheduleRef.current;
    scheduled.generation += 1;
    if (scheduled.firstFrame !== undefined) {
      cancelAnimationFrame(scheduled.firstFrame);
    }
    if (scheduled.secondFrame !== undefined) {
      cancelAnimationFrame(scheduled.secondFrame);
    }
    scheduled.firstFrame = undefined;
    scheduled.secondFrame = undefined;
  }, []);

  useEffect(() => {
    cancelScheduledOptimizer();
    optimizerClient.cancel();
    mechanismFitClient.cancel();
    setOptimizerBusy(false);
  }, [cancelScheduledOptimizer, mechanismFitClient, optimizerClient, project]);

  useEffect(() => () => {
    cancelScheduledOptimizer();
    optimizerClient.dispose();
    mechanismFitClient.dispose();
  }, [cancelScheduledOptimizer, mechanismFitClient, optimizerClient]);

  const cancelMechanismOptimization = useCallback(() => {
    cancelScheduledOptimizer();
    optimizerClient.cancel();
    setOptimizerBusy(false);
    setCommandStatus("Fit cancelled");
  }, [cancelScheduledOptimizer, optimizerClient, setCommandStatus]);

  const commitFoundryDraft = useCallback(
    (draft: MechanismConfig) => {
      if (!draft.targetPathId || !project.paths[draft.targetPathId]) return;
      const existingTarget = project.mechanisms.find(
        (mechanism) =>
          mechanism.targetPathId === draft.targetPathId &&
          mechanism.targetSceneObjectId === draft.targetSceneObjectId &&
          (!draft.targetSceneObjectId
            ? mechanism.targetPartId === draft.targetPartId
            : true),
      );
      dispatch({
        type: "upsert_mechanism",
        mechanism: {
          ...draft,
          id: existingTarget?.id ?? draft.id,
        },
      });
    },
    [dispatch, project],
  );

  const updateMechanism = useCallback(
    (id: string, updates: Partial<MechanismConfig>) => {
      const mechanism = project.mechanisms.find((m) => m.id === id);
      if (!mechanism) return;
      const nextUpdates = { ...updates };
      if (updates.targetPathId) {
        const path = project.paths[updates.targetPathId];
        if (path) {
          if (path.sceneObjectId) {
            nextUpdates.targetSceneObjectId = path.sceneObjectId;
            nextUpdates.targetPartId = undefined;
            nextUpdates.targetAnchorJointId = undefined;
          } else {
            nextUpdates.targetPartId = path.partId;
            nextUpdates.targetSceneObjectId = undefined;
            nextUpdates.targetAnchorJointId =
              path.targetAnchorJointId ??
              preferredMotionJointId(
                project,
                path.partId,
                mechanism.targetAnchorJointId,
                { preferDistalWhenRoot: !mechanism.targetAnchorJointId },
              );
          }
        }
      }
      if (updates.targetPartId !== undefined) {
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
      if (updates.targetSceneObjectId !== undefined) {
        const pathId = updates.targetPathId ?? mechanism.targetPathId;
        if (
          pathId &&
          project.paths[pathId]?.sceneObjectId !== updates.targetSceneObjectId
        )
          nextUpdates.targetPathId = undefined;
        nextUpdates.targetPartId = undefined;
        nextUpdates.targetAnchorJointId = undefined;
      }
      const next = { ...mechanism, ...nextUpdates };
      const normalized = normalizeGearMeshMechanism(next);
      const preserveGeneratedPath =
        hasStoredGeneratedPath(mechanism) && !changesGeneratedPathGeometry(updates);
      const requiresPathFit =
        nextUpdates.targetPathId &&
        (updates.targetPathId !== undefined ||
          updates.targetPartId !== undefined ||
          updates.targetSceneObjectId !== undefined ||
          updates.targetAnchorJointId !== undefined);
      if (requiresPathFit) {
        mechanismFitClient.request(
          createMechanismFitJobInput(
            project,
            normalized,
            "path",
            nextUpdates.targetPathId,
          ),
          {
            complete: ({ mechanism: fitted }) => {
              startTransition(() => {
                dispatch({ type: "upsert_mechanism", mechanism: fitted });
                setCommandStatus("Fit ready");
              });
            },
            failed: (error) => setCommandStatus(`Fit failed: ${error.message}`),
          },
        );
        return;
      }
      const refreshed = mechanismWithGeneratedPath({
        ...(
          changesGeneratedPathGeometry(updates)
            ? invalidateMechanismPathFit(normalized)
            : normalized
        ),
        activeVisualPartIds: normalized.targetPartId
          ? [normalized.targetPartId]
          : [],
      }, { preserveGeneratedPath });
      dispatch({ type: "upsert_mechanism", mechanism: refreshed });
    },
    [dispatch, mechanismFitClient, project, setCommandStatus],
  );

  const optimizeSelectedMechanism = useCallback(() => {
    const fitPath = selectedMechanism?.targetPathId
      ? project.paths[selectedMechanism.targetPathId]
      : selectedPath;
    if (!selectedMechanism || !fitPath || fitPath.points.length < 3) return;
    setOptimizerBusy(true);
    const iterations =
      project.settings.performancePreset === "fast"
        ? 120
        : project.settings.performancePreset === "high"
          ? 520
          : 260;
    const input = createMechanismOptimizerJobInput(
      project,
      selectedMechanism,
      fitPath.id,
      iterations,
    );
    cancelScheduledOptimizer();
    const generation = optimizerScheduleRef.current.generation;
    optimizerScheduleRef.current.firstFrame = requestAnimationFrame(() => {
      optimizerScheduleRef.current.firstFrame = undefined;
      optimizerScheduleRef.current.secondFrame = requestAnimationFrame(() => {
        optimizerScheduleRef.current.secondFrame = undefined;
        if (generation !== optimizerScheduleRef.current.generation) return;
        optimizerClient.request(input, {
          complete: ({ mechanism }) => {
            if (generation !== optimizerScheduleRef.current.generation) return;
            setOptimizerBusy(false);
            startTransition(() => {
              dispatch({ type: "upsert_mechanism", mechanism });
              setCommandStatus("Optimized mechanism");
            });
          },
          failed: (error) => {
            if (generation !== optimizerScheduleRef.current.generation) return;
            setOptimizerBusy(false);
            setCommandStatus(`Optimize failed: ${error.message}`);
          },
        });
      });
    });
  }, [
    dispatch,
    optimizerClient,
    project,
    selectedMechanism,
    selectedPath,
    setCommandStatus,
  ]);

  const exportMechanismSvg = useCallback(() => {
    downloadText(
      `mechanisms-${Date.now()}.svg`,
      generateSVG(mechanismConfig, angle),
      "image/svg+xml",
    );
    setCommandStatus("Exported mechanism SVG");
  }, [angle, mechanismConfig, setCommandStatus]);

  const exportMechanismDxf = useCallback(() => {
    downloadText(
      `mechanisms-${Date.now()}.dxf`,
      generateDXF(mechanismConfig, angle),
      "application/dxf",
    );
    setCommandStatus("Exported mechanism DXF");
  }, [angle, mechanismConfig, setCommandStatus]);

  const exportFoundryMechanism = useCallback(
    (pkg: FoundryExportPackage) => {
      const existingTarget = project.mechanisms.find(
        (mechanism) =>
          mechanism.targetPartId === pkg.targetPartId &&
          mechanism.targetSceneObjectId === pkg.targetSceneObjectId &&
          mechanism.targetPathId === pkg.targetPathId &&
          (pkg.targetSceneObjectId ||
            preferredMotionJointId(
              project,
              mechanism.targetPartId,
              mechanism.targetAnchorJointId,
            ) === pkg.targetAnchorJointId),
      );
      const activeVisualPartIds = selectedPart ? [selectedPart.id] : [];
      const fittedFoundryParameters = pkg.parameters as Partial<MechanismConfig>;
      const packagePathFit =
        fittedFoundryParameters.fabricationMetadata?.pathFit ??
        foundry.fabricationMetadata?.pathFit;
      const packageFitCandidate: MechanismConfig = {
        ...foundry,
        ...fittedFoundryParameters,
        targetPartId: pkg.targetPartId,
        targetSceneObjectId: pkg.targetSceneObjectId,
        targetPathId: pkg.targetPathId,
        targetAnchorJointId: pkg.targetAnchorJointId,
      };
      if (
        pkg.mechanismType === "4bar" &&
        pkg.targetPathId &&
        (packagePathFit?.status !== "fit" ||
          !mechanismPathFitIsUsable(project, packageFitCandidate))
      ) {
        setCommandStatus("No fabrication-valid path fit.");
        return;
      }
      const rawMechanism = mechanismWithGeneratedPath(
        {
          ...foundry,
          ...fittedFoundryParameters,
          id: existingTarget?.id ?? pkg.mechanismId,
          anchorX: pkg.pivot.x,
          anchorY: pkg.pivot.y,
          color: fittedFoundryParameters.color ?? foundry.color,
          targetPartId: pkg.targetPartId,
          targetSceneObjectId: pkg.targetSceneObjectId,
          targetPathId: pkg.targetPathId,
          targetAnchorJointId: pkg.targetAnchorJointId,
          presetId: pkg.metadata.selectedPreset,
          recommendation: pkg.metadata.recommendation,
          source: "foundry",
          foundryExport: pkg,
          generatedPath: pkg.generatedPath,
          warnings: pkg.warnings,
          activeVisualPartIds,
        },
        { preserveGeneratedPath: true },
      );
      setCommandStatus("Preparing mechanism");
      mechanismFitClient.request(
        createMechanismFitJobInput(
          project,
          normalizeGearMeshMechanism(rawMechanism),
          "sheet",
        ),
        {
          complete: ({ mechanism: fittedMechanism }) => {
            const generatedPath =
              fittedMechanism.generatedPath ??
              rawMechanism.generatedPath ??
              pkg.generatedPath;
            const mechanism = mechanismWithGeneratedPath(
              {
                ...fittedMechanism,
                foundryExport: {
                  ...pkg,
                  parameters: { ...fittedMechanism },
                  pivot: {
                    x: fittedMechanism.anchorX ?? pkg.pivot.x,
                    y: fittedMechanism.anchorY ?? pkg.pivot.y,
                  },
                  outputPoint: generatedPath[0] ?? pkg.outputPoint,
                  generatedPath,
                },
                generatedPath,
                warnings: [
                  ...new Set([
                    ...(fittedMechanism.warnings ?? []),
                    ...(pkg.warnings ?? []),
                  ]),
                ],
                activeVisualPartIds,
              },
              { preserveGeneratedPath: true },
            );
            startTransition(() => {
              dispatch({ type: "set_foundry_export", foundryExport: pkg });
              dispatch({ type: "upsert_mechanism", mechanism });
              setStage("design");
              setCommandStatus("Mechanism ready");
            });
          },
          failed: (error) =>
            setCommandStatus(`Mechanism failed: ${error.message}`),
        },
      );
    },
    [
      dispatch,
      foundry,
      mechanismFitClient,
      project,
      selectedPart,
      setCommandStatus,
      setStage,
    ],
  );

  const applyRecommendedMechanism = useCallback(
    (mechanism: MechanismConfig) => {
      dispatch({ type: "upsert_mechanism", mechanism });
      setStage("design");
    },
    [dispatch, setStage],
  );

  return {
    optimizerBusy,
    cancelMechanismOptimization,
    updateMechanism,
    optimizeSelectedMechanism,
    exportMechanismSvg,
    exportMechanismDxf,
    exportFoundryMechanism,
    commitFoundryDraft,
    applyRecommendedMechanism,
  };
};
