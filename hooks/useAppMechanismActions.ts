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
  MechanismOutputBinding,
  ProjectAction,
  ProjectMotionPath,
  SceneObject,
  ProjectState,
} from "../types";
import { createMechanismOptimizerJobInput } from "../runtime/optimizer/mechanismOptimizerJob";
import { createMechanismOptimizerWorkerClient } from "../runtime/optimizer/mechanismOptimizerWorkerClient";
import { createMechanismFitJobInput } from "../runtime/fitting/mechanismFitJob";
import {
  createMechanismFitWorkerClient,
  type MechanismFitWorkerClient,
} from "../runtime/fitting/mechanismFitWorkerClient";
import { mechanismPathFitIsUsable, motionPathReadiness, preferredMotionJointId } from "../utils/motion";
import { pathOwnerLabel } from "../utils/pathTargets";
import {
  downloadText,
  invalidateMechanismPathFit,
  mechanismWithGeneratedPath,
} from "../utils/project";
import {
  normalizeGearMeshMechanism,
} from "../utils/mechanismRecommendations";
import {
  allocateMechanismOutput,
  assignMechanismOutputBinding,
  mechanismBindingTargetKey,
  mechanismBindingsConflict,
  mechanismOutputBindings,
  mechanismOwnerForDraft,
  mechanismWithOutputBindings,
  replacePrimaryMechanismOutputBinding,
  replacedMechanismPathIds,
  resolvedMechanismOutputBindings,
} from "../utils/mechanismBindings";

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
  "outputs",
  "rodLength",
  "phase",
  "transform",
  "sceneAnchor",
  "outputGearRadius",
  "showOutputGear",
]);

const BOARD_FIT_GEOMETRY_KEYS = new Set<keyof MechanismConfig>([
  "targetPartId",
  "targetSceneObjectId",
  "targetPathId",
  "targetAnchorJointId",
  "outputs",
]);

const changesGeneratedPathGeometry = (updates: Partial<MechanismConfig>) =>
  Object.keys(updates).some((key) =>
    GENERATED_PATH_GEOMETRY_KEYS.has(key as keyof MechanismConfig),
  );

const changesBoardFitGeometry = (updates: Partial<MechanismConfig>) =>
  Object.keys(updates).some((key) =>
    BOARD_FIT_GEOMETRY_KEYS.has(key as keyof MechanismConfig),
  );

export type MechanismUpdateCallbacks = {
  failed?: (error: Error) => void;
};

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
  const mechanismFitGenerationRef = useRef(0);
  const activeMechanismFitRef = useRef<{
    generation: number;
    failed?: (error: Error) => void;
  } | undefined>(undefined);
  const currentProjectRef = useRef(project);
  currentProjectRef.current = project;
  const foundryOwnerIdRef = useRef<string | undefined>(undefined);
  const foundryOwner = mechanismOwnerForDraft(project, foundry);
  if (foundryOwner) foundryOwnerIdRef.current = foundryOwner.id;
  else if (!project.mechanisms.some(mechanism => mechanism.id === foundryOwnerIdRef.current)) foundryOwnerIdRef.current = undefined;
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
    mechanismFitGenerationRef.current += 1;
    const pendingFit = activeMechanismFitRef.current;
    activeMechanismFitRef.current = undefined;
    pendingFit?.failed?.(new Error("Fit cancelled because the project changed."));
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

  const confirmBindingReplacement = useCallback((candidate: MechanismConfig) => {
    const replaced = replacedMechanismPathIds(project, candidate);
    if (!replaced.length) return true;
    const labels = replaced.map(id => project.paths[id] ? pathOwnerLabel(project, project.paths[id]) : id);
    const target = candidate.targetPathId ? project.paths[candidate.targetPathId] : undefined;
    const accepted = window.confirm(`Replace the ${labels.join(", ")} fit${target ? ` with ${pathOwnerLabel(project, target)}` : ""}? All paths will be kept.`);
    if (!accepted) setCommandStatus("Fit kept");
    return accepted;
  }, [project, setCommandStatus]);

  const commitFoundryDraft = useCallback(
    (draft: MechanismConfig) => {
      if (currentProjectRef.current !== project) return false;
      if (!draft.targetPathId || !project.paths[draft.targetPathId]) return;
      const readiness = motionPathReadiness(project, project.paths[draft.targetPathId]);
      if (!readiness.playable) { setCommandStatus(readiness.reason ?? "Check path"); return false; }
      const existingTarget = project.mechanisms.find(
        (mechanism) => mechanismOutputBindings(mechanism).some(
          (binding) => binding.pathId === draft.targetPathId,
        ),
      );
      const draftOwner = existingTarget ?? mechanismOwnerForDraft(project, draft) ??
        project.mechanisms.find(mechanism => mechanism.id === foundryOwnerIdRef.current);
      const boundDraft = draft.targetPathId
        ? replacePrimaryMechanismOutputBinding(project, draft, draft.targetPathId, {
            outputTraceId: draft.fabricationMetadata?.pathFit?.outputTraceId,
            fit: draft.fabricationMetadata?.pathFit,
          })
        : draft;
      const committedDraft = existingTarget
        ? mechanismWithOutputBindings(
            { ...boundDraft, id: existingTarget.id },
            [
              ...mechanismOutputBindings(boundDraft),
              ...mechanismOutputBindings(existingTarget).filter(
                (binding) => binding.pathId !== draft.targetPathId,
              ),
            ],
          )
        : { ...boundDraft, id: draftOwner?.id ?? boundDraft.id };
      if (!confirmBindingReplacement(committedDraft)) return false;
      dispatch({
        type: "upsert_mechanism",
        mechanism: committedDraft,
      });
      return true;
    },
    [confirmBindingReplacement, dispatch, foundry, project, setCommandStatus],
  );

  const updateMechanism = useCallback(
    (
      id: string,
      updates: Partial<MechanismConfig>,
      callbacks: MechanismUpdateCallbacks = {},
    ) => {
      const requestGeneration = mechanismFitGenerationRef.current + 1;
      const mechanism = project.mechanisms.find((m) => m.id === id);
      if (!mechanism) {
        callbacks.failed?.(new Error("Mechanism is no longer available."));
        return;
      }
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
      const changesBindingTarget = [
        "targetPartId",
        "targetSceneObjectId",
        "targetPathId",
        "targetAnchorJointId",
      ].some((key) => Object.prototype.hasOwnProperty.call(updates, key));
      let bindingAware: MechanismConfig;
      if (Object.prototype.hasOwnProperty.call(updates, "outputs")) {
        bindingAware = mechanismWithOutputBindings(next, next.outputs ?? []);
      } else if (!changesBindingTarget) {
        bindingAware = mechanismWithOutputBindings(
          next,
          mechanismOutputBindings(mechanism),
        );
      } else if (next.targetPathId) {
        const priorPrimary = mechanismOutputBindings(mechanism)[0];
        const candidate = replacePrimaryMechanismOutputBinding(
          project,
          next,
          next.targetPathId,
          {
            id: priorPrimary?.id,
            portId: priorPrimary?.portId,
            outputTraceId:
              priorPrimary?.outputTraceId ??
              next.fabricationMetadata?.pathFit?.outputTraceId,
            targetPartId: next.targetPartId,
            targetSceneObjectId: next.targetSceneObjectId,
            targetAnchorJointId: next.targetAnchorJointId,
            phaseOffset: priorPrimary?.phaseOffset,
            direction: priorPrimary?.direction,
            fit: next.fabricationMetadata?.pathFit,
          },
        );
        const requestedBinding = mechanismOutputBindings(candidate)[0];
        if (!requestedBinding || requestedBinding.pathId !== next.targetPathId) {
          const error = new Error("That path cannot use this mechanism output.");
          callbacks.failed?.(error);
          setCommandStatus(error.message);
          return;
        }
        const assignment = assignMechanismOutputBinding(
          {
            ...project,
            mechanisms: project.mechanisms.map((item) =>
              item.id === id ? next : item,
            ),
          },
          id,
          requestedBinding,
        );
        if (!assignment.ok) {
          const error = new Error(assignment.reason);
          callbacks.failed?.(error);
          setCommandStatus(error.message);
          return;
        }
        bindingAware = assignment.project.mechanisms.find(
          (item) => item.id === id,
        )!;
      } else {
        const directTargetBinding = {
          id: `${id}:direct-target`,
          portId: "direct-target",
          pathId: "",
          targetPartId: next.targetPartId,
          targetSceneObjectId: next.targetSceneObjectId,
          targetAnchorJointId: next.targetAnchorJointId,
          enabled: true,
        };
        const directTargetKey = mechanismBindingTargetKey(
          project,
          directTargetBinding,
        );
        const targetConflict = directTargetKey
          ? project.mechanisms.some((candidateMechanism) =>
              resolvedMechanismOutputBindings(project, candidateMechanism).some(
                (binding, index) =>
                  !(candidateMechanism.id === id && index === 0) &&
                  mechanismBindingsConflict(project, binding, directTargetBinding),
              ),
            )
          : false;
        if (targetConflict) {
          const error = new Error(`Target ${directTargetKey} already has a mechanism output.`);
          callbacks.failed?.(error);
          setCommandStatus(error.message);
          return;
        }
        const detached = mechanismWithOutputBindings(
          next,
          mechanismOutputBindings(mechanism).slice(1),
        );
        bindingAware = {
          ...detached,
          targetPartId: next.targetPartId,
          targetSceneObjectId: next.targetSceneObjectId,
          targetPathId: undefined,
          targetAnchorJointId: next.targetAnchorJointId,
          fabricationMetadata: {
            ...(detached.fabricationMetadata ?? {}),
            targetPathId: undefined,
            pathFit: undefined,
          },
        };
      }
      const hasPlayableBinding = (candidate: MechanismConfig) =>
        resolvedMechanismOutputBindings(project, candidate).some(binding => {
          const path = project.paths[binding.pathId];
          return binding.enabled !== false && path && motionPathReadiness(project, path).playable;
        });
      if (updates.enabled === true && !hasPlayableBinding(bindingAware)) {
        const error = new Error("Connect a motion path first.");
        callbacks.failed?.(error);
        setCommandStatus(error.message);
        return;
      }
      if (changesBindingTarget && updates.enabled !== false &&
          !hasPlayableBinding(mechanism) && hasPlayableBinding(bindingAware)) {
        bindingAware = { ...bindingAware, enabled: true };
      }
      if (!confirmBindingReplacement(bindingAware)) {
        callbacks.failed?.(new Error("Fit kept"));
        return;
      }
      mechanismFitGenerationRef.current = requestGeneration;
      const normalized = normalizeGearMeshMechanism(bindingAware);
      const preserveGeneratedPath =
        hasStoredGeneratedPath(mechanism) && !changesGeneratedPathGeometry(updates);
      const requiresBoardFit = changesBoardFitGeometry(updates);
      if (requiresBoardFit) {
        const fittedInput = changesGeneratedPathGeometry(updates)
          ? invalidateMechanismPathFit(normalized)
          : normalized;
        const targetPathId = fittedInput.targetPathId &&
            project.paths[fittedInput.targetPathId]
          ? fittedInput.targetPathId
          : undefined;
        if (targetPathId) {
          const readiness = motionPathReadiness(project, project.paths[targetPathId]);
          if (!readiness.playable) {
            const error = new Error(readiness.reason ?? "Check path");
            callbacks.failed?.(error);
            setCommandStatus(error.message);
            return;
          }
        }
        activeMechanismFitRef.current = {
          generation: requestGeneration,
          failed: callbacks.failed,
        };
        mechanismFitClient.request(
          createMechanismFitJobInput(
            project,
            fittedInput,
            targetPathId ? "path" : "sheet",
            targetPathId,
          ),
          {
            complete: ({ mechanism: fitted }) => {
              if (
                requestGeneration !== mechanismFitGenerationRef.current ||
                currentProjectRef.current !== project
              ) return;
              if (activeMechanismFitRef.current?.generation === requestGeneration) {
                activeMechanismFitRef.current = undefined;
              }
              startTransition(() => {
                dispatch({ type: "upsert_mechanism", mechanism: fitted });
                const fitStatus = fitted.fabricationMetadata?.pathFit?.status;
                setCommandStatus(!targetPathId ? "Choose a motion path." :
                  fitStatus === "rejected" || fitStatus === "closest" || fitStatus === "unfitted"
                    ? "Path connected. Fit needed."
                    : "Fit ready");
              });
            },
            failed: (error) => {
              if (
                requestGeneration !== mechanismFitGenerationRef.current ||
                currentProjectRef.current !== project
              ) return;
              if (activeMechanismFitRef.current?.generation === requestGeneration) {
                activeMechanismFitRef.current = undefined;
              }
              callbacks.failed?.(error);
              setCommandStatus(`Fit failed: ${error.message}`);
            },
          },
        );
        return;
      }
      const pendingFit = activeMechanismFitRef.current;
      activeMechanismFitRef.current = undefined;
      mechanismFitClient.cancel();
      pendingFit?.failed?.(new Error("Fit cancelled by a newer edit."));
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
    [confirmBindingReplacement, dispatch, mechanismFitClient, project, setCommandStatus],
  );

  const optimizeSelectedMechanism = useCallback(() => {
    const fitPath = selectedMechanism?.targetPathId
      ? project.paths[selectedMechanism.targetPathId]
      : selectedPath;
    if (!selectedMechanism || !fitPath || !motionPathReadiness(project, fitPath).playable) return;
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

  const exportMechanismSvg = useCallback(async () => {
    try {
      const { generateSVG } = await import("../utils/exporter");
      downloadText(
        `mechanisms-${Date.now()}.svg`,
        generateSVG(mechanismConfig, angle),
        "image/svg+xml",
      );
      setCommandStatus("Exported mechanism SVG");
    } catch (error) {
      setCommandStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [angle, mechanismConfig, setCommandStatus]);

  const exportMechanismDxf = useCallback(async () => {
    try {
      const { generateDXF } = await import("../utils/exporter");
      downloadText(
        `mechanisms-${Date.now()}.dxf`,
        generateDXF(mechanismConfig, angle),
        "application/dxf",
      );
      setCommandStatus("Exported mechanism DXF");
    } catch (error) {
      setCommandStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [angle, mechanismConfig, setCommandStatus]);

  const exportFoundryMechanism = useCallback(
    (pkg: FoundryExportPackage, allocationOptions: { reuseMechanismId?: string } = {}) => {
      const existingTarget = project.mechanisms.find(
        (mechanism) => mechanismOutputBindings(mechanism).some(
          (binding) => binding.pathId === pkg.targetPathId,
        ),
      );
      const activeVisualPartIds = selectedPart ? [selectedPart.id] : [];
      const fittedFoundryParameters = pkg.parameters as Partial<MechanismConfig>;
      const packagePathFit =
        fittedFoundryParameters.fabricationMetadata?.pathFit ??
        foundry.fabricationMetadata?.pathFit;
      const selectedOutputPortId = pkg.outputPortId ?? packagePathFit?.outputTraceId;
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
      const rawCandidate: MechanismConfig = {
          ...foundry,
          ...fittedFoundryParameters,
          id: existingTarget?.id ?? foundryOwnerIdRef.current ?? pkg.mechanismId,
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
        };
      const boundCandidate = pkg.targetPathId
        ? replacePrimaryMechanismOutputBinding(project, rawCandidate, pkg.targetPathId, {
            outputTraceId: selectedOutputPortId,
            fit: packagePathFit,
          })
        : rawCandidate;
      if (pkg.targetPathId && (!project.paths[pkg.targetPathId] || !motionPathReadiness(project, project.paths[pkg.targetPathId]).playable)) {
        setCommandStatus("Check target path");
        return;
      }
      const replacementOwner = project.mechanisms.find(candidate => candidate.id === boundCandidate.id);
      if (!confirmBindingReplacement(boundCandidate)) return;
      const rawMechanism = mechanismWithGeneratedPath(
        boundCandidate,
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
            if (currentProjectRef.current !== project) return;
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
            const fittedBinding = pkg.targetPathId
              ? replacePrimaryMechanismOutputBinding(project, mechanism, pkg.targetPathId, {
                  outputTraceId: selectedOutputPortId,
                  fit: packagePathFit,
                })
              : mechanism;
            const draftOwnerIsTemporary = Boolean(
              allocationOptions.reuseMechanismId &&
              existingTarget &&
              existingTarget.id !== allocationOptions.reuseMechanismId &&
              (existingTarget.id === foundry.id || existingTarget.id === "foundry-preview"),
            );
            const committedMechanism = existingTarget && !draftOwnerIsTemporary
              ? mechanismWithOutputBindings(
                  { ...fittedBinding, id: existingTarget.id },
                  [
                    ...mechanismOutputBindings(fittedBinding),
                    ...mechanismOutputBindings(existingTarget).filter(
                      (binding) => binding.pathId !== pkg.targetPathId,
                    ),
                  ],
                )
              : fittedBinding;
            const allocationBase = draftOwnerIsTemporary
              ? {
                  ...project,
                  mechanisms: project.mechanisms.filter((candidate) => candidate.id !== existingTarget?.id),
                }
              : project;
            const allocation = pkg.targetPathId && ((!existingTarget && !replacementOwner) || draftOwnerIsTemporary)
              ? allocateMechanismOutput(allocationBase, fittedBinding, pkg.targetPathId, {
                  reuseMechanismId: allocationOptions.reuseMechanismId,
                  portId: selectedOutputPortId,
                  fit: packagePathFit,
                })
              : undefined;
            if (allocation && !allocation.ok) {
              setCommandStatus(`Mechanism failed: ${allocation.reason}`);
              return;
            }
            startTransition(() => {
              dispatch({ type: "set_foundry_export", foundryExport: pkg });
              if (allocation?.ok) {
                dispatch({
                  type: "set_mechanisms",
                  mechanisms: allocation.project.mechanisms,
                  selectedMechanismId: allocation.mechanismId,
                });
              } else {
                dispatch({ type: "upsert_mechanism", mechanism: committedMechanism });
              }
              setStage("design");
              setCommandStatus(allocation?.ok && allocation.reuseRejected
                ? "Separate mechanism ready"
                : "Mechanism ready");
            });
          },
          failed: (error) =>
            setCommandStatus(`Mechanism failed: ${error.message}`),
        },
      );
    },
    [
      dispatch,
      confirmBindingReplacement,
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
      const candidateBindings = resolvedMechanismOutputBindings(project, mechanism);
      const blocked = candidateBindings.map(binding => project.paths[binding.pathId])
        .find(path => path && !motionPathReadiness(project, path).playable);
      if (blocked) { setCommandStatus(motionPathReadiness(project, blocked).reason ?? "Check path"); return; }
      const candidatePathIds = new Set(candidateBindings.map((binding) => binding.pathId));
      const conflictsWithCandidate = (binding: MechanismOutputBinding) =>
        candidatePathIds.has(binding.pathId) || candidateBindings.some(candidate => mechanismBindingsConflict(project, binding, candidate));
      const conflictingOwners = project.mechanisms.filter(
        (candidate) => candidate.id !== mechanism.id &&
          resolvedMechanismOutputBindings(project, candidate).some(conflictsWithCandidate),
      );
      if (conflictingOwners.length > 1) {
        setCommandStatus("Mechanism failed: recommendation conflicts with multiple owners.");
        return;
      }
      const existingOwner = conflictingOwners[0];
      const committedMechanism = existingOwner
        ? mechanismWithOutputBindings(
            { ...mechanism, id: existingOwner.id },
            [
              ...candidateBindings,
              ...resolvedMechanismOutputBindings(project, existingOwner).filter(binding => !conflictsWithCandidate(binding)),
            ],
          )
        : mechanism;
      dispatch({ type: "upsert_mechanism", mechanism: committedMechanism });
      setStage("design");
    },
    [dispatch, project, setCommandStatus, setStage],
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
