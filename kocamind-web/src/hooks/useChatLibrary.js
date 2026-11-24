import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounce } from '../lib/hooks'
import { saveChats, chatFingerprint } from '../lib/chatStorage'
import { chatSync } from '../lib/firestoreSync'
import { reconcileChats } from '../lib/chatSync'

// Başarısız bulut işlemleri bu aralıklarla, her seferinde iki katına çıkarak yeniden denenir.
const RETRY_MIN_MS = 5000
const RETRY_MAX_MS = 5 * 60 * 1000

// Yazılan sohbetlerin birleşik hâlleri: kullanıcı bu arada değiştirmediyse yerel kopyanın yerine geçer.
function applyPushed(prev, before, pushed) {
  const pushedById = new Map(pushed.map(c => [String(c.id), c]))
  const beforeById = new Map(before.map(c => [String(c.id), c]))
  return prev.map(c => {
    const merged = pushedById.get(String(c.id))
    return merged && c === beforeById.get(String(c.id)) ? merged : c
  })
}

export function useChatLibrary({ currentUser, showToast, onActiveChatRemoved }) {
  const [chats, setChats] = useState([])
  const [hydratedUid, setHydratedUid] = useState(null)
  const [activeChatId, setActiveChatId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 250)
  const [renamingChatId, setRenamingChatId] = useState(null)
  const [renameText, setRenameText] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const syncedChatsRef = useRef({})
  const chatsRef = useRef(chats)
  const retryRef = useRef({ timer: null, delay: RETRY_MIN_MS })

  const ownerReady = Boolean(currentUser && hydratedUid === currentUser.uid)
  const ownerUid = ownerReady ? currentUser.uid : null

  useEffect(() => { chatsRef.current = chats }, [chats])

  // Birleşik hâl yerel kopyaya yazılırken yeniden buluta gönderilmesin.
  const markSynced = useCallback((list) => {
    for (const chat of list) syncedChatsRef.current[chat.id] = chatFingerprint(chat)
  }, [])

  const runRetryRef = useRef(() => {})

  const scheduleRetry = useCallback(() => {
    const state = retryRef.current
    if (state.timer) return
    state.timer = setTimeout(() => {
      state.timer = null
      runRetryRef.current()
    }, state.delay)
    state.delay = Math.min(state.delay * 2, RETRY_MAX_MS)
  }, [])

  const runRetry = useCallback(async () => {
    const state = retryRef.current
    clearTimeout(state.timer)
    state.timer = null
    if (!ownerUid || !chatSync.hasPending(ownerUid)) { state.delay = RETRY_MIN_MS; return }
    const before = chatsRef.current
    const pushed = await chatSync.retryPending(ownerUid, id => chatsRef.current.find(c => String(c.id) === String(id)))
    if (pushed.length > 0) {
      markSynced(pushed)
      setChats(prev => applyPushed(prev, before, pushed))
    }
    if (chatSync.hasPending(ownerUid)) scheduleRetry()
    else state.delay = RETRY_MIN_MS
  }, [ownerUid, markSynced, scheduleRetry])

  useEffect(() => { runRetryRef.current = runRetry }, [runRetry])

  // Bağlantı gelince ve girişte bekleyen işlemleri dene.
  useEffect(() => {
    if (!ownerUid) return
    const retryState = retryRef.current
    const onOnline = () => { retryState.delay = RETRY_MIN_MS; runRetry() }
    window.addEventListener('online', onOnline)
    runRetry()
    return () => {
      window.removeEventListener('online', onOnline)
      clearTimeout(retryState.timer)
      retryState.timer = null
    }
  }, [ownerUid, runRetry])

  // Başka cihazlardan gelen değişiklikler: aynı kurallarla yerelle birleştirilir.
  useEffect(() => {
    if (!ownerUid) return
    let active = true
    const stop = chatSync.listen(ownerUid, async (docs) => {
      const before = chatsRef.current
      const finals = await chatSync.applyRemote(ownerUid, before, docs)
      if (!active) return
      markSynced(finals)
      setChats(prev => reconcileChats(prev, before, finals))
      if (chatSync.hasPending(ownerUid)) scheduleRetry()
    })
    return () => { active = false; stop() }
  }, [ownerUid, markSynced, scheduleRetry])

  useEffect(() => {
    if (ownerReady) saveChats(chats, currentUser.uid)
  }, [chats, currentUser, ownerReady])

  // Değişen sohbet bulutla işlem içinde birleştirilip yazılır; başarısızsa sonra yeniden denenir.
  useEffect(() => {
    if (!ownerUid) return
    for (const chat of chats) {
      const fp = chatFingerprint(chat)
      if (syncedChatsRef.current[chat.id] === fp) continue
      syncedChatsRef.current[chat.id] = fp
      chatSync.push(ownerUid, chat).then(merged => {
        if (!merged) {
          if (syncedChatsRef.current[chat.id] === fp) delete syncedChatsRef.current[chat.id]
          scheduleRetry()
          return
        }
        if (JSON.stringify(merged) === JSON.stringify(chat)) return
        markSynced([merged])
        setChats(prev => applyPushed(prev, [chat], [merged]))
      })
    }
  }, [chats, ownerUid, markSynced, scheduleRetry])

  const resetSyncState = useCallback(() => { syncedChatsRef.current = {} }, [])

  // synced: liste bulutla az önce eşitlendi; tekrar yazmaya gerek yok.
  const hydrateChats = useCallback((uid, userChats, { synced = false } = {}) => {
    if (synced) markSynced(userChats)
    setChats(prev => {
      const ids = new Set(userChats.map(chat => String(chat.id)))
      return [...prev.filter(chat => !ids.has(String(chat.id))), ...userChats]
    })
    setHydratedUid(uid)
  }, [markSynced])

  const clearChatsForSignOut = useCallback(() => {
    syncedChatsRef.current = {}
    setHydratedUid(null)
    setChats([])
    setActiveChatId(null)
    setSearchQuery('')
    setRenamingChatId(null)
    setRenameText('')
  }, [])

  const handleDeleteChat = (e, chatId) => {
    e.stopPropagation()
    setChats(prev => prev.filter(c => c.id !== chatId))
    if (activeChatId === chatId) { onActiveChatRemoved(); setActiveChatId(null) }
    if (currentUser) chatSync.deleteCloud(currentUser.uid, chatId).then(ok => { if (!ok) scheduleRetry() })
    delete syncedChatsRef.current[chatId]
    showToast('Sohbet silindi', 'info')
  }

  const togglePinChat = (e, chatId) => {
    e.stopPropagation()
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, pinned: !c.pinned } : c))
  }

  const toggleArchiveChat = (e, chatId) => {
    e.stopPropagation()
    setChats(prev => prev.map(c => {
      if (c.id !== chatId) return c
      const archived = !c.archived
      showToast(archived ? 'Sohbet arşivlendi' : 'Sohbet arşivden çıkarıldı', 'info')
      return { ...c, archived }
    }))
    if (activeChatId === chatId) { onActiveChatRemoved(); setActiveChatId(null) }
  }

  const startRename = (e, chat) => {
    e.stopPropagation()
    setRenamingChatId(chat.id)
    setRenameText(chat.title)
  }

  const commitRename = (chatId) => {
    const title = renameText.trim()
    if (title) {
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, title, titleManuallySet: true } : c))
    }
    setRenamingChatId(null)
    setRenameText('')
  }

  const cancelRename = () => { setRenamingChatId(null); setRenameText('') }

  const { visibleChats, archivedChats } = useMemo(() => {
    const query = debouncedSearch.toLowerCase()
    const filtered = debouncedSearch
      ? chats.filter(c => c.title.toLowerCase().includes(query) ||
          c.messages.some(m => m.content.toLowerCase().includes(query)))
      : chats
    const sorted = [...filtered].sort((a, b) =>
      ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || ((b.updatedAt || 0) - (a.updatedAt || 0))
    )
    return {
      visibleChats: sorted.filter(c => !c.archived),
      archivedChats: sorted.filter(c => c.archived),
    }
  }, [chats, debouncedSearch])

  return {
    chats, setChats,
    activeChatId, setActiveChatId,
    searchQuery, setSearchQuery,
    visibleChats, archivedChats,
    showArchived, setShowArchived,
    renamingChatId, renameText, setRenameText,
    startRename, commitRename, cancelRename,
    handleDeleteChat, togglePinChat, toggleArchiveChat,
    resetSyncState, hydrateChats, clearChatsForSignOut, chatsReady: ownerReady,
  }
}
