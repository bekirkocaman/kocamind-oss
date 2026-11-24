import { useCallback, useEffect, useRef, useState } from 'react';
import { IconClose, IconDelete, IconStop } from '../components/icons.tsx';
import { parseAnsi } from './ansi.ts';
import { navigate, pushHistory } from './history.ts';
import './terminal.css';

const HEIGHT_STORAGE_KEY = 'kocamind_terminal_height';
const HISTORY_STORAGE_KEY = 'kocamind_terminal_history';
const MAX_LINES = 5000;
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 240;

type TerminalLine = {
  id: number;
  kind: 'cmd' | 'stdout' | 'stderr' | 'meta';
  text: string;
  exitCode?: string;
  exitError?: boolean;
  durationSec?: string;
};

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(HEIGHT_STORAGE_KEY);
    if (!raw) return DEFAULT_HEIGHT;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < MIN_HEIGHT) return DEFAULT_HEIGHT;
    return n;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

function saveStoredHeight(height: number) {
  try {
    localStorage.setItem(HEIGHT_STORAGE_KEY, String(Math.round(height)));
  } catch {
    // yoksay
  }
}

function readStoredHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

function saveStoredHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // yoksay
  }
}

function clampHeight(h: number): number {
  const maxH = typeof window !== 'undefined' ? Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * 0.7)) : 600;
  return Math.max(MIN_HEIGHT, Math.min(maxH, h));
}

export function TerminalPanel({
  isOpen,
  hasWorkspace,
  onClose,
}: {
  isOpen: boolean;
  hasWorkspace: boolean;
  onClose: () => void;
}) {
  const [height, setHeight] = useState<number>(() => clampHeight(readStoredHeight()));
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(() => readStoredHistory());
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  const nextLineIdRef = useRef(1);
  const activeRunIdRef = useRef<string | null>(null);
  const openStreamKindRef = useRef<'stdout' | 'stderr' | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autoScrollRef = useRef(true);

  const appendLine = useCallback(
    (
      kind: TerminalLine['kind'],
      text: string,
      extra?: Pick<TerminalLine, 'exitCode' | 'exitError' | 'durationSec'>,
    ) => {
      openStreamKindRef.current = null;
      setLines((prev) => {
        const next = [...prev, { id: nextLineIdRef.current++, kind, text, ...extra }];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    },
    [],
  );

  const appendStreamChunk = useCallback((stream: 'stdout' | 'stderr', text: string) => {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parts = normalized.split('\n');

    setLines((prev) => {
      const next = [...prev];
      const canAppendToLast =
        openStreamKindRef.current === stream &&
        next.length > 0 &&
        next[next.length - 1].kind === stream;

      if (canAppendToLast) {
        next[next.length - 1] = {
          ...next[next.length - 1],
          text: next[next.length - 1].text + parts[0],
        };
      } else if (parts[0] !== '' || parts.length === 1) {
        next.push({ id: nextLineIdRef.current++, kind: stream, text: parts[0] });
      }

      for (let i = 1; i < parts.length; i++) {
        // Sondaki bos string sadece satir sonu \n demektir; yeni bos satir acmayiz
        if (i === parts.length - 1 && parts[i] === '') {
          openStreamKindRef.current = null;
          continue;
        }
        next.push({ id: nextLineIdRef.current++, kind: stream, text: parts[i] });
      }

      if (parts.length === 1 || parts[parts.length - 1] !== '') {
        openStreamKindRef.current = stream;
      }

      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  useEffect(() => {
    const api = window.electron?.terminal;
    if (!api) return;

    const unsubData = api.onData((ev) => {
      if (activeRunIdRef.current && ev.runId !== activeRunIdRef.current) return;
      appendStreamChunk(ev.stream, ev.text);
    });

    const unsubExit = api.onExit((ev) => {
      if (activeRunIdRef.current && ev.runId !== activeRunIdRef.current) return;
      activeRunIdRef.current = null;
      setRunningRunId(null);

      if (ev.killed) {
        setLastErrorCode(null);
        appendLine('meta', 'durduruldu');
      } else {
        const sec = (ev.durationMs / 1000).toFixed(1);
        const codeText = ev.code === null ? '?' : String(ev.code);
        const isError = ev.code !== 0;
        setLastErrorCode(isError ? codeText : null);
        appendLine('meta', `çıkış kodu ${codeText}, ${sec} sn`, {
          exitCode: codeText,
          exitError: isError,
          durationSec: sec,
        });
      }
    });

    return () => {
      unsubData();
      unsubExit();
    };
  }, [appendLine, appendStreamChunk]);

  useEffect(() => {
    if (isOpen && hasWorkspace && !runningRunId) {
      inputRef.current?.focus();
    }
  }, [isOpen, hasWorkspace, runningRunId]);

  useEffect(() => {
    if (!isOpen || !autoScrollRef.current) return;
    const el = outputRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines, isOpen]);

  const handleOutputScroll = () => {
    const el = outputRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distanceFromBottom <= 24;
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    let latestH = startH;

    const onMove = (ev: MouseEvent) => {
      latestH = clampHeight(startH + (startY - ev.clientY));
      setHeight(latestH);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveStoredHeight(latestH);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleRun = async () => {
    const cmd = input.trim();
    if (!cmd || runningRunId || !hasWorkspace) return;
    const api = window.electron?.terminal;
    if (!api) return;

    const nextHistory = pushHistory(history, cmd);
    setHistory(nextHistory);
    saveStoredHistory(nextHistory);
    setHistoryIdx(-1);
    setInput('');
    setLastErrorCode(null);
    autoScrollRef.current = true;

    appendLine('cmd', `$ ${cmd}`);

    const res = await api.run(cmd);
    if ('error' in res) {
      appendLine('stderr', res.error);
      return;
    }
    activeRunIdRef.current = res.runId;
    setRunningRunId(res.runId);
  };

  const handleKill = async () => {
    const api = window.electron?.terminal;
    if (!api) return;
    await api.kill();
  };

  const handleClear = () => {
    openStreamKindRef.current = null;
    setLastErrorCode(null);
    setLines([]);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleRun();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const res = navigate(history, historyIdx, 'up');
      setHistoryIdx(res.index);
      setInput(res.value);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const res = navigate(history, historyIdx, 'down');
      setHistoryIdx(res.index);
      setInput(res.value);
    }
  };

  const isRunning = runningRunId !== null;
  const inputDisabled = !hasWorkspace || isRunning;
  const placeholder = !hasWorkspace
    ? 'Terminal için önce bir klasör aç'
    : isRunning
      ? 'Komut çalışıyor…'
      : 'Komut yaz ve Enter’a bas…';

  return (
    <section
      className="ag-terminal-panel"
      aria-label="Terminal"
      style={{ height: `${height}px`, display: isOpen ? 'flex' : 'none' }}
    >
      <div className="ag-terminal-resizer" onMouseDown={handleResizeStart} />

      <div className="ag-terminal-header">
        <div className="ag-terminal-title-group">
          <span className="ag-terminal-title">Terminal</span>
          {isRunning ? (
            <span className="ag-terminal-running">
              <span className="ag-terminal-live-dot" aria-hidden="true" />
              Çalışıyor
            </span>
          ) : lastErrorCode !== null ? (
            <span className="ag-terminal-exit-badge error">
              Çıkış {lastErrorCode}
            </span>
          ) : null}
        </div>
        <div className="ag-terminal-actions">
          {isRunning && (
            <button
              type="button"
              className="ag-terminal-icon-btn danger"
              onClick={() => void handleKill()}
              aria-label="Çalışan komutu durdur"
              title="Çalışan komutu durdur"
            >
              <IconStop size={12} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="ag-terminal-icon-btn"
            onClick={handleClear}
            aria-label="Çıktıyı temizle"
            title="Çıktıyı temizle"
          >
            <IconDelete size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ag-terminal-icon-btn"
            onClick={onClose}
            aria-label="Terminali kapat"
            title="Terminali kapat (Ctrl+`)"
          >
            <IconClose size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={outputRef}
        className="ag-terminal-output"
        onScroll={handleOutputScroll}
      >
        {lines.length === 0 ? (
          <div className="ag-terminal-empty">
            {hasWorkspace
              ? 'Komut çalıştırmak için aşağıya yaz.'
              : 'Terminal için önce bir klasör aç'}
          </div>
        ) : (
          lines.map((line) => {
            if (line.kind === 'meta') {
              if (line.exitCode !== undefined) {
                return (
                  <div key={line.id} className="ag-terminal-line meta">
                    <span
                      className={`ag-terminal-exit-badge${line.exitError ? ' error' : ''}`}
                    >
                      çıkış {line.exitCode}
                    </span>
                    {line.durationSec && (
                      <span className="ag-terminal-duration">{line.durationSec} sn</span>
                    )}
                  </div>
                );
              }
              return (
                <div key={line.id} className="ag-terminal-line meta">
                  <span className="ag-terminal-exit-badge">{line.text}</span>
                </div>
              );
            }
            if (line.kind === 'cmd') {
              return (
                <div key={line.id} className="ag-terminal-line cmd">
                  {line.text}
                </div>
              );
            }
            const segs = parseAnsi(line.text);
            return (
              <div key={line.id} className={`ag-terminal-line ${line.kind}`}>
                {segs.length === 0
                  ? '\u00a0'
                  : segs.map((seg, idx) => {
                      const cls = [
                        seg.bold ? 'ansi-bold' : '',
                        seg.fg ? `ansi-fg-${seg.fg}` : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return cls ? (
                        <span key={idx} className={cls}>
                          {seg.text}
                        </span>
                      ) : (
                        <span key={idx}>{seg.text}</span>
                      );
                    })}
              </div>
            );
          })
        )}
      </div>

      <div className="ag-terminal-input-row">
        <span className="ag-terminal-prompt" aria-hidden="true">$</span>
        <input
          ref={inputRef}
          type="text"
          className="ag-terminal-input"
          aria-label="Terminal komutu"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (historyIdx !== -1) setHistoryIdx(-1);
          }}
          onKeyDown={handleInputKeyDown}
          disabled={inputDisabled}
          placeholder={placeholder}
        />
      </div>
    </section>
  );
}
