import { useEffect, useRef, useState } from "react";
import { IconExpand } from "../icons.jsx";
import { thoughtForLabel } from "../../lib/thinking";

// Android ThinkingPanel: yanıt gelmeden önce açık; "Düşünüyor" ışıltısı, canlı sayaç ve modelin
// düşünce özeti akar. İlk yanıt metni gelince "N saniye düşündü" olarak kapanır; düşünce metni
// varsa tıklayınca yeniden açılır.
export default function ThinkingPanel({ active, label, thinking, thinkingMs, startedAt }) {
  const [open, setOpen] = useState(false)
  const [mountedAt] = useState(() => Date.now())
  const [now, setNow] = useState(mountedAt)
  const textRef = useRef(null)
  const hasText = Boolean(thinking?.trim())

  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [active])

  useEffect(() => {
    if (active && textRef.current) textRef.current.scrollTop = textRef.current.scrollHeight
  }, [active, thinking])

  const elapsed = Math.max(0, now - (startedAt || mountedAt))
  const shown = active || open

  return (
    <div className={`thinking-panel ${active ? 'active' : ''}`}>
      {active ? (
        <div className="thinking-head" role="status" aria-live="polite" aria-label={`${label || 'Düşünüyor'}, ${Math.floor(elapsed / 1000)} saniye`}>
          <span className="thinking-shimmer">{label || 'Düşünüyor'}</span>
          <span className="thinking-timer">{Math.floor(elapsed / 1000)} sn</span>
        </div>
      ) : (
        <button
          type="button"
          className="thinking-head done"
          onClick={() => hasText && setOpen(v => !v)}
          disabled={!hasText}
          aria-expanded={hasText ? open : undefined}
        >
          <span>{thoughtForLabel(thinkingMs ?? elapsed)}</span>
          {hasText && <IconExpand size={15} className={`thinking-chevron ${open ? 'open' : ''}`} />}
        </button>
      )}
      {hasText && (
        <div className={`thinking-body ${shown ? 'open' : ''}`}>
          <div ref={textRef} className={`thinking-text ${active ? 'live' : ''}`}>{thinking}</div>
        </div>
      )}
    </div>
  )
}
