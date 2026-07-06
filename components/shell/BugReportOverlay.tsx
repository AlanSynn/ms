import { Bug, Camera, Clipboard, Download, ExternalLink, X } from "lucide-react";
import { useMemo, useState } from "react";

const BUG_ISSUE_URL = "https://github.com/AlanSynn/ms/issues/new";

type Screenshot = {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
};

const lines = (...items: Array<string | false | undefined>) =>
  items.filter(Boolean).join("\n\n");

const fieldBlock = (title: string, value: string) =>
  `### ${title}\n${value.trim() || "_Not provided_"}`;

const captureScreenPng = async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture is not available in this browser.");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const width = video.videoWidth || window.innerWidth;
    const height = video.videoHeight || window.innerHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    return { url: canvas.toDataURL("image/png"), width, height };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
};

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
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [status, setStatus] = useState("Ready");
  const [capturing, setCapturing] = useState(false);

  const reportBody = useMemo(() => {
    const shotLines = screenshots.length
      ? screenshots.map((shot, index) => `- ${index + 1}. ${shot.name}`).join("\n")
      : "_No screenshots captured._";
    return lines(
      fieldBlock("What happened", summary),
      fieldBlock("Steps", steps),
      fieldBlock("Expected", expected),
      `### Context\n- Stage: ${stageLabel}\n- App: MotionSmith v${__APP_VERSION__}\n- URL: ${typeof window === "undefined" ? "" : window.location.href}\n- Browser: ${typeof navigator === "undefined" ? "" : navigator.userAgent}`,
      email.trim() ? `### Contact\n${email.trim()}` : undefined,
      `### Screenshots\n${shotLines}\n\nAttach downloaded screenshots here if needed.`,
    );
  }, [email, expected, screenshots, stageLabel, steps, summary]);

  const issueHref = useMemo(() => {
    const title = summary.trim()
      ? `Bug: ${summary.trim().slice(0, 80)}`
      : `Bug: ${stageLabel}`;
    return `${BUG_ISSUE_URL}?${new URLSearchParams({
      title,
      body: reportBody,
      labels: "bug",
    }).toString()}`;
  }, [reportBody, stageLabel, summary]);

  const addScreenshot = async () => {
    setCapturing(true);
    setStatus("Choose this tab or window.");
    try {
      const shot = await captureScreenPng();
      const id = Date.now().toString(36);
      setScreenshots((current) => [
        ...current,
        {
          ...shot,
          id,
          name: `motionsmith-bug-${id}.png`,
        },
      ]);
      setStatus("Screenshot added");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Screenshot cancelled");
    } finally {
      setCapturing(false);
    }
  };

  const copyReport = async () => {
    if (!navigator.clipboard?.writeText) {
      setStatus("Clipboard is not available");
      return;
    }
    await navigator.clipboard.writeText(reportBody);
    setStatus("Report text copied");
  };

  const copyScreenshot = async (shot: Screenshot) => {
    const clipboard = navigator.clipboard as Clipboard & {
      write?: (items: ClipboardItem[]) => Promise<void>;
    };
    if (!clipboard?.write || typeof ClipboardItem === "undefined") {
      setStatus("Use Download, then attach on GitHub");
      return;
    }
    const blob = await (await fetch(shot.url)).blob();
    await clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    setStatus("Screenshot copied");
  };

  return (
    <aside
      className="bug-report-overlay"
      data-testid="bug-report-overlay"
      data-capturing={capturing ? "true" : "false"}
      aria-label="Bug report"
    >
      <section className="bug-report-panel">
        <header className="bug-report-head">
          <div>
            <div className="section-title">Bug report</div>
            <h3>Send to GitHub</h3>
          </div>
          <button className="btn-secondary" aria-label="Close bug report" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <label className="bug-report-field">
          <span>What broke?</span>
          <input
            className="field"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Short bug title"
          />
        </label>
        <label className="bug-report-field">
          <span>What did you do?</span>
          <textarea
            className="field"
            value={steps}
            onChange={(event) => setSteps(event.target.value)}
            placeholder="Steps to repeat"
            rows={3}
          />
        </label>
        <label className="bug-report-field">
          <span>What should happen?</span>
          <textarea
            className="field"
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
            placeholder="Expected result"
            rows={2}
          />
        </label>
        <label className="bug-report-field">
          <span>Email optional</span>
          <input
            className="field"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Only if you want a reply"
            type="email"
          />
        </label>

        <div className="bug-report-actions">
          <button className="btn-secondary" onClick={addScreenshot} type="button">
            <Camera size={16} /> Capture screen
          </button>
          <button className="btn-secondary" onClick={copyReport} type="button">
            <Clipboard size={16} /> Copy text
          </button>
        </div>

        {screenshots.length > 0 && (
          <div className="bug-report-shots" aria-label="Captured screenshots">
            {screenshots.map((shot) => (
              <div key={shot.id} className="bug-report-shot">
                <img src={shot.url} alt="Captured bug report screen" />
                <div>
                  <a href={shot.url} download={shot.name}>
                    <Download size={14} /> {shot.width}×{shot.height}
                  </a>
                  <button className="btn-secondary" type="button" onClick={() => void copyScreenshot(shot)}>
                    <Clipboard size={14} /> Copy image
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bug-report-note">
          Screenshots stay local. Download or copy them, then attach on GitHub.
        </div>

        <div className="bug-report-footer">
          <span>{status}</span>
          <a className="btn-primary" href={issueHref} target="_blank" rel="noreferrer">
            <Bug size={16} /> Open issue <ExternalLink size={14} />
          </a>
        </div>
      </section>
    </aside>
  );
};
