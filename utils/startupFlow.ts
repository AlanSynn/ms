export const GETTING_STARTED_SESSION_KEY = 'motionsmith.gettingStarted.hiddenSession';
export const BOOT_READY_EVENT = 'motionsmith-boot-ready';
export type StartupStep = 'announcement' | 'entry' | 'editor';

export const initialStartupStep = (hasUnseenUpdate: boolean, hideEntry: boolean): StartupStep =>
  hasUnseenUpdate ? 'announcement' : hideEntry ? 'editor' : 'entry';

export const afterStartupAnnouncement = (hideEntry: boolean): StartupStep =>
  hideEntry ? 'editor' : 'entry';

let hiddenInMemory = false;
export const readGettingStartedHiddenForSession = () => {
  try {
    if (typeof window !== 'undefined') {
      hiddenInMemory = window.sessionStorage.getItem(GETTING_STARTED_SESSION_KEY) === 'true';
    }
  } catch { /* Keep the current session's preference when storage is denied. */ }
  return hiddenInMemory;
};

export const writeGettingStartedHiddenForSession = (hidden: boolean) => {
  hiddenInMemory = hidden;
  try {
    if (typeof window === 'undefined') return;
    if (hidden) window.sessionStorage.setItem(GETTING_STARTED_SESSION_KEY, 'true');
    else window.sessionStorage.removeItem(GETTING_STARTED_SESSION_KEY);
  } catch { /* Session-only onboarding preference is best-effort. */ }
};
