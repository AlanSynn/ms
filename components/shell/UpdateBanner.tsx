type UpdateBannerProps = {
  onReload: () => void;
  onDismiss: () => void;
};

export const UpdateBanner = ({ onReload, onDismiss }: UpdateBannerProps) => (
  <span
    className="status-cache-pill inline-flex items-center gap-2"
    data-testid="update-banner"
    role="status"
  >
    A new version is available.
    <button
      type="button"
      className="btn-secondary"
      data-testid="update-banner-reload"
      onClick={onReload}
    >
      Reload
    </button>
    <button
      type="button"
      className="btn-secondary"
      data-testid="update-banner-dismiss"
      onClick={onDismiss}
    >
      Dismiss
    </button>
  </span>
);
