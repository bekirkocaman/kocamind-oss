import { useState } from "react";
import { IconAgent, IconCheck, IconExpand } from "../icons.jsx";
import { activityLabel } from "../../lib/chatText";

export function TypingIndicator({ status }) {
  const label = activityLabel(status)
  return (
    <div className="typing-indicator" role="status" aria-live="polite" aria-label={label}>
      <span className="typing-activity">{label}</span>
    </div>
  )
}

export function AgentSteps({ steps, running, status }) {
  const [open, setOpen] = useState(false)
  const panelOpen = running || open
  // Uzun base64 görselleri adım özetinde boğucu olmasın
  const slim = (text) => (text || '').replace(/!\[[^\]]*\]\(data:[^)]+\)/g, '_[Oluşturulan görsel]_')
  const toolLabels = {
    web_search: 'Web’de araştırıyor',
    read_emails: 'Gmail gelen kutusunu okuyor',
    search_wikipedia: 'Wikipedia’da araştırıyor',
    scrape_website: 'Web sayfasını inceliyor',
    calculate: 'Hesaplama yapıyor',
    run_code: 'Kodu çalıştırıyor',
    get_weather: 'Hava durumunu kontrol ediyor',
  }
  return (
    <div className={`agent-steps ${running ? 'running' : ''}`}>
      <button className="agent-steps-header" onClick={() => { if (!running) setOpen(o => !o) }}>
        <IconAgent size={14} />
        <span>{running ? 'Agent çalışıyor' : `Agent · ${steps.length} işlem tamamlandı`}</span>
        {running && <span className="agent-live-dots" aria-hidden="true"><i /><i /><i /></span>}
        <IconExpand size={14} className="agent-steps-chevron" style={{ transform: panelOpen ? 'rotate(180deg)' : 'none' }} />
      </button>
      {panelOpen && (
        <div className="agent-steps-list">
          {steps.map((s, i) => (
            <div key={i} className="agent-step">
              <div className="agent-step-title"><IconCheck size={13} /> {toolLabels[s.name] || s.name}</div>
              {Object.keys(s.arguments || {}).length > 0 && <div className="agent-step-args">{Object.values(s.arguments).join(' · ')}</div>}
              {!running && <div className="agent-step-result">{slim(s.result).slice(0, 240)}{slim(s.result).length > 240 ? '…' : ''}</div>}
            </div>
          ))}
          {running && <div className="agent-step-status">{status || 'Görevi hazırlıyor…'}</div>}
        </div>
      )}
    </div>
  )
}

export function AgentApprovalCard({ approval, onDecision }) {
  if (!approval) return null
  return (
    <div className="agent-approval" role="alert">
      <div className="agent-approval-title">Onayın gerekiyor</div>
      <div className="agent-approval-copy">KocaMind dışarıda işlem yapmadan önce senden izin istiyor.</div>
      <div className="agent-approval-actions-list">
        {(approval.actions || []).map((action, index) => (
          <div className="agent-approval-action" key={`${action.name}-${index}`}>
            <strong>{action.name}</strong>
            <span>{action.summary}</span>
          </div>
        ))}
      </div>
      <div className="agent-approval-buttons">
        <button type="button" className="agent-approval-cancel" onClick={() => onDecision(false)}>İptal et</button>
        <button type="button" className="agent-approval-confirm" onClick={() => onDecision(true)}>Onayla ve uygula</button>
      </div>
    </div>
  )
}
