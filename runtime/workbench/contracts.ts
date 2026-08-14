import type {
  AppStage,
  CanvasViewport,
  ConnectionSelection,
  ConnectionSelectionRole,
  MechanismConfig,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../../types";
import type {
  ProjectionSourceType,
  ToonMaterial,
  ToonSceneProjection,
} from "../../utils/sceneProjection";

export {
  WORKBENCH_CANONICAL_PLANE_Z,
  WORKBENCH_CANONICAL_VIEW,
  fitWorkbenchRenderRect,
  orthographicCameraFrame,
  workbenchClientPointToCanonical,
} from "./orthographicMapping";
export type {
  OrthographicCameraFrame,
  WorkbenchCanonicalPointer,
  WorkbenchClientRect,
  WorkbenchRenderRect,
} from "./orthographicMapping";
import type { WorkbenchClientRect } from "./orthographicMapping";

export const WORKBENCH_CONTRACT_VERSION = 1 as const;
export const WORKBENCH_TRANSFORM_STRIDE = 5 as const;
export const WORKBENCH_INTERACTION_BOUNDS_STRIDE = 4 as const;
export const WORKBENCH_MIN_POSE_SAMPLES = 256 as const;
export const WORKBENCH_MAX_POSE_SAMPLES = 1_024 as const;
export const WORKBENCH_MAX_INTERPOLATION_ERROR_CSS_PX = 0.5 as const;

export const WORKBENCH_SCENE_GROUPS = [
  "board",
  "character",
  "sceneObjects",
  "skeleton",
  "paths",
  "mechanisms",
  "hardware",
  "editHandles",
  "physicsOverlay",
  "assemblyOverlay",
  "blueprintOverlay",
  "selectionOverlay",
] as const;

export type WorkbenchSceneGroupName = (typeof WORKBENCH_SCENE_GROUPS)[number];
export type WorkbenchStage = Exclude<AppStage, "options">;
export type WorkbenchCameraMode = "studio-orthographic" | "inspect-perspective";

export type WorkbenchCameraPlan =
  | Readonly<{
      mode: "studio-orthographic";
      locked: true;
      fit: "contain-canonical";
      planeZ: 0;
      viewport: CanvasViewport;
    }>
  | Readonly<{
      mode: "inspect-perspective";
      paused: true;
      orbitEnabled: true;
      returnViewport: CanvasViewport;
      position: Readonly<{ x: number; y: number; z: number }>;
      target: Readonly<{ x: number; y: number; z: number }>;
      fovDegrees: number;
      near: number;
      far: number;
    }>;

export type WorkbenchInteractionAction =
  | Readonly<{ kind: "select"; sourceType: ProjectionSourceType; sourceId: string }>
  | Readonly<{ kind: "transform"; sourceType: "part" | "scene-object"; sourceId: string }>
  | Readonly<{ kind: "joint"; jointId: string }>
  | Readonly<{ kind: "bend-direction"; jointId: string; direction: -1 | 1 }>
  | Readonly<{ kind: "draw-path"; pathId?: string; partId?: string; sceneObjectId?: string }>
  | Readonly<{ kind: "path-point"; pathId: string; pointIndex: number }>
  | Readonly<{ kind: "viewport-pan" }>
  | Readonly<{ kind: "viewport-zoom" }>
  | Readonly<{ kind: "mechanism-parameter"; mechanismId: string; parameter: keyof MechanismConfig }>
  | Readonly<{ kind: "mechanism-connection"; mechanismId: string; role: ConnectionSelectionRole; selection: ConnectionSelection }>
  | Readonly<{ kind: "mechanism-target"; mechanismId: string }>
  | Readonly<{ kind: "assembly-scrub" }>;

export interface WorkbenchInteractionTarget {
  readonly id: string;
  readonly semanticNodeIndex: number;
  readonly action: WorkbenchInteractionAction;
  readonly label: string;
  readonly keyboard: readonly string[];
}

export interface InteractionPlan {
  readonly version: 1;
  readonly revision: string;
  readonly planeZ: 0;
  readonly boundsStride: 4;
  readonly targets: readonly WorkbenchInteractionTarget[];
  readonly canonicalBounds: Float32Array;
  readonly spatialIndex?: Readonly<{
    cellSizeScene: number;
    cellOffsets: Uint32Array;
    targetIndices: Uint32Array;
  }>;
}

export type WorkbenchInteractionCommit =
  | Readonly<{ kind: "project-action"; action: ProjectAction }>
  | Readonly<{
      kind: "path-points";
      pathId?: string;
      pointsXY: Float32Array;
      source: ProjectMotionPath["source"];
      partId?: string;
      sceneObjectId?: string;
    }>
  | Readonly<{ kind: "mechanism-update"; mechanismId: string; updates: Partial<MechanismConfig> }>
  | Readonly<{ kind: "mechanism-connection"; mechanismId: string; role: ConnectionSelectionRole; selection: ConnectionSelection }>
  | Readonly<{ kind: "viewport"; viewport: CanvasViewport }>
  | Readonly<{ kind: "assembly-phase"; stepIndex: number; progress: number }>;

export interface WorkbenchInteractionSink {
  commit(commit: WorkbenchInteractionCommit): void;
  cancel(sessionId: number): void;
  announce(message: string): void;
}

export interface StageLens {
  readonly version: 1;
  readonly stage: AppStage;
  readonly enabled: boolean;
  readonly camera: WorkbenchCameraPlan | null;
  readonly visibleGroups: readonly WorkbenchSceneGroupName[];
  readonly materialPolicy:
    | "studio-solid"
    | "path-solid"
    | "mechanism-solid"
    | "blueprint-solid"
    | "assembly-solid";
  readonly interactionPolicy: Readonly<{
    mode: "character" | "path" | "foundry" | "design" | "blueprint" | "assembly" | "none";
    allowedActions: readonly WorkbenchInteractionAction["kind"][];
    authoringWrites: "none" | "selection" | "project-commit";
    editsRequirePaused: boolean;
    commitOnPointerUp: true;
    hitSlopCssPx: number;
  }>;
  readonly physics:
    | Readonly<{ mode: "off"; requested: false }>
    | Readonly<{ mode: "explicit-paused"; requested: true; paused: true }>;
}

export interface WorkbenchStaticRenderPlan {
  readonly version: 1;
  readonly semanticNodeCount: number;
  readonly groupNodeIndices: Readonly<Record<WorkbenchSceneGroupName, Uint32Array>>;
}

export interface WorkbenchBindingPlan {
  readonly version: 1;
  readonly transformStride: 5;
  readonly bindingIds: readonly string[];
  readonly semanticNodeIndices: Uint32Array;
  readonly frameTransformOffsets: Uint32Array;
  readonly overlayIds: readonly string[];
  readonly overlayNodeIndices: Uint32Array;
  readonly overlayFrameOffsets: Uint32Array;
}

export interface PreparedPoseTable {
  readonly version: 1;
  readonly generation: number;
  readonly durationMs: number;
  readonly sampleCount: number;
  readonly bindingCount: number;
  readonly transformStride: 5;
  readonly phases: Float32Array;
  readonly transforms: Float32Array;
  readonly overlays: Float32Array;
  readonly overlayFrameLength: number;
  readonly maxInterpolationErrorCssPx: number;
  readonly rotationsUnwrapped: true;
}

export interface WorkbenchResourceManifest {
  readonly version: 1;
  readonly rebuildableFromPreparedScene: true;
  readonly resources: readonly Readonly<{
    key: string;
    kind: "geometry" | "material" | "texture";
    semanticNodeIndices: Uint32Array;
    material?: ToonMaterial;
    sourceKey?: string;
    lifetime: "scene-revision" | "session";
  }>[];
}

export type InspectorModelKey = Readonly<{
  relevantProjectRevision: string;
  mechanismRevision?: string;
  kitRevision: string;
  bindingRevision?: string;
}>;

export type InspectorControl =
  | Readonly<{ kind: "number"; id: string; label: string; value: number; min: number; max: number; step: number; enabled: boolean; mechanismId: string; parameter: keyof MechanismConfig }>
  | Readonly<{ kind: "toggle"; id: string; label: string; value: boolean; enabled: boolean; action: ProjectAction }>
  | Readonly<{ kind: "select"; id: string; label: string; value: string; enabled: boolean; options: readonly Readonly<{ value: string; label: string; disabled?: boolean }>[] }>
  | Readonly<{ kind: "readout"; id: string; label: string; value: string }>;

export interface InspectorModel {
  readonly version: 1;
  readonly stage: WorkbenchStage;
  readonly revision: string;
  readonly key: InspectorModelKey;
  readonly status: "ready" | "blocked";
  readonly issues: readonly Readonly<{
    id: string;
    severity: "info" | "warning" | "error";
    message: string;
    nextAction?: string;
    sourceId?: string;
  }>[];
  readonly sections: readonly Readonly<{
    id: string;
    label: string;
    collapsedByDefault: boolean;
    controls: readonly InspectorControl[];
  }>[];
}

export type InspectorModelByStage = Readonly<
  Partial<Record<WorkbenchStage, InspectorModel>>
>;

export interface PreparedWorkbenchScene {
  readonly version: 1;
  readonly generation: number;
  readonly revision: string;
  readonly sourceProjectId: string;
  readonly sourceProjectVersion: ProjectState["version"];
  readonly relevantProjectRevision: string;
  readonly semanticProjection: ToonSceneProjection;
  readonly staticPlan: WorkbenchStaticRenderPlan;
  readonly bindingPlan: WorkbenchBindingPlan;
  readonly interactionPlan: InteractionPlan;
  readonly inspectorModels: InspectorModelByStage;
  readonly poseTable?: PreparedPoseTable;
  readonly resourceManifest: WorkbenchResourceManifest;
}

export interface RuntimeFrame {
  generation: number;
  phase: number;
  elapsedMs: number;
  sampleIndexA: number;
  sampleIndexB: number;
  sampleMix: number;
  readonly transforms: Float32Array;
  readonly overlays: Float32Array;
}

export type WorkbenchRenderReason =
  | "scene-swap"
  | "lens-change"
  | "resize"
  | "camera-gesture"
  | "interaction"
  | "selection"
  | "context-restored"
  | "explicit";

export interface WorkbenchDiagnosticsSnapshot {
  readonly rendererCreations: number;
  readonly liveWebGLContexts: number;
  readonly rendererSubmissions: number;
  readonly warmSwitchShaderCompilations: number;
  readonly reactAnimationCommits: number;
  readonly diagnosticJsonBytes: number;
  readonly box3SetFromObjectCalls: number;
  readonly autosaveSerializations: number;
  readonly aiNetworkRequests: number;
  readonly rapierNetworkRequests: number;
  readonly studyNetworkRequests: number;
  readonly domainCalls: Readonly<{
    compileMechanismGraphFabrication: number;
    projectMechanismReadiness: number;
    sampleFeasibleRange: number;
    motionSafeParamRange: number;
    mechanismEditIsSafe: number;
    safetyPhaseLinkageEvaluations: number;
    prepareMechanismKinematics: number;
    connectionCandidateEnumeration: number;
    motionPreviewForPath: number;
    samplePreparedMotionPreview: number;
  }>;
}

export interface WorkbenchRuntimeSnapshot {
  readonly mounted: boolean;
  readonly stage: AppStage | null;
  readonly cameraMode: WorkbenchCameraMode | null;
  readonly sceneGeneration: number | null;
  readonly playing: boolean;
  readonly phase: number;
  readonly context: "unmounted" | "ready" | "lost" | "restoring" | "disposed";
}

export interface WorkbenchRuntime {
  mount(canvas: HTMLCanvasElement): void;
  acceptPreparedScene(scene: PreparedWorkbenchScene):
    | Readonly<{ status: "accepted"; generation: number }>
    | Readonly<{ status: "rejected-stale"; generation: number; activeGeneration: number }>;
  setStageLens(lens: StageLens): void;
  setInteractionSink(sink: WorkbenchInteractionSink | null): void;
  resize(host: WorkbenchClientRect, devicePixelRatio: number): void;
  play(options: Readonly<{ durationMs: number; speed: number; startPhase?: number }>): void;
  pause(): void;
  scrub(phase: number): void;
  requestRender(reason: WorkbenchRenderReason): void;
  snapshot(): WorkbenchRuntimeSnapshot;
  diagnostics(): WorkbenchDiagnosticsSnapshot | null;
  dispose(): void;
}
