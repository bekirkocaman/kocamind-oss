import './EmptyState.css'
import { IconCamera, IconDocument, IconMail, IconReceipt } from './icons.jsx'
import { LogoMark } from './chat/LogoMark'
import { SUGGESTIONS } from '../lib/suggestions'

const ICONS = { dilekce: IconDocument, 'resmi-eposta': IconMail, fatura: IconReceipt, soru: IconCamera }

// Karşılama ekranı: sade logo, sans-serif selam ve öneri hapları.
export default function EmptyState({ userName, onPick }) {
  const firstName = userName?.trim().split(/\s+/)[0]

  return (
    <section className="empty-state" aria-labelledby="welcome-title">
      <div className="empty-inner">
        <LogoMark size={32} />
        <h1 className="empty-title" id="welcome-title">
          {firstName ? `Merhaba, ${firstName}` : 'Merhaba'}
        </h1>
        {onPick && (
          <div className="empty-suggestions">
            {SUGGESTIONS.map(s => {
              const Icon = ICONS[s.id]
              return (
                <button key={s.id} type="button" className="empty-suggestion" onClick={() => onPick(s)}>
                  <Icon size={16} aria-hidden="true" />
                  <span>{s.label}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
