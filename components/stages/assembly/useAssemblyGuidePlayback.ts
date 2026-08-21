import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useWorkspacePlaybackLoop } from "../../../hooks/useWorkspacePlaybackLoop";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";

type AssemblyGuidePlaybackOptions = {
  activeStepCount: number;
  resetKey: string;
  playing: boolean;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  setStepCount: Dispatch<SetStateAction<number>>;
  setStepIndex: Dispatch<SetStateAction<number>>;
  setStepProgress: Dispatch<SetStateAction<number>>;
  playbackClock: PlaybackClock;
};

export const useAssemblyGuidePlayback = ({
  activeStepCount,
  resetKey,
  playing,
  setPlaying,
  setStepCount,
  setStepIndex,
  setStepProgress,
  playbackClock,
}: AssemblyGuidePlaybackOptions) => {
  const stepProgressRef = useRef(0);

  useEffect(() => {
    setStepCount(activeStepCount);
  }, [activeStepCount, setStepCount]);

  const goAssemblyStep = useCallback(
    (next: number | ((index: number) => number)) => {
      stepProgressRef.current = 0;
      playbackClock.setPhase(0);
      setStepProgress(0);
      setStepIndex((index) => {
        const nextIndex = typeof next === "function" ? next(index) : next;
        return Math.max(
          0,
          Math.min(Math.max(0, activeStepCount - 1), nextIndex),
        );
      });
    },
    [activeStepCount, playbackClock, setStepIndex, setStepProgress],
  );

  useEffect(() => {
    stepProgressRef.current = 0;
    playbackClock.setPhase(0);
    setStepIndex(0);
    setStepProgress(0);
    setPlaying(false);
  }, [playbackClock, resetKey, setPlaying, setStepIndex, setStepProgress]);

  const phaseAdvance = useCallback(
    (elapsedMs: number, previousPhase: number) => {
      if (!playing || activeStepCount < 2) return previousPhase;
      const next =
        stepProgressRef.current + Math.min(120, Math.max(0, elapsedMs)) / 1400;
      if (next >= 1) {
        stepProgressRef.current = 0;
        return 0;
      }
      stepProgressRef.current = next;
      return next * Math.PI * 2;
    },
    [activeStepCount, playing],
  );

  useWorkspacePlaybackLoop({
    stage: "assembly",
    isPlaying: playing && activeStepCount >= 2,
    drawMode: false,
    optimizerBusy: false,
    showGettingStarted: false,
    playbackDurationMs: 1400,
    animationSpeed: 1,
    timingProfile: "linear",
    playbackClock,
    phaseAdvance,
    driverStage: "assembly",
  });

  return { goAssemblyStep };
};
