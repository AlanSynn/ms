import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import "./appToast.css";

const TOAST_EVENT = "motionsmith:toast";
const TOAST_VISIBLE_MS = 7000;

export type AppToastDetail = {
  message: string;
};

/**
 * Broadcast a transient in-app notification. Unlike the command status strip,
 * this surfaces proactive guidance (e.g. a closest-match fit recommendation)
 * where students will actually see it.
 */
export const showAppToast = (message: string) => {
  window.dispatchEvent(
    new CustomEvent<AppToastDetail>(TOAST_EVENT, { detail: { message } }),
  );
};

export const AppToast = () => {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let hideTimer: number | undefined;
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<AppToastDetail>).detail;
      if (!detail?.message) return;
      setMessage(detail.message);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(
        () => setMessage(null),
        TOAST_VISIBLE_MS,
      );
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener(TOAST_EVENT, onToast);
    };
  }, []);

  if (!message) return null;
  return (
    <div role="status" aria-live="polite" data-testid="app-toast" className="app-toast">
      <div className="app-toast-card">
        <Info className="app-toast-icon h-4 w-4" aria-hidden />
        <span>{message}</span>
      </div>
    </div>
  );
};
