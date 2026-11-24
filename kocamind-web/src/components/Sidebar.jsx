import { useEffect, useRef, useState } from 'react'
import {
  IconAdd,
  IconAdmin,
  IconArchive,
  IconBack,
  IconClear,
  IconConnectors,
  IconConversation,
  IconDelete,
  IconEdit,
  IconExpand,
  IconMemory,
  IconPin,
  IconProfile,
  IconSearch,
  IconSkills,
  IconUnarchive,
  IconUnpin,
} from './icons.jsx'

// Klon tasarımındaki menü: üstte başlık ve arama, altında bölümler, "Son kullanılanlar",
// en altta profil yuvarlağı (Ayarlar) ve "Yeni sohbet" hapı.
export default function Sidebar({
  open, onToggle,
  onNewChat,
  searchQuery, onSearchChange,
  visibleChats, archivedChats,
  showArchived, onToggleArchived,
  activeChatId,
  renamingChatId, renameText, onRenameTextChange, onCommitRename, onCancelRename,
  onLoadChat, onDeleteChat, onPinChat, onStartRename, onArchiveChat,
  currentUser, isPro,
  onOpenSettings, onOpenSettingsTab,
  isAdmin, onOpenProfiler,
}) {
  const [searching, setSearching] = useState(false)
  const searchRef = useRef(null)

  useEffect(() => { if (searching) searchRef.current?.focus() }, [searching])

  const closeSearch = () => { setSearching(false); onSearchChange('') }

  const sections = [
    { label: 'Hafıza', icon: IconMemory, run: () => onOpenSettingsTab('memory') },
    { label: 'Bağlantılar', icon: IconConnectors, run: () => onOpenSettingsTab('connectors') },
    { label: "Skill'ler", icon: IconSkills, run: () => onOpenSettingsTab('skills') },
    isAdmin && { label: 'Admin paneli', icon: IconAdmin, run: onOpenProfiler },
  ].filter(Boolean)

  const renderChatItem = (chat) => (
    <div key={chat.id} className={`history-item ${chat.id === activeChatId ? 'active' : ''}`}
      onClick={() => renamingChatId !== chat.id && onLoadChat(chat)}>
      {chat.pinned ? <IconPin size={15} className="history-icon" /> : <IconConversation size={15} className="history-icon" />}
      {renamingChatId === chat.id ? (
        <input
          className="rename-input"
          value={renameText}
          autoFocus
          onChange={(e) => onRenameTextChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename(chat.id)
            if (e.key === 'Escape') onCancelRename()
          }}
          onBlur={() => onCommitRename(chat.id)}
        />
      ) : (
        <span className="history-title">{chat.title}</span>
      )}
      <div className="history-actions">
        <button className="history-action-btn" onClick={(e) => onPinChat(e, chat.id)} title={chat.pinned ? 'Sabitlemeyi Kaldır' : 'Sabitle'}>
          {chat.pinned ? <IconUnpin size={13} /> : <IconPin size={13} />}
        </button>
        <button className="history-action-btn" onClick={(e) => onStartRename(e, chat)} title="Yeniden Adlandır">
          <IconEdit size={13} />
        </button>
        <button className="history-action-btn" onClick={(e) => onArchiveChat(e, chat.id)} title={chat.archived ? 'Arşivden Çıkar' : 'Arşivle'}>
          {chat.archived ? <IconUnarchive size={13} /> : <IconArchive size={13} />}
        </button>
        <button className="history-action-btn delete" onClick={(e) => onDeleteChat(e, chat.id)} title="Sohbeti Sil">
          <IconDelete size={13} />
        </button>
      </div>
    </div>
  )

  const name = currentUser?.displayName || currentUser?.email || ''
  const initial = name.trim()[0]?.toLocaleUpperCase('tr')

  return (
    <>
      <aside className={`sidebar clone-drawer ${open ? 'open' : ''}`}>
        <div className="drawer-head">
          {searching ? (
            <>
              <button type="button" className="drawer-icon-btn" onClick={closeSearch} aria-label="Aramayı kapat"><IconBack size={18} /></button>
              <input
                ref={searchRef}
                type="text"
                className="drawer-search-input"
                placeholder="Sohbetlerde ara"
                aria-label="Sohbetlerde ara"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') closeSearch() }}
              />
              {searchQuery && <button type="button" className="drawer-icon-btn" onClick={() => onSearchChange('')} aria-label="Aramayı temizle"><IconClear size={16} /></button>}
            </>
          ) : (
            <>
              <span className="drawer-title">KocaMind</span>
              <button type="button" className="drawer-icon-btn" onClick={() => setSearching(true)} aria-label="Ara"><IconSearch size={18} /></button>
            </>
          )}
        </div>

        <div className="drawer-scroll">
          {!searching && (
            <nav className="drawer-sections" aria-label="Bölümler">
              {sections.map(section => (
                <button key={section.label} type="button" className="drawer-section" onClick={section.run}>
                  <section.icon size={18} />
                  <span>{section.label}</span>
                </button>
              ))}
              <div className="drawer-divider" />
              <div className="drawer-recent-title">Son kullanılanlar</div>
            </nav>
          )}

          <div className="history-list">
            {visibleChats.map(renderChatItem)}
            {visibleChats.length === 0 && archivedChats.length === 0 && (
              <div className="history-empty">
                {searchQuery ? (
                  <>
                    <span>“{searchQuery.trim()}” için sohbet bulunamadı</span>
                    <small>Başka bir kelimeyle dene.</small>
                  </>
                ) : 'Henüz sohbet yok'}
              </div>
            )}

            {archivedChats.length > 0 && (
              <>
                <button className="archived-toggle" onClick={onToggleArchived}>
                  <IconExpand size={14} style={{ transform: showArchived ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  Arşivlenmiş ({archivedChats.length})
                </button>
                {showArchived && archivedChats.map(renderChatItem)}
              </>
            )}
          </div>
        </div>

        <div className="drawer-bottom">
          <button type="button" className="drawer-avatar" onClick={onOpenSettings} aria-label="Ayarlar" title={currentUser?.email || 'Ayarlar'}>
            {currentUser?.photoURL ? (
              <img src={currentUser.photoURL} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="drawer-avatar-fallback">{initial || <IconProfile size={18} />}</span>
            )}
            {isPro && <span className="drawer-avatar-pro">PRO</span>}
          </button>
          <button type="button" className="drawer-new-chat" onClick={onNewChat}>
            <IconAdd size={18} /> Yeni sohbet
          </button>
        </div>
      </aside>

      {open && <div className="sidebar-overlay" onClick={onToggle} />}
    </>
  )
}
