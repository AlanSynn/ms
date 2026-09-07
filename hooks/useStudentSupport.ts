import { useRef, useState, type RefObject } from 'react';
import type { AppStage, ProjectState } from '../types';
import type { AppMenuId } from '../utils/appCommands';
import type { FeatureId } from '../utils/featureDestinations';
import type { SupportReturnFocus } from '../components/support/SupportDialog';
import { useFeatureReveal } from './useFeatureReveal';
import { useFeedbackDraft } from './useFeedbackDraft';
import type { useReleaseNotes } from './useReleaseNotes';

export type SupportSurface = 'search' | 'feedback' | 'whatsNew';
export type SupportMenuRequest = { id: AppMenuId; sequence: number };

export const useStudentSupport = ({ rootRef, project, stage, goStage, onStatus, notes, startupAnnouncement, onDismissStartup }: {
  rootRef: RefObject<HTMLElement | null>;
  project: ProjectState;
  stage: AppStage;
  goStage: (stage: AppStage) => void;
  onStatus: (message: string) => void;
  notes: ReturnType<typeof useReleaseNotes>;
  startupAnnouncement: boolean;
  onDismissStartup: () => void;
}) => {
  const [manualSurface, setSurface] = useState<SupportSurface | null>(null);
  const surface = startupAnnouncement ? 'whatsNew' : manualSurface;
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const [notice, setNotice] = useState('');
  const [menuRequest, setMenuRequest] = useState<SupportMenuRequest>();
  const returnFocus = useRef<SupportReturnFocus>({ target: null, restore: true });
  const renderedNotes = useRef(new Set<string>());
  const feedback = useFeedbackDraft({ rootRef, stage });

  const acknowledgeNotes = () => {
    if (surfaceRef.current === 'whatsNew') {
      for (const id of renderedNotes.current) notes.markViewed(id);
    }
    renderedNotes.current.clear();
  };
  const open = (next: SupportSurface, suggestion?: string) => {
    if (startupAnnouncement) return;
    acknowledgeNotes();
    if (!surfaceRef.current) {
      returnFocus.current = {
        target: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        restore: true,
      };
    }
    if (next === 'feedback') feedback.openDraft(suggestion, suggestion ? 'idea' : 'problem');
    setNotice('');
    surfaceRef.current = next;
    setSurface(next);
  };
  const { revealFeature, cancelReveal } = useFeatureReveal({
    rootRef, project, stage, goStage,
    openMenu: id => setMenuRequest(previous => ({ id, sequence: (previous?.sequence ?? 0) + 1 })),
    openSupport: next => open(next),
    onStatus: message => { setNotice(message); onStatus(message); },
  });
  const close = () => {
    acknowledgeNotes();
    cancelReveal();
    surfaceRef.current = null;
    setSurface(null);
    if (startupAnnouncement) onDismissStartup();
  };
  const reveal = (id: FeatureId) => {
    if (id === 'help.feedback' || id === 'help.whatsNew') {
      open(id === 'help.feedback' ? 'feedback' : 'whatsNew');
      return;
    }
    if (!revealFeature(id)) return;
    acknowledgeNotes();
    returnFocus.current.restore = false;
    surfaceRef.current = null;
    setSurface(null);
  };
  return {
    surface, returnFocus: startupAnnouncement ? { target: null, restore: false } : returnFocus.current,
    startupAnnouncement, notice, menuRequest, notes, feedback,
    noteRendered: (id: string) => { renderedNotes.current.add(id); },
    open, close, reveal,
    suggest: (draft: string) => open('feedback', draft),
    discard: () => { feedback.discard(); close(); },
  };
};

export type StudentSupport = ReturnType<typeof useStudentSupport>;
