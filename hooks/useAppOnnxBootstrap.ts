import { useCallback, useEffect } from "react";
import { warmWebOnnxCache, type WebOnnxCacheStatus } from "../utils/webOnnx";
import { setWebOnnxCacheStatus } from "../utils/webOnnxStatusStore";

const finishBootLoader = () => {
  document.body.classList.add("app-ready");
  return window.setTimeout(
    () => document.getElementById("boot-loader")?.remove(),
    320,
  );
};

type UseAppOnnxBootstrapResult = {
  cacheOnnxModel: () => Promise<void>;
};

export const useAppOnnxBootstrap = (
  setCommandStatus: (message: string) => void,
): UseAppOnnxBootstrapResult => {
  useEffect(() => {
    let active = true;
    const bootTimer = finishBootLoader();
    const publishCacheStatus = (status: WebOnnxCacheStatus) => {
      if (!active) return;
      setWebOnnxCacheStatus(status);
    };
    setWebOnnxCacheStatus({
      stage: "checking",
      label: "AI pose model",
      progress: 0,
    });
    void warmWebOnnxCache(publishCacheStatus);
    return () => {
      active = false;
      window.clearTimeout(bootTimer);
    };
  }, []);

  const cacheOnnxModel = useCallback(async () => {
    setCommandStatus("Getting AI…");
    const result = await warmWebOnnxCache(setWebOnnxCacheStatus);
    setCommandStatus(
      result.stage === "cached"
        ? "AI ready"
        : `AI failed: ${result.error ?? "download error"}`,
    );
  }, [setCommandStatus]);

  return { cacheOnnxModel };
};
