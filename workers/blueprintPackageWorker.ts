import type {
  BlueprintPackageWorkerRequest,
  BlueprintPackageWorkerResponse,
} from "../runtime/blueprint/blueprintPackageJob";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BlueprintPackageWorkerRequest>) => void) | null;
  postMessage(response: BlueprintPackageWorkerResponse): void;
};

worker.onmessage = async ({ data }) => {
  if (data?.type !== "create-package") return;
  try {
    const { runBlueprintPackageJob } = await import(
      "../runtime/blueprint/blueprintPackageJob"
    );
    worker.postMessage({
      type: "result",
      generationId: data.generationId,
      fabricationPackage: runBlueprintPackageJob(data.project),
    });
  } catch (error) {
    worker.postMessage({
      type: "error",
      generationId: data.generationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
