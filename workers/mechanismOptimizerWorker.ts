import type {
  MechanismOptimizerWorkerRequest,
  MechanismOptimizerWorkerResponse,
} from '../runtime/optimizer/mechanismOptimizerJob';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<MechanismOptimizerWorkerRequest>) => void) | null;
  postMessage: (response: MechanismOptimizerWorkerResponse) => void;
};

worker.onmessage = async ({ data }) => {
  if (data?.type !== 'optimize') return;
  try {
    const { runMechanismOptimizerJob } = await import(
      '../runtime/optimizer/mechanismOptimizerJob'
    );
    const result = runMechanismOptimizerJob(data.input, (progress) => {
      worker.postMessage({
        type: 'progress',
        generationId: data.generationId,
        inputFingerprint: data.input.inputFingerprint,
        progress,
      });
    });
    worker.postMessage({
      type: 'result',
      generationId: data.generationId,
      inputFingerprint: data.input.inputFingerprint,
      result,
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
