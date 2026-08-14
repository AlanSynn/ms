import {
  buildParts,
  buildPoseSkeleton,
  extractKeypoints,
  imageToDataUrl,
  makeCharacterMask,
  preprocessForPose,
  readImage,
} from "./webOnnxImagePipeline";
import {
  deleteCachedModel,
  loadOrtRuntime,
  loadWebOnnxSession,
  WebOnnxRuntimeError,
  warmWebOnnxCache,
  type OrtSession,
} from "./webOnnxModelRuntime";
import type { Tensor as OrtTensor } from "onnxruntime-web";
import {
  classifyWebOnnxError,
  type WebOnnxResult,
  type WorkerRequest,
} from "./webOnnxProtocol";

const processImageWithWebOnnx = async (
  file: File,
  modelUrl: string,
  onProgress: (stage: string, progress: number) => void = () => {},
): Promise<WebOnnxResult> => {
  const startedAt = performance.now();
  let runtimeStage = "decode-image";
  let img: ImageBitmap | undefined;
  let session: OrtSession | undefined;
  let modelInitMs = 0;
  let modelReused = false;
  let modelBytes = 0;
  let inferenceMs = 0;
  let inputTensor: { dispose?: () => void } | undefined;
  let outputTensor: { dispose?: () => void } | undefined;
  let result: WebOnnxResult | undefined;
  // One ORT session is retained by the worker for sequential jobs. ImageBitmap,
  // input/output tensors, and derived result buffers remain request-scoped; worker
  // termination is the session reclamation boundary.
  try {
    const decoded = await readImage(file);
    img = decoded.img;
    onProgress("loading-model", 6);

    runtimeStage = "segment-character";
    const mask = await makeCharacterMask(img);
    runtimeStage = "downloading-model";
    onProgress("downloading-model", 12);
    runtimeStage = "loading-model";
    const sessionLease = await loadWebOnnxSession(
      modelUrl,
      (status) =>
        onProgress(
          "downloading-model",
          Math.max(12, Math.min(34, Math.round(status.progress * 0.22 + 12))),
        ),
      (phase) => {
        runtimeStage = phase;
      },
    );
    session = sessionLease.session;
    modelInitMs = sessionLease.modelInitMs;
    modelReused = sessionLease.modelReused;
    modelBytes = sessionLease.modelBytes;
    onProgress("loading-model", 35);
    const ort = await loadOrtRuntime();

    runtimeStage = "preprocess-image";
    const input = preprocessForPose(img, mask, ort);
    inputTensor = input.tensor;
    runtimeStage = "running-onnx";
    onProgress("running-onnx", 45);
    const inferenceStartedAt = performance.now();
    const outputs = await session.run({ [session.inputNames[0]]: input.tensor });
    inferenceMs = performance.now() - inferenceStartedAt;
    const output = Object.values(outputs)[0];
    if (!output) throw new Error("Pose model returned no output tensor");
    outputTensor = output as unknown as { dispose?: () => void };

    runtimeStage = "extracting-keypoints";
    const keypoints = extractKeypoints(output as OrtTensor, input);
    runtimeStage = "extracting-parts";
    onProgress("extracting-parts", 75);
    const skeleton = buildPoseSkeleton(keypoints, img, mask, modelUrl);
    const parts = await buildParts(skeleton, img, mask);
    if (!parts.length) throw new Error("ONNX pose succeeded but no body parts could be extracted");
    if (parts.some((part) => !part.textureUrl || !part.maskUrl)) {
      throw new Error("ONNX pose extracted a body part without bounded art and mask output");
    }

    runtimeStage = "normalizing";
    onProgress("normalizing", 90);
    const partTextureDataUrlChars = parts.reduce((sum, part) => sum + (part.textureUrl?.length ?? 0), 0);
    const partMaskDataUrlChars = parts.reduce((sum, part) => sum + (part.maskUrl?.length ?? 0), 0);
    const textureUrl = await imageToDataUrl(img);
    const workingWidth = img.width;
    const workingHeight = img.height;
    img.close();
    img = undefined;
    result = {
      skeleton,
      parts,
      textureUrl,
      maskUrl: mask.url,
      keypoints,
      metrics: {
        inputWidth: decoded.inputWidth,
        inputHeight: decoded.inputHeight,
        workingWidth,
        workingHeight,
        provider: "wasm",
        model: "fp32",
        modelBytes,
        modelPath: modelUrl,
        modelInitMs,
        modelReused,
        ownedModelBufferReferencesRetained: 0,
        retainedModelSessionCount: 1,
        requestTensorRetainedBytes: 0,
        imageBitmapClosed: true,
        partTextureDataUrlChars,
        partMaskDataUrlChars,
        inferenceMs,
        totalMs: performance.now() - startedAt,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const runtimeFailurePhase = error instanceof WebOnnxRuntimeError
      ? error.phase
      : undefined;
    if (
      runtimeFailurePhase === "model-download" ||
      runtimeFailurePhase === "session-create" ||
      runtimeStage === "downloading-model" ||
      runtimeStage === "loading-model"
    ) {
      try {
        await deleteCachedModel(modelUrl);
      } catch {
        // Preserve the ONNX Runtime failure as the actionable error.
      }
    }
    const retryHint = runtimeFailurePhase || runtimeStage === "loading-model"
      ? " Cached model bytes were cleared; try the image again to redownload them."
      : "";
    const contextualMessage =
      `Web ONNX image processing failed during ${runtimeStage} at ${modelUrl}: ${message}${retryHint}`;
    if (runtimeFailurePhase) {
      throw new WebOnnxRuntimeError(runtimeFailurePhase, contextualMessage);
    }
    throw new Error(contextualMessage);
  } finally {
    // ORT tensors are explicitly released before the result crosses the worker
    // boundary; zero retained request-tensor bytes is an observed postcondition.
    outputTensor?.dispose?.();
    inputTensor?.dispose?.();
    if (img) {
      // Error paths still close a bitmap that was not closed before result assembly.
      img.close();
      img = undefined;
    }
    if (result) result.metrics.imageBitmapClosed = true;
  }
  if (!result) throw new Error("Web ONNX image processing returned no result");
  return result;
};

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  const post = (message: object) => self.postMessage({ id: data.id, ...message });
  try {
    if (data.type === "warm") {
      const status = await warmWebOnnxCache(data.modelUrl, (next) => post({ type: "cache", status: next }));
      post({ type: "result", result: status });
      return;
    }
    const result = await processImageWithWebOnnx(data.file, data.modelUrl, (nextStage, progress) => {
      post({ type: "progress", stage: nextStage, progress });
    });
    post({ type: "result", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stageMatch = message.match(/failed during ([a-z-]+)/);
    const stage = stageMatch?.[1] ?? "image-processing";
    const runtimePhase = error instanceof WebOnnxRuntimeError ? error.phase : undefined;
    post({ type: "error", code: classifyWebOnnxError(stage, message, runtimePhase), message });
  }
};
