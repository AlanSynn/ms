import React, { useMemo, useRef, useState } from "react";
import { ThreePuppetPreview } from "../../ThreePuppetPreview";
import { ThreeFoundryPreview } from "../foundry/ThreeFoundryPreview";
import type { MechanismConfig, Point, ProjectState } from "../../../types";
import { buildFoundryPhysicsOverlay } from "../../../utils/physicsSession";
import { animatedPartsForProject } from "../../../utils/motion";
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
import { uid } from "../../../utils/project";

type DesignFoundryPreviewProps = {
  project: ProjectState;
  mechanism?: MechanismConfig;
  angle: number;
  showTrace: boolean;
};

export const DesignFoundryPreview = ({
  project,
  mechanism,
  angle,
  showTrace,
}: DesignFoundryPreviewProps) => {
  const [camera, setCamera] = useState<FoundryCamera>({
    ...FOUNDRY_VIEW_PRESETS.iso,
    preset: "iso",
    pan: { x: 0, y: 0 },
  });
  const [projectionSize, setProjectionSize] =
    useState<FoundryOverlaySize>(FOUNDRY_OVERLAY_SIZE);
  const [showGrid, setShowGrid] = useState(true);
  const [showPathPreview, setShowPathPreview] = useState(true);
  const [showForces, setShowForces] = useState(true);
  const [showVelocity, setShowVelocity] = useState(true);
  const [explode, setExplode] = useState(0);
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

  const designMechanism = useMemo(
    () => (mechanism ? normalizeGearMeshMechanism(mechanism) : undefined),
    [mechanism],
  );
  const rawPointTraces = useMemo(
    () =>
      designMechanism
        ? generateMechanismPointTraces(designMechanism, 96).traces
        : [],
    [designMechanism],
  );
  const fitContext = useMemo(
    () =>
      designMechanism
        ? createMechanismFitContext(designMechanism, 360, 240, 96)
        : undefined,
    [designMechanism],
  );
  const selectedSimulation = useMemo(
    () =>
      designMechanism && fitContext
        ? fitMechanismSimulationWithContext(designMechanism, angle, fitContext)
        : undefined,
    [angle, designMechanism, fitContext],
  );
  const pointTraces = useMemo(
    () =>
      fitContext
        ? rawPointTraces.map((trace) => ({
            ...trace,
            points: trace.points.map(fitContext.map),
          }))
        : [],
    [fitContext, rawPointTraces],
  );
  const fallbackPreview = useMemo(
    () =>
      designMechanism
        ? fitPointsToBox(
            generateCurvePoints(designMechanism, 96).points,
            360,
            240,
          )
        : [],
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
    () =>
      selectedSimulation
        ? {
            ...selectedSimulation,
            pathPoints: previewPoints,
            pathD: pointsToSvgPath(previewPoints),
          }
        : undefined,
    [previewPoints, selectedSimulation],
  );
  const physicsOverlay = useMemo(
    () =>
      designMechanism && physicalSimulation
        ? buildFoundryPhysicsOverlay(
            designMechanism,
            physicalSimulation,
            angle,
            project.settings,
            previewPoints,
          )
        : undefined,
    [
      angle,
      designMechanism,
      physicalSimulation,
      previewPoints,
      project.settings,
    ],
  );
  const designContextPaths = useMemo(() => {
    const targetPath = designMechanism?.targetPathId
      ? project.paths[designMechanism.targetPathId]
      : undefined;
    const selectedPath = project.selectedPathId
      ? project.paths[project.selectedPathId]
      : undefined;
    const firstVisiblePath = Object.values(project.paths).find(
      (path) => path.visible !== false,
    );
    const path = targetPath ?? selectedPath ?? firstVisiblePath;
    return path ? [path] : [];
  }, [designMechanism?.targetPathId, project.paths, project.selectedPathId]);
  const designContextAnimatedParts = useMemo(
    () =>
      designMechanism
        ? animatedPartsForProject(project, [designMechanism], angle)
        : {},
    [angle, designMechanism, project],
  );
  const designContextPathId = designContextPaths[0]?.id;

  const updateProjectionSize = (size: FoundryOverlaySize) =>
    setProjectionSize((prev) =>
      Math.abs(prev.width - size.width) < 1 &&
      Math.abs(prev.height - size.height) < 1
        ? prev
        : size,
    );
  const setCameraPreset = (preset: Exclude<FoundryViewPreset, "custom">) =>
    setCamera({ ...FOUNDRY_VIEW_PRESETS[preset], preset, pan: { x: 0, y: 0 } });
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const mode = event.altKey
      ? "zoom"
      : event.shiftKey || event.button === 1 || event.button === 2
        ? "pan"
        : "orbit";
    orbitStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: camera.yaw,
      pitch: camera.pitch,
      zoom: camera.zoom,
      pan: camera.pan ?? { x: 0, y: 0 },
      mode,
    };
    setIsOrbiting(mode === "orbit");
    setIsZooming(mode === "zoom");
    setIsPanning(mode === "pan");
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = orbitStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (start.mode === "zoom") {
      setCamera({
        yaw: start.yaw,
        pitch: start.pitch,
        zoom: clampFoundryZoom(start.zoom + (start.y - event.clientY) * 0.006),
        preset: "custom",
        pan: start.pan,
      });
      return;
    }
    if (start.mode === "pan") {
      const scale = 0.018 / Math.max(0.45, start.zoom);
      setCamera({
        yaw: start.yaw,
        pitch: start.pitch,
        zoom: start.zoom,
        preset: "custom",
        pan: {
          x: start.pan.x - (event.clientX - start.x) * scale,
          y: start.pan.y + (event.clientY - start.y) * scale,
        },
      });
      return;
    }
    setCamera({
      yaw: start.yaw + (event.clientX - start.x) * 0.45,
      pitch: clampFoundryPitch(start.pitch - (event.clientY - start.y) * 0.45),
      zoom: start.zoom,
      preset: "custom",
      pan: start.pan,
    });
  };
  const finishPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (orbitStartRef.current?.pointerId !== event.pointerId) return;
    orbitStartRef.current = null;
    setIsOrbiting(false);
    setIsZooming(false);
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCamera((prev) => ({
      ...prev,
      zoom: clampFoundryZoom(prev.zoom * (event.deltaY < 0 ? 1.1 : 0.9)),
      preset: "custom",
    }));
  };

  if (!designMechanism || !physicalSimulation || !physicsOverlay) {
    return (
      <div
        className="blueprint-empty-state"
        data-testid="design-shared-foundry-empty"
      >
        Add a mechanism.
      </div>
    );
  }

  const cameraLabel =
    camera.preset === "custom"
      ? "Custom view"
      : FOUNDRY_VIEW_PRESETS[camera.preset].label;
  return (
    <section
      className="design-shared-foundry-preview foundry-canvas-shell canvas-workspace"
      data-testid="design-shared-foundry-preview"
      data-renderer-source="ThreeFoundryPreview"
      data-shared-with="foundry-preview"
      data-mechanism-id={designMechanism.id}
      data-mechanism-type={designMechanism.type}
      data-guided-context-mode="character-path-mechanism"
      data-guided-context-part-count={project.partOrder.length}
      data-guided-context-path-count={designContextPaths.length}
      data-guided-context-path-id={designContextPathId ?? ""}
    >
      <div
        className="foundry-camera-hud design-foundry-camera-hud"
        data-testid="design-foundry-camera-controls"
        aria-label="Shared Foundry viewer controls"
      >
        <span
          className="foundry-camera-readout"
          data-testid="design-foundry-camera-readout"
        >
          3D {cameraLabel} · {Math.round(camera.zoom * 100)}%
        </span>
        {(["front", "iso", "side", "top"] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            className={camera.preset === preset ? "active" : ""}
            onClick={() => setCameraPreset(preset)}
          >
            {preset === "iso"
              ? "Isometric"
              : FOUNDRY_VIEW_PRESETS[preset].label}
          </button>
        ))}
        <span className="viewer-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className={showGrid ? "active" : ""}
          onClick={() => setShowGrid((value) => !value)}
        >
          Grid
        </button>
        <button
          type="button"
          className={showPathPreview ? "active" : ""}
          onClick={() => setShowPathPreview((value) => !value)}
        >
          Path
        </button>
        <button
          type="button"
          className={showForces ? "active" : ""}
          onClick={() => setShowForces((value) => !value)}
        >
          Push
        </button>
        <button
          type="button"
          className={showVelocity ? "active" : ""}
          onClick={() => setShowVelocity((value) => !value)}
        >
          Speed
        </button>
      </div>
      <div
        className="foundry-opacity-panel"
        data-testid="design-foundry-stack-controls"
      >
        <div>
          <span>Explode</span>
          <strong>{explode}%</strong>
        </div>
        <input
          aria-label="Design explode stack"
          type="range"
          min="0"
          max="100"
          value={explode}
          onChange={(event) => setExplode(Number(event.target.value))}
        />
      </div>
      <ThreeFoundryPreview
        mechanism={designMechanism}
        simulation={physicalSimulation}
        kit={project.settings.physicalKit}
        camera={camera}
        rigOpacity={0.85}
        color={designMechanism.color}
        pathPoints={previewPoints}
        pathTraces={pointTraces}
        showGrid={showGrid}
        showPathPreview={showPathPreview}
        showTrail={showTrace}
        showForces={showForces}
        showVelocity={showVelocity}
        explode={explode / 100}
        physicsRule={physicsOverlay.rule}
        velocityMagnitude={physicsOverlay.velocityMagnitude}
        forceMagnitude={physicsOverlay.forceMagnitude}
        frictionCoefficient={project.settings.simulationFriction}
        frictionMagnitude={physicsOverlay.frictionMagnitude}
        constraintError={physicsOverlay.constraintError}
        cameraLabel={cameraLabel}
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
        {project.partOrder.length > 0 && (
          <div
            className="design-context-ghost"
            data-testid="design-guided-context-overlay"
            aria-hidden="true"
          >
            <ThreePuppetPreview
              project={project}
              animatedParts={designContextAnimatedParts}
              skeleton={project.skeleton}
              mechanisms={[]}
              paths={designContextPaths}
              selectedPathId={designContextPathId}
              angle={angle}
              inputMode="none"
              testId="design-context-puppet"
              cameraPresets={["iso"]}
              showToolbar={false}
              initialLayers={{
                grid: false,
                character: true,
                skeleton: true,
                mechanisms: false,
              }}
            />
          </div>
        )}
        <svg
          data-testid="design-foundry-preview-overlay"
          viewBox={`0 0 ${projectionSize.width} ${projectionSize.height}`}
          className="foundry-preview-overlay"
          aria-hidden="true"
          data-renderer-source="ThreeFoundryPreview"
        />
      </ThreeFoundryPreview>
    </section>
  );
};
