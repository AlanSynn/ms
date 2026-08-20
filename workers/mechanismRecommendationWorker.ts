import type {
  MechanismRecommendationWorkerRequest,
  MechanismRecommendationWorkerResponse,
} from "../runtime/recommendations/mechanismRecommendationJob";

const worker = globalThis as unknown as {
  onmessage:
    | ((event: MessageEvent<MechanismRecommendationWorkerRequest>) => void)
    | null;
  postMessage: (response: MechanismRecommendationWorkerResponse) => void;
};

worker.onmessage = async ({ data }) => {
  if (data?.type !== "build") return;
  try {
    const { runMechanismRecommendationJob } = await import(
      "../runtime/recommendations/mechanismRecommendationJob"
    );
    worker.postMessage({
      type: "result",
      generationId: data.generationId,
      inputFingerprint: data.input.inputFingerprint,
      recommendations: runMechanismRecommendationJob(data.input),
    });
  } catch (error) {
    worker.postMessage({
      type: "error",
      generationId: data.generationId,
      inputFingerprint: data.input.inputFingerprint,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
