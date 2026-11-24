import { useState } from "react";
import { IconSendReport, IconSuccess } from "../icons.jsx";
import { sendBugReport } from "../../lib/api";
import { BUG_TEXT_MAX, validateBugText } from "../../lib/feedbackPayload";

export default function BugReportPanel() {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)

  const validation = validateBugText(text)
  const trimmedLen = text.trim().length

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    const check = validateBugText(text)
    if (!check.ok) {
      setError(check.error)
      return
    }
    setSubmitting(true)
    setError(null)
    setSent(false)
    try {
      await sendBugReport({
        text: text.trim(),
        context: { platform: 'web' },
      })
      setText('')
      setSent(true)
    } catch (err) {
      if (err?.code === 'daily_limit') {
        setError('Bugünlük bildirim sınırına ulaştın.')
      } else if (err?.status === 429) {
        setError('Çok sık denedin, biraz sonra tekrar dene.')
      } else {
        setError(err?.message || 'Hata bildirimi gönderilemedi. Lütfen tekrar dene.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="settings-section" onSubmit={handleSubmit}>
      <h3>Hata bildir</h3>
      <p className="settings-hint">
        Karşılaştığın sorunu kısaca anlat; ne yapıyordun ve ne oldu?
      </p>

      <textarea
        className="settings-textarea"
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
        rows={6}
        maxLength={BUG_TEXT_MAX}
        placeholder="Örneğin: Sohbet geçmişini açarken ekran dondu…"
        aria-label="Hata açıklaması"
        value={text}
        disabled={submitting}
        onChange={e => {
          setText(e.target.value.slice(0, BUG_TEXT_MAX))
          if (error) setError(null)
          if (sent) setSent(false)
        }}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginTop: 6,
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <span>{trimmedLen > 0 && !validation.ok ? validation.error : 'En az 10 karakter'}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {text.length} / {BUG_TEXT_MAX}
        </span>
      </div>

      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}

      {sent && (
        <div className="import-result" role="status">
          <IconSuccess size={18} />
          <span>Teşekkürler, bildirimin alındı.</span>
        </div>
      )}

      <button
        type="submit"
        className="create-btn primary"
        style={{ marginTop: 14 }}
        disabled={submitting || !validation.ok}
      >
        <IconSendReport size={15} />
        {submitting ? 'Gönderiliyor…' : 'Gönder'}
      </button>
    </form>
  )
}
