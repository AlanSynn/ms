import type { TrackingGifPlan } from './trackingMediaPolicy';

type GifWorkerResponse =
  | { type: 'ready'; generationId: number; plan: TrackingGifPlan }
  | {
      type: 'frame';
      generationId: number;
      requestId: number;
      index: number;
      bitmap: ImageBitmap;
    }
  | { type: 'error'; generationId: number; message: string };

type WorkerLike = Pick<
  Worker,
  'addEventListener' | 'removeEventListener' | 'postMessage' | 'terminate'
>;

export type GifFrameSessionOptions = {
  generationId: number;
  buffer: ArrayBuffer;
  onReady: (plan: TrackingGifPlan) => void;
  onFrame: (index: number, bitmap: ImageBitmap) => void;
  onError: (message: string) => void;
  createWorker?: () => WorkerLike;
};

export type GifFrameSession = {
  requestFrame: (index: number) => boolean;
  close: () => void;
};

const defaultWorker = (): WorkerLike =>
  new Worker(new URL('../../workers/gifFrameWorker.ts', import.meta.url), {
    type: 'module',
  });

export const createGifFrameSession = ({
  generationId,
  buffer,
  onReady,
  onFrame,
  onError,
  createWorker = defaultWorker,
}: GifFrameSessionOptions): GifFrameSession => {
  if (typeof Worker === 'undefined' && createWorker === defaultWorker) {
    throw new Error('Web Worker support is required for GIF tracing.');
  }
  const worker = createWorker();
  let closed = false;
  let ready = false;
  let inFlight = false;
  let queuedIndex: number | null = null;
  let requestId = 0;

  const sendFrameRequest = (index: number) => {
    inFlight = true;
    requestId += 1;
    worker.postMessage({
      type: 'frame',
      generationId,
      requestId,
      index,
    });
  };

  const handleMessage = (event: MessageEvent<GifWorkerResponse>) => {
    const message = event.data;
    if (!message || message.generationId !== generationId || closed) {
      if (message?.type === 'frame') message.bitmap.close();
      return;
    }
    if (message.type === 'ready') {
      ready = true;
      onReady(message.plan);
      return;
    }
    if (message.type === 'error') {
      inFlight = false;
      queuedIndex = null;
      onError(message.message);
      return;
    }
    if (message.requestId !== requestId) {
      message.bitmap.close();
      return;
    }
    inFlight = false;
    onFrame(message.index, message.bitmap);
    if (queuedIndex !== null) {
      const nextIndex = queuedIndex;
      queuedIndex = null;
      sendFrameRequest(nextIndex);
    }
  };
  const handleError = (event: ErrorEvent) => {
    inFlight = false;
    onError(event.message || 'GIF worker failed');
  };
  worker.addEventListener('message', handleMessage as EventListener);
  worker.addEventListener('error', handleError as EventListener);
  try {
    worker.postMessage(
      { type: 'load', generationId, buffer },
      [buffer],
    );
  } catch (error) {
    worker.removeEventListener('message', handleMessage as EventListener);
    worker.removeEventListener('error', handleError as EventListener);
    worker.terminate();
    throw error;
  }

  return {
    requestFrame: (index) => {
      if (closed || !ready) return false;
      if (inFlight) {
        queuedIndex = index;
        return true;
      }
      sendFrameRequest(index);
      return true;
    },
    close: () => {
      if (closed) return;
      closed = true;
      worker.removeEventListener('message', handleMessage as EventListener);
      worker.removeEventListener('error', handleError as EventListener);
      try {
        worker.postMessage({ type: 'dispose', generationId });
      } finally {
        worker.terminate();
      }
    },
  };
};
