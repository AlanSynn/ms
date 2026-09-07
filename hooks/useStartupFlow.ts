import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  afterStartupAnnouncement, initialStartupStep, readGettingStartedHiddenForSession,
  writeGettingStartedHiddenForSession, BOOT_READY_EVENT, type StartupStep,
} from '../utils/startupFlow';

/** One startup surface, chosen before the first render. Never loads a project. */
export const useStartupFlow = (hasUnseenUpdate: boolean) => {
  const [bootReady, setBootReady] = useState(() => typeof document === 'undefined' || !document.getElementById('boot-loader'));
  useEffect(() => {
    const ready = () => setBootReady(true);
    window.addEventListener(BOOT_READY_EVENT, ready);
    if (!document.getElementById('boot-loader')) ready();
    return () => window.removeEventListener(BOOT_READY_EVENT, ready);
  }, []);
  const [hideForSession, setHideForSession] = useState(readGettingStartedHiddenForSession);
  const [step, setStep] = useState<StartupStep>(() => initialStartupStep(hasUnseenUpdate, hideForSession));
  const setShowGettingStarted: Dispatch<SetStateAction<boolean>> = useCallback(next => {
    setStep(current => {
      if (current === 'announcement') return current;
      const show = typeof next === 'function' ? next(current === 'entry') : next;
      return show ? 'entry' : 'editor';
    });
  }, []);
  return {
    booting: !bootReady,
    showAnnouncement: bootReady && step === 'announcement',
    showGettingStarted: bootReady && step === 'entry',
    hideForSession,
    setShowGettingStarted,
    dismissAnnouncement: () => setStep(afterStartupAnnouncement(hideForSession)),
    setHideForSession: (hidden: boolean) => {
      setHideForSession(hidden);
      writeGettingStartedHiddenForSession(hidden);
    },
  };
};
