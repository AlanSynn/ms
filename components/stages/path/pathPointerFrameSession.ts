import {
  createFrameCommitSession,
  type FrameCommitScheduler,
} from "../../../utils/frameCommitQueue";

export const createPathPointerFrameSession = <Value>({
  commit,
  scheduler,
}: {
  commit: (value: Value) => void;
  scheduler?: FrameCommitScheduler;
}) => {
  return createFrameCommitSession({ commit, scheduler });
};
