import type {
  BlueprintPackageWorkerRequest,
  BlueprintPackageWorkerResponse,
} from "../runtime/blueprint/blueprintPackageJob";
import { blueprintPackageWithoutSceneArtwork } from "../runtime/blueprint/blueprintPackageTransfer";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BlueprintPackageWorkerRequest>) => void) | null;
  postMessage(response: BlueprintPackageWorkerResponse): void;
};

worker.onmessage = async ({ data }) => {
  if (
    data?.type !== "create-package" &&
    data?.type !== "create-custom-parts-stl" &&
    data?.type !== "create-character-template"
  ) return;
  try {
    const {
      runBlueprintCustomPartsStlJob,
      runBlueprintCharacterTemplateJob,
      runBlueprintPackageJob,
    } = await import(
      "../runtime/blueprint/blueprintPackageJob"
    );
    if (data.type === "create-character-template") {
      worker.postMessage({
        type: "character-template-result",
        generationId: data.generationId,
        ...runBlueprintCharacterTemplateJob(
          data.project,
          data.sourceProjectFingerprint,
        ),
      });
    } else if (data.type === "create-custom-parts-stl") {
      worker.postMessage({
        type: "stl-result",
        generationId: data.generationId,
        customPartsStl: runBlueprintCustomPartsStlJob(data.project),
      });
    } else {
      worker.postMessage({
        type: "result",
        generationId: data.generationId,
        fabricationPackage: blueprintPackageWithoutSceneArtwork(
          runBlueprintPackageJob(data.project, {
            lane: data.lane,
            sourceProjectFingerprint: data.sourceProjectFingerprint,
          }),
        ),
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
