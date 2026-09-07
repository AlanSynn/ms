import { useEffect, useRef, useState, type RefObject } from 'react';
import { releaseImageUrl, type ReleaseNote } from '../../utils/releaseNotes';
import type { FeatureId } from '../../utils/featureDestinations';

const NoteImage = ({ path, alt }: { path: string; alt: string }) => {
  const [failed, setFailed] = useState(false);
  return failed ? <p className="support-muted" role="img" aria-label={alt}>{alt}</p>
    : <img className="release-note-image" loading="lazy" decoding="async" src={releaseImageUrl(path, import.meta.env.BASE_URL)}
      alt={alt} onError={() => setFailed(true)} />;
};

const ReleaseEntry = ({ entry, scrollRoot, onRendered, onReveal, startup }: {
  entry: ReleaseNote;
  scrollRoot: RefObject<HTMLDivElement | null>;
  onRendered: (id: string) => void;
  onReveal: (id: FeatureId) => void;
  startup: boolean;
}) => {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    let frame = 0;
    const observer = new IntersectionObserver(changes => {
      const visible = changes.some(change => change.isIntersecting && change.intersectionRatio >= 0.1);
      cancelAnimationFrame(frame);
      if (!visible) return;
      frame = requestAnimationFrame(() => {
        onRendered(entry.id);
        observer.disconnect();
      });
    }, { root: scrollRoot.current, threshold: 0.1 });
    observer.observe(element.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [entry.id, onRendered, scrollRoot]);
  return <div ref={element} className="release-note" data-release-note-id={entry.id}>
    <div className="release-highlights">
      {entry.highlights.map(highlight => <article key={highlight.title}>
        <h5>{highlight.title}</h5>
        <p>{highlight.text}</p>
        {highlight.image && <NoteImage {...highlight.image} />}
        {!startup && highlight.destination && <button className="btn-secondary"
          onClick={() => onReveal(highlight.destination!)}
          aria-label={'Show me: ' + highlight.title}>Show me</button>}
      </article>)}
    </div>
  </div>;
};

export const WhatsNewPanel = ({ entries, onRendered, onReveal, onClose, startup = false }: {
  entries: readonly ReleaseNote[];
  onRendered: (id: string) => void;
  onReveal: (id: FeatureId) => void;
  onClose: () => void;
  startup?: boolean;
}) => {
  const scrollRoot = useRef<HTMLDivElement>(null);
  const versions = [...new Set(entries.map(entry => entry.version))];
  return <>
    <div className="support-heading release-heading">
      <div><h3>What's new</h3><p className="support-muted">MotionSmith v{__APP_VERSION__}</p></div>
      <button className="btn-secondary" onClick={onClose}>Close</button>
    </div>
    <div ref={scrollRoot} className="release-history" role="region" aria-label="Update history"
      data-testid="release-history" tabIndex={0}>
      {versions.length ? versions.map((version, index) => <section className="release-version-group"
        key={version} aria-label={'Version ' + version} data-release-version={version}>
        <div className="release-version-heading">
          <h4>v{version}</h4>{index === 0 && <span className="release-latest">Latest</span>}
        </div>
        {entries.filter(entry => entry.version === version).map(entry =>
          <ReleaseEntry key={entry.id} entry={entry} scrollRoot={scrollRoot} startup={startup}
            onRendered={onRendered} onReveal={onReveal} />)}
      </section>) : <p>No updates yet.</p>}
    </div>
    <div className="release-footer">
      {entries.length > 1 && <span className="support-muted">Scroll for more updates</span>}
      {startup && <button className="btn-primary release-continue" onClick={onClose}>Continue</button>}
    </div>
  </>;
};
