import React, { useMemo, useRef, useState } from "react";

import {
  ThreeFoundryPreview,
  type FoundryPlaybackFrame,
} from "../foundry/ThreeFoundryPreview";
import type {
  MechanismConfig,
  Point,
  ProjectState,
} from "../../../types";
import {
  createAutomataSceneRuntime,
  sampleAutomataSceneRuntime,
} from "../../../utils/automataSceneModel";
import {
  FOUNDRY_OVERLAY_SIZE,
  FOUNDRY_VIEW_PRESETS,
  clampFoundryPitch,
  clampFoundryZoom,
  type FoundryCamera,
  type FoundryOverlaySize,
} from "../../../utils/foundryCamera";
import type {
  AssemblyPlaybackStep,
  CharacterAssemblyStep,
} from "../../../utils/assemblyPlayback";
import type { AssemblySceneFrame } from "../../../utils/assemblySceneFrame";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";

const assemblyMechanismForProject = (project: ProjectState) =>
  project.mechanisms.find((item) => item.id === project.selectedMechanismId) ??
  project.mechanisms.find(
    (item) => item.visible !== false && item.enabled !== false,
  );

const stepLift = (motion: string, progress: number, playing: boolean) =>
  motion === "explode_z" && (playing || progress > 0)
    ? Math.max(0, 0.38 * (1 - progress))
    : 0;

const cameraLabel = (camera: FoundryCamera) =>
  camera.preset === "custom"
    ? "Custom view"
    : FOUNDRY_VIEW_PRESETS[camera.preset].label;

const noPoint = { x: 0, y: 0 };

const useAssemblyFoundryCamera = () => {
  const [camera, setCamera] = useState<FoundryCamera>({
    ...FOUNDRY_VIEW_PRESETS.iso,
    preset: "iso",
    pan: { x: 0, y: 0 },
  });
  const [projectionSize, setProjectionSize] =
    useState<FoundryOverlaySize>(FOUNDRY_OVERLAY_SIZE);
  const [isOrbiting, setIsOrbiting] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const orbitStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    zoom: number;
    pan: Point;
    mode: "orbit" | "zoom" | "pan";
  } | null>(null);

  const updateProjectionSize = (size: FoundryOverlaySize) =>
    setProjectionSize((prev) =>
      Math.abs(prev.width - size.width) < 1 &&
      Math.abs(prev.height - size.height) < 1
        ? prev
        : size,
    );

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const mode: "orbit" | "zoom" | "pan" =
      event.shiftKey || event.button === 1
        ? "pan"
        : event.altKey || event.button === 2
          ? "zoom"
          : "orbit";
    orbitStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: camera.yaw,
      pitch: camera.pitch,
      zoom: camera.zoom,
      pan: camera.pan ?? noPoint,
      mode,
    };
    setIsOrbiting(mode === "orbit");
    setIsZooming(mode === "zoom");
    setIsPanning(mode === "pan");
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (
    event,
  ) => {
    const start = orbitStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    setCamera((prev) => {
      if (start.mode === "zoom") {
        return {
          ...prev,
          zoom: clampFoundryZoom(start.zoom * (1 - dy * 0.006)),
          preset: "custom",
        };
      }
      if (start.mode === "pan") {
        return {
          ...prev,
          pan: {
            x: start.pan.x - dx * 0.018,
            y: start.pan.y + dy * 0.018,
          },
          preset: "custom",
        };
      }
      return {
        ...prev,
        yaw: start.yaw + dx * 0.38,
        pitch: clampFoundryPitch(start.pitch + dy * 0.28),
        preset: "custom",
      };
    });
  };

  const finishPointerMove: React.PointerEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if (orbitStartRef.current?.pointerId !== event.pointerId) return;
    orbitStartRef.current = null;
    setIsOrbiting(false);
    setIsZooming(false);
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCamera((prev) => ({
      ...prev,
      zoom: clampFoundryZoom(prev.zoom * (event.deltaY < 0 ? 1.1 : 0.9)),
      preset: "custom",
    }));
  };

  return {
    camera,
    projectionSize,
    isOrbiting,
    isZooming,
    isPanning,
    updateProjectionSize,
    handlePointerDown,
    handlePointerMove,
    finishPointerMove,
    handleWheel,
  };
};

export const AssemblyCharacterThreePreview = ({
  project,
  step,
  progress,
  playing,
  sceneFrame,
  playbackClock,
}: {
  project: ProjectState;
  step: CharacterAssemblyStep;
  progress: number;
  playing: boolean;
  sceneFrame: AssemblySceneFrame;
  playbackClock: PlaybackClock;
}) => {
  const angle = step.phase === "test-character" ? progress * Math.PI * 2 : 0;
  const mechanism = assemblyMechanismForProject(project);
  const sceneRuntime = useMemo(
    () => createAutomataSceneRuntime(project, mechanism, "assembly-live"),
    [mechanism, project],
  );
  const sceneModel = useMemo(
    () => sampleAutomataSceneRuntime(sceneRuntime, angle),
    [angle, sceneRuntime],
  );
  const previewModel = sceneModel.foundryPreview;
  const {
    camera,
    projectionSize,
    isOrbiting,
    isZooming,
    isPanning,
    updateProjectionSize,
    handlePointerDown,
    handlePointerMove,
    finishPointerMove,
    handleWheel,
  } = useAssemblyFoundryCamera();
  const automataContext = useMemo(
    () =>
      previewModel
        ? {
            project,
            animatedParts: sceneModel.animatedParts,
            animatedSceneObjects: sceneModel.animatedSceneObjects,
            geometrySkeleton: project.skeleton,
            skeleton: sceneModel.skeleton,
            paths: [],
            showCharacter: true,
            showSkeleton: false,
          }
        : undefined,
    [previewModel, project, sceneModel],
  );
  const playbackSample = useMemo(
    () => (phase: number): FoundryPlaybackFrame | undefined => {
      if (!mechanism) return undefined;
      const sampleProgress = (((phase / (Math.PI * 2)) % 1) + 1) % 1;
      const sampleAngle =
        step.phase === "test-character" ? sampleProgress * Math.PI * 2 : 0;
      const sampleModel = sampleAutomataSceneRuntime(sceneRuntime, sampleAngle);
      const samplePreview = sampleModel.foundryPreview;
      if (!samplePreview) return undefined;
      return {
        simulation: samplePreview.physicalSimulation,
        automataContext: {
          project,
          animatedParts: sampleModel.animatedParts,
          animatedSceneObjects: sampleModel.animatedSceneObjects,
          geometrySkeleton: project.skeleton,
          skeleton: sampleModel.skeleton,
          paths: [],
          showCharacter: true,
          showSkeleton: false,
        },
        assemblySceneFrame: { ...sceneFrame, progress: sampleProgress },
        explode: stepLift(sceneFrame.motion, sampleProgress, playing),
      };
    },
    [mechanism, playing, project, sceneFrame, sceneRuntime, step.phase],
  );

  if (!previewModel || !mechanism) {
    return (
      <section
        className="assembly-three-preview assembly-character-three-preview"
        data-testid="assembly-character-three-preview"
        data-assembly-three-mode="character"
        data-assembly-three-phase={step.phase}
        data-assembly-three-progress={Math.round(progress * 100)}
        data-automata-model-source="automata-scene-runtime"
      >
        Add a mechanism.
      </section>
    );
  }

  const {
    mechanism: designMechanism,
    pointTraces,
    previewPoints,
    physicalSimulation,
    physicsOverlay,
  } = previewModel;

  return (
    <section
      className="assembly-three-preview assembly-character-three-preview"
      data-testid="assembly-character-three-preview"
      data-assembly-three-mode="character"
      data-assembly-three-phase={step.phase}
      data-assembly-three-progress={Math.round(progress * 100)}
      data-assembly-frame-version={sceneFrame.version}
      data-assembly-motion-kind={sceneFrame.motion}
      data-automata-model-source="automata-scene-runtime"
      data-assembly-explode-axis={sceneFrame.explodeAxis}
      data-active-board-coords={sceneFrame.activeBoardCoords.join(",")}
      data-floating-reference-count={sceneFrame.floatingReferencePoints?.length ?? 0}
      data-assembly-one-scene-automata="shown"
      data-assembly-animated-part-count={Object.keys(sceneModel.animatedParts).length}
      data-assembly-animated-object-count={Object.keys(sceneModel.animatedSceneObjects).length}
      aria-label="3D character assembly simulation"
    >
      <ThreeFoundryPreview
        mechanism={designMechanism}
        performancePreset={project.settings.performancePreset}
        simulation={physicalSimulation}
        kit={project.settings.physicalKit}
        camera={camera}
        rigOpacity={0.92}
        color={designMechanism.color}
        pathPoints={previewPoints}
        pathTraces={pointTraces}
        showGrid
        showPathPreview={step.phase === "test-character"}
        showTrail={step.phase === "test-character"}
        showForces={false}
        showVelocity={false}
        explode={stepLift(sceneFrame.motion, progress, playing)}
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerMove}
        onPointerCancel={finishPointerMove}
        onWheel={handleWheel}
        onProjectionSizeChange={updateProjectionSize}
        assemblySceneFrame={sceneFrame}
        viewerTab="assembly"
        automataContext={automataContext}
        playback={{
          clock: playbackClock,
          sample: playbackSample,
        }}
      >
        <div className="assembly-three-hud">3D build</div>
        <svg
          data-testid="assembly-character-foundry-preview-overlay"
          viewBox={`0 0 ${projectionSize.width} ${projectionSize.height}`}
          className="foundry-preview-overlay"
          aria-hidden="true"
        />
      </ThreeFoundryPreview>
    </section>
  );
};

export const AssemblyMechanismThreePreview = ({
  project,
  mechanism,
  step,
  progress,
  playing,
  sceneFrame,
  playbackClock,
}: {
  project: ProjectState;
  mechanism: MechanismConfig;
  step: AssemblyPlaybackStep;
  progress: number;
  playing: boolean;
  sceneFrame: AssemblySceneFrame;
  playbackClock: PlaybackClock;
}) => {
  const angle = progress * Math.PI * 2;
  const explode = stepLift(step.motion, progress, playing);
  const {
    camera,
    projectionSize,
    isOrbiting,
    isZooming,
    isPanning,
    updateProjectionSize,
    handlePointerDown,
    handlePointerMove,
    finishPointerMove,
    handleWheel,
  } = useAssemblyFoundryCamera();
  const sceneRuntime = useMemo(
    () => createAutomataSceneRuntime(project, mechanism, "assembly-live"),
    [mechanism, project],
  );
  const sceneModel = useMemo(
    () => sampleAutomataSceneRuntime(sceneRuntime, angle),
    [angle, sceneRuntime],
  );
  const previewModel = sceneModel.foundryPreview;
  const showAutomataContext =
    step.phase === "connect-character" || step.phase === "test-motion";
  const automataContext = useMemo(
    () =>
      previewModel
        ? {
            project,
            animatedParts: sceneModel.animatedParts,
            animatedSceneObjects: sceneModel.animatedSceneObjects,
            geometrySkeleton: project.skeleton,
            skeleton: sceneModel.skeleton,
            paths: [],
            showCharacter: showAutomataContext,
            showSkeleton: false,
          }
        : undefined,
    [previewModel, project, sceneModel, showAutomataContext],
  );
  const playbackSample = useMemo(
    () => (phase: number): FoundryPlaybackFrame | undefined => {
      const sampleProgress = (((phase / (Math.PI * 2)) % 1) + 1) % 1;
      const sampleModel = sampleAutomataSceneRuntime(
        sceneRuntime,
        sampleProgress * Math.PI * 2,
      );
      const samplePreview = sampleModel.foundryPreview;
      if (!samplePreview) return undefined;
      const sampleShowAutomataContext =
        step.phase === "connect-character" || step.phase === "test-motion";
      return {
        simulation: samplePreview.physicalSimulation,
        automataContext: {
          project,
          animatedParts: sampleModel.animatedParts,
          animatedSceneObjects: sampleModel.animatedSceneObjects,
          geometrySkeleton: project.skeleton,
          skeleton: sampleModel.skeleton,
          paths: [],
          showCharacter: sampleShowAutomataContext,
          showSkeleton: false,
        },
        assemblySceneFrame: { ...sceneFrame, progress: sampleProgress },
        explode: stepLift(sceneFrame.motion, sampleProgress, playing),
      };
    },
    [mechanism, playing, project, sceneFrame, sceneRuntime, step.phase],
  );

  if (!previewModel) {
    return (
      <section
        className="assembly-three-preview assembly-mechanism-three-preview"
        data-testid="assembly-mechanism-three-preview"
        data-assembly-three-mode="mechanism"
        data-assembly-three-phase={step.phase}
        data-assembly-three-progress={Math.round(progress * 100)}
        data-automata-model-source="automata-scene-runtime"
      >
        Add a mechanism.
      </section>
    );
  }

  const {
    mechanism: designMechanism,
    pointTraces,
    previewPoints,
    physicalSimulation,
    physicsOverlay,
  } = previewModel;

  return (
    <section
      className="assembly-three-preview assembly-mechanism-three-preview"
      data-testid="assembly-mechanism-three-preview"
      data-assembly-three-mode="mechanism"
      data-assembly-three-phase={step.phase}
      data-assembly-three-progress={Math.round(progress * 100)}
      data-assembly-three-explode={Math.round(explode * 100)}
      data-automata-model-source="automata-scene-runtime"
      data-assembly-one-scene-automata={
        showAutomataContext ? "shown" : "mechanism-only"
      }
      data-assembly-frame-version={sceneFrame.version}
      data-assembly-motion-kind={sceneFrame.motion}
      data-assembly-explode-axis={sceneFrame.explodeAxis}
      data-active-board-coords={sceneFrame.activeBoardCoords.join(",")}
      data-floating-reference-coords={sceneFrame.floatingReferenceCoords.join(",")}
      data-mechanism-scene-contract-version={sceneFrame.mechanismContract?.version ?? ""}
      data-mechanism-scene-contract-mechanism-id={sceneFrame.mechanismContract?.mechanismId ?? ""}
      data-mechanism-scene-contract-stack-source={sceneFrame.mechanismContract?.stackSource ?? ""}
      data-mechanism-scene-contract-layer-count={sceneFrame.mechanismContract?.layers.length ?? 0}
      data-automata-mechanism-contract-id={sceneModel.mechanismContract?.mechanismId ?? ""}
      data-assembly-animated-part-count={Object.keys(sceneModel.animatedParts).length}
      data-assembly-animated-object-count={Object.keys(sceneModel.animatedSceneObjects).length}
      aria-label="3D mechanism assembly simulation"
    >
      <ThreeFoundryPreview
        mechanism={designMechanism}
        performancePreset={project.settings.performancePreset}
        simulation={physicalSimulation}
        kit={project.settings.physicalKit}
        camera={camera}
        rigOpacity={0.92}
        color={designMechanism.color}
        pathPoints={previewPoints}
        pathTraces={pointTraces}
        showGrid
        showPathPreview={step.phase === "test-motion"}
        showTrail={step.phase === "test-motion"}
        showForces={false}
        showVelocity={false}
        explode={explode}
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerMove}
        onPointerCancel={finishPointerMove}
        onWheel={handleWheel}
        onProjectionSizeChange={updateProjectionSize}
        assemblySceneFrame={sceneFrame}
        viewerTab="assembly"
        automataContext={automataContext}
        playback={{
          clock: playbackClock,
          sample: playbackSample,
        }}
      >
        <div className="assembly-three-hud">Build animation</div>
        <svg
          data-testid="assembly-foundry-preview-overlay"
          viewBox={`0 0 ${projectionSize.width} ${projectionSize.height}`}
          className="foundry-preview-overlay"
          aria-hidden="true"
        />
      </ThreeFoundryPreview>
    </section>
  );
};
