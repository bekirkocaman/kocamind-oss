import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconSearch } from '../components/icons.tsx';
import { fileIconFor } from '../icons/index.ts';
import { fuzzyFilter } from './fuzzy.ts';

type QuickOpenProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (filePath: string) => void;
  showToast: (msg: string) => void;
};

const EXIT_DURATION_MS = 120;
const SKELETON_WIDTHS = ['46%', '64%', '38%', '58%', '50%'];

function findSubsequenceIndices(target: string, queryLower: string): Set<number> | null {
  if (!queryLower) return null;
  const targetLower = target.toLowerCase();
  const indices = new Set<number>();
  let qi = 0;

  for (let ti = 0; ti < targetLower.length && qi < queryLower.length; ti++) {
    if (targetLower[ti] === queryLower[qi]) {
      indices.add(ti);
      qi++;
    }
  }

  return qi === queryLower.length ? indices : null;
}

function getHighlightSets(
  filePath: string,
  fileName: string,
  lastSlash: number,
  query: string,
): { nameMatches: Set<number> | null; dirMatches: Set<number> | null } {
  const queryLower = query.trim().toLowerCase();
  if (!queryLower) {
    return { nameMatches: null, dirMatches: null };
  }

  const nameOnly = findSubsequenceIndices(fileName, queryLower);
  if (nameOnly) {
    return { nameMatches: nameOnly, dirMatches: null };
  }

  const fullPath = findSubsequenceIndices(filePath, queryLower);
  if (!fullPath || lastSlash < 0) {
    return { nameMatches: fullPath, dirMatches: null };
  }

  const dirMatches = new Set<number>();
  const nameMatches = new Set<number>();
  const nameOffset = lastSlash + 1;

  for (const idx of fullPath) {
    if (idx < lastSlash) {
      dirMatches.add(idx);
    } else if (idx >= nameOffset) {
      nameMatches.add(idx - nameOffset);
    }
  }

  return {
    nameMatches: nameMatches.size > 0 ? nameMatches : null,
    dirMatches: dirMatches.size > 0 ? dirMatches : null,
  };
}

function renderHighlighted(text: string, matches: Set<number> | null): ReactNode {
  if (!matches || matches.size === 0) return text;

  const nodes: ReactNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const isMatch = matches.has(cursor);
    let end = cursor + 1;
    while (end < text.length && matches.has(end) === isMatch) {
      end++;
    }
    const slice = text.slice(cursor, end);
    if (isMatch) {
      nodes.push(
        <span key={cursor} className="ag-quickopen-match">
          {slice}
        </span>,
      );
    } else {
      nodes.push(slice);
    }
    cursor = end;
  }

  return nodes;
}

export function QuickOpen({ isOpen, onClose, onSelect }: QuickOpenProps) {
  const [rendered, setRendered] = useState(isOpen);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRendered(true);
      setClosing(false);
      return;
    }

    if (!rendered) return;

    setClosing(true);
    const timer = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, EXIT_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, rendered]);

  useEffect(() => {
    if (!isOpen) return;

    setQuery('');
    setSelectedIndex(0);
    setFiles([]);
    setError(null);

    const api = window.electron?.workspace;
    if (!api) {
      setLoading(false);
      setError('Klasör açmak için masaüstü uygulamasını kullan.');
      const focusTimer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(focusTimer);
    }

    let cancelled = false;
    setLoading(true);
    api
      .listFiles()
      .then((res) => {
        if (cancelled) return;
        setLoading(false);
        if ('error' in res) {
          setError(res.error);
          return;
        }
        setFiles(res.files);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setError('Dosyalar listelenemedi.');
      });

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  const results = useMemo(() => fuzzyFilter(files, query, 50), [files, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const container = listRef.current;
    if (!container || results.length === 0) return;
    const item = container.querySelector<HTMLElement>(
      `[data-quickopen-idx="${selectedIndex}"]`,
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, results.length]);

  if (!rendered) return null;

  const activeOptionId =
    !loading && !error && results.length > 0
      ? `${listboxId}-opt-${selectedIndex}`
      : undefined;

  const commitSelection = (filePath: string) => {
    if (closing) return;
    onSelect(filePath);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!closing) onClose();
      return;
    }
    if (loading || error || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setSelectedIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setSelectedIndex(results.length - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[selectedIndex];
      if (target) {
        commitSelection(target);
      }
    }
  };

  return (
    <div
      className={`ag-quickopen-backdrop${closing ? ' closing' : ''}`}
      onMouseDown={() => {
        if (!closing) onClose();
      }}
    >
      <div
        className={`ag-quickopen-modal${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Hızlı dosya aç"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ag-quickopen-input-wrap">
          <IconSearch size={14} className="ag-quickopen-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="ag-quickopen-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            aria-label="Dosya ara"
            placeholder="Dosya ara…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div
          id={listboxId}
          ref={listRef}
          className="ag-quickopen-list"
          role="listbox"
          aria-label="Dosyalar"
          aria-busy={loading}
        >
          {loading ? (
            <div className="ag-quickopen-skeleton-group" aria-hidden="true">
              {SKELETON_WIDTHS.map((width, idx) => (
                <div key={idx} className="ag-quickopen-skeleton-row">
                  <span className="ag-quickopen-skeleton-icon" />
                  <span className="ag-quickopen-skeleton-bar" style={{ width }} />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="ag-quickopen-error" role="alert">
              {error}
            </div>
          ) : results.length === 0 ? (
            <div className="ag-quickopen-empty">Eşleşen dosya yok</div>
          ) : (
            results.map((filePath, idx) => {
              const lastSlash = filePath.lastIndexOf('/');
              const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
              const dirName = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '';
              const FileIcon = fileIconFor(fileName);
              const { nameMatches, dirMatches } = getHighlightSets(
                filePath,
                fileName,
                lastSlash,
                query,
              );
              const selected = idx === selectedIndex;
              return (
                <div
                  key={filePath}
                  id={`${listboxId}-opt-${idx}`}
                  data-quickopen-idx={idx}
                  role="option"
                  aria-selected={selected}
                  className={`ag-quickopen-item${selected ? ' selected' : ''}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => commitSelection(filePath)}
                >
                  <FileIcon size={14} className="ag-quickopen-file-icon" aria-hidden="true" />
                  <span className="ag-quickopen-name">
                    {renderHighlighted(fileName, nameMatches)}
                  </span>
                  {dirName && (
                    <span className="ag-quickopen-dir">
                      {renderHighlighted(dirName, dirMatches)}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="ag-quickopen-footer">
          <span className="ag-quickopen-hint">
            <kbd className="ag-quickopen-kbd">↑↓</kbd> gez
          </span>
          <span className="ag-quickopen-hint">
            <kbd className="ag-quickopen-kbd">Enter</kbd> aç
          </span>
          <span className="ag-quickopen-hint">
            <kbd className="ag-quickopen-kbd">Esc</kbd> kapat
          </span>
        </div>
      </div>
    </div>
  );
}
