import type {
  SceneObjectImageWorkerRequest,
  SceneObjectImageWorkerResponse,
} from "../runtime/import/sceneObjectImageJob";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SceneObjectImageWorkerRequest>) => void) | null;
  postMessage(response: SceneObjectImageWorkerResponse): void;
};

worker.onmessage = async ({ data }) => {
  if (data?.type !== "create-object") return;
  try {
    const { runSceneObjectImageJob } = await import(
      "../runtime/import/sceneObjectImageJob"
    );
    worker.postMessage({
      type: "result",
      generationId: data.generationId,
      object: await runSceneObjectImageJob(data.file, data.objectId, data.project),
    });
  } catch (error) {
    worker.postMessage({
      type: "error",
      generationId: data.generationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
