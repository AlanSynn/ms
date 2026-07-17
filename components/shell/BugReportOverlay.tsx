import { Bug, Camera, Clipboard, Download, ExternalLink, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  BUG_REPORT_LIMITS,
  bugReportText,
  captureBugScreenshot,
  newBugSubmissionId,
  submitBugReport,
} from "../../utils/bugReport";
import type { BugScreenshot } from "../../utils/bugReport";

export const BugReportOverlay = ({
  stageLabel,
  onClose,
}: {
  stageLabel: string;
  onClose: () => void;
}) => {
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [email, setEmail] = useState("");
  const [screenshot, setScreenshot] = useState<BugScreenshot>();
  const [status, setStatus] = useState("Ready");
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [issueUrl, setIssueUrl] = useState("");
  const [submissionId, setSubmissionId] = useState(newBugSubmissionId);

  const fields = useMemo(() => ({
    summary,
    steps,
    expected,
    email,
    stage: stageLabel,
    appVersion: __APP_VERSION__,
  }), [email, expected, stageLabel, steps, summary]);

  useEffect(() => () => {
    if (screenshot) URL.revokeObjectURL(screenshot.url);
  }, [screenshot]);

  const clearResult = () => {
    if (issueUrl || status.startsWith("Report saved") || status === "Report sent") {
      setSubmissionId(newBugSubmissionId());
    }
    setIssueUrl("");
    setStatus("Ready");
  };

  const addScreenshot = async () => {
    setCapturing(true);
    setIssueUrl("");
    setStatus("Choose one tab or window.");
    try {
      setScreenshot(await captureBugScreenshot());
      setStatus("Screenshot added");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Screenshot cancelled");
    } finally {
      setCapturing(false);
    }
  };

  const removeScreenshot = () => {
    setScreenshot(undefined);
    clearResult();
  };

  const copyReport = async () => {
    if (!navigator.clipboard?.writeText) {
      setStatus("Clipboard is not available");
      return;
    }
    await navigator.clipboard.writeText(bugReportText(fields));
    setStatus("Report text copied");
  };

  const sendReport = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setIssueUrl("");
    setStatus("Sending…");
    try {
      const result = await submitBugReport(fields, screenshot, submissionId);
      setIssueUrl(result.issueUrl);
      setStatus(result.pending ? "Report saved; issue pending" : result.draft ? "Open GitHub to finish report" : "Report sent");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Report could not be sent");
    } finally {
      setSending(false);
    }
  };

  return (
    <aside
      className="bug-report-overlay"
      data-testid="bug-report-overlay"
      data-capturing={capturing ? "true" : "false"}
      aria-label="Bug report"
    >
      <form className="bug-report-panel" onSubmit={sendReport}>
        <header className="bug-report-head">
          <div>
            <div className="section-title">Bug report</div>
            <h3>Send report</h3>
          </div>
          <button className="btn-secondary" aria-label="Close bug report" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        <label className="bug-report-field">
          <span>What broke?</span>
          <input className="field" value={summary} onChange={(event) => { setSummary(event.target.value); clearResult(); }} placeholder="Short bug title" maxLength={BUG_REPORT_LIMITS.summary} required />
        </label>
        <label className="bug-report-field">
          <span>What did you do?</span>
          <textarea className="field" value={steps} onChange={(event) => { setSteps(event.target.value); clearResult(); }} placeholder="Steps to repeat" rows={3} maxLength={BUG_REPORT_LIMITS.steps} required />
        </label>
        <label className="bug-report-field">
          <span>What should happen?</span>
          <textarea className="field" value={expected} onChange={(event) => { setExpected(event.target.value); clearResult(); }} placeholder="Expected result" rows={2} maxLength={BUG_REPORT_LIMITS.expected} required />
        </label>
        <label className="bug-report-field">
          <span>Email optional</span>
          <input className="field" value={email} onChange={(event) => { setEmail(event.target.value); clearResult(); }} placeholder="Only if you want a reply" type="email" maxLength={BUG_REPORT_LIMITS.email} />
        </label>

        <div className="bug-report-actions">
          <button className="btn-secondary" onClick={addScreenshot} type="button" disabled={capturing || sending}>
            <Camera size={16} /> {screenshot ? "Replace screen" : "Capture screen"}
          </button>
          <button className="btn-secondary" onClick={copyReport} type="button">
            <Clipboard size={16} /> Copy text
          </button>
        </div>

        {screenshot && (
          <div className="bug-report-shots" aria-label="Captured screenshot">
            <div className="bug-report-shot">
              <img src={screenshot.url} alt="Captured bug report screen" />
              <div>
                <span>{screenshot.width}×{screenshot.height}</span>
                <a href={screenshot.url} download={screenshot.name}><Download size={14} /> Download screen</a>
                <button className="btn-secondary" type="button" onClick={removeScreenshot}>Remove</button>
              </div>
            </div>
          </div>
        )}

        <div className="bug-report-note">One optional screen is sent with this report.</div>

        <div className="bug-report-footer">
          <span role="status">{status}</span>
          {issueUrl ? (
            <a className="btn-primary" href={issueUrl} target="_blank" rel="noreferrer">
              {issueUrl.includes("/issues/new") ? "Open GitHub" : "View issue"} <ExternalLink size={14} />
            </a>
          ) : (
            <button className="btn-primary" type="submit" disabled={sending}>
              <Bug size={16} /> {sending ? "Sending…" : "Send report"}
            </button>
          )}
        </div>
      </form>
    </aside>
  );
};
