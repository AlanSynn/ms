import { useEffect, useRef, useState, type SetStateAction } from "react";
import type { ProjectState } from "../types";
import { createAutosaveRecoveryWorkerClient } from "../runtime/persistence/autosaveRecoveryWorkerClient";

type ProjectSetter = (
  update: SetStateAction<ProjectState>,
  options?: { history?: boolean; resetHistory?: boolean },
) => void;

export const useColdAutosaveRecovery = ({
  project,
  setProject,
}: {
  project: ProjectState;
  setProject: ProjectSetter;
}) => {
  const initialProjectRef = useRef(project);
  const latestProjectRef = useRef(project);
  latestProjectRef.current = project;
  const setProjectRef = useRef(setProject);
  setProjectRef.current = setProject;
  const clientRef = useRef<ReturnType<
    typeof createAutosaveRecoveryWorkerClient
  > | null>(null);
  clientRef.current ??= createAutosaveRecoveryWorkerClient();
  const client = clientRef.current;
  const [pending, setPending] = useState(true);
  const [recoveredBaseline, setRecoveredBaseline] = useState<
    ProjectState | undefined
  >();

  useEffect(() => {
    const initialProject = initialProjectRef.current;
    const stillInitial = () =>
      latestProjectRef.current === initialProject &&
      latestProjectRef.current.metadata.id === initialProject.metadata.id;
    client.request(
      initialProject,
      {
        complete: (result) => {
          if (result.status === "loaded" && stillInitial()) {
            setRecoveredBaseline(result.project);
            setProjectRef.current(
              (current) =>
                current === initialProject &&
                current.metadata.id === initialProject.metadata.id
                  ? result.project
                  : current,
              { resetHistory: true },
            );
          }
          setPending(false);
        },
        failed: () => setPending(false),
        superseded: () => setPending(false),
      },
      stillInitial,
    );
    return () => client.dispose();
  }, [client]);

  useEffect(() => {
    if (pending && project !== initialProjectRef.current) {
      client.cancel();
      setPending(false);
    }
  }, [client, pending, project]);

  return { pending, recoveredBaseline };
};
