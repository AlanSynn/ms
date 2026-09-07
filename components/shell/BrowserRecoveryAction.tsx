import { RotateCcw } from 'lucide-react';
import type { BrowserRecoveryCandidate } from '../../hooks/useColdAutosaveRecovery';

export const BrowserRecoveryAction = ({ candidate, onRecover }: {
  candidate: BrowserRecoveryCandidate;
  onRecover: () => void;
}) => {
  const date = candidate.backedUpAt === undefined ? undefined : new Date(candidate.backedUpAt);
  const knownDate = date && Number.isFinite(date.getTime()) ? date : undefined;
  return <button type="button" className="btn-secondary browser-recovery-action"
    data-testid="recover-browser-backup" onClick={onRecover}>
    <RotateCcw size={16} aria-hidden="true" />
    <span><strong>Recover browser backup</strong>
      <small><span data-capture-mask>{candidate.projectName}</span> · {knownDate
        ? <time dateTime={knownDate.toISOString()}>{new Intl.DateTimeFormat('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }).format(knownDate)}</time>
        : 'Backup time unavailable'}</small>
    </span>
  </button>;
};
