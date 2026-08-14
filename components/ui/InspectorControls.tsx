import { useEffect, useRef, useState } from "react";
import { ContextHelp } from "./ContextHelp";
import type { ContextHelpId } from "../../utils/contextHelp";
import {
  createFrameCommitQueue,
  type FrameCommitQueue,
} from "../../utils/frameCommitQueue";

export const MiniNumber = ({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  constraint,
  helpId,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  constraint?: string;
  helpId?: ContextHelpId;
  onChange: (v: number) => boolean | void;
}) => {
  const onChangeRef = useRef(onChange);
  const boundsRef = useRef({ min, max });
  const rangeQueueRef = useRef<FrameCommitQueue<number> | null>(null);
  const [numberResetVersion, setNumberResetVersion] = useState(0);
  onChangeRef.current = onChange;
  boundsRef.current = { min, max };
  const boundedChange = (next: number) => {
    if (!Number.isFinite(next)) return;
    const bounds = boundsRef.current;
    return onChangeRef.current(
      Math.max(bounds.min, Math.min(bounds.max, next)),
    );
  };
  if (!rangeQueueRef.current) {
    rangeQueueRef.current = createFrameCommitQueue({
      commit: (next: number) => boundedChange(next),
    });
  }
  const flushRangeChange = () => rangeQueueRef.current?.flush();
  useEffect(() => () => rangeQueueRef.current?.cancel(), []);
  const displayedValue = Number.isFinite(value) ? value : min;
  return <label
    className={`block mini-number-control ${disabled ? "is-disabled" : ""}`}
    data-bounded-input={`${min}:${max}:${step}`}
  >
    <div className="mb-1 flex justify-between text-xs font-black uppercase tracking-wider text-slate-500">
      <span className="inline-flex items-center gap-1">
        {label}
        {helpId && <ContextHelp helpId={helpId} />}
      </span>
      <span>{Number(displayedValue).toFixed(step < 1 ? 2 : 0)}</span>
    </div>
    <input
      aria-label={`${label} slider`}
      className="w-full"
      type="range"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={displayedValue}
      aria-valuetext={`${displayedValue}; ${min} to ${max}`}
      onChange={(event) =>
        rangeQueueRef.current?.queue(event.currentTarget.valueAsNumber)
      }
      onPointerUp={flushRangeChange}
      onPointerCancel={flushRangeChange}
      onLostPointerCapture={flushRangeChange}
      onBlur={flushRangeChange}
    />
    <input
      key={numberResetVersion}
      aria-label={`${label} number`}
      className="field mt-1"
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={displayedValue}
      onChange={(event) => {
        const next = event.currentTarget.valueAsNumber;
        if (!Number.isFinite(next)) return;
        if (boundedChange(next) === false) {
          setNumberResetVersion((version) => version + 1);
        }
      }}
    />
    <small className="mini-number-limit">{min}–{max}</small>
    {constraint && <small className="motion-option-lock-note">{constraint}</small>}
  </label>;
};

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
