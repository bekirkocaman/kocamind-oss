import { useCallback, useEffect, useRef, useState } from 'react';
import { IconHistory, IconResumeSession } from '../components/icons.tsx';
import { formatRelativeTime, groupSessionsByDate } from '../shell/sessionUtils.ts';
import type { AgentSessionSummary } from './types.ts';

export function SessionList({
  disabled,
  listSessions,
  onSelect,
  activeSessionId = null,
}: {
  disabled: boolean;
  listSessions: () => Promise<{ sessions: AgentSessionSummary[] } | { error: string }>;
  onSelect: (sessionId: string) => Promise<boolean>;
  activeSessionId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listSessions();
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      setSessions([]);
    } else {
      setSessions(res.sessions);
    }
  }, [listSessions]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleToggle = async () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    await loadList();
  };

  const handlePick = async (sessionId: string) => {
    setOpen(false);
    await onSelect(sessionId);
  };

  const groups = groupSessionsByDate(sessions);

  return (
    <div className="ag-agent-session-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ag-agent-btn-reset ${open ? 'active' : ''}`}
        onClick={() => void handleToggle()}
        disabled={disabled}
        title="Önceki oturumlar"
        aria-label="Önceki oturumlar"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <IconHistory size={13} />
        <span>Oturumlar</span>
      </button>

      {open && (
        <div className="ag-agent-session-popover" role="menu" aria-label="Önceki oturumlar">
          {loading ? (
            <div className="ag-session-skeleton-list" aria-busy="true" aria-label="Oturumlar yükleniyor">
              <div className="ag-session-skeleton-row" />
              <div className="ag-session-skeleton-row short" />
              <div className="ag-session-skeleton-row" />
            </div>
          ) : error ? (
            <div className="ag-agent-session-error-box">
              <span className="ag-agent-session-error">{error}</span>
              <button
                type="button"
                className="ag-agent-btn-reset"
                onClick={() => void loadList()}
              >
                <IconResumeSession size={12} />
                <span>Yeniden dene</span>
              </button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="ag-agent-session-empty">
              Bu klasörde önceki oturum yok.
            </div>
          ) : (
            <div className="ag-agent-session-items">
              {groups.map((group) => (
                <div key={group.label} className="ag-agent-session-group">
                  <div className="ag-agent-session-group-label">{group.label}</div>
                  {group.items.map((s) => {
                    const isActive = activeSessionId === s.sessionId;
                    return (
                      <button
                        key={s.sessionId}
                        type="button"
                        role="menuitem"
                        className={`ag-agent-session-item ${isActive ? 'active' : ''}`}
                        onClick={() => void handlePick(s.sessionId)}
                      >
                        <span className="ag-agent-session-title">
                          {s.title || 'Adsız oturum'}
                        </span>
                        <span className="ag-agent-session-meta">
                          {s.updatedAt ? formatRelativeTime(s.updatedAt) : `${s.turns} tur`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
