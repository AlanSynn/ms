import type {
  MechanismFitWorkerRequest,
  MechanismFitWorkerResponse,
} from '../runtime/fitting/mechanismFitJob';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<MechanismFitWorkerRequest>) => void) | null;
  postMessage(response: MechanismFitWorkerResponse): void;
};

worker.onmessage = async ({ data }) => {
  if (data?.type !== 'fit') return;
  try {
    const { runMechanismFitJob } = await import(
      '../runtime/fitting/mechanismFitJob'
    );
    worker.postMessage({
      type: 'result',
      generationId: data.generationId,
      inputFingerprint: data.input.inputFingerprint,
      result: runMechanismFitJob(data.input),
    });
  } catch (error) {
    worker.postMessage({
      type: 'error',
      generationId: data.generationId,
      inputFingerprint: data.input.inputFingerprint,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
