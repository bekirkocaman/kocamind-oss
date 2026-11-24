import { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck } from "./icons.jsx";
import { REASONS, FEEDBACK_NOTE_MAX } from "../lib/feedbackPayload";
import "./Dialogs.css";

export default function FeedbackReasonSheet({ onSubmit, onSkip }) {
  const [reason, setReason] = useState(null)
  const [note, setNote] = useState('')
  const firstChipRef = useRef(null)
  const doneRef = useRef(false)

  const handleSkip = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onSkip()
  }, [onSkip])

  useEffect(() => {
    firstChipRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') handleSkip()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleSkip])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (doneRef.current) return
    doneRef.current = true
    onSubmit({ reason, note })
  }

  return (
    <div className="km-dialog-overlay" onClick={handleSkip}>
      <form
        className="km-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-reason-title"
        style={{ width: 'min(100%, 420px)', textAlign: 'left', boxSizing: 'border-box' }}
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 id="feedback-reason-title">Neyi beğenmedin?</h2>
        <p style={{ marginTop: 6 }}>İstersen kısaca seç veya not bırak; geliştirirken yardımcı olur.</p>

        <div className="chip-select" style={{ marginTop: 14 }} role="group" aria-label="Geri bildirim sebebi">
          {REASONS.map((item, idx) => {
            const active = reason === item.id
            return (
              <button
                key={item.id}
                ref={idx === 0 ? firstChipRef : undefined}
                type="button"
                className={`chip ${active ? 'active' : ''}`}
                aria-pressed={active}
                onClick={() => setReason(prev => (prev === item.id ? null : item.id))}
              >
                {active && <IconCheck size={12} />}
                {item.label}
              </button>
            )
          })}
        </div>

        <textarea
          className="settings-textarea"
          style={{ width: '100%', marginTop: 14, boxSizing: 'border-box', resize: 'vertical' }}
          rows={3}
          maxLength={FEEDBACK_NOTE_MAX}
          placeholder="İsteğe bağlı not ekle…"
          aria-label="Ek not"
          value={note}
          onChange={e => setNote(e.target.value.slice(0, FEEDBACK_NOTE_MAX))}
        />
        <div
          style={{
            marginTop: 6,
            textAlign: 'right',
            fontSize: 12,
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {note.length} / {FEEDBACK_NOTE_MAX}
        </div>

        <div className="km-dialog-actions" style={{ marginTop: 14 }}>
          <button type="button" className="km-dialog-btn" onClick={handleSkip}>Geç</button>
          <button type="submit" className="km-dialog-btn primary">Gönder</button>
        </div>
      </form>
    </div>
  )
}
