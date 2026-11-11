import { useEffect, useRef, useState } from 'react';

/**
 * Autocomplete search input with voice search (phone mic / Web Speech API).
 * Props:
 *   value       – current selected object (or null)
 *   onSelect    – called with the selected item
 *   fetchItems  – async (query) => [{ id, label, sublabel, icon }]
 *   placeholder – string
 *   id          – for label association
 */
export default function SearchInput({ value, onSelect, fetchItems, placeholder = 'Search…', id }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [listening, setListening] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState('');
  const debounce = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const recRef = useRef(null);

  // When value changes externally, sync display text
  useEffect(() => {
    setText(value ? value.label : '');
    setOpen(false);
  }, [value]);

  useEffect(() => () => {
    clearTimeout(debounce.current);
    try { recRef.current?.abort?.(); recRef.current?.stop?.(); } catch {}
  }, []);

  function runSearch(q, { immediate = false } = {}) {
    clearTimeout(debounce.current);
    const doFetch = async () => {
      setLoading(true);
      try {
        const results = await fetchItems(q);
        setItems(results);
        setOpen(results.length > 0);
      } catch { setItems([]); setOpen(false); }
      finally { setLoading(false); }
    };
    if (immediate) doFetch();
    else debounce.current = setTimeout(doFetch, 280);
  }

  function handleChange(e) {
    const q = e.target.value;
    setText(q);
    setCursor(-1);
    setVoiceMsg('');
    if (!q.trim()) { setItems([]); setOpen(false); onSelect(null); return; }
    runSearch(q);
  }

  function handleSelect(item) {
    setText(item.label);
    setOpen(false);
    setItems([]);
    setCursor(-1);
    setVoiceMsg('');
    onSelect(item);
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); handleSelect(items[cursor]); }
    if (e.key === 'Escape') { setOpen(false); setCursor(-1); }
  }

  function handleClear() {
    setText(''); setItems([]); setOpen(false); setCursor(-1); setVoiceMsg('');
    onSelect(null);
    inputRef.current?.focus();
  }

  function toggleVoice() {
    const Ctor = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!Ctor) { setVoiceMsg('Voice search is not supported in this browser. Please type instead.'); return; }
    if (typeof window !== 'undefined' && window.isSecureContext === false) { setVoiceMsg('Voice search needs HTTPS or localhost.'); return; }
    if (listening) {
      try { recRef.current?.stop(); } catch {}
      setListening(false);
      return;
    }
    try { recRef.current?.abort?.(); } catch {}
    const rec = new Ctor();
    rec.lang = 'en-IN';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let got = false;
    rec.onstart = () => { setListening(true); setVoiceMsg('Listening… say a building name.'); };
    rec.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      got = true;
      setText(transcript);
      setCursor(-1);
      onSelect(null);
      setVoiceMsg(`Heard “${transcript}”. Choose a suggestion below.`);
      runSearch(transcript, { immediate: true });
      inputRef.current?.focus();
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setVoiceMsg('Microphone access blocked. Allow mic permission or type instead.');
      else if (e.error === 'no-speech') setVoiceMsg("Didn't catch that. Try again or type.");
      else if (e.error !== 'aborted') setVoiceMsg('Voice search failed. You can still type.');
    };
    rec.onend = () => { recRef.current = null; setListening(false); if (!got) setVoiceMsg((m) => m.startsWith('Listening') ? '' : m); };
    recRef.current = rec;
    try { rec.start(); } catch { setListening(false); setVoiceMsg('Could not start voice search.'); }
  }

  return (
    <div className="search-wrap" role="combobox" aria-expanded={open} aria-haspopup="listbox">
      <div className="search-input-row">
        <span className="search-icon">🔍</span>
        <input
          ref={inputRef}
          id={id}
          className="search-input"
          type="text"
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-activedescendant={cursor >= 0 ? `${id}-item-${cursor}` : undefined}
        />
        {loading && <span style={{ padding: '0 10px', color: 'var(--muted)', fontSize: 12 }}>…</span>}
        {text && !loading && (
          <button className="search-clear" onClick={handleClear} aria-label="Clear search" type="button">×</button>
        )}
        <button
          type="button"
          className="search-clear"
          onClick={toggleVoice}
          aria-label={listening ? 'Stop voice search' : 'Search by voice'}
          title={listening ? 'Stop voice search' : 'Search by voice'}
          style={{ color: listening ? 'var(--danger)' : 'var(--muted)', fontSize: 16, padding: '0 10px' }}
        >
          {listening ? '■' : '🎤'}
        </button>
      </div>
      {voiceMsg && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{voiceMsg}</div>}

      {open && (
        <ul className="search-dropdown" id={`${id}-list`} ref={listRef} role="listbox">
          {items.map((item, i) => (
            <li
              key={item.id}
              id={`${id}-item-${i}`}
              className={`search-item${i === cursor ? ' active' : ''}`}
              role="option"
              aria-selected={i === cursor}
              onMouseDown={() => handleSelect(item)}
            >
              <span className="search-item-icon">{item.icon || '🏢'}</span>
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
