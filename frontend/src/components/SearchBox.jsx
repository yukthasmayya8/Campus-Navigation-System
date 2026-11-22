import { useEffect, useId, useRef, useState } from 'react';
import { voiceHint } from '../lib/platform.js';

const getRecognition = () =>
  typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null;

const VOICE_MESSAGE = {
  listening: 'Listening… say a building or place name.',
  nomatch: "Didn't catch that. Try again, or type the name.",
  denied: 'Microphone access is blocked. Allow it in your browser settings, or type instead.',
  unsupported: "Voice search isn't supported in this browser. You can still type.",
  insecure: 'Voice search needs HTTPS. You can still type.',
  mic: 'No microphone found. You can still type.',
  network: 'Voice search needs an internet connection. You can still type.',
  error: 'Voice search failed. You can still type.',
};

/**
 * Autocomplete search with phone voice input.
 * Suggestions always require an explicit pick; voice never selects or navigates by itself.
 *
 * Props: id, value ({id,label}|null), onSelect(item|null), fetchItems(q), placeholder, disabled.
 */
export default function SearchBox({ id, value, onSelect, fetchItems, placeholder = 'Search buildings…', disabled = false }) {
  const uid = useId();
  const inputId = id || `${uid}-search`;
  const listId = `${uid}-list`;
  const [text, setText] = useState(value?.label || '');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [voice, setVoice] = useState({ state: 'idle', message: '' });
  const [error, setError] = useState('');
  const debounce = useRef(null);
  const inputRef = useRef(null);
  const recRef = useRef(null);
  const fetchRef = useRef(fetchItems);
  fetchRef.current = fetchItems;
  const supported = Boolean(getRecognition()) && (typeof window === 'undefined' || window.isSecureContext !== false);

  useEffect(() => {
    setText(value?.label || '');
    setOpen(false);
  }, [value]);

  useEffect(() => () => {
    clearTimeout(debounce.current);
    const rec = recRef.current;
    if (rec) {
      rec.onstart = rec.onresult = rec.onerror = rec.onend = rec.onnomatch = null;
      try { rec.abort(); } catch { /* already stopped */ }
    }
  }, []);

  // Release the microphone if the tab is suspended/hidden (iOS/Android behaviour).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        const rec = recRef.current;
        if (rec) { try { rec.abort(); } catch { /* ignore */ } }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  function runSearch(query, { immediate = false } = {}) {
    clearTimeout(debounce.current);
    const run = async () => {
      setLoading(true); setError('');
      try {
        const results = await fetchRef.current(query);
        setItems(results || []);
        setOpen(Boolean(results?.length));
      } catch (e) {
        setItems([]); setOpen(false); setError(e?.message || 'Search failed. Try again.');
      } finally { setLoading(false); }
    };
    if (immediate) run();
    else debounce.current = setTimeout(run, 280);
  }

  function handleChange(e) {
    const q = e.target.value;
    setText(q); setCursor(-1); setError('');
    setVoice((v) => (['recognised', 'nomatch', 'error'].includes(v.state) ? { state: 'idle', message: '' } : v));
    if (!q.trim()) { setItems([]); setOpen(false); onSelect(null); return; }
    runSearch(q);
  }

  function pick(item) {
    setText(item.label); setItems([]); setOpen(false); setCursor(-1); setError('');
    setVoice({ state: 'idle', message: '' });
    onSelect(item);
  }

  function clear() {
    setText(''); setItems([]); setOpen(false); setCursor(-1); setError('');
    stopVoice();
    setVoice({ state: 'idle', message: '' });
    onSelect(null);
    inputRef.current?.focus();
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); pick(items[cursor]); }
    if (e.key === 'Escape') { setOpen(false); setCursor(-1); }
  }

  function stopVoice() {
    const rec = recRef.current;
    if (!rec) return;
    try { rec.stop(); } catch { /* ignore */ }
  }

  function toggleVoice() {
    if (!supported) {
      setVoice({ state: 'unsupported', message: `${getRecognition() ? VOICE_MESSAGE.insecure : VOICE_MESSAGE.unsupported} ${voiceHint()}` });
      return;
    }
    if (voice.state === 'listening') { stopVoice(); return; }
    const Ctor = getRecognition();
    const rec = new Ctor();
    rec.lang = 'en-IN'; rec.continuous = false; rec.interimResults = false; rec.maxAlternatives = 1;
    let got = false;
    rec.onstart = () => setVoice({ state: 'listening', message: VOICE_MESSAGE.listening });
    rec.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      got = true;
      setText(transcript); setCursor(-1); onSelect(null);
      setVoice({ state: 'recognised', message: `Heard “${transcript}”. Choose a suggestion below.` });
      runSearch(transcript, { immediate: true });
      inputRef.current?.focus();
    };
    rec.onnomatch = () => setVoice({ state: 'nomatch', message: VOICE_MESSAGE.nomatch });
    rec.onerror = (e) => {
      got = true;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setVoice({ state: 'denied', message: `${VOICE_MESSAGE.denied} ${voiceHint()}` });
      else if (e.error === 'no-speech') setVoice({ state: 'nomatch', message: VOICE_MESSAGE.nomatch });
      else if (e.error === 'audio-capture') setVoice({ state: 'error', message: VOICE_MESSAGE.mic });
      else if (e.error === 'network') setVoice({ state: 'error', message: VOICE_MESSAGE.network });
      else if (e.error !== 'aborted') setVoice({ state: 'error', message: VOICE_MESSAGE.error });
    };
    rec.onend = () => {
      recRef.current = null;
      setVoice((v) => (v.state === 'listening' ? { state: 'idle', message: '' } : v));
    };
    recRef.current = rec;
    try { rec.start(); } catch {
      recRef.current = null;
      setVoice({ state: 'error', message: VOICE_MESSAGE.error });
    }
  }

  const listening = voice.state === 'listening';
  const showPanel = open && items.length > 0;

  return (
    <div className="search-wrap">
      <div className="search-input-row" role="combobox" aria-expanded={showPanel} aria-haspopup="listbox">
        <span className="search-icon" aria-hidden="true">🔍</span>
        <input
          ref={inputRef}
          id={inputId}
          className="search-input"
          type="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          aria-autocomplete="list"
          aria-controls={`${listId}-items`}
          aria-activedescendant={cursor >= 0 ? `${listId}-${cursor}` : undefined}
        />
        {loading && <span className="search-action" aria-hidden="true">…</span>}
        {text && !loading && (
          <button type="button" className="search-action" onClick={clear} aria-label="Clear search">×</button>
        )}
        <button
          type="button"
          className={`search-action${listening ? ' listening' : ''}`}
          onClick={toggleVoice}
          aria-label={listening ? 'Stop voice search' : 'Search by voice'}
          aria-pressed={listening}
          title={listening ? 'Stop voice search' : 'Search by voice'}
        >
          {listening ? '■' : '🎤'}
        </button>
      </div>

      {(voice.message || error) && (
        <p className={`search-note${error || ['error', 'denied', 'unsupported'].includes(voice.state) ? ' error' : ''}`} role="status">
          {error || voice.message}
        </p>
      )}

      {showPanel && (
        <ul className="search-dropdown" id={`${listId}-items`} role="listbox">
          {items.map((item, i) => (
            <li
              key={item.id}
              id={`${listId}-${i}`}
              className={`search-item${i === cursor ? ' active' : ''}`}
              role="option"
              aria-selected={i === cursor}
              onMouseDown={(e) => { e.preventDefault(); pick(item); }}
            >
              <span className="search-item-icon" aria-hidden="true">{item.icon || '🏢'}</span>
              <span>
                <div className="search-item-name">{item.label}</div>
                {item.sublabel && <div className="search-item-dist">{item.sublabel}</div>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
