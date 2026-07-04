import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  warmWebOnnxCache,
  type WebOnnxCacheStatus,
} from "../utils/webOnnx";

const initialOnnxCacheStatus = (): WebOnnxCacheStatus => ({
  stage: "checking",
  label: "AI pose model",
  progress: 0,
});

const bootLoaderLabel = (status: WebOnnxCacheStatus) => {
  if (status.stage === "cached") return "AI ready";
  if (status.stage === "downloading") {
    const pct = Math.max(0, Math.min(100, Math.round(status.progress)));
    return `Downloading AI model ${pct}%`;
  }
  if (status.stage === "error") return "Opening without AI model";
  return "Preparing AI model";
};

const updateBootLoader = (status: WebOnnxCacheStatus) => {
  const loader = document.getElementById("boot-loader");
  if (!loader) return;
  const label = loader.querySelector<HTMLElement>("[data-boot-status]");
  if (label) label.textContent = bootLoaderLabel(status);
  const bar = loader.querySelector<HTMLElement>("[data-boot-progress]");
  if (bar) {
    const fallback =
      status.stage === "checking" ? 8 : status.stage === "error" ? 100 : 0;
    bar.style.width = `${Math.max(6, Math.min(100, status.progress || fallback))}%`;
  }
};

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
    let active = true;
    let bootTimer: number | undefined;
    const publishBootStatus = (status: WebOnnxCacheStatus) => {
      if (!active) return;
      setOnnxCacheStatus(status);
      updateBootLoader(status);
    };
    publishBootStatus(initialOnnxCacheStatus());
    warmWebOnnxCache(publishBootStatus).then((status) => {
      if (!active) return;
      publishBootStatus(status);
      bootTimer = finishBootLoader();
    });
    return () => {
      active = false;
      if (bootTimer !== undefined) window.clearTimeout(bootTimer);
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
