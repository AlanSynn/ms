import type {
  AutosaveRecoveryWorkerRequest,
  AutosaveRecoveryWorkerResponse,
} from "../runtime/persistence/autosaveRecoveryWorkerClient";

const worker = globalThis as unknown as {
  onmessage:
    | ((event: MessageEvent<AutosaveRecoveryWorkerRequest>) => void)
    | null;
  postMessage: (response: AutosaveRecoveryWorkerResponse) => void;
};

worker.onmessage = async ({ data }) => {
  if (data?.type !== "recover-autosave") return;
  try {
    const { runAutosaveRecoveryJob } = await import(
      "../runtime/persistence/autosaveRecoveryJob"
    );
    worker.postMessage({
      type: "result",
      generationId: data.generationId,
      output: runAutosaveRecoveryJob(data.input),
    });
  } catch (error) {
    worker.postMessage({
      type: "error",
      generationId: data.generationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
