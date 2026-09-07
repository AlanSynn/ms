import React, { useEffect, useMemo, useState } from "react";
import type { MechanismConfig, ProjectAction, ProjectState } from "../../../types";
import {
  FOUNDRY_VIEW_PRESETS,
  type FoundryCamera,
} from "../../../utils/foundryCamera";
import {
  reuseAutomataSceneRuntime,
  sampleReusableAutomataSceneRuntime,
} from "../../../utils/automataSceneModel";
import { DeferredThreeFoundryPreview } from "../foundry/DeferredThreeFoundryPreview";
import type { FoundryPlaybackFrame } from "../foundry/ThreeFoundryPreview";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";
import { useWorkingPreviewCamera, type WorkingPreviewCameraProps } from "./useWorkingPreviewCamera";
import { visibleWorkingProjectPaths } from "../../../utils/workingProjectPreview";

type DesignFoundryPreviewProps = WorkingPreviewCameraProps & {
  project: ProjectState;
  mechanism?: MechanismConfig;
  angle: number;
  playbackClock: PlaybackClock;
  isPlaying: boolean;
  showTrace: boolean;
  dispatch?: (action: ProjectAction) => void;
  presentation?: "design" | "project";
};

const cameraLabel = (camera: FoundryCamera) =>
  camera.preset === "custom"
    ? "Custom view"
    : FOUNDRY_VIEW_PRESETS[camera.preset].label;

export const DesignFoundryPreview = React.memo(({
  project,
  mechanism,
  angle,
  playbackClock,
  isPlaying,
  showTrace,
  dispatch,
  presentation = "design",
  camera: controlledCamera,
  onCameraChange,
}: DesignFoundryPreviewProps) => {
  const [showGrid, setShowGrid] = useState(true);
  const [showUserPathPreview, setShowUserPathPreview] = useState(true);
  const [showMechanismPathPreview, setShowMechanismPathPreview] = useState(true);
  const [characterLayerReady, setCharacterLayerReady] = useState(false);
  const {
    camera, setCamera, transientCamera, fitRequest, requestFit, setCameraPreset,
    isOrbiting, isZooming, isPanning, ...cameraEvents
  } = useWorkingPreviewCamera({ camera: controlledCamera, onCameraChange });
  const authoredPaths = useMemo(() => visibleWorkingProjectPaths(project), [project.paths, project.pathOrder]);
  const showUserPath = showTrace && showUserPathPreview;
  const showMechanismPath = showTrace && showMechanismPathPreview;

  useEffect(() => {
    setCharacterLayerReady(false);
    const handle = window.setTimeout(() => setCharacterLayerReady(true), 120);
    return () => window.clearTimeout(handle);
  }, [mechanism, project]);

  const sceneRuntime = useMemo(
    () => reuseAutomataSceneRuntime(project, mechanism, "design-live"),
    [mechanism, project],
  );
  const sceneModel = useMemo(
    () => sampleReusableAutomataSceneRuntime(sceneRuntime, angle),
    [angle, sceneRuntime],
  );
  const automataContext = useMemo(
    () =>
      characterLayerReady && sceneModel.mechanism
        ? {
            project,
            animatedParts: sceneModel.animatedParts,
            animatedSceneObjects: sceneModel.animatedSceneObjects,
            geometrySkeleton: project.skeleton,
            skeleton: sceneModel.skeleton,
            paths: showUserPath ? authoredPaths : [],
            selectedPathId: project.selectedPathId,
            showCharacter: true,
            showSkeleton: false,
          }
        : undefined,
    [authoredPaths, characterLayerReady, project, sceneModel, showUserPath],
  );
  const playbackSample = useMemo(
    () => (phase: number): FoundryPlaybackFrame | undefined => {
      const frame = sampleReusableAutomataSceneRuntime(sceneRuntime, phase);
      if (!frame.foundryPreview || !frame.mechanism) return undefined;
      return {
        simulation: frame.foundryPreview.physicalSimulation,
        automataContext: characterLayerReady
          ? {
              project,
              animatedParts: frame.animatedParts,
              animatedSceneObjects: frame.animatedSceneObjects,
              geometrySkeleton: project.skeleton,
              skeleton: frame.skeleton,
              paths: showUserPath ? authoredPaths : [],
              selectedPathId: project.selectedPathId,
              showCharacter: true,
              showSkeleton: false,
            }
          : undefined,
      };
    },
    [authoredPaths, characterLayerReady, project, sceneRuntime, showUserPath],
  );

  if (!sceneModel.mechanism || !sceneModel.foundryPreview) {
    return (
      <div className="blueprint-empty-state" data-testid="design-shared-foundry-empty">
        Add a mechanism.
      </div>
    );
  }

  const targetError = sceneModel.targetError;
  const target = sceneModel.target;
  const physicsOverlay = sceneModel.foundryPreview.physicsOverlay;

  return (
    <section
      className="design-automata-preview foundry-canvas-shell canvas-workspace"
      style={{ height: "100%" }}
      data-testid={presentation === "project" ? "project-working-preview" : "design-shared-foundry-preview"}
      data-renderer-source="ThreeFoundryPreview"
      data-shared-with="foundry-renderer"
      data-design-scene-mode="single-foundry-automata-scene"
      data-automata-model-source="automata-scene-runtime"
      data-mechanism-id={sceneModel.mechanism.id}
      data-mechanism-type={sceneModel.mechanism.type}
      data-foundry-feature-label={sceneModel.featureLabel ?? ""}
      data-foundry-feature-issue-count={sceneModel.featureIssues.length}
      data-guided-context-mode="single-scene-automata"
      data-guided-context-part-count={project.partOrder.length}
      data-guided-context-path-count={authoredPaths.length}
      data-authored-path-ids={authoredPaths.map(path => path.id).join(",")}
      data-working-camera={JSON.stringify(camera)}
      data-working-phase={angle}
      data-guided-context-path-id={sceneModel.userPath?.id ?? ""}
      data-user-path-preview={showUserPath ? "shown" : "hidden"}
      data-mechanism-path-preview={showMechanismPath ? "shown" : "hidden"}
      data-design-motion-source={sceneModel.motionSource}
      data-design-generated-path-count={sceneModel.mechanism.generatedPath?.length ?? 0}
      data-design-generated-path-error={
        sceneModel.generatedPathError === undefined
          ? "missing"
          : sceneModel.generatedPathError.toFixed(3)
      }
      data-design-fit-status={
        sceneModel.mechanism.fabricationMetadata?.pathFit?.status ?? "unfitted"
      }
      data-design-fit-error={
        sceneModel.mechanism.fabricationMetadata?.pathFit?.error === undefined
          ? "missing"
          : sceneModel.mechanism.fabricationMetadata.pathFit.error.toFixed(3)
      }
      data-design-visible-mechanism-count={sceneModel.mechanisms.length}
      data-design-target-joint-id={sceneModel.targetJointId ?? ""}
      data-design-target-error={targetError === undefined ? "missing" : targetError.toFixed(3)}
      data-design-target-x={target ? target.x.toFixed(2) : "missing"}
      data-design-target-y={target ? target.y.toFixed(2) : "missing"}
      data-design-animated-part-count={Object.keys(sceneModel.animatedParts).length}
      data-design-animated-object-count={Object.keys(sceneModel.animatedSceneObjects).length}
      data-design-show-trace={showTrace ? "true" : "false"}
      data-design-trace-layer={showTrace ? "shown" : "hidden"}
      data-design-foundry-contract-source="automata-scene-runtime"
      data-design-mechanism-contract-id={sceneModel.mechanismContract?.mechanismId ?? ""}
    >
      <div
        className="foundry-camera-hud design-foundry-camera-hud"
        style={{ width: "max-content" }}
        data-testid="design-foundry-camera-controls"
        aria-label="Automata viewer controls"
      >
        <span className="foundry-camera-readout" data-testid="design-foundry-camera-readout">
          3D {cameraLabel(camera)} · {Math.round(camera.zoom * 100)}%
        </span>
        {(["front", "iso", "side", "top"] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            className={camera.preset === preset ? "active" : ""}
            aria-pressed={camera.preset === preset}
            onClick={() => setCameraPreset(preset)}
          >
            {FOUNDRY_VIEW_PRESETS[preset].label}
          </button>
        ))}
        <button type="button" onClick={() => requestFit("content")}>Fit</button>
        <button type="button" onClick={() => requestFit("scene")}>Full scene</button>
        <span className="viewer-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className={showGrid ? "active" : ""}
          aria-pressed={showGrid}
          onClick={() => setShowGrid((value) => !value)}
        >
          Grid
        </button>
        <button
          type="button"
          data-testid="design-toggle-user-path"
          className={showUserPath ? "active" : ""}
          aria-pressed={showUserPath}
          disabled={!showTrace}
          onClick={() => setShowUserPathPreview((value) => !value)}
        >
          User path
        </button>
        <button
          type="button"
          data-testid="design-toggle-mechanism-path"
          className={showMechanismPath ? "active" : ""}
          aria-pressed={showMechanismPath}
          disabled={!showTrace}
          onClick={() => setShowMechanismPathPreview((value) => !value)}
        >
          Mech path
        </button>
      </div>
      <DeferredThreeFoundryPreview
        mechanism={sceneModel.foundryPreview.mechanism}
        performancePreset={project.settings.performancePreset}
        simulation={sceneModel.foundryPreview.physicalSimulation}
        playback={
          isPlaying
            ? {
                clock: playbackClock,
                sample: playbackSample,
              }
            : undefined
        }
        kit={project.settings.physicalKit}
        camera={camera}
        cameraFit={fitRequest}
        onCameraFit={setCamera}
        transientCamera={transientCamera}
        rigOpacity={0.94}
        color={sceneModel.foundryPreview.mechanism.color}
        pathPoints={sceneModel.foundryPreview.previewPoints}
        pathTraces={sceneModel.foundryPreview.pointTraces}
        showGrid={showGrid}
        showPathPreview={showMechanismPath}
        showTrail={showMechanismPath}
        showForces={false}
        showVelocity={false}
        explode={0}
        physicsRule={physicsOverlay.rule}
        velocityMagnitude={physicsOverlay.velocityMagnitude}
        forceMagnitude={physicsOverlay.forceMagnitude}
        frictionCoefficient={project.settings.simulationFriction}
        frictionMagnitude={physicsOverlay.frictionMagnitude}
        constraintError={physicsOverlay.constraintError}
        cameraLabel={cameraLabel(camera)}
        isPickingAnchor={false}
        isOrbiting={isOrbiting}
        isZooming={isZooming}
        isPanning={isPanning}
        onAnchorPick={() => {}}
        {...cameraEvents}
        onProjectionSizeChange={() => {}}
        onAutomataPartSelect={dispatch ? (partId) => dispatch({ type: "select_part", partId }) : undefined}
        onAutomataSceneObjectSelect={dispatch ? (objectId) => dispatch({ type: "select_scene_object", objectId }) : undefined}
        viewerTab={presentation}
        automataContext={automataContext}
        children={null}
      />
      {Object.values(sceneModel.warnings).some(messages => messages.includes("Move target within reach")) && (
        <div className="absolute bottom-3 left-3 z-10 rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900" role="status" data-testid="mechanism-reach-warning">
          Move mechanism within reach
        </div>
      )}
    </section>
  );
});

DesignFoundryPreview.displayName = "DesignFoundryPreview";
