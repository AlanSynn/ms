import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  warmWebOnnxCacheInWorker,
  type WebOnnxCacheStatus,
} from "../utils/webOnnx";

const initialOnnxCacheStatus = (): WebOnnxCacheStatus => ({
  // AI is opt-in. The editor and starter workflows never need the model.
  stage: "missing",
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
  const prepareModelRef = useRef<Promise<WebOnnxCacheStatus> | null>(null);

  const prepareModel = useCallback(() => {
    if (!prepareModelRef.current) {
      prepareModelRef.current = warmWebOnnxCacheInWorker(setOnnxCacheStatus).finally(() => {
        prepareModelRef.current = null;
      });
    }
    return prepareModelRef.current;
  }, []);

  const cacheOnnxModel = useCallback(async () => {
    setCommandStatus("Getting AI…");
    const result = await prepareModel();
    setCommandStatus(
      result.stage === "cached"
        ? "AI ready"
        : `AI failed: ${result.error ?? "download error"}`,
    );
  }, [prepareModel, setCommandStatus]);

  return { onnxCacheStatus, setOnnxCacheStatus, cacheOnnxModel };
};
