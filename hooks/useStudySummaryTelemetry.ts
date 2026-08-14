import { useEffect } from "react";
import type { StudyStage, StudySummarySession } from "../utils/studySummaryTelemetry";

/**
 * Thin stage-adapter wrapper. Session creation, profile policy, endpoint, and
 * transport stay outside React so the product can compile this hook out.
 */
export type StudySummaryTelemetryHookOptions = {
  session?: StudySummarySession | null;
  stage?: StudyStage;
};

export const useStudySummaryTelemetry = ({
  session,
  stage,
}: StudySummaryTelemetryHookOptions): StudySummarySession | undefined => {
  useEffect(() => {
    if (session && stage !== undefined) session.enterStage(stage);
  }, [session, stage]);

  return session ?? undefined;
};
