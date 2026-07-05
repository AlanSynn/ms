import React, { useMemo, useRef, useState } from "react";

import { ThreePuppetPreview } from "../../ThreePuppetPreview";
import { ThreeFoundryPreview } from "../foundry/ThreeFoundryPreview";
import type {
  CanvasViewport,
  MechanismConfig,
  Point,
  ProjectState,
} from "../../../types";
import {
  buildFoundryPhysicsOverlay,
} from "../../../utils/physicsSession";
import {
  animatedPartsForProject,
  animatedSceneObjectsForProject,
} from "../../../utils/motion";
import {
  generateCurvePoints,
  generateMechanismPointTraces,
} from "../../../utils/kinematics";
import {
  createMechanismFitContext,
  fitMechanismSimulationWithContext,
  fitPointsToBox,
  pointsToSvgPath,
} from "../../../utils/mechanismPreview";
import { normalizeGearMeshMechanism } from "../../../utils/mechanismRecommendations";
import {
  FOUNDRY_OVERLAY_SIZE,
  FOUNDRY_VIEW_PRESETS,
  clampFoundryPitch,
  clampFoundryZoom,
  type FoundryCamera,
  type FoundryOverlaySize,
  type FoundryViewPreset,
} from "../../../utils/foundryCamera";
import type {
  AssemblyPlaybackStep,
  CharacterAssemblyPlan,
  CharacterAssemblyStep,
} from "../../../utils/assemblyPlayback";

const assemblyViewport = (): CanvasViewport => ({
  offset: { x: -110, y: -20 },
  zoom: 0.78,
});

const mechanismExplodeForStep = (step: AssemblyPlaybackStep, progress: number) => {
  if (step.phase === "test-motion") return 0.22;
  if (step.phase === "connect-character") return 0.42;
  if (step.phase === "mount-to-board") return 0.64 - progress * 0.22;
  if (step.phase === "assemble-module") return 0.92;
  return 0.72;
};

const cameraLabel = (camera: FoundryCamera) =>
  camera.preset === "custom"
    ? "Custom view"
    : FOUNDRY_VIEW_PRESETS[camera.preset].label;

const noPoint = { x: 0, y: 0 };

const useMechanismPreviewModel = (
  project: ProjectState,
  mechanism: MechanismConfig,
  angle: number,
) => {
  const designMechanism = useMemo(
    () => normalizeGearMeshMechanism(mechanism),
    [mechanism],
  );
  const rawPointTraces = useMemo(
    () => generateMechanismPointTraces(designMechanism, 96).traces,
    [designMechanism],
  );
  const fitContext = useMemo(
    () => createMechanismFitContext(designMechanism, 360, 240, 96),
    [designMechanism],
  );
  const selectedSimulation = useMemo(
    () => fitMechanismSimulationWithContext(designMechanism, angle, fitContext),
    [angle, designMechanism, fitContext],
  );
  const pointTraces = useMemo(
    () =>
      rawPointTraces.map((trace) => ({
        ...trace,
        points: trace.points.map(fitContext.map),
      })),
    [fitContext, rawPointTraces],
  );
  const fallbackPreview = useMemo(
    () =>
      fitPointsToBox(generateCurvePoints(designMechanism, 96).points, 360, 240),
    [designMechanism],
  );
  const previewPoints = useMemo(
    () =>
      pointTraces.find((trace) => trace.primary)?.points ??
      pointTraces[0]?.points ??
      fallbackPreview,
    [fallbackPreview, pointTraces],
  );
  const physicalSimulation = useMemo(
    () => ({
      ...selectedSimulation,
      pathPoints: previewPoints,
      pathD: pointsToSvgPath(previewPoints),
    }),
    [previewPoints, selectedSimulation],
  );
  const physicsOverlay = useMemo(
    () =>
      buildFoundryPhysicsOverlay(
        designMechanism,
        physicalSimulation,
        angle,
        project.settings,
        previewPoints,
      ),
    [angle, designMechanism, physicalSimulation, previewPoints, project.settings],
  );

  return {
    designMechanism,
    pointTraces,
    previewPoints,
    physicalSimulation,
    physicsOverlay,
  };
};

export const AssemblyCharacterThreePreview = ({
  project,
  plan,
  step,
  progress,
}: {
  project: ProjectState;
  plan: CharacterAssemblyPlan;
  step: CharacterAssemblyStep;
  progress: number;
}) => {
  const [viewport, setViewport] = useState<CanvasViewport>(assemblyViewport);
  const angle = step.phase === "test-character" ? progress * Math.PI * 2 : 0;
  const animatedParts = useMemo(
    () => animatedPartsForProject(project, project.mechanisms, angle),
    [angle, project],
  );
  const animatedSceneObjects = useMemo(
    () => animatedSceneObjectsForProject(project, project.mechanisms, angle),
    [angle, project],
  );
  const activePins = step.pinIds.length
    ? [...plan.fixedPins, ...plan.freePivots].filter((pin) =>
        step.pinIds.includes(pin.id),
      )
    : [];
  const activePartIds =
    step.phase === "character-parts"
      ? plan.parts.map((part) => part.id)
      : [...new Set(activePins.flatMap((pin) => pin.partIds))];
  const activeJointIds = activePins.map((pin) => pin.jointId);

  return (
    <section
      className="assembly-three-preview assembly-character-three-preview"
      data-testid="assembly-character-three-preview"
      data-assembly-three-mode="character"
      data-assembly-three-phase={step.phase}
      data-assembly-three-progress={Math.round(progress * 100)}
      aria-label="3D character assembly simulation"
    >
      <ThreePuppetPreview
        project={project}
        animatedParts={animatedParts}
        animatedSceneObjects={animatedSceneObjects}
        skeleton={project.skeleton}
        mechanisms={project.mechanisms}
        paths={[]}
        angle={angle}
        viewport={viewport}
        setViewport={setViewport}
        inputMode="always"
        testId="assembly-three-puppet"
        cameraPresets={["front", "iso", "top"]}
        initialLayers={{
          grid: true,
          character: true,
          skeleton: true,
          mechanisms: project.mechanisms.length > 0,
        }}
        assemblyOverlay={{
          phase: step.phase,
          progress,
          activePartIds,
          activeJointIds,
        }}
      />
      <div className="assembly-three-hud">3D build</div>
    </section>
  );
};

export const AssemblyMechanismThreePreview = ({
  project,
  mechanism,
  step,
  progress,
}: {
  project: ProjectState;
  mechanism: MechanismConfig;
  step: AssemblyPlaybackStep;
  progress: number;
}) => {
  const angle = progress * Math.PI * 2;
  const explode = mechanismExplodeForStep(step, progress);
  const [viewport, setViewport] = useState<CanvasViewport>(assemblyViewport);
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
  const {
    designMechanism,
    pointTraces,
    previewPoints,
    physicalSimulation,
    physicsOverlay,
  } = useMechanismPreviewModel(project, mechanism, angle);
  const activeProjectMechanisms = useMemo(
    () =>
      project.mechanisms.filter(
        (projectMechanism) =>
          projectMechanism.visible !== false &&
          projectMechanism.enabled !== false,
      ),
    [project.mechanisms],
  );
  const animatedParts = useMemo(
    () => animatedPartsForProject(project, [mechanism], angle),
    [angle, mechanism, project],
  );
  const animatedSceneObjects = useMemo(
    () => animatedSceneObjectsForProject(project, [mechanism], angle),
    [angle, mechanism, project],
  );

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

  return (
    <section
      className="assembly-three-preview assembly-mechanism-three-preview"
      data-testid="assembly-mechanism-three-preview"
      data-assembly-three-mode="mechanism"
      data-assembly-three-phase={step.phase}
      data-assembly-three-progress={Math.round(progress * 100)}
      data-assembly-three-explode={Math.round(explode * 100)}
      aria-label="3D mechanism assembly simulation"
    >
      <ThreeFoundryPreview
        mechanism={designMechanism}
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
      >
        <div className="assembly-three-hud">Exploded build</div>
        <div
          className="assembly-context-ghost"
          data-testid="assembly-character-context-ghost"
          data-assembly-motion-mechanism-id={mechanism.id}
          data-assembly-rendered-mechanism-ids={activeProjectMechanisms
            .map((projectMechanism) => projectMechanism.id)
            .join(",")}
          aria-hidden="true"
        >
          <ThreePuppetPreview
            project={project}
            animatedParts={animatedParts}
            animatedSceneObjects={animatedSceneObjects}
            skeleton={project.skeleton}
            mechanisms={activeProjectMechanisms}
            paths={[]}
            angle={angle}
            viewport={viewport}
            setViewport={setViewport}
            inputMode="none"
            testId="assembly-three-puppet"
            cameraPresets={["iso"]}
            showToolbar={false}
            initialLayers={{
              grid: false,
              character: true,
              skeleton: true,
              mechanisms: true,
            }}
          />
        </div>
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
