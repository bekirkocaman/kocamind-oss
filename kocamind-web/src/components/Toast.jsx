import { IconClose, IconError, IconInfo, IconSuccess, IconWarning } from './icons.jsx'
import './Toast.css'

const ICONS = {
  success: IconSuccess,
  error: IconError,
  warning: IconWarning,
  info: IconInfo,
}

export default function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map(t => {
        const Icon = ICONS[t.type] || ICONS.info
        return (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <Icon size={17} className="toast-icon" />
            <span className="toast-message">{t.message}</span>
            {t.action && (
              <button type="button" className="toast-action" onClick={() => { t.action.onClick(); onDismiss(t.id) }}>
                {t.action.label}
              </button>
            )}
            <button className="toast-close" onClick={() => onDismiss(t.id)} title="Kapat">
              <IconClose size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
