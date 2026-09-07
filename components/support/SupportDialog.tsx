import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

export type SupportReturnFocus = { target: HTMLElement | null; restore: boolean };

export const SupportDialog = ({ title, testId, children, onClose, returnFocus, startup = false, scrollBody = false }: {
  title: string;
  testId: string;
  children: ReactNode;
  onClose: () => void;
  returnFocus: SupportReturnFocus;
  startup?: boolean;
  scrollBody?: boolean;
}) => {
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    (panel.current?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)')
      ?? panel.current?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), button:not(:disabled)')
      ?? panel.current)?.focus();
  }, [title]);
  useEffect(() => () => {
    // React removes shell inert state in the same effects pass.
    queueMicrotask(() => {
      if (returnFocus.restore && returnFocus.target?.isConnected) returnFocus.target.focus();
    });
  }, [returnFocus]);
  return <div className={`support-backdrop${startup ? ' support-startup' : ''}`} data-capture-exclude onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section ref={panel} className={'modal-sheet support-panel' + (scrollBody ? ' support-release-panel' : '')} role="dialog" aria-modal="true"
      aria-label={title} data-testid={testId} tabIndex={-1} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key !== 'Tab') return;
        const controls = [...(panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"], a[href]',
        ) ?? [])].filter(element => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }}>
      {children}
    </section>
  </div>;
};
