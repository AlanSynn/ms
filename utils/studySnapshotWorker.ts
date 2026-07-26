import type { ProjectState } from "../types";
import { prepareStudySnapshotRecords } from "./studyTelemetryProject";

type SnapshotWorkerRequest = {
  generation: number;
  project: ProjectState;
  alias: string;
  reason: string;
  snapshotId: string;
};

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SnapshotWorkerRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (event) => {
  const startedAt = performance.now();
  void prepareStudySnapshotRecords(
    event.data.project,
    event.data.alias,
    event.data.reason,
    event.data.snapshotId,
  ).then(({ contentHash, records }) => {
    workerScope.postMessage({
      generation: event.data.generation,
      contentHash,
      records,
      durationMs: performance.now() - startedAt,
    });
  }).catch(() => {
    workerScope.postMessage({
      generation: event.data.generation,
      error: "snapshot_prepare_failed",
    });
  });
};
