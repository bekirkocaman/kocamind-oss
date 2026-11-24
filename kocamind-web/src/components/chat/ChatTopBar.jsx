import { useEffect, useRef, useState } from "react";
import {
  IconDelete,
  IconDownload,
  IconEdit,
  IconMoreVertical,
  IconNewChat,
  IconPin,
  IconShare,
  IconSidebar,
  IconUnpin,
} from "../icons.jsx";

// Klon tasarımının üst çubuğu: solda menü; sohbet varken sağda yeni sohbet ve seçenekler menüsü.
export default function ChatTopBar({ hasMessages, title, pinned, onMenu, onNewChat, onShare, onExport, onRename, onTogglePin, onDelete }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onClick = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey) }
  }, [open])

  const items = [
    { label: 'Paylaş', icon: IconShare, run: onShare },
    { label: 'Markdown olarak indir', icon: IconDownload, run: onExport },
    onRename && { label: 'Yeniden adlandır', icon: IconEdit, run: onRename },
    onTogglePin && { label: pinned ? 'Sabitlemeyi kaldır' : 'Sabitle', icon: pinned ? IconUnpin : IconPin, run: onTogglePin },
    onDelete && { label: 'Sil', icon: IconDelete, run: onDelete, danger: true },
  ].filter(Boolean)

  return (
    <header className="chat-header clone-topbar">
      <button type="button" className="header-btn menu-btn" onClick={onMenu} aria-label="Menüyü aç">
        <IconSidebar size={22} />
      </button>
      <span className="topbar-spacer" />
      {hasMessages && (
        <div className="header-actions">
          <button type="button" className="header-btn" onClick={onNewChat} aria-label="Yeni sohbet" title="Yeni sohbet">
            <IconNewChat size={20} />
          </button>
          <div className="topbar-menu-root" ref={rootRef}>
            <button type="button" className="header-btn" onClick={() => setOpen(v => !v)} aria-label="Diğer seçenekler" aria-expanded={open}>
              <IconMoreVertical size={20} />
            </button>
            {open && (
              <div className="topbar-menu" role="menu">
                {title && <div className="topbar-menu-title">{title}</div>}
                {items.map(item => (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    className={`topbar-menu-item ${item.danger ? 'danger' : ''}`}
                    onClick={() => { setOpen(false); item.run() }}
                  >
                    <item.icon size={18} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
