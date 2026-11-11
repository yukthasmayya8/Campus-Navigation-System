import { useEffect, useId, useRef, useState } from 'react';
import VoiceSearchControl from './VoiceSearchControl (1).jsx';
import { useLocationSearch } from './useLocationSearch (1).js';
import { locationId } from './searchUtils.js';
import './CampusSearch.css';

/**
 * Props
 *  - onSelect({ locationId, name })   called when the user picks a suggestion (ID, not text)
 *  - placeholder?: string
 *  - disabled?: boolean
 */
export default function CampusSearch({
  onSelect,
  onClear,
  placeholder = 'Search buildings and places',
  disabled = false,
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i) => `${uid}-opt-${i}`;

  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null); // set after a pick; stops re-searching on the filled-in name
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [voice, setVoice] = useState({ state: 'idle', message: '' });
  const [voiceResetKey, setVoiceResetKey] = useState(0);

  const { status, items, message, retry } = useLocationSearch(query, !selected);

  useEffect(() => setActiveIndex(-1), [items]);

  const hasQuery = query.trim().length > 0;
  const showPanel = open && !selected && hasQuery && status !== 'idle';
  const hasOptions = showPanel && items.length > 0 && (status === 'success' || status === 'offline');

  function pick(loc) {
    const payload = { locationId: locationId(loc), name: loc.name };
    setSelected(payload);
    setQuery(loc.name);
    setOpen(false);
    setActiveIndex(-1);
    onSelect?.(payload);
  }

  function handleChange(e) {
    setQuery(e.target.value);
    setSelected(null);
    setOpen(true);
    // Drop finished voice messages once the user takes over by typing.
    setVoice((v) => (['recognised', 'nomatch', 'error'].includes(v.state) ? { state: 'idle', message: '' } : v));
  }

  // Voice text goes into the same field and triggers the same search.
  // We never call onSelect from here: the user must pick a suggestion.
  function handleTranscript(text) {
    setQuery(text);
    setSelected(null);
    setOpen(true);
  }

  function clearAll() {
    setQuery('');
    setSelected(null);
    setOpen(false);
    setActiveIndex(-1);
    setVoice((v) => (['unsupported', 'denied'].includes(v.state) ? v : { state: 'idle', message: '' }));
    setVoiceResetKey((k) => k + 1);
    onClear?.();
    inputRef.current?.focus();
  }

  function handleKeyDown(e) {
    switch (e.key) {
      case 'ArrowDown':
        if (!showPanel) {
          if (hasQuery && !selected) setOpen(true);
          return;
        }
        e.preventDefault();
        if (hasOptions) setActiveIndex((i) => (i + 1) % items.length);
        break;
      case 'ArrowUp':
        if (!hasOptions) return;
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
        break;
      case 'Enter':
        if (hasOptions && activeIndex >= 0) {
          e.preventDefault();
          pick(items[activeIndex]);
        }
        break;
      case 'Escape':
        if (showPanel) {
          e.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
        }
        break;
      default:
    }
  }

  function handleBlur(e) {
    if (!rootRef.current?.contains(e.relatedTarget)) setOpen(false);
  }

  const voiceTone = ['error', 'denied', 'unsupported'].includes(voice.state) ? 'error' : 'info';

  return (
    <div className="cs-root" ref={rootRef} onBlur={handleBlur}>
      <div className={`cs-field${disabled ? ' is-disabled' : ''}`}>
        <input
          ref={inputRef}
          className="cs-input"
          type="text"
          role="combobox"
          aria-expanded={hasOptions}
          aria-controls={hasOptions ? listId : undefined}
          aria-activedescendant={hasOptions && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          aria-label={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          onChange={handleChange}
          onFocus={() => hasQuery && !selected && setOpen(true)}
          onKeyDown={handleKeyDown}
        />

        {showPanel && status === 'loading' && <span className="cs-spinner" aria-hidden="true" />}

        {hasQuery && (
          <button
            type="button"
            className="cs-icon-btn cs-clear"
            onClick={clearAll}
            disabled={disabled}
            aria-label="Clear search"
            title="Clear search"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}

        <VoiceSearchControl
          disabled={disabled}
          resetKey={voiceResetKey}
          onTranscript={handleTranscript}
          onStateChange={setVoice}
        />
      </div>

      <p className="cs-status" data-tone={voiceTone} role="status" aria-live="polite">
        {voice.message}
      </p>

      {showPanel && (
        // preventDefault keeps focus in the input so a click can't trigger blur-close first
        <div className="cs-panel" onMouseDown={(e) => e.preventDefault()}>
          {status === 'loading' && <p className="cs-note" role="status">Searching…</p>}

          {status === 'error' && (
            <div className="cs-note cs-note-error" role="alert">
              <span>{message}</span>
              <button type="button" className="cs-retry" onClick={retry}>Try again</button>
            </div>
          )}

          {status === 'offline' && (
            <p className="cs-note cs-note-warn" role="status">{message}</p>
          )}

          {status === 'success' && items.length === 0 && (
            <p className="cs-note" role="status">No matching location</p>
          )}

          {status === 'offline' && items.length === 0 && (
            <p className="cs-note" role="status">No saved location matches</p>
          )}

          {hasOptions && (
            <ul className="cs-list" id={listId} role="listbox" aria-label="Matching locations">
              {items.map((loc, i) => (
                <li
                  key={locationId(loc) ?? loc.name}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`cs-option${i === activeIndex ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => pick(loc)}
                >
                  <span className="cs-option-name">{loc.name}</span>
                  {(loc.category || loc.type) && (
                    <span className="cs-option-meta">{loc.category || loc.type}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
