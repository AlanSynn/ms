import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useWorkspacePlaybackLoop } from "../../../hooks/useWorkspacePlaybackLoop";

type AssemblyGuidePlaybackOptions = {
  activeStepCount: number;
  resetKey: string;
  playing: boolean;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  setStepCount: Dispatch<SetStateAction<number>>;
  setStepIndex: Dispatch<SetStateAction<number>>;
  setStepProgress: Dispatch<SetStateAction<number>>;
};

export const useAssemblyGuidePlayback = ({
  activeStepCount,
  resetKey,
  playing,
  setPlaying,
  setStepCount,
  setStepIndex,
  setStepProgress,
}: AssemblyGuidePlaybackOptions) => {
  const stepProgressRef = useRef(0);

  useWorkspacePlaybackLoop({
    stage: "assembly",
    isPlaying: playing && activeStepCount >= 2,
    drawMode: false,
    optimizerBusy: false,
    showGettingStarted: false,
    playbackDurationMs: 1400,
    animationSpeed: 1,
    timingProfile: "linear",
    setDrawMode: undefined,
    onFrame: (elapsedMs) => {
      const next = stepProgressRef.current + elapsedMs / 1400;
      if (next >= 1) {
        stepProgressRef.current = 0;
        setStepProgress(0);
        setStepIndex((index) => (index >= activeStepCount - 1 ? 0 : index + 1));
      } else {
        stepProgressRef.current = next;
        setStepProgress(next);
      }
    },
    driverStage: "assembly",
  });

  useEffect(() => {
    setStepCount(activeStepCount);
  }, [activeStepCount, setStepCount]);

  const goAssemblyStep = useCallback(
    (next: number | ((index: number) => number)) => {
      stepProgressRef.current = 0;
      setStepProgress(0);
      setStepIndex((index) => {
        const nextIndex = typeof next === "function" ? next(index) : next;
        return Math.max(
          0,
          Math.min(Math.max(0, activeStepCount - 1), nextIndex),
        );
      });
    },
    [activeStepCount, setStepIndex, setStepProgress],
  );

  useEffect(() => {
    stepProgressRef.current = 0;
    setStepIndex(0);
    setStepProgress(0);
    setPlaying(false);
  }, [resetKey, setPlaying, setStepIndex, setStepProgress]);

  return { goAssemblyStep };
};
