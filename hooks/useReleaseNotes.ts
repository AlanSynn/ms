import { useEffect, useMemo, useState } from 'react';
import { releaseNotesForVersion } from '../utils/releaseNotes';
import { RELEASE_READ_KEY, releaseReadState } from '../utils/releaseReadState';

const READ_EVENT = 'motionsmith-release-viewed';

export const useReleaseNotes = () => {
  const entries = useMemo(() => releaseNotesForVersion(__APP_VERSION__), []);
  const entry = entries[0];
  const [viewed, setViewed] = useState(() => releaseReadState.read());
  useEffect(() => {
    const sync = () => setViewed(releaseReadState.read());
    const storage = (event: StorageEvent) => {
      if (event.key === RELEASE_READ_KEY) setViewed(releaseReadState.merge(event.newValue));
      else if (event.key === null) sync();
    };
    window.addEventListener('storage', storage);
    window.addEventListener(READ_EVENT, sync);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(READ_EVENT, sync);
    };
  }, []);
  const markViewed = (id: string) => {
    if (!entries.some(note => note.id === id)) return;
    setViewed(releaseReadState.markViewed(id));
    window.dispatchEvent(new Event(READ_EVENT));
  };
  // Only the newest update controls startup. Unread archives never become a
  // queue of dialogs, and acknowledgement never removes entries from history.
  return { entry, entries, hasNew: !!entry && !viewed.has(entry.id), markViewed };
};
