import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { SHARED_PLAYBACK_STAGES } from "../components/AppShell";
import type { AppStage, ProjectState } from "../types";
import type {
  PlaybackClock,
  PlaybackClockFrame,
  PlaybackPhaseAdvance,
} from "../runtime/playback/externalPlaybackClock";
import { animationDeltaRadians } from "../utils/kinematics";

type UseWorkspacePlaybackLoopOptions = {
  stage: AppStage;
  isPlaying: boolean;
  drawMode: boolean;
  optimizerBusy: boolean;
  showGettingStarted: boolean;
  playbackDurationMs: number;
  animationSpeed: number;
  timingProfile: ProjectState["settings"]["timingProfile"];
  playbackClock: PlaybackClock;
  setAngle?: Dispatch<SetStateAction<number>>;
  setDrawMode?: Dispatch<SetStateAction<boolean>>;
  onFrame?: (frame: PlaybackClockFrame) => void;
  phaseAdvance?: PlaybackPhaseAdvance;
  driverStage?: AppStage;
};

const defaultPhaseAdvance = (
  elapsedMs: number,
  previousPhase: number,
  playbackDurationMs: number,
  animationSpeed: number,
  timingProfile: ProjectState["settings"]["timingProfile"],
) =>
  (previousPhase +
    animationDeltaRadians(
      Math.min(64, elapsedMs),
      playbackDurationMs,
      animationSpeed,
      timingProfile,
      previousPhase,
    )) %
  (Math.PI * 2);

export const useWorkspacePlaybackLoop = ({
  stage,
  isPlaying,
  drawMode,
  optimizerBusy,
  showGettingStarted,
  playbackDurationMs,
  animationSpeed,
  timingProfile,
  playbackClock,
  setAngle,
  setDrawMode,
  onFrame,
  phaseAdvance,
  driverStage,
}: UseWorkspacePlaybackLoopOptions) => {
  const onFrameRef = useRef(onFrame);
  const phaseAdvanceRef = useRef(phaseAdvance);
  const playbackConfigRef = useRef({
    playbackDurationMs,
    animationSpeed,
    timingProfile,
  });
  onFrameRef.current = onFrame;
  phaseAdvanceRef.current = phaseAdvance;
  playbackConfigRef.current = {
    playbackDurationMs,
    animationSpeed,
    timingProfile,
  };

  useEffect(() => {
    const sharedStageRejected = !SHARED_PLAYBACK_STAGES.includes(stage);
    if (
      !isPlaying ||
      drawMode ||
      optimizerBusy ||
      showGettingStarted ||
      (driverStage ? stage !== driverStage : sharedStageRejected)
    )
      return;

    let customAdvance = phaseAdvanceRef.current;
    const onFrameRefAtStart = onFrameRef;
    playbackClock.start({
      initialPhase: playbackClock.getPhase(),
      advancePhase: (elapsedMs, previousPhase) => {
        const config = playbackConfigRef.current;
        customAdvance = phaseAdvanceRef.current;
        return customAdvance
          ? customAdvance(elapsedMs, previousPhase)
          : defaultPhaseAdvance(
              elapsedMs,
              previousPhase,
              config.playbackDurationMs,
              config.animationSpeed,
              config.timingProfile,
            );
      },
      onFrame: (frame) => onFrameRefAtStart.current?.(frame),
    });
    return () => playbackClock.stop();
  }, [
    isPlaying,
    drawMode,
    optimizerBusy,
    showGettingStarted,
    stage,
    driverStage,
    playbackClock,
  ]);

  useEffect(() => {
    if (stage !== "path" && drawMode && setDrawMode) setDrawMode(false);
  }, [stage, drawMode, setDrawMode]);

  // `setAngle` remains an interaction boundary for the player and command
  // handlers. Animation frames update the external clock only.
  void setAngle;
};
