import { useCallback, useState } from "react";
import type {
  AppStage,
  FoundryExportPackage,
  GlobalConfig,
  MechanismConfig,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../types";
import { generateDXF, generateSVG } from "../utils/exporter";
import {
  evaluateFitness,
  generateSmartConfig,
  mutateConfig,
} from "../utils/optimizer";
import { preferredMotionJointId } from "../utils/motion";
import { downloadText, mechanismWithGeneratedPath } from "../utils/project";
import {
  fitMechanismToTargetPath,
  fitRecommendedMechanismToSheet,
  normalizeGearMeshMechanism,
} from "../utils/mechanismRecommendations";
import { constrainMechanismUpdate } from "../utils/mechanismEditAuthority";
import { pathOwnedTargetFields } from "../utils/pathTargets";

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
  selectedPath,
  selectedMechanism,
  foundry,
  mechanismConfig,
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

  const updateMechanism = useCallback(
    (id: string, updates: Partial<MechanismConfig>) => {
      const mechanism = project.mechanisms.find((m) => m.id === id);
      if (!mechanism) return;
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
      const next = { ...mechanism, ...constrainedUpdates };
      const normalized = normalizeGearMeshMechanism(next);
      const preserveGeneratedPath =
        hasStoredGeneratedPath(mechanism) &&
        !changesGeneratedPathGeometry(constrainedUpdates);
      const fitted =
        constrainedUpdates.targetPathId
          ? fitMechanismToTargetPath(
              project,
              normalized,
              constrainedUpdates.targetPathId,
            )
          : mechanismWithGeneratedPath(
              {
                ...normalized,
                activeVisualPartIds: normalized.targetPartId
                  ? [normalized.targetPartId]
                  : [],
              },
              { preserveGeneratedPath },
            );
      dispatch({ type: "upsert_mechanism", mechanism: fitted });
    },
    [dispatch, project],
  );

  const optimizeSelectedMechanism = useCallback(async () => {
    const fitPath = selectedMechanism?.targetPathId
      ? project.paths[selectedMechanism.targetPathId]
      : selectedPath;
    if (!selectedMechanism || !fitPath || fitPath.points.length < 3) return;
    setOptimizerBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 16));
    let best = generateSmartConfig(fitPath.points, selectedMechanism.type);
    let bestScore = evaluateFitness(best, fitPath.points);
    const iterations =
      project.settings.performancePreset === "fast"
        ? 120
        : project.settings.performancePreset === "high"
          ? 520
          : 260;
    for (let i = 0; i < iterations; i++) {
      const candidate =
        i < 80
          ? generateSmartConfig(fitPath.points, selectedMechanism.type)
          : mutateConfig(best, 0.45, true);
      const score = evaluateFitness(candidate, fitPath.points);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    updateMechanism(selectedMechanism.id, {
      ...best,
      id: selectedMechanism.id,
      color: selectedMechanism.color,
      visible: true,
      ...pathOwnedTargetFields(fitPath),
      source: "optimized",
      warnings:
        bestScore > 350 ? ["Fit is loose. Try Fit again."] : [],
    });
    setOptimizerBusy(false);
  }, [
    project,
    selectedMechanism,
    selectedPath,
    updateMechanism,
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
      const existingTarget = project.mechanisms.find(
        (mechanism) =>
          mechanism.targetPartId === targetFields.targetPartId &&
          mechanism.targetSceneObjectId === targetFields.targetSceneObjectId &&
          mechanism.targetPathId === targetFields.targetPathId &&
          (targetFields.targetSceneObjectId ||
            mechanism.targetAnchorJointId === targetFields.targetAnchorJointId),
      );
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
          foundryExport: pkg,
          generatedPath: pkg.generatedPath,
          warnings: pkg.warnings,
        },
        { preserveGeneratedPath: true },
      );
      const fittedMechanism = fitRecommendedMechanismToSheet(
        project,
        normalizeGearMeshMechanism(rawMechanism),
      );
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
        },
        { preserveGeneratedPath: true },
      );
      dispatch({ type: "set_foundry_export", foundryExport: pkg });
      dispatch({ type: "upsert_mechanism", mechanism });
      setStage("design");
    },
    [dispatch, foundry, project, setStage],
  );

  const applyRecommendedMechanism = useCallback(
    (mechanism: MechanismConfig) => {
      dispatch({ type: "upsert_mechanism", mechanism });
      setShowRecommendations(false);
      setStage("design");
    },
    [dispatch, setShowRecommendations, setStage],
  );

  return {
    optimizerBusy,
    updateMechanism,
    optimizeSelectedMechanism,
    exportMechanismSvg,
    exportMechanismDxf,
    exportFoundryMechanism,
    applyRecommendedMechanism,
  };
};
