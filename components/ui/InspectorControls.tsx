import { ContextHelp } from "./ContextHelp";
import type { ContextHelpId } from "../../utils/contextHelp";
import { useEffect, useRef, useState } from "react";

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
  onChange: (v: number) => void | boolean;
}) => {
  const displayedValue = Number.isFinite(value) ? value : min;
  const pendingRangeValue = useRef<number | undefined>(undefined);
  const rangeFrame = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const [numberResetVersion, setNumberResetVersion] = useState(0);
  onChangeRef.current = onChange;
  const boundedChange = (next: number) => {
    if (!Number.isFinite(next)) return;
    return onChangeRef.current(Math.max(min, Math.min(max, next)));
  };
  const flushRangeChange = () => {
    if (rangeFrame.current !== undefined) {
      window.cancelAnimationFrame(rangeFrame.current);
      rangeFrame.current = undefined;
    }
    const next = pendingRangeValue.current;
    pendingRangeValue.current = undefined;
    if (next !== undefined) boundedChange(next);
  };
  const queueRangeChange = (next: number) => {
    if (!Number.isFinite(next)) return;
    pendingRangeValue.current = next;
    if (rangeFrame.current !== undefined) return;
    rangeFrame.current = window.requestAnimationFrame(() => {
      rangeFrame.current = undefined;
      const pending = pendingRangeValue.current;
      pendingRangeValue.current = undefined;
      if (pending !== undefined) boundedChange(pending);
    });
  };
  useEffect(() => () => {
    if (rangeFrame.current !== undefined) {
      window.cancelAnimationFrame(rangeFrame.current);
      rangeFrame.current = undefined;
    }
  }, []);
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
      onChange={(event) => queueRangeChange(event.currentTarget.valueAsNumber)}
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
        if (boundedChange(next) === false)
          setNumberResetVersion((version) => version + 1);
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
