import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconAdd,
  IconClose,
  IconCloseLeftSidebar,
  IconConversation,
  IconRetry,
  IconSearch,
  IconSidebar,
} from '../components/icons.tsx';
import { AccountButton } from '../agent/AccountButton.tsx';
import AgentPanel, { type AgentController } from '../agent/AgentPanel.tsx';
import {
  formatRelativeTime,
  groupSessionsByDate,
} from './sessionUtils.ts';
import type { AgentSessionSummary } from '../agent/types.ts';

export function AgentWorkspace({
  agent,
  input,
  onInputChange,
  projectName,
  onOpenFolder,
  activeSessionId,
  onSessionSelect,
  onNewSession,
}: {
  agent: AgentController;
  input: string;
  onInputChange: (val: string) => void;
  projectName: string | null;
  onOpenFolder: () => void;
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => Promise<boolean>;
  onNewSession: () => Promise<void>;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchSessions = useCallback(async () => {
    if (!agent.available) return;
    setLoading(true);
    setError(null);
    const res = await agent.listSessions();
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      setSessions([]);
    } else {
      setSessions(res.sessions);
    }
  }, [agent]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions, projectName]);

  // Tur tamamlandığında oturum listesini sessizce güncelle
  useEffect(() => {
    if (!agent.state.running && agent.state.items.length > 0 && agent.available) {
      void agent.listSessions().then((res) => {
        if (!('error' in res)) {
          setSessions(res.sessions);
        }
      });
    }
  }, [agent, agent.state.running, agent.state.items.length]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      (s.title || 'Adsız oturum').toLowerCase().includes(q),
    );
  }, [sessions, searchQuery]);

  const groups = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions],
  );

  return (
    <div className="km-agent-workspace">
      <aside
        className={`clone-drawer km-agent-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
        aria-label="Oturumlar kenar çubuğu"
      >
        <div className="drawer-head">
          <span className="drawer-title">KocaMind</span>
          <div className="drawer-head-actions">
            <button
              type="button"
              className="drawer-search-btn"
              onClick={() => {
                setIsSearching((v) => {
                  if (v) setSearchQuery('');
                  return !v;
                });
              }}
              aria-label="Oturumlarda ara"
              title="Oturumlarda ara"
            >
              {isSearching ? <IconClose size={18} /> : <IconSearch size={18} />}
            </button>
            <button
              type="button"
              className="drawer-search-btn"
              onClick={() => setSidebarCollapsed(true)}
              title="Kenar çubuğunu daralt"
              aria-label="Kenar çubuğunu daralt"
            >
              <IconCloseLeftSidebar size={18} />
            </button>
          </div>
        </div>

        {isSearching && (
          <div className="drawer-search">
            <input
              type="text"
              placeholder="Oturumlarda ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
        )}

        <div className="drawer-actions">
          <button
            type="button"
            className="drawer-new-chat"
            onClick={() => void onNewSession()}
            disabled={agent.state.running || !agent.available}
          >
            <IconAdd size={18} />
            <span>Yeni oturum</span>
          </button>
        </div>

        <div className="drawer-history km-agent-sidebar-sessions">
          {!agent.available ? (
            <div className="history-empty">
              Oturum geçmişi masaüstü uygulamasında görünür.
            </div>
          ) : loading ? (
            <div className="km-sidebar-skeletons" aria-busy="true" aria-label="Oturumlar yükleniyor">
              <div className="km-sidebar-skeleton-item" />
              <div className="km-sidebar-skeleton-item short" />
              <div className="km-sidebar-skeleton-item" />
              <div className="km-sidebar-skeleton-item medium" />
            </div>
          ) : error ? (
            <div className="km-sidebar-error">
              <p className="km-sidebar-error-text">{error}</p>
              <button
                type="button"
                className="km-sidebar-retry-btn"
                onClick={() => void fetchSessions()}
              >
                <IconRetry size={13} />
                <span>Yeniden dene</span>
              </button>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="history-empty">
              {searchQuery.trim() ? 'Sonuç bulunamadı.' : 'Henüz kayıtlı oturum yok.'}
            </div>
          ) : (
            <div className="km-sidebar-groups">
              {groups.map((group) => (
                <div key={group.label} className="km-sidebar-group">
                  <div className="drawer-section-label">{group.label}</div>
                  <div className="history-list">
                    {group.items.map((s) => {
                      const isActive = activeSessionId === s.sessionId;
                      return (
                        <button
                          key={s.sessionId}
                          type="button"
                          className={`history-item km-sidebar-session-row ${isActive ? 'active' : ''}`}
                          onClick={() => void onSessionSelect(s.sessionId)}
                          disabled={agent.state.running}
                          title={s.title || 'Adsız oturum'}
                        >
                          <IconConversation size={15} className="history-icon" />
                          <span className="history-title">
                            {s.title || 'Adsız oturum'}
                          </span>
                          <span className="km-sidebar-session-time">
                            {s.updatedAt ? formatRelativeTime(s.updatedAt) : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="drawer-footer km-agent-sidebar-footer">
          <AccountButton />
        </div>
      </aside>

      <main className="km-agent-main">
        {sidebarCollapsed && (
          <button
            type="button"
            className="header-btn km-sidebar-expand-floating"
            onClick={() => setSidebarCollapsed(false)}
            title="Kenar çubuğunu aç"
            aria-label="Kenar çubuğunu aç"
          >
            <IconSidebar size={20} />
          </button>
        )}

        <AgentPanel
          variant="workspace"
          agent={agent}
          input={input}
          onInputChange={onInputChange}
          projectName={projectName}
          onOpenFolder={onOpenFolder}
          activeSessionId={activeSessionId}
          onSessionSelect={onSessionSelect}
          onNewSession={onNewSession}
        />
      </main>
    </div>
  );
}
