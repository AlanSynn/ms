import { useEffect, useRef, useState, type RefObject } from 'react';
import type { AppStage } from '../types';
import {
  FEEDBACK_MAX_MESSAGE_LENGTH, feedbackPayloadDigest,
  type FeedbackCategory, type FeedbackContext, type FeedbackIssue,
  type FeedbackPayload, type FeedbackResponse,
} from '../shared/feedbackProtocol';
import { freezeAppView, type FrozenAppView } from '../utils/appCapture';

export type FeedbackDraft = {
  submissionId: string;
  category: FeedbackCategory;
  message: string;
  context: FeedbackContext;
  screenshot?: Blob;
  capture: 'preparing' | 'ready' | 'failed' | 'removed';
  captureMessage?: string;
  includeScreenshot: boolean;
  phase: 'editing' | 'sending' | 'rejected' | 'unknown' | 'checking';
  notice?: string;
  receipt?: string;
  payloadDigest?: string;
  submittedWithScreenshot?: boolean;
};

export const useFeedbackDraft = ({ rootRef, stage }: {
  rootRef: RefObject<HTMLElement | null>;
  stage: AppStage;
}) => {
  const [draft, setDraftState] = useState<FeedbackDraft | null>(null);
  const draftRef = useRef(draft);
  const busy = useRef(false);
  const mounted = useRef(true);
  const pendingCapture = useRef<FrozenAppView | null>(null);
  const [sent, setSent] = useState<FeedbackIssue | null>(null);
  const update = (next: FeedbackDraft | null) => {
    draftRef.current = next;
    if (mounted.current) setDraftState(next);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; draftRef.current = null;
      pendingCapture.current?.dispose(); pendingCapture.current = null;
    };
  }, []);

  const openDraft = (message = '', category: FeedbackCategory = 'problem') => {
    if (draftRef.current) return;
    setSent(null);
    const next: FeedbackDraft = {
      submissionId: crypto.randomUUID(), category, message,
      context: { version: __APP_VERSION__, stage, viewport: { width: window.innerWidth, height: window.innerHeight } },
      capture: 'preparing', includeScreenshot: true, phase: 'editing',
    };
    update(next);
    // Synchronous freeze precedes panel render, lazy imports, and transient timers.
    try {
      if (!rootRef.current) throw new Error('No app view');
      const frozen = freezeAppView(rootRef.current);
      pendingCapture.current = frozen;
      void import('../utils/appCaptureRaster').then(module => {
        if (pendingCapture.current !== frozen) return { status: 'failed' as const, reason: 'Capture discarded.' };
        return module.rasterizeAppView(frozen);
      })
        .then(result => {
          const current = draftRef.current;
          if (!mounted.current || current?.submissionId !== next.submissionId || current.capture !== 'preparing') return;
          update(result.status === 'ready'
            ? { ...current, screenshot: result.blob, capture: 'ready' }
            : { ...current, capture: 'failed', includeScreenshot: false, captureMessage: result.reason });
        }).catch(() => {
          frozen.dispose();
          const current = draftRef.current;
          if (current?.submissionId === next.submissionId && current.capture === 'preparing') {
            update({ ...current, capture: 'failed', includeScreenshot: false, captureMessage: 'Screenshot unavailable.' });
          }
        }).finally(() => {
          if (pendingCapture.current === frozen) pendingCapture.current = null;
        });
    } catch {
      update({ ...next, capture: 'failed', includeScreenshot: false, captureMessage: 'Screenshot unavailable.' });
    }
  };

  const edit = (patch: Partial<Pick<FeedbackDraft, 'message' | 'category' | 'includeScreenshot'>>) => {
    const current = draftRef.current;
    if (!current || busy.current || current.phase === 'unknown') return;
    update({ ...current, ...patch, phase: 'editing', notice: undefined, receipt: undefined, payloadDigest: undefined });
  };
  const removeScreenshot = () => {
    const current = draftRef.current;
    if (!current || busy.current || current.phase === 'unknown') return;
    update({ ...current, screenshot: undefined, capture: 'removed', includeScreenshot: false,
      receipt: undefined, payloadDigest: undefined, phase: 'editing', notice: undefined });
  };
  const applyReply = (reply: FeedbackResponse, sentWithImage: boolean) => {
    const current = draftRef.current;
    if (!current) return;
    if (reply.status === 'sent') {
      if ((reply.screenshot === 'included') !== sentWithImage) {
        update({ ...current, phase: 'unknown', notice: 'Attachment unconfirmed. Check status.' });
        return;
      }
      update(null);
      setSent(reply.issue);
      return;
    }
    update({ ...current, phase: reply.status, notice: reply.message,
      receipt: reply.receipt ?? current.receipt });
  };
  const send = async () => {
    const current = draftRef.current;
    if (!current || busy.current || current.capture === 'preparing' || current.phase === 'unknown') return;
    const message = current.message.trim();
    if (!message || message.length > FEEDBACK_MAX_MESSAGE_LENGTH) {
      update({ ...current, notice: 'Write a message first.' }); return;
    }
    if (!navigator.onLine) {
      update({ ...current, phase: 'rejected', notice: 'Offline. Reconnect, then Send.' }); return;
    }
    busy.current = true; // Locks synchronously before any encoding/digest/network await.
    update({ ...current, phase: 'sending', notice: undefined });
    let transportStarted = false;
    try {
      const { postFeedback, screenshotBase64 } = await import('../utils/feedbackClient');
      const included = current.includeScreenshot && !!current.screenshot;
      const payload: FeedbackPayload = {
        submissionId: current.submissionId, category: current.category, message, context: current.context,
        ...(included ? { screenshot: { mime: 'image/png' as const, base64: await screenshotBase64(current.screenshot!) } } : {}),
      };
      const payloadDigest = await feedbackPayloadDigest(payload);
      update({ ...draftRef.current!, payloadDigest, submittedWithScreenshot: included });
      transportStarted = true;
      applyReply(await postFeedback(import.meta.env.VITE_FEEDBACK_ENDPOINT ?? '', {
        action: 'submit', ...payload, ...(current.receipt ? { receipt: current.receipt } : {}),
      }), included);
    } catch {
      if (draftRef.current) update({ ...draftRef.current,
        phase: transportStarted ? 'unknown' : 'rejected',
        notice: transportStarted ? 'Delivery unconfirmed. Check status.' : 'Could not prepare the message. Try again.',
      });
    } finally { busy.current = false; }
  };
  const checkStatus = async () => {
    const current = draftRef.current;
    if (!current?.payloadDigest || busy.current) return;
    busy.current = true;
    update({ ...current, phase: 'checking' });
    try {
      const { postFeedback } = await import('../utils/feedbackClient');
      const reply = await postFeedback(import.meta.env.VITE_FEEDBACK_ENDPOINT ?? '', {
        action: 'status', submissionId: current.submissionId, payloadDigest: current.payloadDigest,
        ...(current.receipt ? { receipt: current.receipt } : {}),
      });
      // A failed status check never changes an uncertain send into a retryable one.
      applyReply(reply.status === 'rejected' ? { ...reply, status: 'unknown' } : reply,
        !!current.submittedWithScreenshot);
    } catch {
      if (draftRef.current) update({ ...draftRef.current, phase: 'unknown', notice: 'Could not check. Reconnect and check status.' });
    } finally { busy.current = false; }
  };
  const discard = () => {
    if (busy.current) return;
    pendingCapture.current?.dispose(); pendingCapture.current = null;
    update(null); setSent(null);
  };
  return { draft, sent, openDraft, edit, removeScreenshot, send, checkStatus, discard };
};
