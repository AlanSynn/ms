import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createUpdateCheckScheduler,
  FIRST_PROBE_DELAY_MS,
  MIN_PROBE_SPACING_MS,
  PROBE_TIMEOUT_MS,
  VISIBLE_TIMER_INTERVAL_MS,
} from './updateCheckScheduler';

export {
  FIRST_PROBE_DELAY_MS,
  MIN_PROBE_SPACING_MS,
  PROBE_TIMEOUT_MS,
  updateCheckBackoffDelayMs,
  VISIBLE_TIMER_INTERVAL_MS,
} from './updateCheckScheduler';

const DISMISSED_KEY_PREFIX = 'motionsmith-update-dismissed:';

export type UpdateCheckState = {
  updateAvailable: boolean;
  remoteBuildId: string | null;
  reloadWithCacheBust: () => void;
  dismissUpdate: () => void;
};

type UpdateSnapshot = { remote: string | null; dismissed: string | null };
type UpdateManifest = { buildId?: unknown };

export const parseUpdateManifest = (value: unknown): UpdateManifest => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('version.json manifest is not an object');
  }
  const manifest = value as UpdateManifest;
  if (typeof manifest.buildId !== 'string') {
    throw new Error('version.json manifest has no build id');
  }
  return manifest;
};

export const updateCheckEnabled = (
  isTauriFlag: boolean,
  hasTauriInternals: boolean,
): boolean => !isTauriFlag && !hasTauriInternals;

export const shouldProbeNow = (lastAttemptAt: number | null, now: number): boolean =>
  lastAttemptAt === null || now >= lastAttemptAt + MIN_PROBE_SPACING_MS;

export const updateBannerState = (
  localBuildId: string,
  remoteBuildId: string | null,
  dismissedBuildId: string | null,
): 'hidden' | 'visible' =>
  remoteBuildId !== null && remoteBuildId !== localBuildId && dismissedBuildId !== remoteBuildId
    ? 'visible'
    : 'hidden';

const isDismissed = (buildId: string): boolean => {
  try {
    return sessionStorage.getItem(DISMISSED_KEY_PREFIX + buildId) !== null;
  } catch {
    return false;
  }
};

export const useUpdateCheck = (): UpdateCheckState | null => {
  const enabled = typeof window !== 'undefined' && updateCheckEnabled(
    !__MOTIONSMITH_UPDATE_CHECK_ENABLED__,
    '__TAURI_INTERNALS__' in window,
  );
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>({ remote: null, dismissed: null });
  const remoteBuildIdRef = useRef<string | null>(null);

  const fetchManifest = useCallback(async (signal: AbortSignal): Promise<UpdateManifest> => {
    const response = await fetch(
      `${import.meta.env.BASE_URL}version.json?t=${Date.now().toString(36)}`,
      { cache: 'no-store', signal },
    );
    if (!response.ok) throw new Error(`version.json probe returned ${response.status}`);
    return parseUpdateManifest(await response.json());
  }, []);

  const publishManifest = useCallback((manifest: UpdateManifest) => {
    if (typeof manifest.buildId !== 'string') return;
    remoteBuildIdRef.current = manifest.buildId;
    setSnapshot({
      remote: manifest.buildId,
      dismissed: isDismissed(manifest.buildId) ? manifest.buildId : null,
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const scheduler = createUpdateCheckScheduler<UpdateManifest>({
      enabled,
      host: {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: handle => window.clearTimeout(handle),
        setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
        clearInterval: handle => window.clearInterval(handle),
        isVisible: () => document.visibilityState === 'visible',
        onVisibilityChange: callback => {
          const listener = () => callback();
          document.addEventListener('visibilitychange', listener);
          return () => document.removeEventListener('visibilitychange', listener);
        },
        onPreloadError: callback => {
          const listener = () => callback();
          window.addEventListener('vite:preloadError', listener);
          return () => window.removeEventListener('vite:preloadError', listener);
        },
      },
      fetchProbe: fetchManifest,
      onSuccess: publishManifest,
      firstProbeDelayMs: FIRST_PROBE_DELAY_MS,
      minimumSpacingMs: MIN_PROBE_SPACING_MS,
      visibleIntervalMs: VISIBLE_TIMER_INTERVAL_MS,
      probeTimeoutMs: PROBE_TIMEOUT_MS,
    });
    scheduler.start();
    return scheduler.dispose;
  }, [enabled, fetchManifest, publishManifest]);

  const reloadWithCacheBust = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('_rs', Date.now().toString(36));
    window.location.replace(url.href);
  }, []);

  const dismissUpdate = useCallback(() => {
    const remoteBuildId = remoteBuildIdRef.current;
    if (remoteBuildId === null) return;
    try {
      sessionStorage.setItem(DISMISSED_KEY_PREFIX + remoteBuildId, '1');
    } catch {
      // Private-mode storage can be unavailable; dismissal just will not persist.
    }
    setSnapshot((previous) => ({ ...previous, dismissed: remoteBuildId }));
  }, []);

  if (!enabled) return null;
  return {
    updateAvailable:
      updateBannerState(__BUILD_ID__, snapshot.remote, snapshot.dismissed) === 'visible',
    remoteBuildId: snapshot.remote,
    reloadWithCacheBust,
    dismissUpdate,
  };
};
