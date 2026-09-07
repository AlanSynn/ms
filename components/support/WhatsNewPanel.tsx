import { useEffect, useState } from 'react';
import { releaseImageUrl, type ReleaseNote } from '../../utils/releaseNotes';
import type { FeatureId } from '../../utils/featureDestinations';

const NoteImage = ({ path, alt }: { path: string; alt: string }) => {
  const [failed, setFailed] = useState(false);
  return failed ? <p className="support-muted" role="img" aria-label={alt}>{alt}</p>
    : <img className="release-note-image" src={releaseImageUrl(path, import.meta.env.BASE_URL)}
      alt={alt} onError={() => setFailed(true)} />;
};

export const WhatsNewPanel = ({ entry, onRendered, onReveal, onClose, startup = false }: {
  entry?: ReleaseNote;
  onRendered: (id: string) => void;
  onReveal: (id: FeatureId) => void;
  onClose: () => void;
  startup?: boolean;
}) => {
  useEffect(() => {
    if (!entry) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => onRendered(entry.id));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [entry?.id]);
  return <>
    <div className="support-heading">
      <h3>What's new</h3><button className="btn-secondary" onClick={onClose}>Close</button>
    </div>
    {entry ? <>
      <p className="support-muted">v{entry.version}</p>
      <div className="release-highlights">
        {entry.highlights.slice(0, 3).map(highlight => <article key={highlight.title}>
          <h4>{highlight.title}</h4>
          <p>{highlight.text}</p>
          {highlight.image && <NoteImage {...highlight.image} />}
          {!startup && highlight.destination && <button className="btn-secondary"
            onClick={() => onReveal(highlight.destination!)}
            aria-label={`Show me: ${highlight.title}`}>Show me</button>}
        </article>)}
      </div>
    </> : <p>No updates for this version.</p>}
    {startup && <button className="btn-primary release-continue" onClick={onClose}>Continue</button>}
  </>;
};
