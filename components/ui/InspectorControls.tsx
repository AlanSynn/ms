import { ContextHelp } from "./ContextHelp";
import type { ContextHelpId } from "../../utils/contextHelp";

export const MiniNumber = ({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  helpId,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  helpId?: ContextHelpId;
  onChange: (v: number) => void;
}) => (
  <label className={`block ${disabled ? "opacity-50" : ""}`}>
    <div className="mb-1 flex justify-between text-xs font-black uppercase tracking-wider text-slate-500">
      <span className="inline-flex items-center gap-1">
        {label}
        {helpId && <ContextHelp helpId={helpId} />}
      </span>
      <span>{Number(value).toFixed(step < 1 ? 2 : 0)}</span>
    </div>
    <input
      aria-label={`${label} slider`}
      className="w-full"
      type="range"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value))}
    />
    <input
      aria-label={`${label} number`}
      className="field mt-1"
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  </label>
);

export const Toggle = ({
  label,
  checked,
  disabled = false,
  helpId,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  helpId?: ContextHelpId;
  onChange: (v: boolean) => void;
}) => (
  <label
    className={`flex items-center justify-between rounded-2xl bg-slate-100 px-3 py-2 text-sm font-bold ${disabled ? "opacity-50" : ""}`}
  >
    <span className="inline-flex items-center gap-1">
      {label}
      {helpId && <ContextHelp helpId={helpId} />}
    </span>
    <input
      type="checkbox"
      disabled={disabled}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  </label>
);
