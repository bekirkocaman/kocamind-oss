import { useState, useEffect, useRef } from 'react'
import { IconCheck, IconExpand, IconLock } from './icons.jsx'
import { API, authFetch } from '../lib/api'
import './ModelSelector.css'

// ─── Sağlayıcı görsel kimlikleri ───
const PROVIDER_META = {
  claude: { name: 'Claude', color: '#d97757' },
  groq: { name: 'Groq', color: '#f55036' },
  openai: { name: 'OpenAI', color: '#10a37f' },
  gemini: { name: 'Google', color: '#4285f4' },
  anthropic: { name: 'Anthropic', color: '#d97757' },
  xai: { name: 'xAI', color: '#9b9ba4' },
  deepseek: { name: 'DeepSeek', color: '#2c6bd1' },
  evren: { name: 'EVREN', color: '#e30a17' },
}

const PROVIDER_ORDER = ['claude', 'groq', 'openai', 'gemini', 'anthropic', 'xai', 'deepseek', 'evren']

const BADGES = {
  guclu: { label: 'En Güçlü', className: 'badge-guclu' },
  hizli: { label: 'Hızlı', className: 'badge-hizli' },
  ucuz: { label: 'Ucuz', className: 'badge-ucuz' },
  yeni: { label: 'Yeni', className: 'badge-yeni' },
}

// /models erişilemezse UI kırılmasın diye yedek liste
const FALLBACK_MODELS = [
  { id: 'gpt-5.6-luna', provider: 'openai', label: 'GPT-5.6 Luna', badge: 'ucuz', available: true },
  { id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek V3', badge: 'guclu', available: true },
  { id: 'deepseek-reasoner', provider: 'deepseek', label: 'DeepSeek R1', badge: 'guclu', available: true },
]

export default function ModelSelector({ value, onChange, placement = 'down' }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState(FALLBACK_MODELS)
  const [loading, setLoading] = useState(true)
  const rootRef = useRef(null)

  useEffect(() => {
    authFetch(API.models)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (Array.isArray(data?.models) && data.models.length > 0) {
          setModels(data.models.filter(m => m.provider !== 'claude'))
        }
      })
      .catch(() => { /* yedek liste kalır */ })
      .finally(() => setLoading(false))
  }, [])

  // Kaldırılmış veya kullanılamayan eski bir model seçiliyse çalışan modele geç.
  useEffect(() => {
    if (loading) return
    const currentIsAvailable = models.some(model =>
      model.id === value?.id && model.provider === value?.provider && model.available
    )
    if (currentIsAvailable) return
    const replacement = models.find(m => m.available)
    if (replacement) onChange({ id: replacement.id, provider: replacement.provider, label: replacement.label })
  }, [loading, models, onChange, value?.id, value?.provider])

  // Dışarı tıklayınca kapat
  useEffect(() => {
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const available = models.filter(m => m.available)
  const locked = models.filter(m => !m.available)

  const grouped = (list) =>
    PROVIDER_ORDER
      .map(p => ({ provider: p, items: list.filter(m => m.provider === p) }))
      .filter(g => g.items.length > 0)

  const meta = PROVIDER_META[value?.provider] || PROVIDER_META.claude

  const renderRow = (m) => {
    const pm = PROVIDER_META[m.provider] || {}
    const badge = BADGES[m.badge]
    const isActive = value?.id === m.id && value?.provider === m.provider
    return (
      <button
        key={`${m.provider}:${m.id}`}
        className={`ms-row ${isActive ? 'active' : ''} ${!m.available ? 'locked' : ''}`}
        disabled={!m.available}
        onClick={() => {
          onChange({ id: m.id, provider: m.provider, label: m.label })
          setOpen(false)
        }}
      >
        <span className="ms-dot" style={{ background: pm.color }} />
        <span className="ms-row-label">{m.label}</span>
        {badge && <span className={`ms-badge ${badge.className}`}>{badge.label}</span>}
        {!m.available && (
          <span className="ms-soon"><IconLock size={11} /> Yakında</span>
        )}
        {isActive && m.available && <IconCheck size={16} className="ms-check" />}
      </button>
    )
  }

  return (
    <div className={`ms-root ${placement === 'up' ? 'ms-up' : ''}`} ref={rootRef}>
      <button
        className={`ms-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Model değiştir"
        aria-label="Model seç"
        aria-expanded={open}
      >
        <span className="ms-dot" style={{ background: meta.color }} />
        <span className="ms-trigger-label">{value?.label || 'Model Seç'}</span>
        <IconExpand size={15} className="ms-chevron" />
      </button>

      {open && (
        <div className="ms-panel">
          {loading ? (
            <div className="ms-loading">
              <div className="ms-skeleton ms-skeleton-title" />
              <div className="ms-skeleton ms-skeleton-row" />
              <div className="ms-skeleton ms-skeleton-row" />
              <div className="ms-skeleton ms-skeleton-row" />
            </div>
          ) : (
            <>
              {grouped(available).map(g => (
                <div key={g.provider} className="ms-group">
                  <div className="ms-group-title">{PROVIDER_META[g.provider]?.name}</div>
                  {g.items.map(renderRow)}
                </div>
              ))}

              {locked.length > 0 && (
                <div className="ms-group ms-locked-group">
                  <div className="ms-group-title">Yakında KocaMind'de</div>
                  {grouped(locked).map(g => g.items.map(renderRow))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
