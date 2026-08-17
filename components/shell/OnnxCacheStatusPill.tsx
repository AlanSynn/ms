import type { WebOnnxCacheStatus } from '../../utils/webOnnx';

const formatBytes = (bytes?: number) => (bytes ? `${Math.round(bytes / 1024 / 1024)}MB` : '');

export const OnnxCacheStatusPill = ({ status, onDownload }: { status: WebOnnxCacheStatus; onDownload: () => void }) => {
  const busy = status.stage === 'checking' || status.stage === 'downloading';
  const ready = status.stage === 'cached' || status.stage === 'available';
  const label = ready
    ? 'AI ready'
    : status.stage === 'checking'
      ? 'AI preparing…'
      : status.stage === 'downloading'
        ? `AI ${status.progress}% ${formatBytes(status.bytesLoaded)}`
        : status.stage === 'error'
          ? 'Try again'
          : 'Get AI';
  return <button type="button" className={`status-cache-pill ${ready ? 'cached' : status.stage}`} data-testid="onnx-cache-status" disabled={busy || ready} onClick={onDownload} aria-label={status.error ?? label}>{label}</button>;
};
