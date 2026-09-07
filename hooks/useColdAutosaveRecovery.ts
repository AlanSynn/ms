import { useEffect, useRef, useState } from "react";
import type { ProjectState } from "../types";
import { createAutosaveRecoveryWorkerClient } from "../runtime/persistence/autosaveRecoveryWorkerClient";
import {
  createProjectDecisionBoundary,
  projectAuthoringChanged,
  type BrowserRecoveryCandidate,
} from "../runtime/persistence/projectDecisionBoundary";
export type { BrowserRecoveryCandidate } from "../runtime/persistence/projectDecisionBoundary";

export const useColdAutosaveRecovery = ({
  project,
}: {
  project: ProjectState;
}) => {
  const initialProjectRef = useRef(project);
  const previousProjectRef = useRef(project);
  const [hasChosenProject, setHasChosenProject] = useState(false);
  const decisionRef = useRef<ReturnType<typeof createProjectDecisionBoundary> | null>(null);
  decisionRef.current ??= createProjectDecisionBoundary(() => setHasChosenProject(true));
  const decision = decisionRef.current;
  const clientRef = useRef<ReturnType<
    typeof createAutosaveRecoveryWorkerClient
  > | null>(null);
  clientRef.current ??= createAutosaveRecoveryWorkerClient();
  const client = clientRef.current;
  const [pending, setPending] = useState(true);
  const [candidate, setCandidate] = useState<BrowserRecoveryCandidate>();

  useEffect(() => {
    const initialProject = initialProjectRef.current;
    const stillChoosing = () => !decision.isAuthorized();
    client.request(
      initialProject,
      {
        complete: (result) => {
          if (result.status === "loaded" && stillChoosing()) {
            setCandidate({
              projectId: result.project.metadata.id,
              projectName: result.project.metadata.name,
              backedUpAt: result.backedUpAt,
            });
          }
          setPending(false);
        },
        failed: () => setPending(false),
        superseded: () => setPending(false),
      },
      stillChoosing,
      { readOnly: true },
    );
    return () => client.dispose();
  }, [client, decision]);

  useEffect(() => {
    if (projectAuthoringChanged(previousProjectRef.current, project)) {
      decision.authoredEdit();
    }
    previousProjectRef.current = project;
    if (decision.isAuthorized()) {
      client.cancel();
      setPending(false);
      setCandidate(undefined);
    }
  }, [client, decision, hasChosenProject, project]);

  return { pending, candidate, decision, hasChosenProject };
};
