import { useEffect, useId, useMemo, useState } from 'react';
import type { AppStage } from '../../types';
import type { FeatureId } from '../../utils/featureDestinations';
import { searchFeatures } from '../../utils/featureSearch';
import './featureSearch.css';

export type FeatureSearchPanelProps = {
  onReveal: (id: FeatureId) => void;
  onSuggest: (draft: string) => void;
  onClose: () => void;
  stage?: AppStage;
  notice?: string;
};

/** Inner content; the shell supplies the dialog, focus trap, and return focus. */
export const FeatureSearchPanel = ({ onReveal, onSuggest, onClose, stage = 'character', notice }: FeatureSearchPanelProps) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const results = useMemo(() => searchFeatures(query, stage), [query, stage]);
  useEffect(() => setActiveIndex(0), [query, stage]);
  const activeResult = results[Math.min(activeIndex, results.length - 1)];

  return <div className="feature-search" data-testid="feature-search-panel" onKeyDown={event => {
    if (event.key !== 'Tab') event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }}>
    <label className="feature-search-label" htmlFor={`${listId}-input`}>Find a feature</label>
    <input
      id={`${listId}-input`}
      className="field"
      autoFocus
      autoComplete="off"
      spellCheck={false}
      maxLength={160}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={results.length > 0}
      aria-controls={listId}
      aria-activedescendant={activeResult ? `${listId}-${activeResult.id}` : undefined}
      placeholder="Save, draw, print…"
      value={query}
      onChange={event => setQuery(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (results.length) setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (activeResult) onReveal(activeResult.id);
        }
      }}
    />
    <div className="feature-search-results" id={listId} role="listbox" aria-label="Features">
      {results.map((result, index) => <button
        key={result.id}
        id={`${listId}-${result.id}`}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={index === activeIndex}
        className="feature-search-result"
        data-feature-result={result.id}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => onReveal(result.id)}
      >
        <span className="feature-search-result-heading"><strong>{result.label}</strong><small>{result.location}</small></span>
        {result.description && <span className="feature-search-description">{result.description}</span>}
      </button>)}
    </div>
    <div role="status" className="feature-search-status">
      {notice || (!query.trim() ? 'Type an action or a feature.' : results.length ? `${results.length} found` : 'No matching feature.')}
    </div>
    <div className="feature-search-actions">
      {query.trim() && !results.length && <button type="button" className="btn-secondary" onClick={() => onSuggest(query)}>Suggest a feature</button>}
      <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
    </div>
  </div>;
};
