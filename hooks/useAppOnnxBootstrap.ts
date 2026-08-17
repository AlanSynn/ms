import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  warmWebOnnxCacheInWorker,
  type WebOnnxCacheStatus,
} from "../utils/webOnnx";

const initialOnnxCacheStatus = (): WebOnnxCacheStatus => ({
  // The editor is ready immediately; cache preparation is scheduled after the
  // first interactive paint and never gates templates or the workbench.
  stage: "available",
  label: "AI pose model",
  progress: 0,
});

type UseAppOnnxBootstrapResult = {
  onnxCacheStatus: WebOnnxCacheStatus;
  setOnnxCacheStatus: Dispatch<SetStateAction<WebOnnxCacheStatus>>;
  cacheOnnxModel: () => Promise<void>;
};

export const useAppOnnxBootstrap = (
  setCommandStatus: (message: string) => void,
): UseAppOnnxBootstrapResult => {
  const [onnxCacheStatus, setOnnxCacheStatus] = useState<WebOnnxCacheStatus>(
    initialOnnxCacheStatus,
  );
  const backgroundWarmRef = useRef<Promise<WebOnnxCacheStatus> | null>(null);

  const warmInBackground = useCallback(() => {
    if (!backgroundWarmRef.current) {
      backgroundWarmRef.current = warmWebOnnxCacheInWorker(setOnnxCacheStatus).finally(() => {
        backgroundWarmRef.current = null;
      });
    }
    return backgroundWarmRef.current;
  }, []);

  useEffect(() => {
    setOnnxCacheStatus(initialOnnxCacheStatus);
    let disposed = false;
    const start = () => {
      if (!disposed) void warmInBackground();
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleHandle = idleWindow.requestIdleCallback?.(start, { timeout: 1800 });
    const fallbackTimer = idleHandle === undefined ? window.setTimeout(start, 700) : undefined;
    return () => {
      disposed = true;
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    };
  }, [warmInBackground]);

  const cacheOnnxModel = useCallback(async () => {
    setCommandStatus("Getting AI…");
    const result = await warmInBackground();
    setCommandStatus(
      result.stage === "cached"
        ? "AI ready"
        : `AI failed: ${result.error ?? "download error"}`,
    );
  }, [setCommandStatus, warmInBackground]);

  return { onnxCacheStatus, setOnnxCacheStatus, cacheOnnxModel };
};
