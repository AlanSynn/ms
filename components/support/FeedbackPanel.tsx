import { useEffect, useState } from 'react';
import type { useFeedbackDraft } from '../../hooks/useFeedbackDraft';
import { FEEDBACK_MAX_MESSAGE_LENGTH } from '../../shared/feedbackProtocol';

export const FeedbackPanel = ({ feedback, onClose, onDiscard }: {
  feedback: ReturnType<typeof useFeedbackDraft>;
  onClose: () => void;
  onDiscard: () => void;
}) => {
  const { draft, sent } = feedback;
  const [imageUrl, setImageUrl] = useState<string>();
  const [enlarged, setEnlarged] = useState(false);
  useEffect(() => {
    if (!draft?.screenshot) { setImageUrl(undefined); return; }
    const url = URL.createObjectURL(draft.screenshot);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft?.screenshot]);
  const busy = draft?.phase === 'sending' || draft?.phase === 'checking';
  const locked = busy || draft?.phase === 'unknown';
  return <>
    <div className="support-heading">
      <h3>Feedback</h3><button className="btn-secondary" onClick={onClose}>Close</button>
    </div>
    {sent && <div role="status" className="feedback-sent">
      <strong>Sent · #{sent.number}</strong><p>Thanks for sharing.</p>
      <button className="btn-secondary" onClick={() => feedback.openDraft()}>New feedback</button>
    </div>}
    {draft && <form className="feedback-form" onSubmit={event => { event.preventDefault(); void feedback.send(); }}>
      <fieldset disabled={locked} className="feedback-category">
        <legend className="sr-only">Feedback type</legend>
        <label><input type="radio" name="feedback-category" value="problem" checked={draft.category === 'problem'}
          onChange={() => feedback.edit({ category: 'problem' })} /> Something is broken</label>
        <label><input type="radio" name="feedback-category" value="idea" checked={draft.category === 'idea'}
          onChange={() => feedback.edit({ category: 'idea' })} /> I have an idea</label>
      </fieldset>
      <label className="feedback-message-label">
        {draft.category === 'problem' ? 'What happened?' : 'What would help?'}
        <textarea data-autofocus required rows={4} maxLength={FEEDBACK_MAX_MESSAGE_LENGTH}
          value={draft.message} disabled={locked} data-testid="feedback-message"
          onChange={event => feedback.edit({ message: event.currentTarget.value })} />
      </label>
      {draft.capture === 'preparing' && <p role="status" className="support-muted">Preparing screenshot…</p>}
      {imageUrl && <div className="feedback-image">
        <div className={`feedback-image-view ${enlarged ? 'is-enlarged' : ''}`}>
          <button type="button" className="feedback-preview-button" aria-label={enlarged ? 'Fit screenshot' : 'Enlarge screenshot'}
            aria-pressed={enlarged} onClick={() => setEnlarged(value => !value)}>
            <img src={imageUrl} alt="Current MotionSmith view, prepared on this device" data-testid="feedback-screenshot" />
          </button>
        </div>
        <div className="feedback-image-actions">
          <label><input type="checkbox" checked={draft.includeScreenshot} disabled={locked}
            onChange={event => feedback.edit({ includeScreenshot: event.currentTarget.checked })} /> Include screenshot</label>
          <button type="button" className="support-text-button" disabled={locked} onClick={feedback.removeScreenshot}>Remove</button>
        </div>
      </div>}
      {draft.capture === 'failed' && <p role="status" className="support-muted">Screenshot unavailable. Send text only.</p>}
      {draft.capture === 'removed' && <p className="support-muted">No screenshot</p>}
      {draft.notice && <p role="status" className="support-notice">{draft.notice}</p>}
      <div className="feedback-send-row">
        <small>Posted publicly. Leave out names.</small>
        {draft.phase === 'unknown' || draft.phase === 'checking'
          ? <button type="button" className="btn-primary" disabled={busy} onClick={() => void feedback.checkStatus()}>
            {busy ? 'Checking…' : 'Check status'}</button>
          : <button type="submit" className="btn-primary" data-testid="feedback-send"
            disabled={busy || draft.capture === 'preparing' || !draft.message.trim()}>
            {busy ? 'Sending…' : draft.capture === 'failed' ? 'Send text only' : 'Send'}</button>}
      </div>
      <button type="button" className="support-text-button feedback-discard" disabled={busy} onClick={onDiscard}>Discard draft</button>
    </form>}
  </>;
};
