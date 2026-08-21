import {
  autosaveByteLength,
  autosaveFingerprint,
} from "../../utils/autosaveFingerprint";
import { serializeProjectCompact } from "../../utils/projectSerialization";
import type { ProjectState } from "../../types";

type AutosaveWorkerRequest = {
  id: number;
  generation: number;
  project: ProjectState;
};
type AutosaveWorkerResponse =
  | {
      id: number;
      generation: number;
      type: "prepared";
      serialized: string;
      bytes: number;
      fingerprint: string;
    }
  | { id: number; generation: number; type: "error"; message: string };

self.onmessage = ({ data }: MessageEvent<AutosaveWorkerRequest>) => {
  const post = (message: AutosaveWorkerResponse) => self.postMessage(message);
  try {
    const serialized = serializeProjectCompact(data.project);
    post({
      id: data.id,
      generation: data.generation,
      type: "prepared",
      serialized,
      bytes: autosaveByteLength(serialized),
      fingerprint: autosaveFingerprint(serialized),
    });
  } catch (error) {
    post({
      id: data.id,
      generation: data.generation,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
