import type {
  ProjectDownloadWorkerRequest,
  ProjectDownloadWorkerResponse,
} from "../runtime/persistence/projectDownloadWorkerClient";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ProjectDownloadWorkerRequest>) => void) | null;
  postMessage: (response: ProjectDownloadWorkerResponse) => void;
};

worker.onmessage = async ({ data }) => {
  if (data?.type !== "serialize-portable-project") return;
  try {
    const { createPortableProjectBlob } = await import(
      "../runtime/persistence/projectDownloadJob"
    );
    worker.postMessage({
      type: "result",
      generationId: data.generationId,
      blob: createPortableProjectBlob(data.project),
    });
  } catch (error) {
    worker.postMessage({
      type: "error",
      generationId: data.generationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
