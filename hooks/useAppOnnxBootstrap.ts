import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  warmWebOnnxCache,
  type WebOnnxCacheStatus,
} from "../utils/webOnnx";

const initialOnnxCacheStatus = (): WebOnnxCacheStatus => ({
  // The editor is ready to use AI, but the model cache is intentionally not
  // inspected until an explicit image action needs it.
  stage: "available",
  label: "AI pose model",
  progress: 0,
});

const finishBootLoader = () => {
  document.body.classList.add("app-ready");
  return window.setTimeout(
    () => document.getElementById("boot-loader")?.remove(),
    320,
  );
};

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

  useEffect(() => {
    const bootTimer = finishBootLoader();
    setOnnxCacheStatus(initialOnnxCacheStatus);
    return () => {
      window.clearTimeout(bootTimer);
    };
  }, []);

  const cacheOnnxModel = useCallback(async () => {
    setCommandStatus("Getting AI…");
    const result = await warmWebOnnxCache(setOnnxCacheStatus);
    setCommandStatus(
      result.stage === "cached"
        ? "AI ready"
        : `AI failed: ${result.error ?? "download error"}`,
    );
  }, [setCommandStatus]);

  return { onnxCacheStatus, setOnnxCacheStatus, cacheOnnxModel };
};
