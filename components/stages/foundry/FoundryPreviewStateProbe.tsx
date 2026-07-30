import type { Ref } from "react";
import type { MechanismConfig, Point } from "../../../types";
import {
  gearTrainPitchCenterDistance,
  gearTrainResolvedCenterDistance,
  normalizeCamProfileSamples,
} from "../../../utils/kinematics";
import {
  FABRICATION_SPACER_SPEC,
  planetaryGearConventionForMechanism,
  type FabricationRenderPlan,
} from "../../../utils/fabrication";
import {
  HIGH_THROUGHPUT_SCENE_POLICY,
  PHYSICS_KERNEL_ENGINE,
  PHYSICS_RENDER_STACK,
  PHYSICS_UPDATE_POLICY,
} from "../../../utils/physicsKernel";
import { WEBGL_PIXEL_RATIO_CAP } from "../../../utils/viewport";
import {
  VIEWER3D_CONTRACT_VERSION,
  viewer3DLayerDataValue,
  type Viewer3DContract,
} from "../../../utils/viewer3d";
import {
  FOUNDRY_ANIMATION_COMMIT_MS,
  foundryCameraDistance,
  type FoundryCamera,
} from "../../../utils/foundryCamera";
import {
  foundryLayerGeometryContract,
  type FoundryPinStackPoint,
} from "../../../utils/mechanismPreviewStacks";
import type { FoundryAssemblySceneFrame } from "./foundryAssemblySceneOverlay";

type FoundryRenderedInventory = {
  parts: number;
  holes: number;
  slots: number;
  gears: number;
  racks: number;
  cams: number;
  followers: number;
  endStops: number;
};

type FoundryPathTrace = {
  id: string;
  label: string;
  points: Point[];
  primary: boolean;
};

type FoundryPreviewStateProbeProps = {
  stateRef: Ref<HTMLDivElement>;
  viewerContract: Viewer3DContract;
  selectedSceneObjectId: string;
  camera: FoundryCamera;
  showGrid: boolean;
  showPathPreview: boolean;
  showForces: boolean;
  showVelocity: boolean;
  showTrail: boolean;
  rigOpacity: number;
  physicsKernelRuntime: "loading" | "ready" | "unavailable";
  physicsKernelVersion: string;
  physicsKernelError: string;
  mechanism: MechanismConfig;
  inv: FoundryRenderedInventory;
  gearRadii: number[];
  gearCenters: Point[];
  planetaryConvention: ReturnType<
    typeof planetaryGearConventionForMechanism
  > | null;
  gearOutputRatioForDisplay: number;
  gearCenterSource: string;
  gearCouplingMode: string;
  gearCenterSummary: string;
  gearAxleCenterSummary: string;
  gearCenterMaxError: number;
  gearEndpointMode: string;
  gearUsesMeshPhases: boolean;
  gearMeshPhaseSummary: string;
  gearPlaneMode: string;
  activeGearPlaneZ: number | undefined;
  gearBoardSpacerSummary: string;
  gearAxleZOrderSummary: string;
  gearLinkageSpacingContract: string;
  gearLinkagePinZOrderSummary: string;
  spacerLayerCount: number;
  spacerRenderCount: number;
  spacerPinIdSummary: string;
  boardPivotPinStacks: FoundryPinStackPoint[];
  boardPivotSpacerSummary: string;
  assemblyPinPoints: Point[];
  assemblyPinContract: string;
  pinStackLayerSummary: string;
  pinSpanSummary: string;
  zCollisionCount: number;
  supportContactErrorCount: number;
  spacerSupportErrorCount: number;
  supportBlockerCount: number;
  camContactErrorForData: number;
  simulationScale: number;
  pinionRotation: number;
  visiblePathTraces: FoundryPathTrace[];
  primaryPathId: string;
  pathLayerZ: number;
  physicsRule: string;
  velocityMagnitude: number;
  forceMagnitude: number;
  frictionCoefficient: number;
  frictionMagnitude: number;
  constraintError: number;
  cameraLabel: string;
  dynamicBuildCount: number;
  geometryCacheSize: number;
  materialCacheSize: number;
  explode: number;
  pinBottomZ: number;
  pinTopZ: number;
  automataBaseZ: number;
  automataSurfaceZ: number;
  pinLengthZ: number;
  stackZGap: number;
  visibleSceneObjectCount: number;
  visiblePartCount: number;
  visibleSceneObjectIds: string[];
  renderPlan: FabricationRenderPlan;
  renderedLayerZ: number[];
  physicalValidationErrors: string[];
  physicalValidationSummary: string;
  assemblySceneFrame?: FoundryAssemblySceneFrame;
  assemblyLayerFocusSummary: string;
  assemblyVisibleLayerCount: number;
  connectionSelectionCoordinates: Record<string, Point>;
  connectionExportSignature: string;
  selectedConnection?: { role: string; kind: string; holeIndex: number };
};

export const FoundryPreviewStateProbe = ({
  stateRef,
  viewerContract,
  camera,
  showGrid,
  showPathPreview,
  showForces,
  showVelocity,
  showTrail,
  rigOpacity,
  physicsKernelRuntime,
  physicsKernelVersion,
  physicsKernelError,
  mechanism,
  inv,
  gearRadii,
  gearCenters,
  planetaryConvention,
  gearOutputRatioForDisplay,
  gearCenterSource,
  gearCouplingMode,
  gearCenterSummary,
  gearAxleCenterSummary,
  gearCenterMaxError,
  gearEndpointMode,
  gearUsesMeshPhases,
  gearMeshPhaseSummary,
  gearPlaneMode,
  activeGearPlaneZ,
  gearBoardSpacerSummary,
  gearAxleZOrderSummary,
  gearLinkageSpacingContract,
  gearLinkagePinZOrderSummary,
  spacerLayerCount,
  spacerRenderCount,
  spacerPinIdSummary,
  boardPivotPinStacks,
  boardPivotSpacerSummary,
  assemblyPinPoints,
  assemblyPinContract,
  pinStackLayerSummary,
  pinSpanSummary,
  zCollisionCount,
  supportContactErrorCount,
  spacerSupportErrorCount,
  supportBlockerCount,
  camContactErrorForData,
  simulationScale,
  pinionRotation,
  visiblePathTraces,
  primaryPathId,
  pathLayerZ,
  physicsRule,
  velocityMagnitude,
  forceMagnitude,
  frictionCoefficient,
  frictionMagnitude,
  constraintError,
  cameraLabel,
  dynamicBuildCount,
  geometryCacheSize,
  materialCacheSize,
  explode,
  pinBottomZ,
  pinTopZ,
  automataBaseZ,
  automataSurfaceZ,
  pinLengthZ,
  stackZGap,
  visibleSceneObjectCount,
  visiblePartCount,
  visibleSceneObjectIds,
  selectedSceneObjectId,
  renderPlan,
  renderedLayerZ,
  physicalValidationErrors,
  physicalValidationSummary,
  assemblySceneFrame,
  assemblyLayerFocusSummary,
  assemblyVisibleLayerCount,
  connectionSelectionCoordinates,
  connectionExportSignature,
  selectedConnection,
}: FoundryPreviewStateProbeProps) => {
  const assemblyBoardMarkerCount =
    assemblySceneFrame?.kind === "character"
      ? (assemblySceneFrame.activeScenePoints?.length ?? 0)
      : (assemblySceneFrame?.activeBoardCoords.length ?? 0);
  const assemblyFloatingMarkerCount =
    assemblySceneFrame?.kind === "character"
      ? (assemblySceneFrame.floatingReferencePoints?.length ?? 0)
      : (assemblySceneFrame?.floatingReferenceCoords.length ?? 0);
  const isGearTrain =
    mechanism.type === "gear" || mechanism.type === "gear_linkage";
  const isPlanetaryGear = mechanism.type === "planetary_gear";
  const primaryPath = visiblePathTraces.find((trace) => trace.primary);
  const layerById = new Map(renderPlan.layers.map((layer) => [layer.layerId, layer]));
  const supportNodeById = new Map(renderPlan.supportNodes.map((node) => [node.id, node]));
  const pinSpanById = new Map(renderPlan.pinSpans.map((span) => [span.id, span]));
  const pathKinds = (path: FabricationRenderPlan["supportPaths"][number]) => path.orderedLayerIds
    .map((layerId) => layerById.get(layerId)?.renderKind)
    .filter((kind): kind is NonNullable<typeof kind> => Boolean(kind));
  const supportPathKindSummary = renderPlan.supportPaths
    .map((path) => `${path.sourceIds.join("+") || path.rootNodeId}:${pathKinds(path).join(">")}`)
    .join(";");
  const supportPathSourceSummary = renderPlan.supportPaths
    .map((path) => `${path.id}:${path.sourceIds.join("+")}`)
    .join(";");
  const supportPathLayerSummary = renderPlan.supportPaths
    .map((path) => `${path.id}:${path.orderedLayerIds.join(">")}`)
    .join(";");
  const supportPathPinSpanSummary = renderPlan.supportPaths
    .map((path) => `${path.id}:${path.pinSpanId ?? "none"}`)
    .join(";");
  const planetaryOwnerPaths = renderPlan.supportPaths.filter((path) =>
    path.sourceIds.some((id) => id === "sun-carrier-pivot-pin" || id === "planet-carrier-pin"),
  );
  const planetaryOwnerPathKinds = planetaryOwnerPaths
    .map((path) => `${path.sourceIds[0]}:${pathKinds(path).join(">")}`)
    .join(";");
  const planetaryOwnerPathFaces = planetaryOwnerPaths
    .map((path) => `${path.sourceIds[0]}:${path.orderedLayerIds.map((layerId) => {
      const layer = layerById.get(layerId);
      return layer ? `${layer.backFaceMm}-${layer.frontFaceMm}` : "missing";
    }).join(">")}`)
    .join(";");
  const planetaryOwnerPathRoots = planetaryOwnerPaths
    .map((path) => {
      const span = path.pinSpanId ? pinSpanById.get(path.pinSpanId) : undefined;
      const rootedToBoard = span?.supportNodeIds.some((nodeId) => supportNodeById.get(nodeId)?.kind === "board") ?? false;
      return `${path.sourceIds[0]}:${rootedToBoard ? "board" : "free"}`;
    })
    .join(";");
  const primaryPathBounds = primaryPath?.points.length
    ? (() => {
        const xs = primaryPath.points.map((point) => point.x);
        const ys = primaryPath.points.map((point) => point.y);
        return [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ]
          .map((value) => value.toFixed(2))
          .join(",");
      })()
    : "";

  return (
    <div
      ref={stateRef}
      data-testid="foundry-camera-rig"
      data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
      data-viewer-contract-state={JSON.stringify(viewerContract)}
      data-viewer-tab={viewerContract.tab}
      data-camera-preset={camera.preset}
      data-layer-grid={viewer3DLayerDataValue(showGrid)}
      data-layer-mechanisms={viewer3DLayerDataValue(true)}
      data-layer-character={viewer3DLayerDataValue(viewerContract.layers.character)}
      data-layer-skeleton={viewer3DLayerDataValue(viewerContract.layers.skeleton)}
      data-layer-paths={viewer3DLayerDataValue(showPathPreview)}
      data-layer-forces={viewer3DLayerDataValue(showForces)}
      data-layer-velocity={viewer3DLayerDataValue(showVelocity)}
      data-layer-trail={viewer3DLayerDataValue(showTrail)}
      data-scene-object-count={visibleSceneObjectCount}
      data-selected-scene-object-id={selectedSceneObjectId}
      data-camera-yaw={camera.yaw.toFixed(1)}
      data-camera-pitch={camera.pitch.toFixed(1)}
      data-camera-zoom={camera.zoom.toFixed(3)}
      data-camera-pan-x={(camera.pan?.x ?? 0).toFixed(3)}
      data-camera-pan-y={(camera.pan?.y ?? 0).toFixed(3)}
      data-camera-distance={foundryCameraDistance(camera).toFixed(3)}
      data-rig-opacity={rigOpacity.toFixed(2)}
      data-three-connection-selection-coordinates={JSON.stringify(connectionSelectionCoordinates)}
      data-three-fabrication-export-signature={connectionExportSignature}
      data-three-selected-connection-role={selectedConnection?.role ?? ""}
      data-three-selected-connection-kind={selectedConnection?.kind ?? ""}
      data-three-selected-connection-hole-index={selectedConnection ? String(selectedConnection.holeIndex) : ""}
      data-three-renderer="webgl"
      data-three-engine-stack={PHYSICS_RENDER_STACK}
      data-physics-kernel={PHYSICS_KERNEL_ENGINE}
      data-physics-update-policy={PHYSICS_UPDATE_POLICY}
      data-high-throughput-scene-policy={HIGH_THROUGHPUT_SCENE_POLICY}
      data-physics-contact-mode="kinematic-estimate-rapier-contact-probe"
      data-physics-kernel-runtime={physicsKernelRuntime}
      data-physics-kernel-version={physicsKernelVersion}
      data-physics-kernel-error={physicsKernelError}
      data-physics-authority="motionsmith-kinematics"
      data-mechanism-type={mechanism.type}
      data-three-part-count={visiblePartCount}
      data-three-hole-count={inv.holes}
      data-three-slot-count={inv.slots}
      data-three-gear-count={inv.gears}
      data-three-rack-count={inv.racks}
      data-three-cam-count={inv.cams}
      data-three-follower-count={inv.followers}
      data-three-end-stop-count={inv.endStops}
      data-three-gear-radii={gearRadii
        .map((radius) => radius.toFixed(2))
        .join(",")}
      data-cam-profile={
        mechanism.type === "cam"
          ? normalizeCamProfileSamples(mechanism.camProfileSamples)
              .map((value) => value.toFixed(2))
              .join(",")
          : ""
      }
      data-three-gear-pitch-center={(isGearTrain
        ? gearTrainResolvedCenterDistance(mechanism)
        : mechanism.type === "planetary_gear"
          ? planetaryGearConventionForMechanism(mechanism).carrierPitchRadius
          : mechanism.groundLength
      ).toFixed(2)}
      data-three-gear-pitch-sum={(isGearTrain
        ? gearTrainPitchCenterDistance(mechanism)
        : mechanism.type === "planetary_gear"
          ? planetaryGearConventionForMechanism(mechanism).ringPitchRadius
          : mechanism.crankLength + mechanism.rockerLength
      ).toFixed(2)}
      data-three-gear-output-ratio={gearOutputRatioForDisplay.toFixed(3)}
      data-three-planet-count={planetaryConvention?.planetCount ?? 0}
      data-three-planetary-syntax={planetaryConvention?.syntax ?? ""}
      data-three-planetary-fixed={planetaryConvention?.fixedMember ?? ""}
      data-three-planetary-input={planetaryConvention?.inputMember ?? ""}
      data-three-planetary-output={planetaryConvention?.outputMember ?? ""}
      data-three-planetary-ring-radius={
        planetaryConvention?.ringPitchRadius.toFixed(2) ?? ""
      }
      data-three-planetary-carrier-radius={
        planetaryConvention?.carrierPitchRadius.toFixed(2) ?? ""
      }
      data-three-planetary-center-source={
        isPlanetaryGear ? "simulation-state-carrier-center" : "not-planetary"
      }
      data-three-gear-train-linkage-mode={
        mechanism.type === "gear"
          ? "gear-only-train"
          : mechanism.type === "gear_linkage"
            ? "two-gear-two-link-coupler"
            : "template-specific"
      }
      data-three-gear-linkage-mode={
        mechanism.type === "gear_linkage" ? "two-gear-two-link-coupler" : "none"
      }
      data-three-gear-center-source={gearCenterSource}
      data-three-gear-coupling-mode={gearCouplingMode}
      data-three-gear-center-count={gearCenters.length}
      data-three-gear-centers={gearCenterSummary}
      data-three-gear-axle-centers={gearAxleCenterSummary}
      data-three-gear-axle-center-contract={
        isGearTrain ? "pin-stacks-use-rendered-gear-centers" : "not-gear-train"
      }
      data-three-gear-center-max-error={gearCenterMaxError.toFixed(3)}
      data-three-gear-train-endpoint-mode={gearEndpointMode}
      data-three-gear-mesh-phase-contract={
        isGearTrain
          ? gearUsesMeshPhases
            ? "alternating-three-quarter-tooth-gap-phase"
            : "dual-driven-endpoints-no-mesh-phase"
          : "not-gear-train"
      }
      data-three-gear-mesh-phases={gearMeshPhaseSummary}
      data-three-gear-plane-mode={gearPlaneMode}
      data-three-gear-plane-z={
        typeof activeGearPlaneZ === "number" ? activeGearPlaneZ.toFixed(2) : ""
      }
      data-three-gear-axle-stack-contract={
        isGearTrain
          ? "compiled-support-path-order"
          : isPlanetaryGear
            ? "compiled-owner-support-path-order"
            : "not-gear-train"
      }
      data-three-gear-board-side-spacer-z={gearBoardSpacerSummary}
      data-three-gear-axle-z-order={gearAxleZOrderSummary}
      data-three-gear-linkage-spacing-contract={gearLinkageSpacingContract}
      data-three-gear-linkage-crank-stack-contract={
        mechanism.type === "gear_linkage"
          ? "compiled-support-paths"
          : "not-gear-linkage"
      }
      data-three-gear-linkage-bracket-anchor={
        mechanism.type === "gear_linkage" ? "no-output-bracket" : "not-gear-linkage"
      }
      data-three-gear-linkage-pin-z-order={gearLinkagePinZOrderSummary}
      data-three-linkage-pin-radius={
        mechanism.type === "gear_linkage" ? mechanism.couplerPointDist.toFixed(2) : ""
      }
      data-three-spacer-key={FABRICATION_SPACER_SPEC.key}
      data-three-spacer-label={FABRICATION_SPACER_SPEC.label}
      data-three-spacer-mm={`${FABRICATION_SPACER_SPEC.outerDiameterMm}x${FABRICATION_SPACER_SPEC.innerDiameterMm}`}
      data-three-spacer-layers={spacerLayerCount}
      data-three-spacer-render-count={spacerRenderCount}
      data-three-spacer-render-contract="compiled-support-path-membership"
      data-three-spacer-pin-ids={spacerPinIdSummary}
      data-three-board-pivot-spacer-mode={
        mechanism.type === "4bar" ? "compiled-path-spacer" : "not-board-pivot"
      }
      data-three-board-pivot-spacer-ids={boardPivotPinStacks
        .map((pin) => pin.id)
        .join(",")}
      data-three-board-pivot-spacer-z={boardPivotSpacerSummary}
      data-three-fourbar-ground-link-plane={
        mechanism.type === "4bar" ? "fabrication-stack-separated" : "not-4bar"
      }
      data-three-board-pivot-fastener-contract={
        mechanism.type === "4bar"
          ? "board>linkage>spacer>retainer"
          : "template-specific"
      }
      data-three-physical-pin-count={assemblyPinPoints.length}
      data-three-physical-pin-contract={assemblyPinContract}
      data-three-pin-stack-policy="compiler-support-paths"
      data-three-pin-stack-z-sources="compiled-support-paths-and-pin-spans"
      data-three-pin-stack-layer-indexes={pinStackLayerSummary}
      data-three-pin-stack-spans={pinSpanSummary}
      data-three-pin-stack-clearance-contract="face-adjacent-compiled-support"
      data-three-z-collision-count={zCollisionCount}
      data-three-support-contact-error-count={supportContactErrorCount}
      data-three-support-spacer-error-count={spacerSupportErrorCount}
      data-three-support-blocker-count={supportBlockerCount}
      data-three-support-path-kinds={supportPathKindSummary}
      data-three-support-path-ids={renderPlan.supportPaths.map((path) => path.id).join(";")}
      data-three-support-path-sources={supportPathSourceSummary}
      data-three-support-path-layer-ids={supportPathLayerSummary}
      data-three-support-path-pin-spans={supportPathPinSpanSummary}
      data-three-planetary-owner-path-kinds={planetaryOwnerPathKinds}
      data-three-planetary-owner-path-faces={planetaryOwnerPathFaces}
      data-three-planetary-owner-path-roots={planetaryOwnerPathRoots}
      data-three-ground-span-mode={
        mechanism.type === "4bar" ? "board-reference" : "rendered-reference"
      }
      data-three-cam-guide-mode={
        mechanism.type === "cam" ? "fixed-board-guide" : "not-cam"
      }
      data-three-cam-contact-mode={
        mechanism.type === "cam" ? "sampled-profile-on-guide-axis" : "not-cam"
      }
      data-three-cam-contact-error={
        mechanism.type === "cam" ? camContactErrorForData.toFixed(3) : ""
      }
      data-three-cam-follower-offset={
        mechanism.type === "cam"
          ? (Math.max(0, mechanism.sliderOffset) * simulationScale).toFixed(3)
          : ""
      }
      data-three-cam-pin-contract={
        mechanism.type === "cam" ? "compiled-cam-axle-support-path" : "not-cam"
      }
      data-three-cam-rotation-deg={
        mechanism.type === "cam" ? pinionRotation.toFixed(2) : ""
      }
      data-three-ring-mount-mode={
        mechanism.type === "planetary_gear" ? "fixed-ring-holes" : "not-planetary"
      }
      data-three-path-source="moving-joints"
      data-three-path-trace-count={visiblePathTraces.length}
      data-three-path-trace-ids={visiblePathTraces
        .map((trace) => trace.id)
        .join(",")}
      data-three-primary-path-id={primaryPathId}
      data-three-primary-path-bounds={primaryPathBounds}
      data-three-path-z={pathLayerZ.toFixed(2)}
      data-path-preview={showPathPreview ? "shown" : "hidden"}
      data-trail={showTrail ? "shown" : "hidden"}
      data-forces={showForces ? "shown" : "hidden"}
      data-velocity={showVelocity ? "shown" : "hidden"}
      data-pinion-rotation-deg={pinionRotation.toFixed(2)}
      data-physics-rule={physicsRule}
      data-velocity-magnitude={velocityMagnitude.toFixed(3)}
      data-force-magnitude={forceMagnitude.toFixed(3)}
      data-friction-coefficient={frictionCoefficient.toFixed(3)}
      data-friction-magnitude={frictionMagnitude.toFixed(3)}
      data-constraint-error={constraintError.toFixed(3)}
      data-camera-label={cameraLabel}
      data-anchor-pick-mode="three-raycaster-plane"
      data-three-hole-mode="extruded-cut-through"
      data-three-render-loop="camera-only-orbit"
      data-three-pixel-ratio-cap={WEBGL_PIXEL_RATIO_CAP.toFixed(1)}
      data-three-animation-commit-ms={FOUNDRY_ANIMATION_COMMIT_MS.toFixed(1)}
      data-three-dynamic-build-count={dynamicBuildCount}
      data-three-geometry-cache-size={geometryCacheSize}
      data-three-material-cache-size={materialCacheSize}
      data-three-static-grid-mode="persistent-scene-layer"
      data-three-fit-bounds="phase-invariant-sweep"
      data-three-inventory-source="rendered-template"
      data-three-stack-source="MechanismSceneContract"
      data-three-stack-mode="assembled-spacer-separated"
      data-three-exploded={explode > 0 ? "true" : "false"}
      data-three-explode-percent={Math.round(explode * 100)}
      data-three-pin-z-min={pinBottomZ.toFixed(2)}
      data-three-pin-z-max={pinTopZ.toFixed(2)}
      data-three-automata-base-z={automataBaseZ.toFixed(2)}
      data-three-automata-surface-z={automataSurfaceZ.toFixed(2)}
      data-three-automata-surface-clearance={(automataSurfaceZ - pinTopZ).toFixed(2)}
      data-three-pin-length={pinLengthZ.toFixed(2)}
      data-three-spacer-z-gap={stackZGap.toFixed(2)}
      data-three-base-layer={renderPlan.base.label}
      data-three-stack-order={renderPlan.stackSummary}
      data-three-scene-object-count={visibleSceneObjectCount}
      data-three-scene-prop-count={visibleSceneObjectCount}
      data-three-scene-prop-ids={visibleSceneObjectIds.join(",")}
      data-three-automata-object-count={visibleSceneObjectCount}
      data-three-stack-occurrences={renderPlan.occurrenceSummary}
      data-three-stack-roles={renderPlan.roleSummary}
      data-three-stack-colors={renderPlan.colorSummary}
      data-three-stack-z={renderPlan.zSummary}
      data-three-stack-layer-count={renderPlan.layers.length}
      data-three-rendered-layer-labels={renderPlan.layers
        .map((item) => item.label)
        .join(" → ")}
      data-three-rendered-layer-roles={renderPlan.layers
        .map((item) => item.renderKind)
        .join(">")}
      data-three-rendered-layer-colors={renderPlan.layers
        .map((item) => item.color)
        .join(",")}
      data-three-rendered-layer-z={renderedLayerZ
        .map((z) => z.toFixed(2))
        .join(",")}
      data-three-geometry-contract={renderPlan.layers
        .map((item) => foundryLayerGeometryContract(item))
        .join(" → ")}
      data-three-stack-validation-errors={renderPlan.validationErrors.length}
      data-three-physical-validation-errors={physicalValidationErrors.length}
      data-three-physical-validation-summary={physicalValidationSummary}
      data-three-preview-renderable={
        supportBlockerCount || physicalValidationErrors.length
          ? "blocked"
          : "ready"
      }
      data-three-assembly-scene={
        assemblySceneFrame ? "contract-driven" : "none"
      }
      data-three-assembly-frame-version={assemblySceneFrame?.version ?? ""}
      data-three-assembly-phase={assemblySceneFrame?.phase ?? ""}
      data-three-assembly-motion-kind={assemblySceneFrame?.motion ?? ""}
      data-three-assembly-board-mode={assemblySceneFrame?.boardMode ?? ""}
      data-three-assembly-active-board-coords={
        assemblySceneFrame?.activeBoardCoords.join(",") ?? ""
      }
      data-three-assembly-floating-reference-coords={
        assemblySceneFrame?.floatingReferenceCoords.join(",") ?? ""
      }
      data-three-assembly-visible-part-count={
        assemblySceneFrame?.visibleParts.length ?? 0
      }
      data-three-assembly-active-part-ids={
        assemblySceneFrame?.activePartIds.join(",") ?? ""
      }
      data-three-assembly-rendered-layer-focus={assemblyLayerFocusSummary}
      data-three-assembly-visible-layer-count={assemblyVisibleLayerCount}
      data-three-assembly-rendered-board-marker-count={
        assemblyBoardMarkerCount
      }
      data-three-assembly-rendered-floating-marker-count={
        assemblyFloatingMarkerCount
      }
      className="foundry-three-scene-state"
    />
  );
};
