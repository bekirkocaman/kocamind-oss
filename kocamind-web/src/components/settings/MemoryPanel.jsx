import { useEffect, useState } from "react";
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconDelete,
  IconLoading,
  IconPaste,
  IconRefresh,
  IconRetry,
  IconSuccess,
} from "../icons.jsx";
import { memoryInsight } from "../../lib/api";
import { groupMemories, importSummary, insightBasis, MEMORY_IMPORT_MAX, MEMORY_IMPORT_PROMPT, MEMORY_LIMIT } from "../../lib/memoryView";
import { ConfirmDialog } from "../Dialogs";
import { SettingsGroup, SkeletonRows, SwitchRow, LinkRow } from "./Fields";

// Ayarlar > Hafıza: anahtarlar, KocaMind'in yorumu, kategorilere göre hatırlananlar,
// başka uygulamadan taşıma ve tümünü silme.
export default function MemoryPanel({ currentUser, onRefreshMemories, memoriesLoading, memoriesFailed, memories, onDeleteMemory, onClearMemories, onImportMemories, memoryEnabled, setMemoryEnabled, autoMemory, setAutoMemory, showToast }) {
  const [deleting, setDeleting] = useState(null)
  const [askDeleteAll, setAskDeleteAll] = useState(false)
  const [importing, setImporting] = useState(false)

  if (!currentUser) {
    return (
      <div className="settings-section">
        <h3>Hafıza</h3>
        <p className="settings-hint">Hafıza özelliği için giriş yapmalısın.</p>
      </div>
    )
  }

  const remove = async (key) => {
    setDeleting(key)
    try { await onDeleteMemory(key) } finally { setDeleting(null) }
  }

  const groups = groupMemories(memories)
  const loading = memoriesLoading && memories.length === 0
  const RefreshIcon = memoriesLoading ? IconLoading : IconRefresh

  return (
    <div className="settings-section">
      <h3>Hafıza</h3>
      <div className="settings-intro-row">
        <p className="settings-hint">KocaMind sohbetlerinden önemli bilgileri hatırlar ve cevaplarını sana göre şekillendirir. Hatırladıklarını buradan görebilir, silebilirsin.</p>
        <button type="button" className="mini-btn" onClick={onRefreshMemories} title="Yenile">
          <RefreshIcon size={13} className={memoriesLoading ? 'spin' : ''} /> Yenile
        </button>
      </div>

      <InsightCard memoryKey={memories.map(m => `${m.key}=${m.value}`).join('|')} ready={!loading} />

      <SettingsGroup>
        <SwitchRow label="Hafızayı kullan" desc="Cevaplarda hatırladıklarını dikkate alır" checked={memoryEnabled} onChange={() => setMemoryEnabled(v => !v)} />
        <SwitchRow
          label="Otomatik hatırla"
          desc={memoryEnabled ? 'Yeni bilgileri mesajlarından kendiliğinden kaydeder' : 'Hafıza kapalıyken çalışmaz'}
          checked={memoryEnabled && autoMemory}
          disabled={!memoryEnabled}
          onChange={() => setAutoMemory(v => !v)}
        />
        <LinkRow label="Başka uygulamadan taşı" desc="ChatGPT, Gemini ya da Claude'daki hafızanı getir" onClick={() => setImporting(true)} />
      </SettingsGroup>

      {loading ? (
        <SkeletonRows count={3} />
      ) : memoriesFailed && memories.length === 0 ? (
        <SettingsGroup>
          <div className="connector-row">
            <div className="connector-info"><span className="connector-name">Hafıza yüklenemedi</span><span className="connector-desc">İnternet bağlantını kontrol et.</span></div>
            <button type="button" className="connector-btn" onClick={onRefreshMemories}><IconRetry size={14} /> Tekrar dene</button>
          </div>
        </SettingsGroup>
      ) : memories.length === 0 ? (
        <div className="km-empty">
          <strong>Henüz bir şey hatırlamıyorum</strong>
          <span>Adın, işin ya da tercihlerin gibi bilgileri sohbette söylediğinde burada görünür.</span>
        </div>
      ) : (
        <>
          {groups.map(group => (
            <div key={group.id}>
              <h4>{group.label}</h4>
              <SettingsGroup>
                {group.items.map(m => (
                  <div key={m.key} className="memory-row">
                    <div className="memory-info">
                      <span className="memory-key">{m.key}</span>
                      <span className="memory-value">{m.value}</span>
                    </div>
                    <button type="button" className="row-delete-btn" onClick={() => remove(m.key)} disabled={deleting === m.key} aria-label={`${m.key} bilgisini sil`}>
                      <IconDelete size={16} />
                    </button>
                  </div>
                ))}
              </SettingsGroup>
            </div>
          ))}
          <p className="settings-hint settings-tabular">{memories.length} / {MEMORY_LIMIT} bilgi</p>
          <SettingsGroup>
            <LinkRow label="Tüm hafızayı sil" desc="Hatırlanan her şey unutulur" danger onClick={() => setAskDeleteAll(true)} />
          </SettingsGroup>
        </>
      )}

      {askDeleteAll && (
        <ConfirmDialog
          title="Tüm hafıza silinsin mi?"
          message="KocaMind seninle ilgili hatırladığı her şeyi unutur. Bu işlem geri alınamaz."
          action="Tümünü sil"
          danger
          icon={IconDelete}
          onConfirm={onClearMemories}
          onClose={() => setAskDeleteAll(false)}
        />
      )}
      {importing && <MemoryImportDialog onImport={onImportMemories} showToast={showToast} onClose={() => setImporting(false)} />}
    </div>
  )
}

// "KocaMind'in yorumu": sohbetlere ve hafızaya dayanan kısa, objektif değerlendirme.
function InsightCard({ memoryKey, ready }) {
  const [state, setState] = useState({ kind: 'loading' })
  const [attempt, setAttempt] = useState({ n: 0, refresh: false })

  useEffect(() => {
    if (!ready) return undefined
    let cancelled = false
    memoryInsight(attempt.refresh)
      .then(data => {
        if (cancelled) return
        setState(data.insight
          ? { kind: 'ready', text: data.insight, basedOn: data.basedOn || 0, chats: data.chats || 0 }
          : { kind: 'few' })
      })
      .catch(() => { if (!cancelled) setState({ kind: 'failed' }) })
    return () => { cancelled = true }
  }, [memoryKey, ready, attempt])

  const refreshing = state.kind === 'loading' || state.refreshing
  const RefreshIcon = state.refreshing ? IconLoading : IconRefresh
  const refresh = () => {
    setState(prev => prev.kind === 'ready' ? { ...prev, refreshing: true } : { kind: 'loading' })
    setAttempt(prev => ({ n: prev.n + 1, refresh: true }))
  }

  return (
    <div className="insight-card">
      <div className="insight-head">
        <span>KocaMind'in yorumu</span>
        {state.kind !== 'few' && (
          <button type="button" className="insight-refresh" onClick={refresh} disabled={refreshing} aria-label="Yorumu yenile">
            <RefreshIcon size={15} className={state.refreshing ? 'spin' : ''} />
          </button>
        )}
      </div>
      {state.kind === 'loading' && (
        <div className="insight-skeleton" aria-busy="true">
          <span className="km-skeleton" style={{ width: '100%' }} />
          <span className="km-skeleton" style={{ width: '85%' }} />
          <span className="km-skeleton" style={{ width: '60%' }} />
        </div>
      )}
      {state.kind === 'ready' && (
        <>
          <p className="insight-text">{state.text}</p>
          <p className="insight-basis">{insightBasis(state.chats, state.basedOn)}</p>
        </>
      )}
      {state.kind === 'few' && <p className="insight-muted">Seni yorumlamak için biraz daha tanımam lazım. Benimle sohbet ettikçe ya da hafızanı başka bir uygulamadan taşıdıkça, neyle uğraştığına ve nasıl çalıştığına dair objektif bir yorum burada görünecek.</p>}
      {state.kind === 'failed' && <p className="insight-muted">Yorum şu anda oluşturulamadı.</p>}
    </div>
  )
}

// Başka uygulamadan taşı: istemi kopyala, diğer uygulamaya yapıştır, gelen cevabı içe aktar.
function MemoryImportDialog({ onImport, showToast, onClose }) {
  const [pasted, setPasted] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(MEMORY_IMPORT_PROMPT)
      setCopied(true)
    } catch { showToast?.('Kopyalanamadı; metni seçip elle kopyala.', 'error') }
  }

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) { setPasted(text.slice(0, MEMORY_IMPORT_MAX)); setResult(null) }
    } catch { showToast?.('Panoya erişilemedi; metni kutuya yapıştır.', 'info') }
  }

  const submit = async () => {
    setBusy(true)
    try {
      setResult(await onImport(pasted.trim()))
    } catch (error) {
      showToast?.(error.message || 'Hafıza aktarılamadı, tekrar dene.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="km-dialog-overlay" onClick={onClose}>
      <div className="km-sheet" role="dialog" aria-modal="true" aria-labelledby="memory-import-title" onClick={e => e.stopPropagation()}>
        <div className="km-sheet-head">
          <button type="button" className="km-sheet-close" onClick={onClose} aria-label="Kapat"><IconClose size={20} /></button>
          <h2 id="memory-import-title">Hafızanı KocaMind'e taşı</h2>
        </div>
        <div className="km-sheet-body">
          <p className="settings-hint">ChatGPT, Gemini ya da Claude'un seninle ilgili hatırladıklarını üç adımda buraya getir. Taşınan bilgiler cevaplarda kullanılır ama KocaMind'in senin hakkındaki yorumunu etkilemez.</p>
          <Step n={1}>Bu istemi kopyala</Step>
          <pre className="import-prompt">{MEMORY_IMPORT_PROMPT}</pre>
          <button type="button" className="create-btn full" onClick={copy}>
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />} {copied ? 'Kopyalandı' : 'İstemi kopyala'}
          </button>
          <Step n={2}>Diğer uygulamada yeni bir sohbete yapıştır ve gönder</Step>
          <Step n={3}>Gelen cevabın tamamını buraya yapıştır</Step>
          <textarea
            className="settings-textarea"
            rows={6}
            placeholder="- [Kişisel] isim: …"
            value={pasted}
            aria-label="Gelen cevap"
            onChange={e => { setPasted(e.target.value.slice(0, MEMORY_IMPORT_MAX)); setResult(null) }}
          />
          <button type="button" className="mini-btn" style={{ marginTop: 8 }} onClick={paste}><IconPaste size={13} /> Panodan yapıştır</button>
          {result && <div className="import-result"><IconSuccess size={18} /> {importSummary(result)}</div>}
          <button type="button" className="create-btn full primary" style={{ marginTop: 14 }} disabled={!pasted.trim() || busy || Boolean(result)} onClick={submit}>
            {busy ? <IconLoading size={16} className="spin" /> : null} İçe aktar
          </button>
        </div>
      </div>
    </div>
  )
}

function Step({ n, children }) {
  return (
    <div className="import-step">
      <span className="import-step-n">{n}</span>
      <span>{children}</span>
    </div>
  )
}
