import { useCallback, useState } from "react";
import type {
  AppStage,
  BodyPartLayer,
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
export const useAppMechanismActions = ({
  project,
  dispatch,
  selectedPart,
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
  selectedPart?: BodyPartLayer;
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
      if (updates.targetPathId) {
        const path = project.paths[updates.targetPathId];
        if (path) {
          nextUpdates.targetPartId = path.partId;
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
      if (updates.targetPartId !== undefined) {
        const pathId = updates.targetPathId ?? mechanism.targetPathId;
        if (pathId && project.paths[pathId]?.partId !== updates.targetPartId)
          nextUpdates.targetPathId = undefined;
        nextUpdates.targetAnchorJointId = updates.targetPartId
          ? preferredMotionJointId(project, updates.targetPartId, undefined, {
              preferDistalWhenRoot: true,
            })
          : undefined;
      }
      const next = { ...mechanism, ...nextUpdates };
      const normalized = normalizeGearMeshMechanism(next);
      const fitted =
        nextUpdates.targetPathId &&
        (updates.targetPathId !== undefined ||
          updates.targetPartId !== undefined)
          ? fitMechanismToTargetPath(
              project,
              normalized,
              nextUpdates.targetPathId,
            )
          : mechanismWithGeneratedPath({
              ...normalized,
              activeVisualPartIds: normalized.targetPartId
                ? [normalized.targetPartId]
                : [],
            });
      dispatch({ type: "upsert_mechanism", mechanism: fitted });
    },
    [dispatch, project],
  );

  const optimizeSelectedMechanism = useCallback(async () => {
    if (!selectedMechanism || !selectedPath || selectedPath.points.length < 3)
      return;
    setOptimizerBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 16));
    let best = generateSmartConfig(selectedPath.points, selectedMechanism.type);
    let bestScore = evaluateFitness(best, selectedPath.points);
    const iterations =
      project.settings.performancePreset === "fast"
        ? 120
        : project.settings.performancePreset === "high"
          ? 520
          : 260;
    for (let i = 0; i < iterations; i++) {
      const candidate =
        i < 80
          ? generateSmartConfig(selectedPath.points, selectedMechanism.type)
          : mutateConfig(best, 0.45, true);
      const score = evaluateFitness(candidate, selectedPath.points);
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
      targetPartId: selectedPart?.id,
      targetPathId: selectedPath.id,
      source: "optimized",
      warnings:
        bestScore > 350 ? [`Loose fit score ${Math.round(bestScore)}`] : [],
    });
    setOptimizerBusy(false);
  }, [
    project.settings.performancePreset,
    selectedMechanism,
    selectedPart,
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
      const existingTarget = project.mechanisms.find(
        (mechanism) =>
          mechanism.targetPartId === pkg.targetPartId &&
          mechanism.targetPathId === pkg.targetPathId &&
          preferredMotionJointId(
            project,
            mechanism.targetPartId,
            mechanism.targetAnchorJointId,
          ) === pkg.targetAnchorJointId,
      );
      const activeVisualPartIds = selectedPart ? [selectedPart.id] : [];
      const rawMechanism = mechanismWithGeneratedPath(
        {
          ...foundry,
          id: existingTarget?.id ?? pkg.mechanismId,
          anchorX: pkg.pivot.x,
          anchorY: pkg.pivot.y,
          targetPartId: pkg.targetPartId,
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
      const fittedMechanism = pkg.targetPathId
        ? fitMechanismToTargetPath(project, rawMechanism, pkg.targetPathId)
        : fitRecommendedMechanismToSheet(project, rawMechanism);
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
      dispatch({ type: "set_foundry_export", foundryExport: pkg });
      dispatch({ type: "upsert_mechanism", mechanism });
      setStage("design");
    },
    [dispatch, foundry, project, selectedPart, setStage],
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
