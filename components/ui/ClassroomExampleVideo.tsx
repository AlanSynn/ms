import { useEffect, useMemo, useState } from "react";

import type { ClassroomMechanismUseExample } from "../../utils/classroomContent";
import {
  CLASSROOM_COPY,
  formatClassroomUseExampleLabel,
  youtubeNoCookieEmbedUrl,
} from "../../utils/classroomContent";
import { defaultPhysicalKit } from "../../utils/coordinates";
import { fitMechanismSimulation } from "../../utils/mechanismPreview";
import { createDefaultMechanism } from "../../utils/project";
import { MechanismLinkagePreview } from "../stages/foundry/MechanismLinkagePreview";

const usePrefersReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return reducedMotion;
};

const ClassroomGeneratedLoop = ({
  example,
}: {
  example: ClassroomMechanismUseExample;
}) => {
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState(Math.PI / 5);
  const mechanism = useMemo(
    () => createDefaultMechanism(example.mechanismType, `classroom-${example.mechanismType}-loop`),
    [example.mechanismType],
  );
  const kit = useMemo(() => defaultPhysicalKit(), []);

  useEffect(() => {
    if (reducedMotion) return;
    let frameId = 0;
    const startedAt = performance.now();
    const tick = (time: number) => {
      setPhase(((time - startedAt) / 1200) % (Math.PI * 2));
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [reducedMotion]);

  const simulation = useMemo(
    () => fitMechanismSimulation(mechanism, phase, 160, 96, 56),
    [mechanism, phase],
  );

  return (
    <svg
      viewBox="0 0 160 96"
      role="img"
      aria-label={`${example.label} generated mechanism loop`}
      className="mt-3 h-28 w-full rounded-2xl bg-slate-950 text-white"
      data-testid="classroom-generated-loop"
      data-clip-slot={example.clipSlot}
      data-mechanism-type={example.mechanismType}
      data-renderer-source="MechanismLinkagePreview"
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      <path
        d={simulation.pathD}
        fill="none"
        stroke="#38bdf8"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.65"
      />
      <MechanismLinkagePreview
        mechanism={mechanism}
        simulation={simulation}
        kit={kit}
        testId="classroom-generated-loop-linkage"
        compact
      />
      <text x="16" y="18" fill="#e2e8f0" fontSize="10" fontWeight="700">
        {CLASSROOM_COPY.generatedLoopLabel}
      </text>
    </svg>
  );
};

export const ClassroomExampleVideo = ({
  example,
}: {
  example?: ClassroomMechanismUseExample;
}) => {
  const [open, setOpen] = useState(false);
  const [videoStatus, setVideoStatus] = useState<"idle" | "loading" | "loaded" | "fallback">("idle");
  const embedUrl = example?.youtubeId && example.reviewed
    ? youtubeNoCookieEmbedUrl(example.youtubeId)
    : undefined;

  useEffect(() => {
    if (!open || !embedUrl || videoStatus !== "loading") return;
    const timeout = window.setTimeout(() => {
      setVideoStatus((status) => (status === "loading" ? "fallback" : status));
    }, 1600);
    return () => window.clearTimeout(timeout);
  }, [embedUrl, open, videoStatus]);

  const toggleVideo = () => {
    setOpen((next) => {
      const openNext = !next;
      setVideoStatus(openNext ? "loading" : "idle");
      return openNext;
    });
  };

  if (!example) return null;

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600"
      data-testid="classroom-example-video"
      data-video-source="generated-local"
      data-optional-video={embedUrl ? "youtube-nocookie" : "none"}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-slate-800">{CLASSROOM_COPY.useExampleTitle}</div>
          <span className="classroom-use-label">
            {formatClassroomUseExampleLabel(example)}
          </span>
        </div>
        {embedUrl && (
          <button
            type="button"
            className="chip"
            data-testid="classroom-example-video-toggle"
            data-youtube-id={example.youtubeId}
            aria-expanded={open}
            onClick={toggleVideo}
          >
            {CLASSROOM_COPY.watchExample}
          </button>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600">{example.generatedSummary}</p>
      <div className="mt-2 rounded-2xl bg-violet-50 p-3 text-sm font-bold text-slate-700">
        Watch for: {example.watchFor}
      </div>
      <p className="mt-2 text-sm font-bold text-violet-700">
        Think: {example.studentQuestion}
      </p>
      <ClassroomGeneratedLoop example={example} />
      {open && embedUrl && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
          <iframe
            data-testid="classroom-example-video-frame"
            title={`${example.label} optional example video`}
            src={embedUrl}
            loading="lazy"
            allow="fullscreen; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            onLoad={() => setVideoStatus("loaded")}
            onError={() => setVideoStatus("fallback")}
            className="aspect-video w-full"
          />
          <div
            className="p-3 text-sm font-bold text-white"
            data-testid="classroom-video-fallback"
            data-video-status={videoStatus}
          >
            {videoStatus === "fallback"
              ? CLASSROOM_COPY.videoUnavailable
              : CLASSROOM_COPY.videoOptional}
          </div>
        </div>
      )}
    </div>
  );
};
