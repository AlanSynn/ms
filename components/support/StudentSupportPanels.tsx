import type { AppStage } from '../../types';
import type { StudentSupport } from '../../hooks/useStudentSupport';
import { SupportDialog } from './SupportDialog';
import { FeatureSearchPanel } from './FeatureSearchPanel';
import { FeedbackPanel } from './FeedbackPanel';
import { WhatsNewPanel } from './WhatsNewPanel';
import './support.css';

export const StudentSupportPanels = ({ support, stage }: { support: StudentSupport; stage: AppStage }) => {
  if (!support.surface) return null;
  const title = support.surface === 'search' ? 'Find a feature' : support.surface === 'feedback' ? 'Feedback' : "What's new";
  return <SupportDialog title={title} testId={`support-${support.surface}`} onClose={support.close}
    returnFocus={support.returnFocus} startup={support.startupAnnouncement}>
    {support.surface === 'search' && <FeatureSearchPanel stage={stage} onReveal={support.reveal}
      onSuggest={support.suggest} onClose={support.close} notice={support.notice} />}
    {support.surface === 'feedback' && <FeedbackPanel feedback={support.feedback}
      onClose={support.close} onDiscard={support.discard} />}
    {support.surface === 'whatsNew' && <WhatsNewPanel entry={support.notes.entry}
      startup={support.startupAnnouncement} onRendered={support.noteRendered}
      onReveal={support.reveal} onClose={support.close} />}
  </SupportDialog>;
};
