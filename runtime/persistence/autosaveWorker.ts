import { serializeProject } from "../../utils/project";
import type { ProjectState } from "../../types";

type AutosaveWorkerRequest = {
  id: number;
  generation: number;
  project: ProjectState;
};
type AutosaveWorkerResponse =
  | { id: number; generation: number; type: "prepared"; serialized: string }
  | { id: number; generation: number; type: "error"; message: string };

self.onmessage = ({ data }: MessageEvent<AutosaveWorkerRequest>) => {
  const post = (message: AutosaveWorkerResponse) => self.postMessage(message);
  try {
    post({
      id: data.id,
      generation: data.generation,
      type: "prepared",
      serialized: serializeProject(data.project),
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
