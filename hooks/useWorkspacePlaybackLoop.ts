import { useEffect, type Dispatch, type SetStateAction } from "react";
import { SHARED_PLAYBACK_STAGES } from "../components/AppShell";
import type { AppStage, ProjectState } from "../types";
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
  setAngle: Dispatch<SetStateAction<number>>;
  setDrawMode: Dispatch<SetStateAction<boolean>>;
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
}: UseWorkspacePlaybackLoopOptions) => {
  useEffect(() => {
    if (
      !isPlaying ||
      drawMode ||
      optimizerBusy ||
      showGettingStarted ||
      !SHARED_PLAYBACK_STAGES.includes(stage)
    )
      return;
    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      const dt = Math.min(64, time - last);
      last = time;
      setAngle(
        (prev) =>
          (prev +
            animationDeltaRadians(
              dt,
              playbackDurationMs,
              animationSpeed,
              timingProfile,
              prev,
            )) %
          (Math.PI * 2),
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    isPlaying,
    drawMode,
    optimizerBusy,
    showGettingStarted,
    stage,
    playbackDurationMs,
    animationSpeed,
    timingProfile,
    setAngle,
  ]);

  useEffect(() => {
    if (stage !== "path" && drawMode) setDrawMode(false);
  }, [stage, drawMode, setDrawMode]);
};
