import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconSearch, IconCornerDownLeft } from '@tabler/icons-react';
import { StatusBadge } from '../ui/Badge';
import { api } from '../../api/client';

/**
 * Command-bar style global search.
 *
 * - Cmd/Ctrl+K focuses it from anywhere
 * - Debounced 200ms → hits /api/search → renders a dropdown with results
 * - Arrow keys + Enter navigate the results list
 * - Esc clears
 */
export function CommandBar() {
  const inputRef = useRef(null);
  const wrapRef  = useRef(null);
  const nav = useNavigate();

  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen]       = useState(false);
  const [cursor, setCursor]   = useState(0);
  const [isMac]               = useState(() => /Mac|iPhone|iPad/.test(navigator.platform));

  // Cmd/Ctrl+K focus.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced search.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { results: r } = await api.get(
          `/api/search?q=${encodeURIComponent(query)}&project_id=1`,
        );
        setResults(r || []);
        setCursor(0);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Outside click closes.
  useEffect(() => {
    function onClick(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function handleKey(e) {
    if (!open || !results.length) {
      if (e.key === 'Escape') setQuery('');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = results[cursor];
      if (pick) {
        setOpen(false);
        setQuery('');
        nav('/projects/1');
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full max-w-[440px]">
      <div
        className={`group flex items-center gap-2 h-9 px-3 rounded-card transition
          border border-ink-100 dark:border-white/10
          bg-ink-50/70 dark:bg-white/[0.04]
          hover:bg-ink-50 dark:hover:bg-white/[0.06]
          focus-within:bg-white dark:focus-within:bg-[#1c1c1f]
          focus-within:border-accent/60 focus-within:shadow-focus`}
      >
        <IconSearch size={14} stroke={1.7} className="text-ink-400 shrink-0" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Search tasks, projects, or commands…"
          className="flex-1 bg-transparent outline-none text-[13px] placeholder-ink-400
            text-ink-950 dark:text-white"
        />
        <span className="font-mono text-[10px] text-ink-400 px-1.5 h-[18px] inline-flex items-center
          rounded border border-ink-100 dark:border-white/10
          bg-white dark:bg-white/[0.06]
          group-focus-within:opacity-0 transition">
          {isMac ? '⌘K' : 'Ctrl K'}
        </span>
      </div>

      {open && (results.length > 0 || query.trim().length >= 2) && (
        <div
          data-testid="search-results"
          className="absolute left-0 right-0 top-full mt-2 z-30
            db-card rounded-card overflow-hidden
            shadow-[0_20px_50px_-20px_rgba(0,0,0,0.2)] dark:shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)]"
        >
          {results.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-ink-400">
              No matches for "<span className="font-mono">{query}</span>"
            </div>
          ) : (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide font-medium text-ink-400">
                Tasks · {results.length}
              </div>
              <ul>
                {results.map((r, idx) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => {
                        setOpen(false);
                        setQuery('');
                        nav('/projects/1');
                      }}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition
                        ${idx === cursor
                          ? 'bg-accent-subtle dark:bg-accent/15'
                          : 'hover:bg-ink-50 dark:hover:bg-white/5'}`}
                    >
                      <span className="font-mono text-[11px] text-ink-400 w-8 shrink-0">#{r.id}</span>
                      <span className="flex-1 min-w-0 truncate text-[13px]">{r.title}</span>
                      <StatusBadge status={r.status} />
                      {idx === cursor && (
                        <IconCornerDownLeft size={12} stroke={1.7} className="text-ink-400" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="px-3 py-2 border-t border-ink-100 dark:border-white/10
                flex items-center gap-3 text-[10px] text-ink-400">
                <span className="inline-flex items-center gap-1">
                  <kbd className="font-mono px-1 rounded border border-ink-100 dark:border-white/10">↑↓</kbd> navigate
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="font-mono px-1 rounded border border-ink-100 dark:border-white/10">↵</kbd> open
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="font-mono px-1 rounded border border-ink-100 dark:border-white/10">esc</kbd> close
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
