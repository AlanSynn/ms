import { memo, useEffect } from "react";

import { useStudySummaryTelemetry } from "../../hooks/useStudySummaryTelemetry";
import {
  browserStudySummarySession,
} from "../../infrastructure/study-summary/browserSession";
import type { AppStage } from "../../types";
import { normalizeErrorName } from "../../utils/studySummaryTelemetry";

const errorNameOf = (value: unknown) => {
  if (!value || typeof value !== "object" || !("name" in value))
    return "unknown" as const;
  return normalizeErrorName((value as { name?: unknown }).name);
};

export const StudySummaryLifecycle = memo(function StudySummaryLifecycle({
  stage,
}: {
  stage: AppStage;
}) {
  const session = browserStudySummarySession();
  useStudySummaryTelemetry({ session, stage });

  useEffect(() => {
    if (!session) return;
    const onError = (event: ErrorEvent) =>
      session.recordError(errorNameOf(event.error));
    const onUnhandledRejection = (event: PromiseRejectionEvent) =>
      session.recordError(errorNameOf(event.reason));
    const onPageHide = () => session.beacon();
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [session]);

  return null;
});
