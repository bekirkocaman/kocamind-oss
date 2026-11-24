import { useEffect, useRef, useState } from "react";
import { confirmWordMatches } from "../lib/confirmWord";
import './Dialogs.css'

// Android'deki onay pencereleri: ortalı başlık, kısa açıklama; tehlikeli işlemde kırmızı düğme,
// gerekirse onay kelimesi (ör. "SİL") yazılmadan düğme açılmaz.

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
}

export function ConfirmDialog({ title, message, action, danger = false, confirmWord, icon: Icon, onConfirm, onClose }) {
  const [typed, setTyped] = useState('')
  const ready = !confirmWord || confirmWordMatches(typed, confirmWord)
  useEscape(onClose)

  return (
    <div className="km-dialog-overlay" onClick={onClose}>
      <div className="km-dialog" role="alertdialog" aria-modal="true" aria-labelledby="km-dialog-title" onClick={e => e.stopPropagation()}>
        {Icon && <div className={`km-dialog-icon ${danger ? 'danger' : ''}`}><Icon size={20} /></div>}
        <h2 id="km-dialog-title">{title}</h2>
        {message && <p>{message}</p>}
        {confirmWord && (
          <>
            <label className="km-dialog-hint" htmlFor="km-confirm-word">Onaylamak için {confirmWord} yaz</label>
            <input
              id="km-confirm-word"
              className={`km-dialog-input ${ready ? 'ready' : ''}`}
              value={typed}
              autoFocus
              maxLength={20}
              onChange={e => setTyped(e.target.value)}
              aria-label="Onay kelimesi"
            />
          </>
        )}
        <div className="km-dialog-actions">
          <button type="button" className="km-dialog-btn" onClick={onClose}>Vazgeç</button>
          <button
            type="button"
            className={`km-dialog-btn primary ${danger ? 'danger' : ''}`}
            disabled={!ready}
            autoFocus={!confirmWord}
            onClick={() => { onClose(); onConfirm() }}
          >{action}</button>
        </div>
      </div>
    </div>
  )
}

export function PromptDialog({ title, initial = '', placeholder, action = 'Kaydet', onSubmit, onClose }) {
  const [text, setText] = useState(initial)
  const inputRef = useRef(null)
  useEscape(onClose)
  useEffect(() => { inputRef.current?.select() }, [])

  const submit = (e) => {
    e.preventDefault()
    if (!text.trim()) return
    onClose()
    onSubmit(text.trim())
  }

  return (
    <div className="km-dialog-overlay" onClick={onClose}>
      <form className="km-dialog" role="dialog" aria-modal="true" aria-labelledby="km-dialog-title" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <h2 id="km-dialog-title">{title}</h2>
        <input ref={inputRef} className="km-dialog-input" value={text} placeholder={placeholder} onChange={e => setText(e.target.value)} aria-label={title} />
        <div className="km-dialog-actions">
          <button type="button" className="km-dialog-btn" onClick={onClose}>Vazgeç</button>
          <button type="submit" className="km-dialog-btn primary" disabled={!text.trim()}>{action}</button>
        </div>
      </form>
    </div>
  )
}
