import { useSyncExternalStore } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ProjectState } from "../../../types";
import type { CharacterImportProgressStore } from "../../../runtime/import/characterImportProgressStore";
import type { PendingCharacterReview } from "../../../runtime/import/characterImportProgressStore";
import { ProgressBlock } from "./ProgressBlock";

export type { PendingCharacterReview } from "../../../runtime/import/characterImportProgressStore";

const activeImportStages = new Set([
  "loading-model",
  "normalizing",
  "error",
]);

const compactPackageSummary = (summary: string) =>
  summary.replace(/ready to review/gi, "ready");

export const CharacterImportStatusDock = ({
  project,
  progressStore,
}: {
  project: ProjectState;
  progressStore: CharacterImportProgressStore;
}) => {
  const transientProgress = useSyncExternalStore(
    progressStore.subscribeProgress,
    progressStore.getProgress,
    progressStore.getProgress,
  );
  const pendingCharacter = useSyncExternalStore(
    progressStore.subscribePending,
    progressStore.getPending,
    progressStore.getPending,
  );
  const reviewedProject = pendingCharacter?.project ?? project;
  const processing = transientProgress ?? project.processing;
  const artifact = reviewedProject.characterPackage;
  const showImportProgress = Boolean(
    project.settings.detailedProcessingSteps ||
      activeImportStages.has(processing.stage) ||
      ((transientProgress !== null || pendingCharacter !== null) &&
        processing.stage === "ready"),
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
          <ProgressBlock project={project} processing={processing} />
        </div>
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
        <div className="character-import-review-title" data-capture-mask>
          {pendingCharacter.project.metadata.name}
        </div>
        <div className="character-import-review-meta">
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

export const CharacterImportReviewBoundary = ({
  progressStore,
  onAccept,
  onDiscard,
}: {
  progressStore: CharacterImportProgressStore;
  onAccept: () => void;
  onDiscard: () => void;
}) => {
  const pendingCharacter = useSyncExternalStore(
    progressStore.subscribePending,
    progressStore.getPending,
    progressStore.getPending,
  );
  return (
    <CharacterImportReviewDialog
      pendingCharacter={pendingCharacter}
      onAccept={onAccept}
      onDiscard={onDiscard}
    />
  );
};
