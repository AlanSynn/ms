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
    const result = runMechanismRecommendationJob(data.input);
    worker.postMessage({
      type: "result",
      generationId: data.generationId,
      requestFingerprint: data.input.requestFingerprint,
      inputFingerprint: result.inputFingerprint,
      recommendations: result.recommendations,
    });
  } catch (error) {
    worker.postMessage({
      type: "error",
      generationId: data.generationId,
      requestFingerprint: data.input.requestFingerprint,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
