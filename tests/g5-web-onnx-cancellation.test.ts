import assert from "node:assert/strict";
import { classifyWebOnnxError } from "../utils/webOnnxProtocol";

type FakeMessage =
  | { id: number; type: "result"; result: null }
  | { id: number; type: "error"; code: "model-invalid" | "model-download-failed"; message: string };
type FakeHandler = ((event: MessageEvent<FakeMessage>) => void) | null;

class FakeWorker {
  static terminated = 0;
  static created = 0;
  static nextErrorCodes: Array<"model-invalid" | "model-download-failed"> = [];
  onmessage: FakeHandler = null;
  onerror: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(_url: URL, _options: WorkerOptions) {
    FakeWorker.created += 1;
  }

  postMessage(message: { id: number }) {
    this.timer = setTimeout(() => {
      const code = FakeWorker.nextErrorCodes.shift();
      this.onmessage?.({
        data: code
          ? { id: message.id, type: "error", code, message: `fake ${code}` }
          : { id: message.id, type: "result", result: null },
      } as MessageEvent<FakeMessage>);
    }, 25);
  }

  terminate() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    FakeWorker.terminated += 1;
  }
}

Object.defineProperty(globalThis, "Worker", {
  configurable: true,
  writable: true,
  value: FakeWorker,
});

const { WebOnnxError, processImageWithWebOnnx, warmWebOnnxCache } = await import("../utils/webOnnx");
const file = new File(["image-fixture"], "fixture.png", { type: "image/png" });

const controller = new AbortController();
const started = performance.now();
const canceled = processImageWithWebOnnx(file, () => {}, { signal: controller.signal });
controller.abort();
await assert.rejects(canceled, (error: unknown) =>
  error instanceof WebOnnxError && error.code === "canceled",
);
const cancellationLatencyMs = performance.now() - started;
assert.equal(FakeWorker.terminated, 1);

const first = processImageWithWebOnnx(file);
const second = processImageWithWebOnnx(file);
await assert.rejects(first, (error: unknown) =>
  error instanceof WebOnnxError && error.code === "superseded",
);
await assert.doesNotReject(second);
assert.equal(FakeWorker.terminated, 2);

FakeWorker.nextErrorCodes.push("model-invalid");
const failedWorker = FakeWorker.created;
await assert.rejects(processImageWithWebOnnx(file), (error: unknown) =>
  error instanceof WebOnnxError && error.code === "model-invalid",
);
assert.equal(FakeWorker.terminated, 3, "typed model failure retires its worker");
assert.equal(FakeWorker.created, failedWorker, "model failure is delivered by the current worker");

const retryWorker = FakeWorker.created;
await assert.doesNotReject(processImageWithWebOnnx(file));
assert.equal(FakeWorker.created, retryWorker + 1, "retry creates a fresh worker after model failure");

const workersBeforeWarm = FakeWorker.created;
const terminationsBeforeWarm = FakeWorker.terminated;
const warm = warmWebOnnxCache();
const queuedProcess = processImageWithWebOnnx(file);
assert.equal(FakeWorker.created, workersBeforeWarm, "process waits behind an in-flight warm on the reusable worker");
assert.equal(FakeWorker.terminated, terminationsBeforeWarm, "process does not cancel background warm");
await Promise.all([warm, queuedProcess]);
assert.equal(FakeWorker.created, workersBeforeWarm, "queued process reuses the warmed worker");
assert.equal(FakeWorker.terminated, terminationsBeforeWarm, "warm/process serialization preserves the worker lifecycle");

assert.equal(
  classifyWebOnnxError("loading-model", "TypeError: Failed to fetch", "model-download"),
  "model-download-failed",
  "generic model fetch failures use the model-acquisition phase",
);
assert.equal(
  classifyWebOnnxError("loading-model", "ORT session creation failed", "session-create"),
  "wasm-unavailable",
  "session creation failures use the session-create phase",
);

console.log(JSON.stringify({
  cancellation: {
    latencyMs: cancellationLatencyMs,
    workerTerminated: FakeWorker.terminated,
    supersededRequestRejected: true,
    newerRequestResolved: true,
  },
  recoverableModelError: {
    code: "model-invalid",
    failedWorkerRetired: FakeWorker.terminated === 3,
    freshWorkerRetryResolved: true,
    warmProcessWorkerReused: true,
    genericFetchCode: "model-download-failed",
    sessionCreateCode: "wasm-unavailable",
  },
}));
