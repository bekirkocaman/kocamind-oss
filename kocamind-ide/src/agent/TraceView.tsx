import { useState } from 'react';
import {
  IconCheck,
  IconClose,
  IconDisclosure,
  IconDuration,
  IconError,
} from '../components/icons.tsx';
import type { TraceTurn } from './trace.ts';

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
      return 'Skill yüklendi';
    default:
      return name;
  }
}

function getStatusInfo(status: string | null): { label: string; cls: string } {
  switch (status) {
    case 'completed':
      return { label: 'Tamamlandı', cls: 'completed' };
    case 'aborted':
      return { label: 'Durduruldu', cls: 'aborted' };
    case 'failed':
      return { label: 'Hata', cls: 'failed' };
    default:
      return { label: 'Devam ediyor', cls: 'running' };
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} sn`;
}

export function TraceView({
  turns,
  onClose,
}: {
  turns: TraceTurn[];
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    if (turns.length > 0) {
      initial[turns[turns.length - 1].index] = true;
    }
    return initial;
  });

  const toggleTurn = (index: number) => {
    setExpanded((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div className="ag-trace-overlay" role="dialog" aria-label="İz görünümü">
      <div className="ag-trace-header">
        <span className="ag-trace-title">İz görünümü</span>
        <button
          type="button"
          className="ag-agent-btn-reset"
          onClick={onClose}
          title="Kapat"
          aria-label="İz görünümünü kapat"
        >
          <IconClose size={13} />
          <span>Kapat</span>
        </button>
      </div>

      <div className="ag-trace-body">
        {turns.length === 0 ? (
          <div className="ag-trace-empty">Bu oturumda henüz iz kaydı yok.</div>
        ) : (
          turns.map((turn) => {
            const isOpen = Boolean(expanded[turn.index]);
            const st = getStatusInfo(turn.status);
            const dur = formatDuration(turn.durationMs);

            return (
              <div key={turn.index} className="ag-trace-turn">
                <button
                  type="button"
                  className="ag-trace-turn-header"
                  onClick={() => toggleTurn(turn.index)}
                  aria-expanded={isOpen}
                >
                  <span className={`ag-trace-turn-chevron ${isOpen ? 'open' : ''}`}>
                    <IconDisclosure size={13} />
                  </span>
                  <span className="ag-trace-turn-user" title={turn.userText}>
                    {turn.userText || `Tur ${turn.index}`}
                  </span>
                  <span className={`ag-trace-badge ${st.cls}`}>{st.label}</span>
                  {dur && <span className="ag-trace-meta">{dur}</span>}
                  {turn.usage && (
                    <span className="ag-trace-meta">
                      {turn.usage.total_tokens} belirteç
                    </span>
                  )}
                </button>

                {isOpen && (
                  <div className="ag-trace-turn-content">
                    {turn.compacted && (
                      <div className="ag-trace-compact-note">
                        Bu turda bağlam özetlendi.
                      </div>
                    )}

                    {turn.steps.map((step) => {
                      const stepDur = formatDuration(step.durationMs);
                      return (
                        <div key={step.step} className="ag-trace-step">
                          <div className="ag-trace-step-header">
                            <span className="ag-trace-step-title">
                              Adım {step.step}
                            </span>
                            {stepDur && (
                              <span className="ag-trace-meta">{stepDur}</span>
                            )}
                          </div>

                          {step.text && (
                            <div className="ag-trace-step-text">{step.text}</div>
                          )}

                          {step.tools.length > 0 && (
                            <div className="ag-trace-tools">
                              {step.tools.map((tool) => {
                                const toolDur = formatDuration(tool.durationMs);
                                const statusClass =
                                  tool.ok === true
                                    ? 'ok'
                                    : tool.ok === false
                                      ? 'failed'
                                      : 'pending';
                                return (
                                  <div
                                    key={tool.callId || `${step.step}-${tool.name}`}
                                    className={`ag-trace-tool ${tool.ok === false ? 'failed' : ''}`}
                                  >
                                    <span className={`ag-trace-tool-status ${statusClass}`}>
                                      {tool.ok === true ? (
                                        <IconCheck size={12} />
                                      ) : tool.ok === false ? (
                                        <IconError size={12} />
                                      ) : (
                                        <IconDuration size={12} />
                                      )}
                                    </span>
                                    <span className="ag-trace-tool-label">
                                      {getToolLabel(tool.name)}
                                    </span>
                                    {tool.summary && (
                                      <span
                                        className="ag-trace-tool-summary"
                                        title={tool.summary}
                                      >
                                        {tool.summary}
                                      </span>
                                    )}
                                    {tool.approval && (
                                      <span
                                        className={`ag-trace-approval ${tool.approval}`}
                                      >
                                        {tool.approval === 'approved'
                                          ? 'Onaylandı'
                                          : 'Reddedildi'}
                                      </span>
                                    )}
                                    {toolDur && (
                                      <span className="ag-trace-meta">
                                        {toolDur}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
