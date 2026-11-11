import { useEffect, useRef, useState } from 'react';

/**
 * Autocomplete search input.
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
  const debounce = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // When value changes externally, sync display text
  useEffect(() => {
    setText(value ? value.label : '');
    setOpen(false);
  }, [value]);

  function handleChange(e) {
    const q = e.target.value;
    setText(q);
    setCursor(-1);
    if (!q.trim()) { setItems([]); setOpen(false); onSelect(null); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await fetchItems(q);
        setItems(results);
        setOpen(results.length > 0);
      } catch { setItems([]); setOpen(false); }
      finally { setLoading(false); }
    }, 280);
  }

  function handleSelect(item) {
    setText(item.label);
    setOpen(false);
    setItems([]);
    setCursor(-1);
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
    setText(''); setItems([]); setOpen(false); setCursor(-1);
    onSelect(null);
    inputRef.current?.focus();
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
      </div>

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
