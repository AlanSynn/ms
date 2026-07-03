import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { ProjectState } from "../../../types";

export const processingLabel = (
  stage: ProjectState["processing"]["stage"],
  message: string,
) => {
  if (stage === "error") return message || "Fix needed";
  if (stage === "ready") return "Ready";
  if (stage === "downloading-model") return "Getting AI…";
  if (stage === "loading-model") return "Opening…";
  if (stage === "running-onnx") return "Finding joints…";
  if (stage === "extracting-parts") return "Cutting parts…";
  if (stage === "normalizing") return "Fitting sheet…";
  return message || "Pick file";
};

export const ProgressBlock = ({ project }: { project: ProjectState }) => {
  const p = project.processing;
  const steps: Array<{
    stage: ProjectState["processing"]["stage"];
    label: string;
  }> = [
    { stage: "selecting", label: "Pick file" },
    { stage: "downloading-model", label: "Get AI" },
    { stage: "loading-model", label: "Open" },
    { stage: "running-onnx", label: "Find joints" },
    { stage: "extracting-parts", label: "Cut parts" },
    { stage: "normalizing", label: "Fit sheet" },
    { stage: "ready", label: "Ready" },
  ];
  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.stage === p.stage),
  );
  return (
    <div className="progress-card rounded-3xl p-5">
      <div className="flex items-center gap-3">
        {p.stage === "error" ? (
          <AlertCircle className="text-red-400" />
        ) : p.stage === "ready" ? (
          <CheckCircle2 className="text-emerald-400" />
        ) : (
          <Loader2 className="progress-icon animate-spin" />
        )}
        <div>
          <div className="font-bold">{processingLabel(p.stage, p.message)}</div>
          <div className="progress-stage text-xs" title={p.stage}>
            {p.progress}%
          </div>
        </div>
      </div>
      <div className="progress-track mt-4 h-2 rounded-full">
        <div
          className="progress-bar h-2 rounded-full transition-all"
          style={{ width: `${p.progress}%` }}
        />
      </div>
      {project.settings.detailedProcessingSteps && (
        <ol
          className="mt-4 grid gap-2 text-xs text-slate-600"
          data-testid="processing-step-details"
        >
          {steps.map((step, index) => (
            <li
              key={step.stage}
              className={`flex items-center gap-2 ${index <= activeIndex || p.stage === "error" ? "font-bold text-slate-800" : ""}`}
            >
              <span
                className={`h-2 w-2 rounded-full ${index <= activeIndex ? "bg-indigo-500" : "bg-slate-300"}`}
              />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
      {p.error && (
        <pre className="mt-4 max-h-32 overflow-auto whitespace-pre-wrap rounded-2xl bg-red-950/60 p-3 text-xs text-red-100">
          {p.error}
        </pre>
      )}
    </div>
  );
};
