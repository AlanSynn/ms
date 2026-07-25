import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  contextHelpFor,
  type ContextHelpId,
  type HelpLocale,
} from "../../utils/contextHelp";
import { recordStudyEvent } from "../../utils/studyTelemetryBoundary";

export const ContextHelp = ({
  helpId,
  locale,
  className = "",
}: {
  helpId: ContextHelpId;
  locale?: HelpLocale;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();
  const entry = contextHelpFor(helpId, locale);
  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 224;
    const margin = 8;
    const height = popoverRef.current?.offsetHeight ?? 112;
    const below = rect.bottom + margin;
    const above = rect.top - height - margin;
    const top =
      below + height > window.innerHeight - margin && above >= margin
        ? above
        : Math.min(
            below,
            Math.max(margin, window.innerHeight - height - margin),
          );
    setPosition({
      left: Math.min(
        Math.max(rect.left + rect.width / 2, width / 2 + margin),
        window.innerWidth - width / 2 - margin,
      ),
      top,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  return (
    <span
      className={`inline-flex align-middle ${className}`}
      data-help-id={helpId}
      onBlur={(event) => {
        const nextFocus =
          typeof Node !== "undefined" && event.relatedTarget instanceof Node
            ? event.relatedTarget
            : null;
        if (!event.currentTarget.contains(nextFocus)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-black leading-none text-slate-500 shadow-sm transition hover:border-violet-400 hover:text-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-300"
        aria-label="Context help"
        title={entry.title}
        aria-controls={open ? popoverId : undefined}
        aria-describedby={open ? popoverId : undefined}
        aria-expanded={open}
        data-testid="context-help-trigger"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          recordStudyEvent(
            "help.context",
            { helpId, action: open ? "close" : "open" },
            { level: "metrics" },
          );
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <span
            ref={popoverRef}
            id={popoverId}
            role="tooltip"
            className="rounded-2xl border border-slate-200 bg-white p-3 text-left text-xs normal-case tracking-normal text-slate-600 shadow-xl"
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              zIndex: 120,
              width: "14rem",
              transform: "translateX(-50%)",
            }}
            data-testid="context-help-popover"
          >
            <span className="block text-sm font-black text-slate-900">
              {entry.title}
            </span>
            <span className="mt-1 block leading-5">{entry.body}</span>
          </span>,
          document.body,
        )}
    </span>
  );
};
