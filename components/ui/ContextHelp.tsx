import { useId, useState } from "react";

import {
  contextHelpFor,
  type ContextHelpId,
  type HelpLocale,
} from "../../utils/contextHelp";

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
  const popoverId = useId();
  const entry = contextHelpFor(helpId, locale);

  return (
    <span
      className={`relative inline-flex align-middle ${className}`}
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
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-black leading-none text-slate-500 shadow-sm transition hover:border-violet-400 hover:text-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-300"
        aria-label="Context help"
        title={entry.title}
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        data-testid="context-help-trigger"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
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
      {open && (
        <span
          id={popoverId}
          role="tooltip"
          className="absolute left-1/2 top-7 z-[80] w-56 -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3 text-left text-xs normal-case tracking-normal text-slate-600 shadow-xl"
          data-testid="context-help-popover"
        >
          <span className="block text-sm font-black text-slate-900">
            {entry.title}
          </span>
          <span className="mt-1 block leading-5">{entry.body}</span>
        </span>
      )}
    </span>
  );
};
