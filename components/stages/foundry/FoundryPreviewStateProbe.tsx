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
} from "./foundryPreviewStacks";

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
  pinLengthZ: number;
  stackZGap: number;
  renderPlan: FabricationRenderPlan;
  renderedLayerZ: number[];
  physicalValidationErrors: string[];
  physicalValidationSummary: string;
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
  pinLengthZ,
  stackZGap,
  renderPlan,
  renderedLayerZ,
  physicalValidationErrors,
  physicalValidationSummary,
}: FoundryPreviewStateProbeProps) => {
  const isGearTrain =
    mechanism.type === "gear" || mechanism.type === "gear_linkage";
  const isPlanetaryGear = mechanism.type === "planetary_gear";

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
      data-layer-character={viewer3DLayerDataValue(undefined)}
      data-layer-skeleton={viewer3DLayerDataValue(undefined)}
      data-layer-paths={viewer3DLayerDataValue(showPathPreview)}
      data-layer-forces={viewer3DLayerDataValue(showForces)}
      data-layer-velocity={viewer3DLayerDataValue(showVelocity)}
      data-layer-trail={viewer3DLayerDataValue(showTrail)}
      data-camera-yaw={camera.yaw.toFixed(1)}
      data-camera-pitch={camera.pitch.toFixed(1)}
      data-camera-zoom={camera.zoom.toFixed(3)}
      data-camera-pan-x={(camera.pan?.x ?? 0).toFixed(3)}
      data-camera-pan-y={(camera.pan?.y ?? 0).toFixed(3)}
      data-camera-distance={foundryCameraDistance(camera).toFixed(3)}
      data-rig-opacity={rigOpacity.toFixed(2)}
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
      data-three-part-count={inv.parts}
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
          ? "board-side>S10-spacer>gear>fastener-head"
          : isPlanetaryGear
            ? "sun/carrier and planet/carrier pins use local S10 spacers"
            : "not-gear-train"
      }
      data-three-gear-board-side-spacer-z={gearBoardSpacerSummary}
      data-three-gear-axle-z-order={gearAxleZOrderSummary}
      data-three-gear-linkage-spacing-contract={gearLinkageSpacingContract}
      data-three-gear-linkage-crank-stack-contract={
        mechanism.type === "gear_linkage"
          ? "B-gear-hole>S10>drive-link;C-gear-hole>S10>S10>output-link;R-drive-link>S10>output-link"
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
      data-three-spacer-render-contract="recipe-pin-spacer-sites"
      data-three-spacer-pin-ids={spacerPinIdSummary}
      data-three-board-pivot-spacer-mode={
        mechanism.type === "4bar" ? "single-board-side-spacer" : "not-board-pivot"
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
          ? "fastener-end>S10-board-side>linkage>fastener-head"
          : "template-specific"
      }
      data-three-physical-pin-count={assemblyPinPoints.length}
      data-three-physical-pin-contract={assemblyPinContract}
      data-three-pin-stack-policy="per-pin-adjacent-stack"
      data-three-pin-stack-z-sources={
        mechanism.type === "4bar"
          ? "fourbar-board-pivots-include-board-side-spacer"
          : isGearTrain
            ? "gear-axles-include-board-side-spacer"
            : isPlanetaryGear
              ? "planetary-carrier-pins-include-local-spacers"
              : "moving-layers-only"
      }
      data-three-pin-stack-layer-indexes={pinStackLayerSummary}
      data-three-pin-stack-spans={pinSpanSummary}
      data-three-pin-stack-clearance-contract="local-spacers-fill-adjacent-z-gaps"
      data-three-z-collision-count={zCollisionCount}
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
        mechanism.type === "cam" ? "cam-axle-and-follower-center-only" : "not-cam"
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
      data-three-stack-source="fabricationStackForMechanism"
      data-three-stack-mode="assembled-spacer-separated"
      data-three-exploded={explode > 0 ? "true" : "false"}
      data-three-explode-percent={Math.round(explode * 100)}
      data-three-pin-z-min={pinBottomZ.toFixed(2)}
      data-three-pin-z-max={pinTopZ.toFixed(2)}
      data-three-pin-length={pinLengthZ.toFixed(2)}
      data-three-spacer-z-gap={stackZGap.toFixed(2)}
      data-three-base-layer={renderPlan.base.label}
      data-three-stack-order={renderPlan.stackSummary}
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
        .map((item) =>
          foundryLayerGeometryContract(
            mechanism.type,
            item.label,
            item.renderKind,
          ),
        )
        .join(" → ")}
      data-three-stack-validation-errors={renderPlan.validationErrors.length}
      data-three-physical-validation-errors={physicalValidationErrors.length}
      data-three-physical-validation-summary={physicalValidationSummary}
      data-three-preview-renderable={
        renderPlan.validationErrors.length || physicalValidationErrors.length
          ? "blocked"
          : "ready"
      }
      className="foundry-three-scene-state"
    />
  );
};
