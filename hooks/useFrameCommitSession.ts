import { useEffect, useRef } from "react";

import {
  createFrameCommitSession,
  type FrameCommitSession,
} from "../utils/frameCommitQueue";

/** Keep one frame-coalesced gesture session for a mounted React owner. */
export const useFrameCommitSession = <Value>(
  commit: (value: Value) => void,
): FrameCommitSession<Value> => {
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const sessionRef = useRef<FrameCommitSession<Value> | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = createFrameCommitSession({
      commit: (value: Value) => commitRef.current(value),
    });
  }
  const session = sessionRef.current;

  useEffect(() => () => session.reset(), [session]);
  return session;
};
