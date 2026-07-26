import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppStage, ProjectState } from "../../../types";
import { ProgressBlock } from "./ProgressBlock";

export const IMAGE_IMPORT_PROCESSING_EVENT = "motionsmith:image-import-processing";
export const IMAGE_IMPORT_REVIEW_EVENT = "motionsmith:image-import-review";

export type PendingCharacterReview = {
  project: ProjectState;
  summary: string;
  returnStage: AppStage;
};

const activeImportStages = new Set([
  "preparing-image",
  "downloading-model",
  "loading-model",
  "running-onnx",
  "extracting-parts",
  "normalizing",
  "error",
]);

const compactPackageSummary = (summary: string) =>
  summary.replace(/ready to review/gi, "ready");

export const CharacterImportStatusDock = ({
  project,
  reviewedProject,
  onCancel,
  onRetry,
  onStarterRig,
  onCharacterFile,
}: {
  project: ProjectState;
  reviewedProject: ProjectState;
  onCancel: () => void;
  onRetry: () => void;
  onStarterRig: () => void;
  onCharacterFile: () => void;
}) => {
  const [liveProcessing, setLiveProcessing] =
    useState<ProjectState["processing"] | null>(null);
  useEffect(() => {
    const update = (event: Event) =>
      setLiveProcessing(
        (event as CustomEvent<ProjectState["processing"]>).detail,
      );
    window.addEventListener(IMAGE_IMPORT_PROCESSING_EVENT, update);
    return () => window.removeEventListener(IMAGE_IMPORT_PROCESSING_EVENT, update);
  }, []);
  const statusProject = liveProcessing
    ? { ...project, processing: liveProcessing }
    : project;
  const processing = statusProject.processing;
  const artifact = reviewedProject.characterPackage;
  const showImportProgress = Boolean(
    project.settings.detailedProcessingSteps ||
      activeImportStages.has(processing.stage),
  );
  if (!showImportProgress) return null;

  const showImportChecks = project.settings.debugVisuals;
  const isPlainReview =
    artifact?.replacementContext?.mode !== "replace-character";
  const isReplacementReview =
    artifact?.replacementContext?.mode === "replace-character";
  const checks = [
    { label: "parts", ok: Boolean(artifact?.partsInfo) },
    {
      label: "skeleton",
      ok: Boolean(artifact?.charCfg && reviewedProject.skeleton),
    },
    {
      label: "art",
      ok:
        Boolean(reviewedProject.characterPackage?.sourceTextureUrl) ||
        reviewedProject.partOrder.some((id) =>
          Boolean(
            reviewedProject.parts[id]?.textureUrl ||
              reviewedProject.parts[id]?.maskUrl,
          ),
        ),
    },
    {
      label: "outlines",
      ok: reviewedProject.partOrder.some((id) =>
        Boolean(
          reviewedProject.parts[id]?.originalSvgPath ||
            reviewedProject.parts[id]?.enhancedSvgPath,
        ),
      ),
    },
    {
      label: "clean load",
      ok: Boolean(
        artifact && isPlainReview && reviewedProject.mechanisms.length === 0,
      ),
    },
    {
      label: "kept mechanisms",
      ok: Boolean(
        artifact &&
          isReplacementReview &&
          reviewedProject.mechanisms.length > 0 &&
          artifact.replacementContext?.rebindingSummary.includes("preserved"),
      ),
    },
  ];

  return (
    <aside
      className="character-status-dock"
      data-testid="character-status-dock"
      role="dialog"
      aria-label="Import"
      aria-live="polite"
    >
      <details className="advanced-panel import-status" open>
        <summary>Import</summary>
        <div className="mt-3">
          <ProgressBlock project={statusProject} />
        </div>
        {processing.stage !== "error" &&
          processing.stage !== "ready" &&
          processing.stage !== "idle" && (
            <button type="button" className="btn-secondary mt-3" onClick={onCancel}>
              Cancel
            </button>
          )}
        {processing.stage === "error" && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={onRetry}>Retry</button>
            <button type="button" className="btn-secondary" onClick={onStarterRig}>Starter rig</button>
            <button type="button" className="btn-secondary" onClick={onCharacterFile}>Character file</button>
          </div>
        )}
        {showImportChecks && (
          <details className="advanced-panel mt-6">
            <summary>Checks</summary>
            <div className="mt-3 grid gap-3 text-sm text-slate-600">
              {checks.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  {item.ok ? (
                    <CheckCircle2 size={16} className="text-emerald-600" />
                  ) : (
                    <AlertCircle size={16} className="text-amber-600" />
                  )}
                  <span className={item.ok ? "" : "font-bold text-amber-700"}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </details>
    </aside>
  );
};

export const CharacterImportReviewDialog = ({
  pendingCharacter,
  onAccept,
  onDiscard,
}: {
  pendingCharacter: PendingCharacterReview | null;
  onAccept: () => void;
  onDiscard: () => void;
}) => {
  const [liveReview, setLiveReview] = useState<PendingCharacterReview | null>(
    pendingCharacter,
  );
  useEffect(() => {
    const update = (event: Event) =>
      setLiveReview(
        (event as CustomEvent<PendingCharacterReview | null>).detail,
      );
    window.addEventListener(IMAGE_IMPORT_REVIEW_EVENT, update);
    return () => window.removeEventListener(IMAGE_IMPORT_REVIEW_EVENT, update);
  }, []);
  const review = pendingCharacter ?? liveReview;
  if (!review) return null;

  const pendingStats = `${review.project.partOrder.length} parts · ${
    Object.keys(review.project.skeleton?.joints ?? {}).length
  } joints`;
  const previewUrl =
    review.project.characterPackage?.sourceTextureUrl ??
    review.project.partOrder
      .map((id) => review.project.parts[id]?.textureUrl)
      .find((url): url is string => Boolean(url));

  return (
    <section
      className="character-import-review"
      data-testid="character-import-review"
      role="dialog"
      aria-modal="true"
      aria-label="Use imported character"
    >
      <div className="character-import-review-card">
        <div className="character-import-review-status">
          <CheckCircle2 size={24} />
          <span>Ready</span>
        </div>
        <div className="character-import-review-title">
          {review.project.metadata.name}
        </div>
        <div className="character-import-review-meta">
          {pendingStats || compactPackageSummary(review.summary)}
        </div>
        {previewUrl && (
          <img
            className="character-import-review-preview"
            data-testid="character-import-review-preview"
            src={previewUrl}
            alt="Imported character preview"
            decoding="async"
          />
        )}
        <div className="character-import-review-actions">
          <button className="btn-primary" onClick={onAccept}>
            Use it
          </button>
          <button className="btn-secondary" onClick={onDiscard}>
            Skip
          </button>
        </div>
      </div>
    </section>
  );
};
