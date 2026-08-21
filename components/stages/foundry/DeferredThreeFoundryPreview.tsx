import {
  Suspense,
  lazy,
  startTransition,
  useEffect,
  useState,
} from "react";

import type {
  ThreeFoundryPreviewProps,
} from "./ThreeFoundryPreview";

type ThreeFoundryPreviewComponent =
  (typeof import("./ThreeFoundryPreview"))["ThreeFoundryPreview"];

let previewModulePromise:
  | Promise<{ default: ThreeFoundryPreviewComponent }>
  | undefined;

export const preloadThreeFoundryPreview = () => {
  previewModulePromise ??= import("./ThreeFoundryPreview").then((module) => {
    return { default: module.ThreeFoundryPreview };
  }).catch((error) => {
    previewModulePromise = undefined;
    throw error;
  });
  return previewModulePromise;
};

const LazyThreeFoundryPreview = lazy(preloadThreeFoundryPreview);

const PreviewPlaceholder = ({
  failed = false,
  onRetry,
}: {
  failed?: boolean;
  onRetry?: () => void;
}) => (
  <div
    className="foundry-preview flex h-[520px] w-full items-center justify-center"
    data-testid="foundry-preview-loading"
    data-preview-load-state={failed ? "failed" : "loading"}
    aria-hidden={failed ? undefined : "true"}
  >
    {failed && (
      <button
        type="button"
        className="btn-secondary"
        data-testid="foundry-preview-retry"
        onClick={onRetry}
      >
        Retry preview
      </button>
    )}
  </div>
);

export const DeferredThreeFoundryPreview = (
  props: ThreeFoundryPreviewProps,
) => {
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let firstFrame = 0;
    let secondFrame = 0;
    setLoadState("loading");
    void preloadThreeFoundryPreview().then(() => {
      if (!active) return;
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (active) startTransition(() => setLoadState("ready"));
        });
      });
    }).catch(() => {
      if (active) setLoadState("failed");
    });
    return () => {
      active = false;
      if (firstFrame) window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [loadAttempt]);

  if (loadState === "failed") {
    return (
      <PreviewPlaceholder
        failed
        onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
      />
    );
  }
  if (loadState !== "ready") return <PreviewPlaceholder />;

  return (
    <Suspense fallback={<PreviewPlaceholder />}>
      <LazyThreeFoundryPreview {...props} />
    </Suspense>
  );
};
