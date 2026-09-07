import { useEffect, useState } from 'react';
import { releaseNoteForVersion } from '../utils/releaseNotes';
import { RELEASE_READ_KEY, releaseReadState } from '../utils/releaseReadState';

const READ_EVENT = 'motionsmith-release-viewed';

export const useReleaseNotes = () => {
  const entry = releaseNoteForVersion(__APP_VERSION__);
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
    if (entry?.id !== id) return;
    setViewed(releaseReadState.markViewed(id));
    window.dispatchEvent(new Event(READ_EVENT));
  };
  return { entry, hasNew: !!entry && !viewed.has(entry.id), markViewed };
};
