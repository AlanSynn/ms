import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

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

  useEffect(() => {
    if (!playing || activeStepCount < 2) return;
    let frame = 0;
    let last = performance.now();
    const stepMs = 1400;
    const tick = (time: number) => {
      const delta = Math.min(120, time - last);
      last = time;
      const next = stepProgressRef.current + delta / stepMs;
      if (next >= 1) {
        stepProgressRef.current = 0;
        setStepProgress(0);
        setStepIndex((index) => (index >= activeStepCount - 1 ? 0 : index + 1));
      } else {
        stepProgressRef.current = next;
        setStepProgress(next);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, activeStepCount, setStepIndex, setStepProgress]);

  return { goAssemblyStep };
};
