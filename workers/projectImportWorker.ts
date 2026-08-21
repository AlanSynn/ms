import type {
  ProjectImportWorkerRequest,
  ProjectImportWorkerResponse,
} from "../runtime/import/projectImportJob";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ProjectImportWorkerRequest>) => void) | null;
  postMessage(response: ProjectImportWorkerResponse): void;
};

worker.onmessage = async ({ data }) => {
  if (data?.type !== "import") return;
  try {
    const { runProjectImportJob } = await import(
      "../runtime/import/projectImportJob"
    );
    const result = await runProjectImportJob(data.input);
    worker.postMessage({
      type: "result",
      generationId: data.generationId,
      ...result,
    });
  } catch (error) {
    worker.postMessage({
      type: "error",
      generationId: data.generationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
