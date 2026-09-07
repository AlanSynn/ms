import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { AppStage, ProjectState } from '../types';
import type { AppMenuId } from '../utils/appCommands';
import { planFeatureReveal, type FeatureId, type SupportFeatureSurface } from '../utils/featureDestinations';

export type FeatureRevealOptions = {
  rootRef: RefObject<HTMLElement | null>;
  project: ProjectState;
  stage: AppStage;
  goStage: (stage: AppStage) => void;
  openMenu: (menu: AppMenuId) => void;
  openSupport: (surface: SupportFeatureSurface) => void;
  onStatus: (message: string) => void;
};

const stagePanesReady = (root: HTMLElement, stage: AppStage) => {
  const frame = root.querySelector<HTMLElement>(`[data-stage="${stage}"]`);
  const panes = frame?.querySelectorAll('[data-pane-content-ready]');
  return Boolean(panes?.length && Array.from(panes).every(pane => pane.getAttribute('data-pane-content-ready') === 'true'));
};

/** DOM boundary only: reveal controls without activating an editing command. */
export const beginFeatureReveal = (options: FeatureRevealOptions, id: FeatureId): { accepted: boolean; cancel: () => void } => {
  const plan = planFeatureReveal(id, options.project, options.stage);
  if (!plan.ok) {
    options.onStatus(plan.message);
    return { accepted: false, cancel: () => {} };
  }
  const { destination } = plan;
  if (destination.surface) {
    options.openSupport(destination.surface);
    return { accepted: true, cancel: () => {} };
  }
  const root = options.rootRef.current;
  if (!root) {
    options.onStatus('Editor is opening. Try again.');
    return { accepted: false, cancel: () => {} };
  }
  let observer: MutationObserver | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let clearHighlight: (() => void) | undefined;
  let cancelled = false;
  const cleanup = () => {
    cancelled = true;
    observer?.disconnect();
    if (highlightTimer !== undefined) clearTimeout(highlightTimer);
    clearHighlight?.();
  };

  const locate = () => {
    if (cancelled || root.closest('[inert]')) return;
    const target = root.querySelector<HTMLElement>(`[data-feature-id="${destination.targetId}"]`);
    if (!target) {
      if (destination.stage && stagePanesReady(root, destination.stage)) {
        observer?.disconnect();
        options.onStatus(destination.unavailable ?? 'Choose a target first.');
      }
      return;
    }
    const frame = target.closest('[data-stage]');
    if (destination.stage && (frame
      ? frame.getAttribute('data-stage') !== destination.stage
      : !stagePanesReady(root, destination.stage))) return;
    for (let parent = target.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    if (!target.getClientRects().length || target.closest('[inert], [hidden]')) return;
    observer?.disconnect();
    const disabled = target.matches(':disabled') || target.getAttribute('aria-disabled') === 'true';
    const focusTarget = disabled ? target.parentElement ?? target : target;
    const previousTabIndex = focusTarget.getAttribute('tabindex');
    if (!focusTarget.matches('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]')) {
      focusTarget.setAttribute('tabindex', '-1');
    }
    // Native nearest scrolling respects each stage's independent scroll container.
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    focusTarget.focus({ preventScroll: true });
    target.setAttribute('data-feature-highlighted', 'true');
    clearHighlight = () => {
      target.removeAttribute('data-feature-highlighted');
      if (previousTabIndex === null) focusTarget.removeAttribute('tabindex');
      else focusTarget.setAttribute('tabindex', previousTabIndex);
    };
    highlightTimer = setTimeout(clearHighlight, 3_000);
    options.onStatus(disabled
      ? target.dataset.featureBlocker ?? 'Complete the previous step first.'
      : `${destination.label} · ${destination.location}`);
  };

  observer = new MutationObserver(locate);
  observer.observe(root, { subtree: true, childList: true, attributes: true });
  if (destination.stage && destination.stage !== options.stage) options.goStage(destination.stage);
  if (destination.menu) options.openMenu(destination.menu);
  locate();
  return { accepted: true, cancel: cleanup };
};

export const useFeatureReveal = (options: FeatureRevealOptions) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cleanupRef = useRef<() => void>(() => {});
  const cancelReveal = useCallback(() => {
    cleanupRef.current();
    cleanupRef.current = () => {};
  }, []);
  const revealFeature = useCallback((id: FeatureId) => {
    cancelReveal();
    const result = beginFeatureReveal(optionsRef.current, id);
    cleanupRef.current = result.cancel;
    return result.accepted;
  }, [cancelReveal]);
  useEffect(() => cancelReveal, [cancelReveal]);
  return { revealFeature, cancelReveal };
};
