import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { SHARED_PLAYBACK_STAGES } from "../components/shell/workflowStages";
import type { AppStage, ProjectState } from "../types";
import { createAnimationDriver } from "../utils/animationClock";
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
  setAngle?: Dispatch<SetStateAction<number>>;
  setDrawMode?: Dispatch<SetStateAction<boolean>>;
  onFrame?: (elapsedMs: number, frameTime: number) => void;
  driverStage?: AppStage;
};

export const useWorkspacePlaybackLoop = ({
  stage,
  isPlaying,
  drawMode,
  optimizerBusy,
  showGettingStarted,
  playbackDurationMs,
  animationSpeed,
  timingProfile,
  setAngle,
  setDrawMode,
  onFrame,
  driverStage,
}: UseWorkspacePlaybackLoopOptions) => {
  const onFrameRef = useRef(onFrame);
  const setAngleRef = useRef(setAngle);
  const playbackConfigRef = useRef({
    playbackDurationMs,
    animationSpeed,
    timingProfile,
  });
  onFrameRef.current = onFrame;
  setAngleRef.current = setAngle;
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
    const driver = createAnimationDriver({
      onAdvance: (elapsedMs, frameTime) => {
        const latestOnFrame = onFrameRef.current;
        if (latestOnFrame) {
          latestOnFrame(elapsedMs, frameTime);
          return;
        }
        const latestSetAngle = setAngleRef.current;
        if (!latestSetAngle) return;
        const config = playbackConfigRef.current;
        latestSetAngle(
          (prev) =>
            (prev +
              animationDeltaRadians(
                elapsedMs,
                config.playbackDurationMs,
                config.animationSpeed,
                config.timingProfile,
                prev,
              )) %
            (Math.PI * 2),
        );
      },
    });
    driver.start();
    return () => driver.stop();
  }, [
    isPlaying,
    drawMode,
    optimizerBusy,
    showGettingStarted,
    stage,
    driverStage,
  ]);

  useEffect(() => {
    if (stage !== "path" && drawMode && setDrawMode) setDrawMode(false);
  }, [stage, drawMode, setDrawMode]);
};
