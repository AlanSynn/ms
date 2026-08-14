import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { AppStage, ProjectState } from "../../../types";
import type { WebOnnxResult } from "../../../utils/webOnnxProtocol";
import { cancelWebOnnxProcessing } from "../../../utils/webOnnx";
import { ProgressBlock } from "./ProgressBlock";

export type PendingCharacterReview = {
  project: ProjectState;
  summary: string;
  returnStage: AppStage;
  onnxMetrics?: WebOnnxResult["metrics"];
};

const activeImportStages = new Set([
  "downloading-model",
  "loading-model",
  "running-onnx",
  "extracting-parts",
  "normalizing",
  "error",
]);

const cancelableImportStages = new Set([
  "downloading-model",
  "loading-model",
  "running-onnx",
  "extracting-parts",
  "normalizing",
]);

const compactPackageSummary = (summary: string) =>
  summary.replace(/ready to review/gi, "ready");

export const CharacterImportStatusDock = ({
  project,
  reviewedProject,
}: {
  project: ProjectState;
  reviewedProject: ProjectState;
}) => {
  const artifact = reviewedProject.characterPackage;
  const showImportProgress = Boolean(
    project.settings.detailedProcessingSteps ||
      activeImportStages.has(project.processing.stage),
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
      ok: reviewedProject.partOrder.some((id) =>
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
          <ProgressBlock project={project} />
        </div>
        {cancelableImportStages.has(project.processing.stage) && (
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={cancelWebOnnxProcessing}
          >
            Cancel
          </button>
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
  if (!pendingCharacter) return null;

  const pendingStats = `${pendingCharacter.project.partOrder.length} parts · ${
    Object.keys(pendingCharacter.project.skeleton?.joints ?? {}).length
  } joints`;
  const previewUrl =
    pendingCharacter.project.characterPackage?.sourceTextureUrl ??
    pendingCharacter.project.parts[pendingCharacter.project.partOrder[0] ?? ""]?.textureUrl;

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
          {pendingCharacter.project.metadata.name}
        </div>
        {previewUrl && (
          <div className="mx-auto h-32 max-w-xs rounded-2xl bg-slate-100">
            <img
              className="h-full max-h-32 object-contain"
              src={previewUrl}
              alt="Imported character"
              width={320}
              height={128}
              decoding="async"
            />
          </div>
        )}
        <div
          className="character-import-review-meta"
          data-testid="character-import-media-summary"
          data-art-parts={pendingCharacter.project.partOrder.filter((id) => Boolean(pendingCharacter.project.parts[id]?.textureUrl)).length}
          data-mask-parts={pendingCharacter.project.partOrder.filter((id) => Boolean(pendingCharacter.project.parts[id]?.maskUrl)).length}
          data-total-parts={pendingCharacter.project.partOrder.length}
          data-model-init-ms={pendingCharacter.onnxMetrics?.modelInitMs ?? ""}
          data-model-path={pendingCharacter.onnxMetrics?.modelPath ?? ""}
          data-model-reused={pendingCharacter.onnxMetrics?.modelReused ? "true" : "false"}
          data-inference-ms={pendingCharacter.onnxMetrics?.inferenceMs ?? ""}
          data-owned-model-buffer-references-retained={pendingCharacter.onnxMetrics?.ownedModelBufferReferencesRetained ?? ""}
          data-retained-model-session-count={pendingCharacter.onnxMetrics?.retainedModelSessionCount ?? ""}
          data-request-tensor-retained-bytes={pendingCharacter.onnxMetrics?.requestTensorRetainedBytes ?? ""}
          data-image-bitmap-closed={pendingCharacter.onnxMetrics?.imageBitmapClosed ? "true" : "false"}
          data-part-texture-data-url-chars={pendingCharacter.onnxMetrics?.partTextureDataUrlChars ?? ""}
          data-part-mask-data-url-chars={pendingCharacter.onnxMetrics?.partMaskDataUrlChars ?? ""}
        >
          {pendingStats || compactPackageSummary(pendingCharacter.summary)}
        </div>
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
