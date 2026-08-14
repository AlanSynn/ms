import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { foregroundMaskFromRgba, poseCropBounds } from "../utils/webOnnxPreprocess";
import { resolveWebOnnxModelUrl } from "../utils/webOnnxProtocol";

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const ownedSources = [
  "utils/webOnnx.ts",
  "utils/webOnnxProtocol.ts",
  "utils/webOnnxModelRuntime.ts",
  "utils/webOnnxImagePipeline.ts",
  "utils/webOnnxPreprocess.ts",
  "utils/webOnnxWorker.ts",
  "utils/webOnnxStatusStore.ts",
  "utils/imageDimensions.ts",
  "scripts/pose_model_preprocessing.py",
  "hooks/useAppOnnxBootstrap.ts",
  "hooks/useAppCharacterImportActions.ts",
  "components/stages/character/CharacterImportOverlays.tsx",
  "components/stages/character/CharacterSelection.tsx",
];

for (const path of ownedSources) {
  const source = read(path);
  assert(!/[\uAC00-\uD7AF]/u.test(source), `${path} contains non-English Hangul text`);
}

const wrapper = read("utils/webOnnx.ts");
const protocol = read("utils/webOnnxProtocol.ts");
const runtime = read("utils/webOnnxModelRuntime.ts");
const pipeline = read("utils/webOnnxImagePipeline.ts");
const worker = read("utils/webOnnxWorker.ts");
const statusStore = read("utils/webOnnxStatusStore.ts");
const dimensions = read("utils/imageDimensions.ts");
const quantizer = read("scripts/quantize-pose-model.py");
const hook = read("hooks/useAppCharacterImportActions.ts");
const overlay = read("components/stages/character/CharacterImportOverlays.tsx");
const characterSelection = read("components/stages/character/CharacterSelection.tsx");

assert(wrapper.includes("new Worker(") && (wrapper.includes("new URL('./webOnnxWorker.ts'") || wrapper.includes('new URL("./webOnnxWorker.ts"')), "image AI is worker-backed");
assert(!wrapper.includes("document.createElement('canvas')") && !wrapper.includes("new Image()"), "UI wrapper does not decode or transform images");
assert(pipeline.includes("createImageBitmap") && pipeline.includes("OffscreenCanvas"), "image pipeline owns image decode and canvas transforms");
assert(runtime.includes("InferenceSession.create(new Uint8Array(modelBuffer)") && worker.includes("session.run"), "runtime creates the cached ONNX session and worker owns request inference");
assert(worker.includes("img.close()") && worker.includes("inputTensor?.dispose?.()") && worker.includes("outputTensor?.dispose?.()"), "worker deterministically releases image and request tensor resources");
assert(worker.includes("loadWebOnnxSession") && !worker.includes("session?.release()"), "worker retains one session per model URL and leaves session reclamation to worker termination");
assert(runtime.includes("cachedSession") && runtime.includes("modelReused") && runtime.includes("modelBuffer"), "runtime retains only one resolved-model session and drops its application-owned source-buffer reference after creation");
assert(runtime.includes("WebOnnxRuntimeError") && runtime.includes("onPhase") && protocol.includes("classifyWebOnnxError") && worker.includes("classifyWebOnnxError"), "model acquisition and session creation expose distinct typed runtime phases");
assert(protocol.includes("real ONNX model bytes") && worker.includes("downloading-model"), "protocol classifies invalid model bytes and the worker supplies structural acquisition phases");
assert(pipeline.includes("WEB_IMAGE_LIMITS.maxWorkingEdge") && pipeline.includes("WEB_IMAGE_LIMITS.maxWorkingPixels"), "image pipeline uses bounded image limits");
assert(pipeline.includes("MAX_SOURCE_TEXTURE_BYTES") && pipeline.includes("MAX_MASK_BYTES"), "image pipeline caps returned texture and mask payloads");
assert(pipeline.includes("textureUrl") && pipeline.includes("maskUrl") && worker.includes("bounded art and mask output"), "runtime preserves bounded per-part art and masks");
assert(protocol.includes("WEB_ONNX_MODEL_PATH") && protocol.includes("resolveWebOnnxModelUrl") && runtime.includes("WEB_ONNX_MODEL_BYTES") && worker.includes("data.modelUrl"), "model constants and the resolved model URL use one protocol source");
assert.equal(resolveWebOnnxModelUrl("/", "https://example.test/index.html"), "https://example.test/onnx/pose_model.onnx");
assert.equal(resolveWebOnnxModelUrl("/ms/", "https://example.test/ms/index.html"), "https://example.test/ms/onnx/pose_model.onnx");
assert.equal(resolveWebOnnxModelUrl("./", "https://tauri.local/app/index.html"), "https://tauri.local/app/onnx/pose_model.onnx");
assert(wrapper.includes("resolveWebOnnxModelUrl") && wrapper.includes("window.location.href") && wrapper.includes("modelUrl: modelUrl()"), "UI resolves the public model against the document URL before sending worker requests");
assert(wrapper.includes('activeProcessJob?.cancel("superseded")') && wrapper.includes("data.id !== id"), "stale process jobs cannot resolve the active request");
assert(wrapper.includes("options: { signal?: AbortSignal }") && wrapper.includes("worker.terminate()"), "inference cancellation terminates the worker and accepts AbortSignal");
assert(!wrapper.includes("caches.open") && !wrapper.includes("response.arrayBuffer()") && !wrapper.includes("checkWebOnnxCache"), "UI wrapper does not own model cache or model bytes");
assert(wrapper.includes("warmInFlight") && wrapper.includes("waitForWarm") && wrapper.includes("serializeAfterWarm"), "process requests serialize behind background warm without superseding it");
assert(statusStore.includes("export type StatusUpdater") && statusStore.includes("WebOnnxCacheStatus") && !statusStore.includes('from "react"') && !statusStore.includes("from 'react'"), "ONNX status subscription stays in a non-React utility store");
assert(hook.includes("imageImportGeneration") && hook.includes("activeImageImport.current !== controller"), "hook rejects stale progress and results");
assert(hook.includes("requestedGeneration") && hook.includes("generation !== imageImportGeneration.current"), "starter fetches cannot overtake newer image imports");
assert(overlay.includes("cancelWebOnnxProcessing") && overlay.includes("Cancel"), "active image import exposes cancellation");
assert(overlay.includes('alt="Imported character"') && characterSelection.includes("project={project}") && characterSelection.includes("Keep the canonical scene unchanged until Use it"), "pending image review is result-first without rebuilding the canonical Three scene before acceptance");
assert(runtime.includes("readCachedModel") && runtime.includes("await readCachedModel(modelUrl)") && runtime.includes("buffer.byteLength"), "worker runtime validates cached model bytes, not only cache headers");
assert(runtime.includes("expected ${WEB_ONNX_MODEL_BYTES} real ONNX model bytes"), "model runtime rejects incomplete or pointer model bytes");
assert(quantizer.includes("--calibration-fixtures") && quantizer.includes("--evaluation-fixtures") && quantizer.includes("artifactBitwiseReproduced"), "quantizer separates calibration inputs from held-out evaluation and avoids bitwise reproducibility overclaims");
const imageRuntimeSources = ownedSources.filter(
  (path) => path !== "hooks/useAppCharacterImportActions.ts",
);
assert(
  !imageRuntimeSources.some((path) => /study/i.test(read(path))),
  "general image runtime and Worker code have no study-only gate",
);
assert(
  hook.indexOf("const result = await processImageWithWebOnnx") <
    hook.indexOf('recordStudyImageInference("success"'),
  "opt-in summary recording observes a completed result instead of gating inference",
);

const provenance = JSON.parse(read("models/pose-model-int8.json"));
assert.equal(provenance.source.path, "public/onnx/pose_model.onnx");
assert.equal(provenance.candidate.path, "models/candidates/pose_model.int8.ort");
assert.equal(provenance.candidate.status, "legacy-evaluation-only");
assert.equal(provenance.candidate.deployed, false);
assert.equal(provenance.calibration.kind, "historical-npz");
assert.deepEqual(provenance.calibration.fixtures, []);
assert.equal(provenance.calibration.samples, 12);
assert.equal(provenance.calibration.artifactBitwiseReproduced, false);
assert.equal(provenance.calibration.historicalArtifact.historicalCommit, "868b2b523f43189d9104fca0fb7a67029cbe11ad");
assert.equal(provenance.calibration.historicalArtifact.historicalPath, "models/calibration/pose-inputs.npz");
assert.equal(provenance.calibration.historicalArtifact.sha256, "b3b9e7eacea9b7feb23b0a2c1e84173a2b770a6db9ff369356678d3ccd76e34f");
assert.equal(provenance.calibration.historicalArtifact.retainedInCurrentTree, false);
const calibrationFixtures = provenance.futureRecipe.calibrationFixtures as string[];
const evaluationFixtures = provenance.evaluation.fixtures as string[];
assert.deepEqual(provenance.evaluation.evaluationOnlyFixtures, evaluationFixtures);
assert(provenance.evaluation.evaluationOnlyFixtures.length > 0, "held-out evaluation has an evaluation-only fixture");
assert(calibrationFixtures.every((fixture) => !evaluationFixtures.includes(fixture)), "future calibration and evaluation fixtures are disjoint");
assert.equal(provenance.futureRecipe.reproducible, undefined);
assert.equal(provenance.futureRecipe.artifactBitwiseReproduced, false);
assert.equal(provenance.futureRecipe.status, "recipe-only; candidate must be regenerated before promotion");
assert.equal(provenance.quality.status, "measured-by-tests/g5-web-onnx.test.ts");
assert.equal(provenance.quality.runner, "onnxruntime-web/wasm");
assert.equal(provenance.quality.scope, "committed representative product fixtures; overlap with omitted historical calibration unknown");
assert.deepEqual(provenance.quality.fixtures, [
  "tests/fixtures/stick-character.png",
  "resources/examples/raw/girl.png",
  "resources/examples/raw/boy.PNG",
]);
assert.equal(provenance.source.lineage.record, "docs/archive/ports/to-port-web-onnx/copy_manifest.json");
assert.equal(provenance.source.lineage.source, "models/onnx/pose_model.onnx");
const copyManifest = JSON.parse(read("docs/archive/ports/to-port-web-onnx/copy_manifest.json"));
const copiedFp32 = copyManifest.entries.find((entry: { source: string }) => entry.source === "models/onnx/pose_model.onnx");
assert(copiedFp32, "FP32 source lineage record exists");
assert.equal(copiedFp32.size_bytes, provenance.source.bytes);
assert.equal(copiedFp32.sha256, provenance.source.sha256);
const fp32Bytes = readFileSync(join(root, "public/onnx/pose_model.onnx"));
assert.equal(fp32Bytes.length, provenance.source.bytes);
assert.equal(createHash("sha256").update(fp32Bytes).digest("hex"), provenance.source.sha256);
if (process.env.G5_TAURI_BUILD === "1") {
  const tauriModel = readFileSync(join(root, "dist/onnx/pose_model.onnx"));
  assert.equal(tauriModel.length, provenance.source.bytes, "Tauri frontend packages the FP32 model at document-relative dist/onnx/pose_model.onnx");
  assert.equal(createHash("sha256").update(tauriModel).digest("hex"), provenance.source.sha256, "Tauri packaged model matches deployed FP32 provenance");
}
assert(!existsSync(join(root, "models/source/pose_model.fp32.onnx")), "duplicate FP32 source pointer is omitted");
assert(!existsSync(join(root, "models/calibration/pose-inputs.npz")), "omitted NPZ calibration input is absent");
assert(!existsSync(join(root, "public/onnx/pose_model.int8.ort")), "non-deployed INT8 candidate is absent from public assets");
for (const fixture of [...calibrationFixtures, ...evaluationFixtures]) {
  assert(existsSync(join(root, fixture)), `${fixture} is a committed fixture`);
}
const int8Bytes = readFileSync(join(root, provenance.candidate.path));
const int8Prefix = new TextDecoder().decode(int8Bytes.subarray(0, 256));
if (int8Prefix.startsWith("version https://git-lfs.github.com/spec/v1")) {
  assert(int8Prefix.includes(`oid sha256:${provenance.candidate.sha256}`));
  assert(int8Prefix.includes(`size ${provenance.candidate.bytes}`));
} else {
  assert.equal(int8Bytes.length, provenance.candidate.bytes, "materialized INT8 checkout has the manifest byte length");
  assert.equal(createHash("sha256").update(int8Bytes).digest("hex"), provenance.candidate.sha256, "materialized INT8 checkout has the manifest SHA-256");
}

const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const readU32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

type RgbaImage = { width: number; height: number; data: Uint8Array };

const decodePng = (path: string): RgbaImage => {
  const bytes = Uint8Array.from(readFileSync(join(root, path)));
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), Array.from(pngSignature), `${path} is not a PNG fixture`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      width = readU32(body, 0);
      height = readU32(body, 4);
      bitDepth = body[8] ?? 0;
      colorType = body[9] ?? 0;
      assert.equal(body[12], 0, `${path} must be non-interlaced`);
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
  }
  assert.equal(bitDepth, 8, `${path} must use 8-bit channels`);
  assert(colorType === 2 || colorType === 6, `${path} must be RGB/RGBA`);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = Uint8Array.from(inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk)))));
  const output = new Uint8Array(width * height * 4);
  let inputOffset = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset++] ?? 0;
    const encoded = inflated.subarray(inputOffset, inputOffset + stride);
    inputOffset += stride;
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] ?? 0 : 0;
      const up = previous[x] ?? 0;
      const upperLeft = x >= channels ? previous[x - channels] ?? 0 : 0;
      const value = encoded[x] ?? 0;
      row[x] = filter === 0
        ? value
        : filter === 1
          ? (value + left) & 255
          : filter === 2
            ? (value + up) & 255
            : filter === 3
              ? (value + Math.floor((left + up) / 2)) & 255
              : filter === 4
                ? (value + paeth(left, up, upperLeft)) & 255
                : (() => { throw new Error(`${path} uses unsupported PNG filter ${filter}`); })();
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      output[target] = row[source] ?? 0;
      output[target + 1] = row[source + 1] ?? 0;
      output[target + 2] = row[source + 2] ?? 0;
      output[target + 3] = channels === 4 ? row[source + 3] ?? 255 : 255;
    }
    previous = row;
  }
  return { width, height, data: output };
};

const preprocessContract = JSON.parse(execFileSync(
  "python3",
  ["scripts/quantize-pose-model.py", "--preprocess-contract", "--calibration-fixtures", "tests/fixtures/stick-character.png"],
  { cwd: root, encoding: "utf8" },
));
assert.equal(preprocessContract.policy, "cleaned-foreground-bbox+20%-margin");
const stick = decodePng("tests/fixtures/stick-character.png");
const stickForeground = foregroundMaskFromRgba(stick.data, stick.width, stick.height);
const stickCrop = poseCropBounds(stickForeground.bbox, stick.width, stick.height);
const pythonStick = preprocessContract.fixtures[0];
assert.deepEqual(pythonStick.foreground, stickForeground.bbox);
assert.deepEqual(pythonStick.crop, stickCrop);

const modelInput = (image: RgbaImage) => {
  const width = 192;
  const height = 256;
  const data = new Float32Array(3 * width * height);
  const { bbox } = foregroundMaskFromRgba(image.data, image.width, image.height);
  const { x: cropX, y: cropY, width: cropWidth, height: cropHeight } = poseCropBounds(bbox, image.width, image.height);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(cropY + (y + 0.5) * cropHeight / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(cropX + (x + 0.5) * cropWidth / width));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = y * width + x;
      data[target] = ((image.data[source] ?? 0) / 255 - mean[0]) / std[0];
      data[width * height + target] = ((image.data[source + 1] ?? 0) / 255 - mean[1]) / std[1];
      data[2 * width * height + target] = ((image.data[source + 2] ?? 0) / 255 - mean[2]) / std[2];
    }
  }
  return data;
};

type ModelRun = {
  bytes: number;
  initMs: number;
  inferenceMs: number[];
  outputs: Float32Array[];
};

const runModel = async (path: string, inputs: Float32Array[]): Promise<ModelRun> => {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = join(root, "node_modules/onnxruntime-web/dist/");
  const bytes = readFileSync(path);
  const initStarted = performance.now();
  const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ["wasm"] });
  const initMs = performance.now() - initStarted;
  const inferenceMs: number[] = [];
  const outputs: Float32Array[] = [];
  for (const inputData of inputs) {
    const started = performance.now();
    const result = await session.run({
      [session.inputNames[0]]: new ort.Tensor("float32", inputData, [1, 3, 256, 192]),
    });
    inferenceMs.push(performance.now() - started);
    outputs.push(Float32Array.from(Object.values(result)[0].data as Float32Array));
  }
  await session.release();
  return { bytes: bytes.length, initMs, inferenceMs, outputs };
};

const argmaxPoints = (output: Float32Array) => {
  const points: Array<[number, number]> = [];
  const heatmapSize = 64 * 48;
  for (let joint = 0; joint < 17; joint += 1) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    const base = joint * heatmapSize;
    for (let index = 0; index < heatmapSize; index += 1) {
      const value = output[base + index] ?? Number.NEGATIVE_INFINITY;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    points.push([bestIndex % 48, Math.floor(bestIndex / 48)]);
  }
  return points;
};

const runQualityMeasurement = async () => {
  const fixtures = provenance.quality.fixtures as string[];
  const inputs = fixtures.map((path) => modelInput(decodePng(path)));
  const fp32 = await runModel("public/onnx/pose_model.onnx", inputs);
  const int8Path = process.env.G5_INT8_MODEL ?? provenance.candidate.path;
  const int8 = await runModel(int8Path, inputs);
  const distances: number[] = [];
  const perFixture = fixtures.map((fixture, fixtureIndex) => {
    const source = argmaxPoints(fp32.outputs[fixtureIndex] ?? new Float32Array());
    const candidate = argmaxPoints(int8.outputs[fixtureIndex] ?? new Float32Array());
    const values = source.map(([x, y], index) => {
      const [candidateX, candidateY] = candidate[index] ?? [x, y];
      return Math.hypot(x - candidateX, y - candidateY) / Math.hypot(64, 48) * 100;
    });
    distances.push(...values);
    const exact = values.filter((value) => value === 0).length;
    return {
      fixture,
      meanNormalizedArgmaxDisplacementPercent: values.reduce((sum, value) => sum + value, 0) / values.length,
      p95NormalizedArgmaxDisplacementPercent: values.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0,
      maxNormalizedArgmaxDisplacementPercent: Math.max(...values),
      exactArgmaxMatchPercent: exact / values.length * 100,
    };
  });
  const sorted = distances.slice().sort((a, b) => a - b);
  const evidence = {
    modelBytes: { fp32: fp32.bytes, int8: int8.bytes },
    initializationMs: { fp32: fp32.initMs, int8: int8.initMs },
    inferenceMs: {
      fp32: fp32.inferenceMs,
      int8: int8.inferenceMs,
      fp32Mean: fp32.inferenceMs.reduce((sum, value) => sum + value, 0) / fp32.inferenceMs.length,
      int8Mean: int8.inferenceMs.reduce((sum, value) => sum + value, 0) / int8.inferenceMs.length,
    },
    fixtures: perFixture,
    errorDistribution: {
      samples: distances.length,
      mean: distances.reduce((sum, value) => sum + value, 0) / distances.length,
      p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
      max: Math.max(...distances),
      exactArgmaxMatchPercent: distances.filter((value) => value === 0).length / distances.length * 100,
    },
  };
  assert(evidence.errorDistribution.mean <= 0.5, "INT8 held-out mean displacement exceeds the evaluation limit");
  assert(evidence.errorDistribution.p95 <= 1.5, "INT8 held-out p95 displacement exceeds the evaluation limit");
  assert(evidence.errorDistribution.max <= 3, "INT8 held-out max displacement exceeds the evaluation limit");
  assert(evidence.errorDistribution.exactArgmaxMatchPercent >= 80, "INT8 held-out exact match falls below the evaluation limit");
  console.log(JSON.stringify({ g5ModelQuality: evidence }, null, 2));
};

if (process.env.G5_RUN_MODEL_QUALITY === "1") {
  await runQualityMeasurement();
} else {
  console.log("G5 web ONNX contracts passed; model quality measurement is opt-in and uses local model bytes only.");
}
