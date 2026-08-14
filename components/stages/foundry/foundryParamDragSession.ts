import type { FoundryParamHandleId } from "./FoundryOverlayLayer";
import type { Point } from "../../../types";
import {
  createFrameCommitQueue,
  type FrameCommitScheduler,
} from "../../../utils/frameCommitQueue";

type FoundryParamDrag = {
  pointerId: number;
  handle: FoundryParamHandleId;
};

export type FoundryParamDragSample = {
  handle: FoundryParamHandleId;
  point: Point;
};

export const createFoundryParamDragSession = ({
  commit,
  scheduler,
}: {
  commit: (sample: FoundryParamDragSample) => void;
  scheduler?: FrameCommitScheduler;
}) => {
  let drag: FoundryParamDrag | null = null;
  const frameQueue = createFrameCommitQueue({ commit, scheduler });

  const reset = () => {
    frameQueue.cancel();
    drag = null;
  };

  return {
    start: (pointerId: number, handle: FoundryParamHandleId) => {
      frameQueue.cancel();
      drag = { pointerId, handle };
    },
    current: () => (drag ? { ...drag } : undefined),
    move: (pointerId: number, point: Point) => {
      if (!drag || drag.pointerId !== pointerId) return;
      frameQueue.queue({ handle: drag.handle, point });
    },
    finish: (pointerId: number) => {
      if (!drag || drag.pointerId !== pointerId) return false;
      frameQueue.flush();
      drag = null;
      return true;
    },
    cancel: (pointerId: number) => {
      if (!drag || drag.pointerId !== pointerId) return false;
      frameQueue.cancel();
      drag = null;
      return true;
    },
    reset,
  };
};
