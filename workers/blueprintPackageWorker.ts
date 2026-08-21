import type {
  BlueprintPackageWorkerRequest,
  BlueprintPackageWorkerResponse,
} from "../runtime/blueprint/blueprintPackageJob";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BlueprintPackageWorkerRequest>) => void) | null;
  postMessage(response: BlueprintPackageWorkerResponse): void;
};

worker.onmessage = async ({ data }) => {
  if (
    data?.type !== "create-package" &&
    data?.type !== "create-custom-parts-stl"
  ) return;
  try {
    const {
      runBlueprintCustomPartsStlJob,
      runBlueprintPackageJob,
    } = await import(
      "../runtime/blueprint/blueprintPackageJob"
    );
    if (data.type === "create-custom-parts-stl") {
      worker.postMessage({
        type: "stl-result",
        generationId: data.generationId,
        customPartsStl: runBlueprintCustomPartsStlJob(data.project),
      });
    } else {
      worker.postMessage({
        type: "result",
        generationId: data.generationId,
        fabricationPackage: runBlueprintPackageJob(data.project),
      });
    }
  } catch (error) {
    worker.postMessage({
      type: "error",
      generationId: data.generationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
