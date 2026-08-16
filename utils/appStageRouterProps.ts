import type { AppStageRouterProps } from "../components/AppStageRouter";

type BaseRouterProps = Pick<
  AppStageRouterProps,
  | "editorStage"
  | "project"
  | "dispatch"
  | "goStage"
  | "playerDock"
  | "playbackClock"
>;

type CharacterRouterProps = Pick<
  AppStageRouterProps,
  | "pendingCharacter"
  | "onOpenGettingStarted"
  | "onAcceptPendingCharacter"
  | "onDiscardPendingCharacter"
  | "onProcessCharacter"
  | "onPackageCharacter"
  | "onImportProject"
  | "onEditCharacter"
  | "onSaveSkeleton"
  | "activeClassroomLesson"
  | "resetLesson"
>;

type SelectionRouterProps = Pick<
  AppStageRouterProps,
  | "sortedParts"
  | "selectedPart"
  | "selectedSceneObject"
  | "selectedPath"
  | "selectedMechanism"
>;

type PathRouterProps = Pick<
  AppStageRouterProps,
  | "drawMode"
  | "setDrawMode"
  | "setPathPoints"
  | "openTracking"
  | "isPlaying"
  | "setIsPlaying"
  | "angle"
  | "setAngle"
>;

type ViewportRouterProps = Pick<
  AppStageRouterProps,
  "viewport" | "setViewport"
>;

type FoundryRouterProps = Pick<
  AppStageRouterProps,
  "foundry" | "setFoundry" | "onFoundryExport"
>;

type MechanismRouterProps = Pick<
  AppStageRouterProps,
  | "updateMechanism"
  | "showTrace"
  | "setShowTrace"
  | "onOptimize"
  | "onRecommendations"
  | "optimizerBusy"
  | "exportSvg"
  | "exportDxf"
>;

type AssemblyRouterProps = Pick<
  AppStageRouterProps,
  | "assemblyStepIndex"
  | "setAssemblyStepIndex"
  | "assemblyStepProgress"
  | "setAssemblyStepProgress"
  | "assemblyPlaying"
  | "setAssemblyPlaying"
  | "setAssemblyStepCount"
>;

export type AppStageRouterPropGroups = BaseRouterProps & {
  character: CharacterRouterProps;
  selection: SelectionRouterProps;
  path: PathRouterProps;
  viewport: ViewportRouterProps;
  foundryStage: FoundryRouterProps;
  mechanism: MechanismRouterProps;
  assembly: AssemblyRouterProps;
};

export const buildAppStageRouterProps = ({
  editorStage,
  project,
  dispatch,
  goStage,
  playerDock,
  playbackClock,
  character,
  selection,
  path,
  viewport,
  foundryStage,
  mechanism,
  assembly,
}: AppStageRouterPropGroups): AppStageRouterProps => ({
  editorStage,
  project,
  dispatch,
  goStage,
  playerDock,
  playbackClock,
  ...character,
  ...selection,
  ...path,
  ...viewport,
  ...foundryStage,
  ...mechanism,
  ...assembly,
});
