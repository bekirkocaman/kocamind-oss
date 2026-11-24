import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  IconAdd,
  IconAgent,
  IconAgentPermissions,
  IconCheck,
  IconDisclosure,
  IconError,
  IconExpand,
  IconFolder,
  IconMore,
  IconOpenFolder,
  IconSendMessage,
  IconTrace,
  IconUndo,
} from '../components/icons.tsx';
import './agent.css';
import { LogoMark } from '../shell/LogoMark.tsx';
import { DiffView } from './DiffView.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { SessionList } from './SessionList.tsx';
import { TraceView } from './TraceView.tsx';
import type { TraceTurn } from './trace.ts';
import type { AgentMode, ChatItem } from './types.ts';
import { useAgent } from './useAgent.ts';

export type AgentController = ReturnType<typeof useAgent>;

export type AgentPanelProps = {
  variant?: 'panel' | 'workspace';
  agent?: AgentController;
  input?: string;
  onInputChange?: (value: string) => void;
  projectName?: string | null;
  onOpenFolder?: () => void;
  activeSessionId?: string | null;
  onSessionSelect?: (sessionId: string) => Promise<boolean>;
  onNewSession?: () => Promise<void>;
};

const MODE_OPTIONS: Array<{ value: AgentMode; label: string; hint: string }> = [
  { value: 'ask', label: 'Her şeyi sor', hint: 'Yazma ve komut için onay ister' },
  { value: 'auto-edit', label: 'Otomatik düzenle', hint: 'Dosya düzenlemelerini doğrudan yapar' },
  { value: 'read-only', label: 'Salt okuma', hint: 'Yalnızca okuma ve inceleme yapar' },
];

function getModeLabel(mode: AgentMode): string {
  return MODE_OPTIONS.find((m) => m.value === mode)?.label ?? 'Her şeyi sor';
}

function getToolLabel(name: string): string {
  switch (name) {
    case 'read_file':
      return 'Dosya okundu';
    case 'list_dir':
      return 'Klasör listelendi';
    case 'glob':
      return 'Dosya arandı';
    case 'grep':
      return 'İçerik arandı';
    case 'write_file':
      return 'Dosya yazıldı';
    case 'edit_file':
      return 'Dosya düzenlendi';
    case 'run_command':
      return 'Komut çalıştırıldı';
    case 'update_plan':
      return 'Plan güncellendi';
    case 'task':
      return 'Alt asistan';
    case 'load_skill':
      return 'Beceri yüklendi';
    default:
      return name;
  }
}

function getToolSummary(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const obj = args as Record<string, unknown>;
  const val = (obj.path ?? obj.pattern ?? obj.command ?? obj.description ?? '') as string;
  if (typeof val === 'string' && val.length > 0) {
    return val.length > 80 ? val.slice(0, 80) + '…' : val;
  }
  return '';
}

const COMPLETE_THINK_RE = /<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/gi;
const OPEN_THINK_RE = /<(?:think|thinking)>([\s\S]*)$/i;

function extractThinking(rawText: string): {
  thinking: string;
  content: string;
  isThinking: boolean;
} {
  if (!rawText || typeof rawText !== 'string') {
    return { thinking: '', content: '', isThinking: false };
  }

  const thinkingParts: string[] = [];
  let working = rawText.replace(COMPLETE_THINK_RE, (_, inner: string) => {
    if (inner && inner.trim()) thinkingParts.push(inner.trim());
    return '';
  });

  let isThinking = false;
  const openMatch = working.match(OPEN_THINK_RE);
  if (openMatch) {
    isThinking = true;
    const partial = openMatch[1];
    if (partial && partial.trim()) thinkingParts.push(partial.trim());
    working = working.slice(0, openMatch.index).trimEnd();
  }

  return {
    thinking: thinkingParts.join('\n\n').trim(),
    content: working.replace(/^\n+/, ''),
    isThinking,
  };
}

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

type RenderSegment =
  | { kind: 'single'; item: Exclude<ChatItem, { kind: 'tool' }> }
  | { kind: 'tool-group'; id: string; tools: ToolItem[] };

function buildRenderSegments(items: ChatItem[]): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let i = 0;
  while (i < items.length) {
    const current = items[i];
    if (current.kind === 'tool') {
      const group: ToolItem[] = [current];
      let j = i + 1;
      while (j < items.length && items[j].kind === 'tool') {
        group.push(items[j] as ToolItem);
        j++;
      }
      segments.push({
        kind: 'tool-group',
        id: `group-${group[0].id}`,
        tools: group,
      });
      i = j;
    } else {
      segments.push({ kind: 'single', item: current });
      i++;
    }
  }
  return segments;
}

function AgentStepsCard({ tools }: { tools: ToolItem[] }) {
  const anyRunning = tools.some((t) => t.status === 'running');
  const failedCount = tools.filter((t) => t.status === 'failed').length;
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);

  const isOpen = manualOpen !== null ? manualOpen : anyRunning || failedCount > 0;

  let summaryLabel =
    tools.length === 1
      ? 'Ajan · 1 işlem tamamlandı'
      : `Ajan · ${tools.length} işlem tamamlandı`;
  if (anyRunning) {
    summaryLabel = 'Ajan çalışıyor';
  } else if (failedCount > 0) {
    summaryLabel = `Ajan · ${tools.length} işlem (${failedCount} hata)`;
  }

  return (
    <div className={`agent-steps ${isOpen ? 'open' : ''}`}>
      <button
        type="button"
        className="agent-steps-head"
        onClick={() => setManualOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className="agent-steps-badge">
          <IconAgent size={14} />
          <span>{summaryLabel}</span>
          {anyRunning && (
            <span className="agent-live-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
        </span>
        <IconExpand size={14} className="agent-steps-chevron" />
      </button>

      {isOpen && (
        <div className="agent-steps-list">
          {tools.map((step) => {
            const summary = getToolSummary(step.args);
            const statusCls =
              step.status === 'ok'
                ? 'done'
                : step.status === 'failed'
                  ? 'error'
                  : 'running';
            return (
              <div key={step.id} className={`agent-step ${statusCls}`}>
                <div className="agent-step-row">
                  <span className="agent-step-icon" aria-hidden="true">
                    {step.status === 'ok' ? (
                      <IconCheck size={13} />
                    ) : step.status === 'failed' ? (
                      <IconError size={13} />
                    ) : (
                      <span className="agent-step-spinner" />
                    )}
                  </span>
                  <span className="agent-step-title">{getToolLabel(step.name)}</span>
                  {summary && (
                    <span className="agent-step-args" title={summary}>
                      {summary}
                    </span>
                  )}
                </div>
                {step.status === 'failed' && step.error && (
                  <pre className="agent-step-preview">{step.error}</pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({
  text,
  active,
  elapsedSec,
}: {
  text?: string;
  active: boolean;
  elapsedSec?: number;
}) {
  const [open, setOpen] = useState(false);
  const hasText = Boolean(text && text.trim().length > 0);

  return (
    <div className="thinking-row" role="status" aria-live="polite">
      {active && (
        <div className="thinking-mark">
          <LogoMark size={24} state="think" />
        </div>
      )}
      <div className={`thinking-panel ${open ? 'open' : ''} ${active ? 'active' : 'done'}`}>
        <button
          type="button"
          className="thinking-head"
          onClick={() => {
            if (hasText) setOpen((v) => !v);
          }}
          aria-expanded={hasText ? open : undefined}
        >
          <span className="thinking-label">
            {active ? (
              <>
                <span className="thinking-shimmer">Düşünüyor</span>
                {elapsedSec !== undefined && elapsedSec > 0 && (
                  <span className="thinking-timer">{elapsedSec} sn</span>
                )}
              </>
            ) : (
              <span>
                Düşündü
                {elapsedSec !== undefined && elapsedSec > 0 ? ` · ${elapsedSec} sn` : ''}
              </span>
            )}
          </span>
          {hasText && <IconExpand size={15} className="thinking-chevron" />}
        </button>

        {hasText && open && (
          <div className="thinking-body">
            {text!
              .split(/\n{2,}/)
              .filter(Boolean)
              .map((para, i) => (
                <p key={i}>{para}</p>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionModeMenu({
  mode,
  disabled,
  compact = false,
  onChange,
}: {
  mode: AgentMode;
  disabled: boolean;
  compact?: boolean;
  onChange: (next: AgentMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
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

  const modeLabel = getModeLabel(mode);

  return (
    <div className="ag-mode-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ag-composer-chip ${open ? 'active' : ''}`}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        disabled={disabled}
        title={`İzin modu: ${modeLabel}`}
        aria-label={`İzin modu: ${modeLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <IconAgentPermissions size={14} />
        {!compact && (
          <>
            <span className="ag-composer-chip-label">{modeLabel}</span>
            <IconExpand size={13} />
          </>
        )}
      </button>

      {open && (
        <div className="ag-mode-popover" role="menu" aria-label="İzin modu seçimi">
          {MODE_OPTIONS.map((opt) => {
            const active = opt.value === mode;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`ag-mode-option ${active ? 'active' : ''}`}
                onClick={() => {
                  setOpen(false);
                  onChange(opt.value);
                }}
              >
                <div className="ag-mode-option-text">
                  <span className="ag-mode-option-label">{opt.label}</span>
                  <span className="ag-mode-option-hint">{opt.hint}</span>
                </div>
                {active && <IconCheck size={14} className="ag-mode-option-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AgentPanelView({
  variant = 'panel',
  agent,
  input: controlledInput,
  onInputChange,
  projectName = null,
  onOpenFolder,
  activeSessionId = null,
  onSessionSelect,
  onNewSession,
}: AgentPanelProps & { agent: AgentController }) {
  const {
    state,
    available,
    send,
    abort,
    approve,
    newSession,
    listSessions,
    resume,
    setMode,
    revertLastTurn,
    loadTrace,
    listModels,
    setModel,
    notifyError,
  } = agent;

  const [localInput, setLocalInput] = useState('');
  const input = controlledInput !== undefined ? controlledInput : localInput;
  const setInput = onInputChange ?? setLocalInput;

  const [traceOpen, setTraceOpen] = useState(false);
  const [traceTurns, setTraceTurns] = useState<TraceTurn[]>([]);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [planExpanded, setPlanExpanded] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.running) {
      setElapsedSec(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setElapsedSec(Math.max(1, Math.round((Date.now() - start) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [state.running]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.items, state.running]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, 26), 180);
    el.style.height = `${nextHeight}px`;
  }, [input, variant]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreMenuOpen]);

  if (!available) {
    return (
      <div className={`ag-agent-panel variant-${variant}`}>
        <div className="ag-agent-unavailable">
          <LogoMark size={42} state="idle" />
          <div className="ag-agent-unavailable-title">Masaüstü uygulaması gerekli</div>
          <p className="ag-agent-unavailable-desc">
            Asistan yalnızca KocaMind masaüstü uygulamasında çalışır.
          </p>
        </div>
      </div>
    );
  }

  const handleSend = () => {
    const trimmed = input.trim();
    if (!state.running && trimmed) {
      void send(trimmed);
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleNewSessionClick = async () => {
    if (onNewSession) {
      await onNewSession();
    } else {
      await newSession();
    }
    textareaRef.current?.focus();
  };

  const handleResumeSession = async (sessionId: string) => {
    if (onSessionSelect) {
      return await onSessionSelect(sessionId);
    }
    return await resume(sessionId);
  };

  const handleRevertClick = () => {
    setMoreMenuOpen(false);
    if (window.confirm('Son turdaki dosya değişiklikleri geri alınsın mı?')) {
      void revertLastTurn();
    }
  };

  const handleOpenTraceClick = () => {
    setMoreMenuOpen(false);
    setTraceOpen(true);
    void loadTrace().then(setTraceTurns);
  };

  const completedPlanCount = state.plan.filter((p) => p.status === 'completed').length;
  const totalPlanCount = state.plan.length;
  const activePlanStep = state.plan.find((p) => p.status === 'in_progress') ?? null;

  const isEmpty = state.items.length === 0;
  const hasStreamingAssistant = state.items.some(
    (i) => i.kind === 'assistant' && i.streaming
  );
  const hasPendingApproval = state.items.some(
    (i) => i.kind === 'approval' && i.status === 'pending'
  );
  const showThinkingRow = state.running && !hasStreamingAssistant && !hasPendingApproval;

  const segments = buildRenderSegments(state.items);

  const composerElement = (
    <div className={`input-wrapper ag-agent-input-container ${variant === 'workspace' ? 'workspace-composer' : ''}`}>
      <div className="input-container composer ag-agent-input-box">
        <textarea
          ref={textareaRef}
          className="message-input ag-agent-textarea"
          placeholder={
            variant === 'workspace'
              ? 'KocaMind’a yazın...'
              : 'Bir soru sor veya değişiklik iste...'
          }
          value={input}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          rows={1}
          aria-label="Asistana mesaj yaz"
        />

        <div className="composer-row ag-agent-input-actions">
          <div className="ag-composer-left-tools">
            {Boolean(onOpenFolder) && (
              <button
                type="button"
                className="ag-composer-chip project-chip"
                onClick={() => onOpenFolder?.()}
                title={projectName ? `Açık klasör: ${projectName} (Değiştirmek için tıkla)` : 'Klasör seç'}
                aria-label={projectName ? `Açık klasör: ${projectName}` : 'Klasör seç'}
              >
                <IconFolder size={14} />
                {variant !== 'panel' && (
                  <span className="ag-composer-chip-label">
                    {projectName ?? 'Klasör seç'}
                  </span>
                )}
              </button>
            )}

            <PermissionModeMenu
              mode={state.mode}
              disabled={state.running}
              compact={variant === 'panel'}
              onChange={setMode}
            />

            <ModelPicker
              disabled={state.running}
              listModels={listModels}
              setModel={setModel}
              onError={notifyError}
              direction="up"
            />
          </div>

          <div className="composer-right ag-composer-right-tools">
            {state.running ? (
              <button
                type="button"
                className="stop-button ag-agent-btn-abort"
                onClick={() => void abort()}
                title="Durdur"
                aria-label="Yanıtı durdur"
              >
                <span className="stop-square" />
              </button>
            ) : (
              <button
                type="button"
                className="send-button ag-agent-btn-send"
                onClick={handleSend}
                disabled={!input.trim()}
                title="Gönder (Enter)"
                aria-label="Mesajı gönder"
              >
                <IconSendMessage size={20} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`chat-view ag-agent-panel variant-${variant} ${isEmpty ? 'is-empty' : 'has-items'}`}>
      {variant === 'panel' ? (
        <div className="ag-agent-header">
          <div className="ag-agent-header-bar">
            <div className="ag-agent-title-row">
              <LogoMark size={16} state={state.running ? 'think' : 'idle'} />
              <span className="ag-agent-title">Asistan</span>
            </div>

            <div className="ag-agent-header-actions">
              <SessionList
                disabled={state.running}
                listSessions={listSessions}
                onSelect={handleResumeSession}
                activeSessionId={activeSessionId}
              />

              <button
                type="button"
                className="ag-agent-icon-btn"
                onClick={() => void handleNewSessionClick()}
                disabled={state.running}
                title="Yeni oturum"
                aria-label="Yeni oturum başlat"
              >
                <IconAdd size={15} />
              </button>

              <div className="ag-agent-more-wrap" ref={moreMenuRef}>
                <button
                  type="button"
                  className={`ag-agent-icon-btn ${moreMenuOpen ? 'active' : ''}`}
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  title="Daha fazla işlem"
                  aria-label="Daha fazla işlem"
                  aria-expanded={moreMenuOpen}
                  aria-haspopup="menu"
                >
                  <IconMore size={15} />
                </button>

                {moreMenuOpen && (
                  <div className="ag-agent-more-popover" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="ag-agent-more-item"
                      onClick={handleOpenTraceClick}
                    >
                      <IconTrace size={14} />
                      <span>İz görünümü</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="ag-agent-more-item"
                      onClick={handleRevertClick}
                      disabled={state.running}
                    >
                      <IconUndo size={14} />
                      <span>Son turu geri al</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : !isEmpty || state.running ? (
        <div className="chat-header ag-workspace-topbar">
          <div className="ag-workspace-topbar-inner">
            <div className="ag-workspace-topbar-status" />
            <div className="header-right ag-workspace-topbar-actions">
              <button
                type="button"
                className="ag-agent-btn-reset"
                onClick={handleRevertClick}
                disabled={state.running || isEmpty}
                title="Son turdaki dosya değişikliklerini geri al"
                aria-label="Son turu geri al"
              >
                <IconUndo size={14} />
                <span>Geri al</span>
              </button>
              <button
                type="button"
                className="ag-agent-btn-reset"
                onClick={handleOpenTraceClick}
                title="İz görünümü"
                aria-label="İz görünümünü aç"
              >
                <IconTrace size={14} />
                <span>İz</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Plan: sayılı ilerleme satırı */}
      {state.plan.length > 0 && (
        <div className={`ag-agent-plan ${variant === 'workspace' ? 'workspace-plan' : ''}`}>
          <div className="ag-agent-plan-inner">
            <button
              type="button"
              className="ag-agent-plan-bar"
              onClick={() => setPlanExpanded((v) => !v)}
              aria-expanded={planExpanded}
            >
              <span className={`ag-plan-chevron ${planExpanded ? 'open' : ''}`}>
                <IconDisclosure size={13} />
              </span>
              <span className="ag-agent-plan-badge">
                {completedPlanCount}/{totalPlanCount}
              </span>
              <span className="ag-agent-plan-summary">
                {activePlanStep ? activePlanStep.content : 'Plan adımları'}
              </span>
            </button>

            {planExpanded && (
              <ol className="ag-agent-plan-list">
                {state.plan.map((item, idx) => {
                  const statusClass =
                    item.status === 'completed'
                      ? 'completed'
                      : item.status === 'in_progress'
                        ? 'in_progress'
                        : 'pending';

                  return (
                    <li key={`plan-${idx}`} className={`ag-agent-plan-item ${statusClass}`}>
                      <span className="ag-agent-plan-num">
                        {item.status === 'completed' ? <IconCheck size={11} /> : idx + 1}
                      </span>
                      <span className="ag-agent-plan-text">{item.content}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      )}

      {/* Konuşma ve boş durum düzeni */}
      {variant === 'workspace' && isEmpty && !state.running ? (
        <div className="ag-workspace-empty-stage">
          <div className="empty-state">
            <div className="empty-hero">
              <div className="empty-logo">
                <LogoMark size={54} state="idle" />
              </div>
              <h1 className="empty-title">Merhaba</h1>
              <p className="empty-subtitle">
                Projedeki dosyaları inceleyebilir, kod yazabilir veya komut çalıştırabilirim.
              </p>
            </div>

            {projectName === null && onOpenFolder && (
              <div className="empty-suggestions">
                <button
                  type="button"
                  className="empty-suggestion"
                  onClick={onOpenFolder}
                >
                  <IconOpenFolder size={16} />
                  <span>Klasör seç</span>
                </button>
              </div>
            )}
          </div>
          {composerElement}
        </div>
      ) : (
        <>
          <div className="messages-container ag-agent-messages">
            <div className="ag-agent-messages-inner">
              {isEmpty && !state.running ? (
                <div className="empty-state ag-agent-empty">
                  <div className="empty-hero">
                    <div className="empty-logo">
                      <LogoMark size={38} state="idle" />
                    </div>
                    <h2 className="empty-title empty-title-compact">Merhaba</h2>
                    <p className="empty-subtitle">
                      Açık proje üzerinde soru sor ya da kod değişikliği iste.
                    </p>
                  </div>
                  {projectName === null && onOpenFolder && (
                    <div className="empty-suggestions">
                      <button
                        type="button"
                        className="empty-suggestion"
                        onClick={onOpenFolder}
                      >
                        <IconOpenFolder size={15} />
                        <span>Klasör seç</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                segments.map((seg) => {
                  if (seg.kind === 'tool-group') {
                    return <AgentStepsCard key={seg.id} tools={seg.tools} />;
                  }

                  const item = seg.item;

                  if (item.kind === 'user') {
                    return (
                      <div key={item.id} className="message user ag-agent-msg-user-wrap">
                        <div className="message-content">
                          <div className="message-text ag-agent-msg-user">{item.text}</div>
                        </div>
                      </div>
                    );
                  }

                  if (item.kind === 'assistant') {
                    const parsed = extractThinking(item.text);
                    const hasThink = Boolean(parsed.thinking) || parsed.isThinking;
                    const thinkActive = Boolean(item.streaming && parsed.isThinking);

                    return (
                      <div key={item.id} className="message assistant ag-agent-msg-assistant-wrap">
                        <div className="message-content">
                          {hasThink && (
                            <ThinkingBlock
                              text={parsed.thinking}
                              active={thinkActive}
                              elapsedSec={thinkActive ? elapsedSec : undefined}
                            />
                          )}
                          {(parsed.content || (!hasThink && item.text)) && (
                            <div className="message-text ag-agent-msg-assistant">
                              {parsed.content || item.text}
                              {item.streaming && !parsed.isThinking && (
                                <span className="typing-cursor ag-agent-cursor" aria-hidden="true" />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (item.kind === 'approval') {
                    let title = 'Onay gerekiyor';
                    let copy = 'Ajan bu işlemi çalıştırmak için onayınızı bekliyor:';
                    if (item.name === 'write_file' || item.name === 'edit_file') {
                      title = 'Dosya değişikliği onayı';
                      copy = 'Ajan aşağıdaki dosya değişikliğini uygulamak için onayınızı bekliyor:';
                    } else if (item.name === 'run_command') {
                      title = 'Komut çalıştırma onayı';
                      copy = 'Ajan aşağıdaki komutu çalıştırmak için onayınızı bekliyor:';
                    }

                    const cmd =
                      item.name === 'run_command' && item.args && typeof item.args === 'object'
                        ? ((item.args as Record<string, unknown>).command as string)
                        : '';

                    return (
                      <div key={item.id} className="agent-approval">
                        <div className="agent-approval-card ag-agent-approval-card">
                          <div className="ag-agent-approval-header">
                            <div className="agent-approval-title ag-agent-approval-title">
                              {title}
                            </div>
                            {item.status !== 'pending' && (
                              <span className={`ag-agent-approval-status ${item.status}`}>
                                {item.status === 'approved' ? 'Onaylandı' : 'Reddedildi'}
                              </span>
                            )}
                          </div>

                          {item.status === 'pending' && (
                            <div className="agent-approval-copy">{copy}</div>
                          )}

                          {item.preview && (
                            <DiffView
                              path={item.preview.path}
                              before={item.preview.before}
                              after={item.preview.after}
                            />
                          )}

                          {cmd && <pre className="ag-agent-cmd-box">{cmd}</pre>}

                          {item.status === 'pending' && (
                            <div className="agent-approval-buttons ag-agent-approval-actions">
                              <button
                                type="button"
                                className="agent-approval-cancel ag-agent-btn-reject"
                                onClick={() => void approve(item.callId, false)}
                              >
                                Reddet
                              </button>
                              <button
                                type="button"
                                className="agent-approval-confirm ag-agent-btn-approve"
                                onClick={() => void approve(item.callId, true)}
                              >
                                Onayla
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (item.kind === 'notice') {
                    return (
                      <div
                        key={item.id}
                        className={`ag-agent-notice ${item.tone}`}
                        role="status"
                      >
                        {item.text}
                      </div>
                    );
                  }

                  return null;
                })
              )}

              {showThinkingRow && (
                <ThinkingBlock active={true} elapsedSec={elapsedSec} />
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {composerElement}
        </>
      )}

      {traceOpen && (
        <TraceView turns={traceTurns} onClose={() => setTraceOpen(false)} />
      )}
    </div>
  );
}

function StandaloneAgentPanel(props: AgentPanelProps) {
  const agent = useAgent();
  return <AgentPanelView {...props} agent={agent} />;
}

export default function AgentPanel(props: AgentPanelProps) {
  if (props.agent) {
    return <AgentPanelView {...props} agent={props.agent} />;
  }
  return <StandaloneAgentPanel {...props} />;
}
