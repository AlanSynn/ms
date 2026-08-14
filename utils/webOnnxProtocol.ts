import type { BodyPartLayer, Point, StandardSkeleton } from "../types";

export const WEB_ONNX_MODEL_PATH = "onnx/pose_model.onnx";
export const WEB_ONNX_MODEL_BYTES = 135_929_562;
export const resolveWebOnnxModelUrl = (baseUrl: string, documentUrl: string) =>
  new URL(`${baseUrl}${WEB_ONNX_MODEL_PATH}`, documentUrl).href;
export const WEB_ONNX_MODEL_PROVENANCE = {
  path: "public/onnx/pose_model.onnx",
  format: "onnx",
  precision: "fp32",
  bytes: WEB_ONNX_MODEL_BYTES,
  sha256: "9fd0dc927f41d1981c64d1ac7f5b22545f369c16b95944d60d93495c5a68eb74",
  opset: 11,
  input: [1, 3, 256, 192],
  output: [1, 17, 64, 48],
} as const;

export const WEB_ONNX_MODEL_CACHE_NAME = "motionsmith-web-onnx-v4";
export const WEB_ONNX_LEGACY_MODEL_CACHE_NAMES = [
  "motionsmith-web-onnx-v3",
  "motionsmith-web-onnx-v2",
  "motionsmith-web-onnx-v1",
] as const;
export const WEB_ONNX_MODEL_BYTES_HEADER = "x-motionsmith-model-bytes";
export const WEB_ONNX_MODEL_LABEL = "AI pose model";
export const WEB_ONNX_MODEL_DOWNLOAD_STALL_MS = 30_000;
export const WEB_ONNX_GIT_LFS_POINTER_PREFIX = "version https://git-lfs";

export type WebOnnxKeypoint = Point & {
  confidence: number;
  name: string;
};

export interface WebOnnxMetrics {
  inputWidth: number;
  inputHeight: number;
  workingWidth: number;
  workingHeight: number;
  provider: "wasm";
  model: "fp32";
  modelBytes: number;
  modelPath: string;
  modelInitMs: number;
  modelReused: boolean;
  ownedModelBufferReferencesRetained: number;
  retainedModelSessionCount: number;
  requestTensorRetainedBytes: number;
  imageBitmapClosed: boolean;
  // These are JavaScript character counts of bounded data-URL strings, not
  // decoded image or heap byte measurements. The pipeline bounds the encoded
  // blobs separately with WEB_IMAGE_LIMITS.maxSourceTextureBytes/maxMaskBytes.
  partTextureDataUrlChars: number;
  partMaskDataUrlChars: number;
  inferenceMs: number;
  totalMs: number;
}

export interface WebOnnxResult {
  skeleton: StandardSkeleton;
  parts: BodyPartLayer[];
  textureUrl: string;
  maskUrl: string;
  keypoints: WebOnnxKeypoint[];
  metrics: WebOnnxMetrics;
}

export type WebOnnxCacheStage =
  | "checking"
  | "missing"
  | "downloading"
  | "cached"
  | "error";

export interface WebOnnxCacheStatus {
  stage: WebOnnxCacheStage;
  label: string;
  progress: number;
  bytesLoaded?: number;
  bytesTotal?: number;
  error?: string;
}

export const createWebOnnxCacheStatus = (
  stage: WebOnnxCacheStage,
  progress: number,
  extra: Partial<WebOnnxCacheStatus> = {},
): WebOnnxCacheStatus => ({
  stage,
  label: WEB_ONNX_MODEL_LABEL,
  progress,
  ...extra,
});

export type WebOnnxErrorCode =
  | "canceled"
  | "superseded"
  | "worker-unavailable"
  | "unsupported-image"
  | "model-download-stalled"
  | "model-download-failed"
  | "model-invalid"
  | "wasm-unavailable"
  | "inference-failed"
  | "image-output-too-large"
  | "image-processing-failed";

export type WebOnnxRuntimeFailurePhase = "model-download" | "session-create";

export class WebOnnxError extends Error {
  constructor(public readonly code: WebOnnxErrorCode, message: string) {
    super(message);
    this.name = "WebOnnxError";
  }
}

export const classifyWebOnnxError = (
  stage: string,
  message: string,
  runtimePhase?: WebOnnxRuntimeFailurePhase,
): WebOnnxErrorCode => {
  if (message.includes("model-download-stalled")) return "model-download-stalled";
  if (
    message.includes("Git LFS pointer") ||
    message.includes("real ONNX model bytes")
  ) return "model-invalid";
  if (
    runtimePhase === "model-download" ||
    message.includes("Could not download") ||
    message.includes("download disconnected") ||
    stage === "downloading-model"
  ) return "model-download-failed";
  if (message.includes("image-output-too-large")) return "image-output-too-large";
  if (stage === "decode-image" || stage === "segment-character") return "unsupported-image";
  if (runtimePhase === "session-create" || stage === "loading-model") return "wasm-unavailable";
  if (stage === "running-onnx" || stage === "extracting-keypoints") return "inference-failed";
  return "image-processing-failed";
};

export type WorkerRequest =
  | { id: number; type: "process"; file: File; modelUrl: string }
  | { id: number; type: "warm"; modelUrl: string };

export type WorkerMessage =
  | { id: number; type: "progress"; stage: string; progress: number }
  | { id: number; type: "cache"; status: WebOnnxCacheStatus }
  | {
      id: number;
      type: "result";
      result: WebOnnxResult | WebOnnxCacheStatus;
    }
  | { id: number; type: "error"; code: WebOnnxErrorCode; message: string };
