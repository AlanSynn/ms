import type { WebOnnxCacheStatus } from '../../utils/webOnnx';

const formatBytes = (bytes?: number) => (bytes ? `${Math.round(bytes / 1024 / 1024)}MB` : '');

export const OnnxCacheStatusPill = ({ status, onDownload }: { status: WebOnnxCacheStatus; onDownload: () => void }) => {
  const busy = status.stage === 'checking' || status.stage === 'downloading';
  const label = status.stage === 'cached'
    ? 'AI ready'
    : status.stage === 'downloading'
      ? `AI ${status.progress}% ${formatBytes(status.bytesLoaded)}`
      : status.stage === 'error'
        ? 'Try again'
        : 'Get AI';
  return <button type="button" className={`status-cache-pill ${status.stage}`} data-testid="onnx-cache-status" disabled={busy || status.stage === 'cached'} onClick={onDownload} aria-label={status.error ?? label}>{label}</button>;
};
