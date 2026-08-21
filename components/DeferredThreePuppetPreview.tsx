import {
  Suspense,
  lazy,
  startTransition,
  useEffect,
  useState,
  type ComponentProps,
} from "react";

type ThreePuppetPreviewComponent =
  (typeof import("./ThreePuppetPreview"))["ThreePuppetPreview"];
type DeferredThreePuppetPreviewProps = ComponentProps<ThreePuppetPreviewComponent>;

let previewModulePromise:
  | Promise<{ default: ThreePuppetPreviewComponent }>
  | undefined;

export const preloadThreePuppetPreview = () => {
  previewModulePromise ??= import("./ThreePuppetPreview").then((module) => {
    return { default: module.ThreePuppetPreview };
  }).catch((error) => {
    previewModulePromise = undefined;
    throw error;
  });
  return previewModulePromise;
};

const LazyThreePuppetPreview = lazy(preloadThreePuppetPreview);

const PreviewPlaceholder = ({
  testId,
  failed = false,
  onRetry,
}: {
  testId: string;
  failed?: boolean;
  onRetry?: () => void;
}) => (
  <div
    className="three-puppet-overlay flex items-center justify-center"
    data-testid={`${testId}-loading`}
    data-preview-load-state={failed ? "failed" : "loading"}
    aria-hidden={failed ? undefined : "true"}
  >
    {failed && (
      <button
        type="button"
        className="btn-secondary"
        data-testid={`${testId}-retry`}
        onClick={onRetry}
      >
        Retry preview
      </button>
    )}
  </div>
);

export const DeferredThreePuppetPreview = ({
  testId = "three-puppet",
  ...props
}: DeferredThreePuppetPreviewProps) => {
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let firstFrame = 0;
    let secondFrame = 0;
    setLoadState("loading");
    void preloadThreePuppetPreview().then(() => {
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
        testId={testId}
        failed
        onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
      />
    );
  }
  if (loadState !== "ready") return <PreviewPlaceholder testId={testId} />;

  return (
    <Suspense fallback={<PreviewPlaceholder testId={testId} />}>
      <LazyThreePuppetPreview {...props} testId={testId} />
    </Suspense>
  );
};
