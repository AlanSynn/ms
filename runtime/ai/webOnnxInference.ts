import type {
  BodyPartLayer,
  Point,
  StandardSkeleton,
} from '../../types';

export type WebOnnxInferenceOutput = {
  skeleton: StandardSkeleton;
  parts: BodyPartLayer[];
  textureUrl: string;
  maskUrl: string;
  keypoints: Array<Point & { confidence: number; name: string }>;
};

type InferenceWorkerRequest = {
  type: 'run';
  generationId: number;
  model: {
    url: string;
    cacheName: string;
    label: string;
    minBytes: number;
    bytesHeader: string;
  };
  file: Blob;
  wasmUrl: string;
};

type InferenceWorkerResponse =
  | {
      type: 'progress';
      generationId: number;
      stage: WebOnnxInferenceStage;
      progress: number;
    }
  | {
      type: 'result';
      generationId: number;
      result: WebOnnxInferenceOutput;
    }
  | {
      type: 'error';
      generationId: number;
      message: string;
    };

type WorkerLike = Pick<
  Worker,
  'addEventListener' | 'removeEventListener' | 'postMessage' | 'terminate'
>;

export type WebOnnxInferenceOptions = {
  generationId: number;
  model: InferenceWorkerRequest['model'];
  file: Blob;
  wasmUrl: string;
  signal?: AbortSignal;
  onProgress?: (
    stage: WebOnnxInferenceStage,
    progress: number,
  ) => void;
  createWorker?: () => WorkerLike;
};

export type WebOnnxInferenceStage =
  | 'decode-image'
  | 'segment-character'
  | 'preprocess-image'
  | 'downloading-model'
  | 'loading-model'
  | 'running-onnx'
  | 'extracting-keypoints'
  | 'extracting-parts'
  | 'normalizing';

const defaultWorker = (): WorkerLike =>
  new Worker(new URL('../../workers/webOnnxInferenceWorker.ts', import.meta.url), {
    type: 'module',
  });

const abortError = () => new DOMException('ONNX inference cancelled', 'AbortError');

export const runWebOnnxInferenceInWorker = ({
  generationId,
  model,
  file,
  wasmUrl,
  signal,
  onProgress = () => {},
  createWorker = defaultWorker,
}: WebOnnxInferenceOptions): Promise<WebOnnxInferenceOutput> => {
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === 'undefined' && createWorker === defaultWorker) {
    return Promise.reject(
      new Error('Web Worker support is required for local AI inference.'),
    );
  }

  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    const settle = (
      complete: () => void,
    ) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', handleAbort);
      worker.removeEventListener('message', handleMessage as EventListener);
      worker.removeEventListener('error', handleError as EventListener);
      worker.terminate();
      complete();
    };
    const handleAbort = () => settle(() => reject(abortError()));
    const handleError = (event: ErrorEvent) =>
      settle(() => reject(new Error(event.message || 'ONNX inference worker failed')));
    const handleMessage = (event: MessageEvent<InferenceWorkerResponse>) => {
      const response = event.data;
      if (!response || response.generationId !== generationId) return;
      if (response.type === 'progress') {
        onProgress(response.stage, response.progress);
        return;
      }
      if (response.type === 'error') {
        settle(() => reject(new Error(response.message)));
        return;
      }
      settle(() =>
        resolve(response.result),
      );
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
    worker.addEventListener('message', handleMessage as EventListener);
    worker.addEventListener('error', handleError as EventListener, { once: true });

    const request: InferenceWorkerRequest = {
      type: 'run',
      generationId,
      model,
      file,
      wasmUrl,
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
};
