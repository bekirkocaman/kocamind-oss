import { createChatSubmission } from "./lib/chatSubmission";
import { chatsStorageKey, THEME_KEY, MODEL_KEY, PLUGINS_KEY, RAG_KEY, OFFLINE_QUEUE_KEY, loadOfflineQueue, loadSetting, loadModel, loadFeedback, saveFeedback, applyRetention, loadChats, chatTitle, assistantsStorageKey, clearLegacySharedStorage } from "./lib/chatStorage";
import { needsGmailTool } from "./lib/chatText";

import { makeImageThumbnail } from "./lib/imageThumbnail";
import ChatTopBar from "./components/chat/ChatTopBar";
import { ConfirmDialog, PromptDialog } from "./components/Dialogs";
import MessageList from "./components/chat/MessageList";
import ChatInput from "./components/chat/ChatInput";
import QuotaNotice from "./components/chat/QuotaNotice";
import { useToasts } from "./hooks/useToasts";
import { useKnowledge } from "./hooks/useKnowledge";
import { useChatLibrary } from "./hooks/useChatLibrary";
import { downloadBlob } from "./lib/download";
import { lazy, Suspense, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { flushSync } from "react-dom";
import { useOnline, useIdleTimer } from "./lib/hooks";
import { IconAttachment, IconDelete } from "./components/icons.jsx";
import { BUILT_IN_PLUGINS, getAvailablePluginTools } from "./lib/pluginManager";

import { auth, signOut, onAuthStateChanged } from "./lib/firebase";

import { API, BACKEND_URL, authFetch, transcribeAudio, uploadFileForAnalysis, sendFeedback } from "./lib/api";
import { buildFeedbackPayload } from "./lib/feedbackPayload";
import { createFeedbackQueue, isCurrentFeedbackVote, withFeedbackVote } from "./lib/feedbackQueue";
import FeedbackReasonSheet from "./components/FeedbackReasonSheet";
import { trackEvent } from "./lib/telemetry";
import { connectGmailAccount, disconnectGmailAccount, loadGmailConnection } from "./lib/gmail";
import { stripEphemeralMessages } from "./lib/messagePrivacy";
import { chatSync, deleteAllChatsFromCloud, fetchCloudAssistants, saveAssistantsToCloud } from "./lib/firestoreSync";
import EmptyState from "./components/EmptyState";
import Sidebar from "./components/Sidebar";
import ModelSelector from "./components/ModelSelector";
import ToastContainer from "./components/Toast";
import PwaAutoUpdate from "./components/PwaAutoUpdate";
import AuthGate from "./components/AuthGate";
import { connectorReturnMessage } from "./lib/connectors";
import { normalizeMessages } from "./lib/chatSchema";
import { resolveTheme } from "./lib/theme";
import { speak, notifyReply } from "./lib/appPrefs";
import { buildExport, exportFileName } from "./lib/chatExport";
import { mergeMessages } from "./lib/chatMerge";
import PendingDeletion from "./components/PendingDeletion";
import IdeLoginPrompt from "./components/IdeLoginPrompt";
import Onboarding from "./components/Onboarding";
import { shouldShowOnboarding, markOnboardingDone } from "./lib/onboarding";
import './components/Sidebar.css'
import './App.css'
// Yeni sade tema ayrı tutulur; geri dönüş için bu import kaldırılabilir.
import './claude-theme.css'

const AuthModal = lazy(() => import('./components/AuthModal'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const UserProfiler = lazy(() => import('./components/UserProfiler'))

// ─── Main App ───
function App() {
  const [currentUser, setCurrentUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)

  const online = useOnline()

  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [drawerCollapsed, setDrawerCollapsed] = useState(false)
  const [selectedModel, setSelectedModel] = useState(() => loadModel())
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark')
  const [editingMsgIdx, setEditingMsgIdx] = useState(null)
  const { toasts, showToast, dismissToast } = useToasts()
  const {
    chats, setChats,
    activeChatId, setActiveChatId,
    searchQuery, setSearchQuery,
    visibleChats, archivedChats,
    showArchived, setShowArchived,
    renamingChatId, renameText, setRenameText,
    startRename, commitRename, cancelRename,
    handleDeleteChat, togglePinChat, toggleArchiveChat,
    resetSyncState, hydrateChats, clearChatsForSignOut,
  } = useChatLibrary({ currentUser, showToast, onActiveChatRemoved: () => setMessages([]) })

  const [editText, setEditText] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [assistantType, setAssistantType] = useState('tiger')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState('assistants')
  const [onboardingDismissedUid, setOnboardingDismissedUid] = useState(null)
  const billingReturnRef = useRef(false)

  useEffect(() => {
    const url = new URL(window.location.href)
    const billingResult = url.searchParams.get('billing')
    if (!billingResult) return
    if (billingResult === 'success' || billingResult === 'pending') {
      billingReturnRef.current = true
      showToast('Ödeme sonucu doğrulanıyor…', 'info')
      setSettingsInitialTab('billing')
      setIsSettingsOpen(true)
    } else {
      showToast('Ödeme tamamlanamadı. Kartından ücret çekildiyse destekle iletişime geç.', 'error')
    }
    url.searchParams.delete('billing')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [showToast])

  // Sunucu bağlantısının OAuth dönüşü: ?baglanti=...&durum=ok|hata
  useEffect(() => {
    const url = new URL(window.location.href)
    const result = connectorReturnMessage(url.searchParams)
    if (!result) return
    showToast(result.text, result.type)
    setSettingsInitialTab('connectors')
    setIsSettingsOpen(true)
    for (const key of ['baglanti', 'durum', 'neden']) url.searchParams.delete(key)
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [showToast])
  const [customAssistants, setCustomAssistants] = useState([])
  const [assistantsOwner, setAssistantsOwner] = useState(null)
  const [pluginOverrides, setPluginOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PLUGINS_KEY)) || {} }
    catch { return {} }
  })
  const [availableTools, setAvailableTools] = useState(null)
  const [gmailConnection, setGmailConnection] = useState(loadGmailConnection)
  const [isConnectingGmail, setIsConnectingGmail] = useState(false)
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [chatDialog, setChatDialog] = useState(null)
  // Son sohbet yanıtındaki kalan mesaj hakkı (QuotaNotice); başlık yoksa null.
  const [quota, setQuota] = useState(null)
  // Hesap değişince önceki hesabın kalan hakkı gösterilmez.
  useEffect(() => { setQuota(null) }, [currentUser?.uid])
  const [profileRevision, setProfileRevision] = useState(0)
  const [isDeepResearchMode, setIsDeepResearchMode] = useState(false)
  const [agentStatus, setAgentStatus] = useState(null)
  const approvalWaitersRef = useRef(new Map())
  const [feedback, setFeedback] = useState(() => loadFeedback())
  const feedbackRef = useRef(feedback)
  const confirmedFeedbackRef = useRef(feedback)
  const feedbackIntentsRef = useRef(new Map())
  const [enqueueFeedback] = useState(createFeedbackQueue)
  const [pendingDownFeedback, setPendingDownFeedback] = useState(null)
  const feedbackTriggerRef = useRef(null)
  const appLayoutRef = useRef(null)
  const [speakingMsgIdx, setSpeakingMsgIdx] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isProfilerOpen, setIsProfilerOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [deletionPending, setDeletionPending] = useState(false)
  const [settingsRevision, setSettingsRevision] = useState(0)
  const [offlineQueue, setOfflineQueue] = useState(loadOfflineQueue)
  const [dailyUsage, setDailyUsage] = useState(undefined)
  const [hasPlusAccess, setHasPlusAccess] = useState(false)

  const [useRag, setUseRag] = useState(() => localStorage.getItem(RAG_KEY) === '1')

  const messagesEndRef = useRef(null)
  const abortControllerRef = useRef(null)
  const textareaRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const fileInputRef = useRef(null)
  const audioChunksRef = useRef([])
  const assistantsSyncedRef = useRef(null)
  const currentUserRef = useRef(null) // callback'lerde güncel kullanıcıya erişim için
  const {
    userMemories, memoriesLoading, memoriesFailed, documents, documentsLoading,
    documentsLoadingMore, documentsError, documentsNextCursor, uploadProgress,
    refreshMemories, refreshDocuments, loadMoreDocuments, resetKnowledge,
    handleDeleteMemory, handleClearMemories, handleImportMemories, handleUploadDocument, handleCancelUploadDocument, handleDeleteDocument,
  } = useKnowledge({ currentUserRef, showToast })
  const sendMessageRef = useRef(null)
  const offlineFlushRef = useRef(false)

  const runtimeAvailableTools = useMemo(() => gmailConnection
    ? { ...(availableTools || {}), read_emails: true }
    : availableTools, [availableTools, gmailConnection])

  // ─── Etkin eklentiler (override'lar ve gerçek bağlantılar uygulanmış) ───
  const effectivePlugins = useMemo(
    () => {
      void settingsRevision
      const capabilityEnabled = {
        web_search: loadSetting('cap_web_search', true),
        web_scraper: loadSetting('cap_web_search', true),
        memory: loadSetting('memory_enabled', true) && loadSetting('auto_memory', true),
      }
      return BUILT_IN_PLUGINS.map(plugin => {
        const tools = getAvailablePluginTools(plugin, runtimeAvailableTools)
        return {
          ...plugin,
          tools,
          enabled: tools.length > 0
            && (pluginOverrides[plugin.id] !== undefined ? pluginOverrides[plugin.id] : plugin.enabled)
            && capabilityEnabled[plugin.id] !== false,
        }
      })
    },
    [pluginOverrides, settingsRevision, runtimeAvailableTools]
  )

  // Gmail verisi kurallı, doğrudan görüntüleme yolunda kalır. Modeller bu aracı
  // hiçbir zaman göremez; böylece ham veya türetilmiş Gmail verisi AI'a taşınmaz.
  const modelSafePlugins = useMemo(() => effectivePlugins.map(plugin => ({
    ...plugin,
    tools: plugin.tools.filter(tool => tool.name !== 'read_emails'),
  })), [effectivePlugins])

  // ─── Theme ───
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)')
    const apply = () => {
      const resolved = resolveTheme(theme, media?.matches)
      document.documentElement.setAttribute('data-theme', resolved)
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', resolved === 'dark' ? '#151515' : '#f9f9f7')
    }
    document.documentElement.style.backgroundColor = ''
    document.documentElement.style.colorScheme = ''
    document.body.style.backgroundColor = ''
    document.body.style.colorScheme = ''
    document.getElementById('root')?.style.removeProperty('background-color')
    localStorage.setItem(THEME_KEY, theme)
    apply()
    if (theme !== 'system' || !media) return undefined
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  // ─── Save Assistants (local) ───
  useEffect(() => {
    if (!currentUser || assistantsOwner !== currentUser.uid) return
    try { localStorage.setItem(assistantsStorageKey(currentUser.uid), JSON.stringify(customAssistants)) } catch { /* kota */ }
  }, [customAssistants, currentUser, assistantsOwner])

  // ─── Plugin override'ları kaydet ───
  useEffect(() => {
    try { localStorage.setItem(PLUGINS_KEY, JSON.stringify(pluginOverrides)) } catch { /* yoksay */ }
  }, [pluginOverrides])

  // ─── RAG tercihi ───
  useEffect(() => {
    localStorage.setItem(RAG_KEY, useRag ? '1' : '0')
  }, [useRag])


  // ─── Persist model ───
  useEffect(() => { localStorage.setItem(MODEL_KEY, JSON.stringify(selectedModel)) }, [selectedModel])

  const handleModelChange = useCallback((model) => {
    setSelectedModel(model)
    trackEvent('model_selected', { provider: model.provider, model: model.id })
  }, [])


  // ─── Bağlantı yokken gönderilen mesajları cihazda güvenle beklet ───
  useEffect(() => {
    try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(offlineQueue)) } catch { /* depolama dolu olabilir */ }
  }, [offlineQueue])

  useEffect(() => {
    if (!isSettingsOpen || !currentUser) { setDailyUsage(undefined); return }
    authFetch(API.usage)
      .then(response => response.ok ? response.json() : null)
      .then(setDailyUsage)
      .catch(() => setDailyUsage(null))
  }, [isSettingsOpen, currentUser])

  // ─── Input helpers ───
  // Boş ekran kartı: mesaj kutusunu doldurur (göndermez); fotoğraf isteyen kart dosya seçiciyi açar.
  const handleSuggestion = (suggestion) => {
    const ta = textareaRef.current
    if (ta) {
      ta.value = suggestion.prompt
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    }
    if (suggestion.needsImage) fileInputRef.current?.click()
  }

  const autoResize = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [])

  const clearInput = () => {
    if (!textareaRef.current) return
    textareaRef.current.value = ''
    textareaRef.current.style.height = 'auto'
  }

  // ═══ Firebase Auth + Cloud Sync ═══
  useEffect(() => {
    const readyFallback = setTimeout(() => setAuthReady(true), 5000)
    if (!auth) {
      setAuthReady(true)
      return () => clearTimeout(readyFallback)
    }
    const unsub = onAuthStateChanged(auth, async (user) => {
      clearTimeout(readyFallback)
      // Hesap değişti: önceki hesabın süren cevabı durur; ekran yeni hesaba temiz açılır.
      if (currentUserRef.current?.uid !== user?.uid) {
        feedbackIntentsRef.current = new Map()
        feedbackRef.current = confirmedFeedbackRef.current
        feedbackTriggerRef.current = null
        setFeedback(confirmedFeedbackRef.current)
        setPendingDownFeedback(null)
        setOnboardingDismissedUid(null)
        abortControllerRef.current?.abort()
        abortControllerRef.current = null
        openBaseRef.current = null
        setMessages([])
      }
      currentUserRef.current = user
      setCurrentUser(user)
      setAuthReady(true)
      if (!user) {
        setIsAdmin(false)
        setDeletionPending(false)
        setHasPlusAccess(false)
        clearChatsForSignOut()
        setMessages([])
        setCustomAssistants([])
        setAssistantsOwner(null)
        assistantsSyncedRef.current = null
        resetKnowledge()
        setAvailableTools(null)
        disconnectGmailAccount()
        setGmailConnection(null)
        return
      }
      clearLegacySharedStorage()
      const stillSignedIn = () => currentUserRef.current?.uid === user.uid
      const storedGmailConnection = loadGmailConnection()
      if (storedGmailConnection?.email && storedGmailConnection.email !== user.email) {
        disconnectGmailAccount()
        setGmailConnection(null)
      }
      const tokenResult = await user.getIdTokenResult(true)
      setIsAdmin(tokenResult.claims.admin === true)
      const pendingDeletion = tokenResult.claims.deletionPending === true
      setDeletionPending(pendingDeletion)
      if (pendingDeletion) return
      try {
        const capabilitiesResponse = await authFetch(API.capabilities)
        const capabilities = await capabilitiesResponse.json()
        setAvailableTools(capabilitiesResponse.ok ? capabilities.tools || {} : null)
      } catch { setAvailableTools(null) }
      try {
        const billingResponse = await authFetch(API.billingStatus)
        const billingData = await billingResponse.json()
        const plusActive = billingResponse.ok && billingData?.billing?.plan === 'pro' && billingData?.billing?.status === 'active'
        setHasPlusAccess(plusActive)
        if (billingReturnRef.current) {
          billingReturnRef.current = false
          showToast(plusActive ? 'Plus aboneliğin aktif.' : 'Ödemen henüz onaylanmadı; onaylanınca Plus otomatik açılacak.', plusActive ? 'success' : 'info')
        }
      } catch { setHasPlusAccess(false) }
      // ─── Giriş yapıldı: sohbetleri birleştir ───
      // Üç yönlü birleştirme: başka cihazda silinen geri gelmez, iki cihazın mesajları birlikte kalır.
      const localChats = loadChats(user.uid)
      try {
        const synced = await chatSync.sync(user.uid, localChats)
        const retained = applyRetention(synced)
        const retainedIds = new Set(retained.map(chat => String(chat.id)))
        const expired = synced.filter(chat => !retainedIds.has(String(chat.id)))
        await Promise.all(expired.map(chat => chatSync.deleteCloud(user.uid, chat.id)))
        if (!stillSignedIn()) return
        hydrateChats(user.uid, retained.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), { synced: true })
      } catch (e) {
        console.error('Cloud sync hatası:', e)
        if (!stillSignedIn()) return
        hydrateChats(user.uid, localChats)
        showToast('Sohbetler buluttan alınamadı; bu cihazdaki kayıtlar gösteriliyor.', 'error')
      }
      // ─── Asistanları birleştir ───
      let localAssistants = []
      try { localAssistants = JSON.parse(localStorage.getItem(assistantsStorageKey(user.uid))) || [] } catch { /* bozuk kayıt */ }
      let cloudAssistants = null
      try { cloudAssistants = await fetchCloudAssistants(user.uid) } catch { /* yoksay */ }
      if (!stillSignedIn()) return
      const assistantMap = new Map((cloudAssistants || []).map(a => [a.id, a]))
      for (const a of localAssistants) assistantMap.set(a.id, a)
      setCustomAssistants([...assistantMap.values()])
      setAssistantsOwner(user.uid)
      // ─── Hafıza + dokümanlar ───
      refreshMemories(user.uid)
      refreshDocuments(user.uid)
    })
    return () => { clearTimeout(readyFallback); unsub() }
  }, [refreshMemories, refreshDocuments, resetKnowledge, clearChatsForSignOut, hydrateChats, showToast])

  // ─── Asistan değişince buluta yaz ───
  useEffect(() => {
    if (!currentUser || assistantsOwner !== currentUser.uid) return
    const fp = JSON.stringify(customAssistants)
    if (assistantsSyncedRef.current === fp) return
    assistantsSyncedRef.current = fp
    saveAssistantsToCloud(currentUser.uid, customAssistants).catch(e => console.error('Asistan sync hatası:', e))
  }, [customAssistants, currentUser, assistantsOwner])

  const handleLogout = async () => {
    try { await signOut(auth) } catch (e) { console.error(e) }
    showToast('Çıkış yapıldı.', 'info')
  }

  const handleConnectGmail = async () => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      showToast('Önce KocaMind hesabına giriş yapmalısın.', 'info')
      return
    }
    setIsConnectingGmail(true)
    try {
      const connection = await connectGmailAccount()
      if (!connection) return
      setGmailConnection(connection)
      setPluginOverrides(prev => ({ ...prev, gmail: true }))
      trackEvent('gmail_connected')
      setIsSettingsOpen(false)
      setTimeout(() => textareaRef.current?.focus(), 100)
      showToast(`${connection.email} bağlandı. Hazır mesajını şimdi gönderebilirsin.`, 'success')
    } catch (error) {
      const cancelled = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code)
      showToast(cancelled ? 'Gmail bağlantısı iptal edildi.' : `Gmail bağlanamadı: ${error.message}`, cancelled ? 'info' : 'error')
    } finally {
      setIsConnectingGmail(false)
    }
  }

  const handleDisconnectGmail = () => {
    disconnectGmailAccount()
    setGmailConnection(null)
    trackEvent('gmail_disconnected')
    showToast('Gmail bağlantısı kaldırıldı.', 'info')
  }

  // ─── Idle session timeout (45 dakika) ───
  useIdleTimer({ timeout: 45 * 60 * 1000, onIdle: () => { if (currentUser) handleLogout() } }) 

  // ─── Açık sohbetin depodaki hâlinden bilinen mesaj kimlikleri ───
  // Kayıtta depoda olup ekranın hiç görmediği mesajlar (başka cihazdan gelen) korunur,
  // ekranın kaldırdıkları (düzenleme, yeniden üretme) silinir.
  const openBaseRef = useRef(null)
  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])

  // ─── Ayarlar > Bildirimler: sekme arka plandayken biten yanıt bildirilir ───
  const wasLoadingRef = useRef(false)
  useEffect(() => {
    const finished = wasLoadingRef.current && !isLoading
    wasLoadingRef.current = isLoading
    if (!finished) return
    const reply = [...messagesRef.current].reverse().find(m => m.role === 'ai' && !m.ephemeral)?.content
    if (reply) notifyReply(reply)
  }, [isLoading])

  // ─── Persist chat helper ───
  const persistCurrentChat = useCallback((msgs) => {
    const persistentMessages = stripEphemeralMessages(msgs)
    if (persistentMessages.length === 0) return
    const base = openBaseRef.current
    setChats(prev => {
      if (activeChatId) {
        // Mesajlar Android ile ortak şemadaki kimlik ve zamanı taşır; önceki kayıttakiler korunur.
        return prev.map(c => c.id === activeChatId
          ? { ...c, messages: mergeMessages(normalizeMessages(persistentMessages, c.messages), c.messages, base), title: c.titleManuallySet ? c.title : chatTitle(persistentMessages), updatedAt: Date.now() }
          : c)
      } else {
        const newChat = { id: Date.now().toString(), title: chatTitle(persistentMessages), messages: normalizeMessages(persistentMessages), createdAt: Date.now(), updatedAt: Date.now() }
        setActiveChatId(newChat.id)
        return [newChat, ...prev]
      }
    })
  }, [activeChatId, setActiveChatId, setChats])

  // ─── Açık sohbet depoda değişti (başka cihaz ya da kayıt) ───
  // Cevap üretilmiyorsa ekrana yansıtılır; ekranın henüz kaydetmediği mesajlar korunur.
  useEffect(() => {
    if (!activeChatId) { openBaseRef.current = null; return }
    const stored = chats.find(c => c.id === activeChatId)
    if (!stored || isLoading) return
    const storedIds = new Set(stored.messages.map(m => String(m.id)))
    const base = openBaseRef.current
    openBaseRef.current = storedIds
    if (!base) return
    const view = normalizeMessages(messagesRef.current, stored.messages)
    const merged = mergeMessages(stored.messages, view, base)
    const same = merged.length === view.length && merged.every((m, i) => m.id === view[i].id && m.content === view[i].content)
    if (!same) setMessages(merged)
  }, [chats, activeChatId, isLoading])

  // ─── New Chat ───
  const handleNewChat = () => {
    if (messages.length > 0) persistCurrentChat(messages)
    openBaseRef.current = null
    setMessages([])
    setActiveChatId(null)
    setSidebarOpen(false)
  }

  // ─── Load Chat ───
  const handleLoadChat = (chat) => {
    if (messages.length > 0 && activeChatId) persistCurrentChat(messages)
    openBaseRef.current = new Set(chat.messages.map(m => String(m.id)))
    setMessages(chat.messages)
    setActiveChatId(chat.id)
    setSidebarOpen(false)
  }

  // ─── Export Chat ───
  const handleExportChat = () => {
    if (messages.length === 0) { showToast('Dışa aktarılacak mesaj yok', 'info'); return }
    const title = chats.find(c => c.id === activeChatId)?.title || chatTitle(messages)
    downloadBlob(buildExport('markdown', [{ title, messages }]), 'text/markdown;charset=utf-8', exportFileName('md', 1))
    showToast('Sohbet indirildi', 'success')
  }

  const handleShareChat = async () => {
    const text = messages.filter(m => m.content?.trim()).map(m => `${m.role === 'user' ? 'Sen' : 'KocaMind'}: ${m.content}`).join('\n\n')
    await handleShareMessage(text)
  }

  // ─── Stop ───
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }
  const { sendMessage } = createChatSubmission({
    setIsLoading,
    setIsStreaming,
    abortControllerRef,
    setAgentStatus,
    isDeepResearchMode,
    hasPlusAccess,
    setMessages,
    persistCurrentChat,
    getCurrentUid: () => currentUserRef.current?.uid,
    gmailConnection,
    setSettingsInitialTab,
    setIsSettingsOpen,
    currentUser,
    setGmailConnection,
    assistantType,
    customAssistants,
    setIsDeepResearchMode,
    useRag,
    selectedModel,
    modelSafePlugins,
    userMemories,
    approvalWaitersRef,
    refreshMemories,
    showToast,
    onQuota: setQuota
  });

  sendMessageRef.current = sendMessage

  // Bağlantı geri geldiğinde bekleyen mesajları sırayla gönder.
  useEffect(() => {
    if (!online || !currentUser || isLoading || offlineFlushRef.current || offlineQueue.length === 0) return
    const item = offlineQueue.find(entry => entry.userId === currentUser.uid)
    if (!item) return

    offlineFlushRef.current = true
    setOfflineQueue(prev => prev.filter(entry => entry.id !== item.id))
    setMessages(item.messages)
    showToast('Bekleyen mesaj gönderiliyor…', 'info')

    Promise.resolve(sendMessageRef.current?.(item.text, item.messages))
      .finally(() => { offlineFlushRef.current = false })
  }, [online, currentUser, isLoading, offlineQueue, showToast])

  // ─── Handle Send ───
  const handleSend = async () => {
    const userText = textareaRef.current?.value.trim() || ''
    if (!userText || isLoading) return

    if (!currentUser) {
      setIsAuthModalOpen(true)
      showToast('Sohbet etmek için giriş yap veya ücretsiz hesap oluştur.', 'info')
      return
    }

    if (needsGmailTool(userText) && !gmailConnection) {
      setSettingsInitialTab('connectors')
      setIsSettingsOpen(true)
      showToast('Maillerini okuyabilmem için önce Gmail hesabına izin ver.', 'info')
      return
    }
    clearInput()

    const newMessages = [...messages, { role: 'user', content: userText }]
    const sendableMessages = stripEphemeralMessages(newMessages)
    setMessages(newMessages)
    trackEvent('message_sent', {
      provider: selectedModel.provider,
      model: selectedModel.id,
      queued: !online,
      automaticTools: true,
    })

    if (!online) {
      if (!currentUser) {
        setIsAuthModalOpen(true)
        showToast('Mesajı çevrimdışı saklamak için önce giriş yapmalısın.', 'info')
        return
      }
      persistCurrentChat(sendableMessages)
      setOfflineQueue(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        userId: currentUser.uid,
        text: userText,
        messages: sendableMessages,
        queuedAt: Date.now(),
      }])
      showToast('İnternet gelince mesajın otomatik gönderilecek.', 'success')
      return
    }
    await sendMessage(userText, sendableMessages)
  }

  const handleCheckVideo = async (messageIndex, message) => {
    if (!message.mediaJobId || isLoading) return
    setIsLoading(true)
    try {
      const response = await authFetch(API.videoStatus(message.mediaJobId))
      const status = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(status.error || 'Video durumu alınamadı.')
      if (status.status === 'failed') throw new Error(status.error || 'Video üretilemedi.')
      if (status.status !== 'completed' || !status.videoUrl) {
        showToast('Video hâlâ hazırlanıyor.', 'info')
        return
      }
      setMessages(prev => {
        const updated = prev.map((item, index) => index === messageIndex
          ? { ...item, content: 'Video hazır.', generatedVideo: status.videoUrl, mediaStatus: 'completed' }
          : item)
        persistCurrentChat(updated)
        return updated
      })
      showToast('Video hazır.', 'success')
    } catch (error) {
      showToast(error.message, 'error')
    } finally {
      setIsLoading(false)
    }
  }

  // ─── Regenerate ───
  const handleRegenerate = async () => {
    if (isLoading || messages.length < 2) return
    // Remove last AI message
    const withoutLast = messages.slice(0, -1)
    const lastUserMsg = withoutLast[withoutLast.length - 1]
    if (!lastUserMsg || lastUserMsg.role !== 'user') return
    setMessages(withoutLast)
    await sendMessage(lastUserMsg.content, withoutLast)
  }

  // ─── Edit message ───
  const handleEditStart = (idx) => {
    setEditingMsgIdx(idx)
    setEditText(messages[idx].content)
  }

  const handleEditSend = async () => {
    if (!editText.trim() || isLoading) return
    // Keep messages up to the edited one, replace it
    const newMessages = messages.slice(0, editingMsgIdx)
    newMessages.push({ role: 'user', content: editText.trim() })
    setMessages(newMessages)
    setEditingMsgIdx(null)
    setEditText('')
    await sendMessage(editText.trim(), newMessages)
  }

  const handleEditCancel = () => { setEditingMsgIdx(null); setEditText('') }

  // ─── Voice recording ───
  const handleVoiceToggle = async () => {
    if (isRecording) {
      // Stop recording
      mediaRecorderRef.current?.stop()
      setIsRecording(false)
    } else {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mediaRecorder = new MediaRecorder(stream)
        audioChunksRef.current = []
        mediaRecorder.ondataavailable = (e) => { audioChunksRef.current.push(e.data) }
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop())
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
          try {
            const transcription = await transcribeAudio(audioBlob)
            if (transcription && textareaRef.current) {
              textareaRef.current.value += transcription
              textareaRef.current.dispatchEvent(new Event('input', { bubbles: true }))
            }
            else showToast('Ses anlaşılamadı, tekrar dener misin?', 'info')
          } catch (err) {
            console.error('Ses tanıma hatası:', err)
            showToast('Ses tanıma başarısız: ' + err.message, 'error')
          }
        }
        mediaRecorderRef.current = mediaRecorder
        mediaRecorder.start()
        setIsRecording(true)
      } catch (err) {
        console.error('Mikrofon erişim hatası:', err)
        showToast('Mikrofona erişilemedi. Tarayıcı izinlerini kontrol et.', 'error')
      }
    }
  }

  // ─── File upload (Vision & RAG) ───
  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    const isImage = file.type.startsWith('image/')
    const thumbnail = isImage ? await makeImageThumbnail(file) : null

    // Add temporary message
    const tempMessages = [...messages, { role: 'user', content: isImage ? '📷 Fotoğraf yükleniyor...' : '📄 Dosya okunuyor...' }]
    setMessages(tempMessages)
    setIsLoading(true)

    try {
      const data = await uploadFileForAnalysis(file)

      if (data.content) {
        let promptText = ""
        if (data.type === "image") {
            promptText = `Şu fotoğrafı yükledim: "${data.content}". Bunun hakkında konuşalım.`
        } else {
            promptText = `Şu dosyayı yükledim (${data.filename}):\n\n"""\n${data.content.substring(0, 15000)}\n"""\n\nBu metni incele ve bana özetle ya da soracağım sorulara bu metne dayanarak cevap ver.`
        }

        const newMessages = [...messages, { role: 'user', content: promptText, imageUrl: thumbnail }]
        setMessages(newMessages)
        await sendMessage(promptText, newMessages)
      } else {
        throw new Error("Açıklama alınamadı")
      }
    } catch (err) {
      console.error('Upload hatası:', err)
      showToast('Dosya işlenemedi: ' + err.message, 'error')
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'ai', content: 'Dosya işlenirken bir hata oluştu: ' + err.message }
        return updated
      })
      setIsLoading(false)
    }

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // ─── Klavye kısayolları ───
  useEffect(() => {
    const onKeyDown = (e) => {
      if (appLayoutRef.current?.inert) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); handleNewChat() }
      if (e.key === '/' || e.key === '/') { e.preventDefault(); setIsSettingsOpen(true) }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); handleExportChat() }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); if (window.matchMedia?.('(max-width: 768px)').matches) setSidebarOpen(v => !v); else setDrawerCollapsed(v => !v) }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // Kısayol dinleyicisi App yaşam döngüsü boyunca bir kez bağlanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.attachment-menu-container') && !e.target.closest('.plus-btn')) {
        setIsAttachmentMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // ─── Feedback (Thumbs Up/Down) ───
  const showFeedbackReason = Boolean(pendingDownFeedback && pendingDownFeedback.uid === currentUser?.uid)

  useLayoutEffect(() => {
    if (showFeedbackReason) return
    const trigger = feedbackTriggerRef.current
    feedbackTriggerRef.current = null
    if (trigger?.isConnected) trigger.focus()
  }, [showFeedbackReason])

  const updateLocalVote = (key, type) => {
    const updated = withFeedbackVote(feedbackRef.current, key, type)
    feedbackRef.current = updated
    setFeedback(updated)
  }

  const shouldSendVote = (intent) => isCurrentFeedbackVote(
    intent, auth?.currentUser?.uid, feedbackIntentsRef.current.get(intent.key), feedbackRef.current,
  )

  const submitFeedback = (intent, { reason, note } = {}) => {
    const { key, uid, type } = intent
    const sameAccount = () => auth?.currentUser?.uid === uid
    const isLatest = () => feedbackIntentsRef.current.get(key) === intent
    void enqueueFeedback({
      key,
      shouldSend: () => shouldSendVote(intent),
      send: () => sendFeedback(buildFeedbackPayload({ ...intent, reason, note })),
      onAccepted: () => {
        const confirmed = withFeedbackVote(confirmedFeedbackRef.current, key, type)
        confirmedFeedbackRef.current = confirmed
        saveFeedback(confirmed)
        if (isLatest()) feedbackIntentsRef.current.delete(key)
        if (sameAccount() && !feedbackIntentsRef.current.has(key)) updateLocalVote(key, type)
      },
      onRejected: () => {
        if (!sameAccount() || !isLatest()) return
        feedbackIntentsRef.current.delete(key)
        updateLocalVote(key, confirmedFeedbackRef.current[key] ?? null)
        showToast('Oy kaydedilemedi. Tekrar dene.', 'error')
      },
    })
  }

  const handleFeedback = (msgIdx, type) => {
    const uid = currentUser?.uid
    if (!uid || auth?.currentUser?.uid !== uid || showFeedbackReason) return
    const key = `${activeChatId || 'temp'}_${msgIdx}`
    const current = feedbackRef.current[key]
    const nextType = current === type ? null : type
    const answer = messages[msgIdx]
    const question = messages.slice(0, msgIdx).reverse().find(m => m.role === 'user')
    const intent = {
      key,
      uid,
      type: nextType,
      chatId: activeChatId || 'temp',
      msgIdx,
      answer,
      question,
      selectedModel,
      assistantType,
    }
    feedbackIntentsRef.current.set(key, intent)
    updateLocalVote(key, nextType)
    if (nextType === 'down') {
      feedbackTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setPendingDownFeedback(intent)
      return
    }
    submitFeedback(intent)
  }

  const finishDownFeedback = ({ reason, note } = {}) => {
    const pending = pendingDownFeedback
    setPendingDownFeedback(null)
    if (!pending || !shouldSendVote(pending)) return
    submitFeedback(pending, { reason, note })
  }

  const getFeedback = (msgIdx) => {
    const key = `${activeChatId || 'temp'}_${msgIdx}`
    return feedback[key] || null
  }

  // ─── Share Message ───
  const handleShareMessage = async (text) => {
    const shareData = { title: 'Kocamind Yanıtı', text }
    if (navigator.share) {
      try { await navigator.share(shareData) } catch { /* kullanıcı iptal etti */ }
    } else {
      await navigator.clipboard.writeText(text)
      showToast('Panoya kopyalandı', 'success')
    }
  }

  // ─── Text-to-Speech ───
  const handleTTS = (msgIdx, text) => {
    if (speakingMsgIdx === msgIdx) {
      window.speechSynthesis.cancel()
      setSpeakingMsgIdx(null)
      return
    }
    if (!speak(text, { onEnd: () => setSpeakingMsgIdx(null) })) {
      showToast('Tarayıcın sesli okumayı desteklemiyor.', 'info')
      return
    }
    setSpeakingMsgIdx(msgIdx)
  }

  // ─── Export All Chats as JSON ───
  const handleExportAllChats = () => {
    if (chats.length === 0) {
      showToast('Dışa aktarılacak sohbet yok', 'info')
      return
    }
    downloadBlob(JSON.stringify(chats, null, 2), 'application/json;charset=utf-8', `kocamind-tum-sohbetler-${Date.now()}.json`)
    showToast('Sohbetler indirildi', 'success')
  }

  // ─── Okunaklı biçimde dışa aktar (Markdown / düz metin) ───
  const handleExportFormat = (format) => {
    if (chats.length === 0) {
      showToast('Dışa aktarılacak sohbet yok', 'info')
      return
    }
    const ext = format === 'markdown' ? 'md' : 'txt'
    const mime = format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
    downloadBlob(buildExport(format, chats), mime, exportFileName(ext, chats.length))
    showToast('Sohbetler indirildi', 'success')
  }

  // ─── Hesaptaki tüm sunucu verilerini indir ───
  const handleExportAccount = async () => {
    if (!currentUser) {
      setIsAuthModalOpen(true)
      showToast('Hesap verilerini indirmek için giriş yapmalısın.', 'info')
      return
    }
    try {
      const response = await authFetch(API.accountExport)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Veriler hazırlanamadı')
      downloadBlob(JSON.stringify(data, null, 2), 'application/json;charset=utf-8', `kocamind-hesap-verileri-${Date.now()}.json`)
      trackEvent('account_exported')
      showToast('Tüm hesap verilerin indirildi.', 'success')
    } catch (error) {
      showToast('Hesap verileri indirilemedi: ' + error.message, 'error')
    }
  }

  // ─── Hesabı ve ilişkili tüm verileri kalıcı sil ───
  const handleDeleteAccount = async () => {
    if (!currentUser) return
    try {
      const response = await authFetch(API.account, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Hesap silinemedi')

      clearLocalAccountData()
      try { await signOut(auth) } catch { /* oturum zaten kapatıldı */ }
      window.location.reload()
    } catch (error) {
      showToast('Hesap silinemedi: ' + error.message, 'error')
    }
  }

  const clearLocalAccountData = () => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('kocamind_')) localStorage.removeItem(key)
    }
  }

  // ─── Silinmeyi bekleyen hesap: durum, geri alma, hemen silme ───
  const loadDeletionStatus = useCallback(async () => {
    const response = await authFetch(API.accountDeletion)
    return response.json()
  }, [])

  const handleRestoreAccount = async () => {
    const response = await authFetch(API.accountRestore, { method: 'POST' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Hesap geri alınamadı')
    await auth.currentUser?.getIdToken(true)
    window.location.reload()
  }

  const handleDeleteAccountNow = async () => {
    const response = await authFetch(API.accountDeleteNow, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Hesap silinemedi')
    clearLocalAccountData()
    try { await signOut(auth) } catch { /* hesap zaten silindi */ }
    window.location.reload()
  }

  // ─── Tüm sohbetleri temizle ───
  const handleClearAllChats = async () => {
    setChats([])
    setMessages([])
    setActiveChatId(null)
    resetSyncState()
    try { if (currentUser) localStorage.removeItem(chatsStorageKey(currentUser.uid)) } catch { /* yoksay */ }
    if (currentUser) {
      try {
        await deleteAllChatsFromCloud(currentUser.uid)
        await chatSync.forgetAll(currentUser.uid)
      } catch { /* yoksay */ }
    }
    setIsSettingsOpen(false)
    showToast('Tüm sohbet geçmişin silindi', 'success')
  }

  const handleApprovalDecision = (approval, approved) => {
    const id = approval?.confirmationId
    const resolve = approvalWaitersRef.current.get(id)
    if (!resolve) return
    approvalWaitersRef.current.delete(id)
    setMessages(prev => prev.map(item => item.agentApproval?.confirmationId === id
      ? { ...item, agentApproval: null }
      : item))
    resolve(approved)
  }

  const handleDeepResearch = () => {
    if (!hasPlusAccess) {
      setIsAttachmentMenuOpen(false)
      setSettingsInitialTab('billing')
      setIsSettingsOpen(true)
      showToast('Derin Araştırma Plus aboneliğine özel.', 'info')
      return
    }
    setIsDeepResearchMode(true)
    setIsAttachmentMenuOpen(false)
    trackEvent('deep_research_activated')
    setMessages(prev => [...prev, { role: 'ai', content: '🔬 **Derin Araştırma Modu Aktif!**\n\nİnternette neyi araştırmamı istiyorsun? Öğrenmek istediğin konuyu detaylıca yaz.' }])
    setTimeout(() => textareaRef.current?.focus(), 100)
  }

  const handleAgentMode = () => {
    setAssistantType('agent')
    setIsDeepResearchMode(false)
    setIsAttachmentMenuOpen(false)
    setMessages(prev => [...prev, { role: 'ai', content: '🤖 **Agent Modu Aktif!**\n\nYapmamı istediğin görevi adım adım yaz.' }])
    setTimeout(() => textareaRef.current?.focus(), 100)
  }

  const openSettings = (tab) => {
    setSettingsInitialTab(tab)
    setIsSettingsOpen(true)
    setSidebarOpen(false)
  }

  const toggleDrawer = () => {
    if (window.matchMedia?.('(max-width: 768px)').matches) setSidebarOpen(v => !v)
    else setDrawerCollapsed(v => !v)
  }

  const activeChat = activeChatId ? chats.find(c => c.id === activeChatId) : null

  if (!authReady) return <div className="app-layout" aria-busy="true" />

  if (deletionPending) {
    return (
      <PendingDeletion
        email={currentUser?.email}
        loadStatus={loadDeletionStatus}
        onRestore={handleRestoreAccount}
        onDeleteNow={handleDeleteAccountNow}
        onLogout={() => signOut(auth)}
      />
    )
  }

  if (!currentUser) {
    return (
      <div className="app-layout">
        <IdeLoginPrompt user={currentUser} authFetch={authFetch} apiBase={BACKEND_URL} />
        <AuthGate />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    )
  }

  const finishOnboarding = (suggestion) => {
    if (auth?.currentUser?.uid !== currentUser.uid) return
    markOnboardingDone(null, { user: currentUser })
    if (suggestion) {
      flushSync(() => setOnboardingDismissedUid(currentUser.uid))
      handleSuggestion(suggestion)
    } else {
      setOnboardingDismissedUid(currentUser.uid)
    }
  }

  const showOnboarding = !showFeedbackReason && onboardingDismissedUid !== currentUser.uid && !isSettingsOpen
    && shouldShowOnboarding({ user: currentUser })

  return (
    <>
    <div
      className={`app-layout ${drawerCollapsed ? 'drawer-collapsed' : ''}`}
      ref={appLayoutRef}
      inert={showOnboarding || showFeedbackReason}
    >
      <IdeLoginPrompt user={currentUser} authFetch={authFetch} apiBase={BACKEND_URL} />
      {!online && (
        <div className="offline-banner">
          <span>İnternet bağlantısı yok — mesajların bağlantı gelince gönderilecek{offlineQueue.length ? ` (${offlineQueue.length} bekliyor)` : ''}</span>
        </div>
      )}

      <Sidebar
        open={sidebarOpen} onToggle={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        searchQuery={searchQuery} onSearchChange={setSearchQuery}
        visibleChats={visibleChats} archivedChats={archivedChats}
        showArchived={showArchived} onToggleArchived={() => setShowArchived(v => !v)}
        activeChatId={activeChatId}
        renamingChatId={renamingChatId} renameText={renameText}
        onRenameTextChange={setRenameText}
        onCommitRename={commitRename} onCancelRename={cancelRename}
        onLoadChat={handleLoadChat} onDeleteChat={handleDeleteChat}
        onPinChat={togglePinChat} onStartRename={startRename} onArchiveChat={toggleArchiveChat}
        currentUser={currentUser} isPro={hasPlusAccess}
        onOpenSettings={() => openSettings(null)}
        onOpenSettingsTab={openSettings}
        isAdmin={isAdmin}
        onOpenProfiler={() => { setIsProfilerOpen(true); setSidebarOpen(false) }}
      />

      {/* Main */}
      {isProfilerOpen ? (
        <Suspense fallback={<main className="main-content" aria-busy="true" />}>
          <UserProfiler
            onBack={() => setIsProfilerOpen(false)}
            showToast={showToast}
            currentUser={currentUser}
          />
        </Suspense>
      ) : (
      <main className={`main-content ${messages.length === 0 ? 'is-empty' : ''}`}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true) }}
        onDragLeave={e => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false) }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); if (e.dataTransfer.files.length) { e.target.files = e.dataTransfer.files; handleFileUpload(e) } }}
      >
        {isDragOver && <div className="drop-overlay"><IconAttachment size={32} /><span>Dosyayı buraya bırak</span></div>}
        <ChatTopBar
          hasMessages={messages.length > 0}
          title={activeChat?.title}
          pinned={Boolean(activeChat?.pinned)}
          onMenu={toggleDrawer}
          onNewChat={handleNewChat}
          onShare={handleShareChat}
          onExport={handleExportChat}
          onRename={activeChat ? () => setChatDialog('rename') : null}
          onTogglePin={activeChat ? () => setChats(prev => prev.map(c => c.id === activeChat.id ? { ...c, pinned: !c.pinned } : c)) : null}
          onDelete={activeChat ? () => setChatDialog('delete') : null}
        />

        {messages.length === 0 ? (
          <EmptyState
            key={profileRevision}
            userName={currentUser?.displayName}
            onPick={handleSuggestion}
          />
        ) : (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            isStreaming={isStreaming}
            agentStatus={agentStatus}
            editingMsgIdx={editingMsgIdx}
            editText={editText}
            onEditTextChange={setEditText}
            onEditStart={handleEditStart}
            onEditSend={handleEditSend}
            onEditCancel={handleEditCancel}
            onApprovalDecision={handleApprovalDecision}
            onCheckVideo={handleCheckVideo}
            getFeedback={getFeedback}
            onFeedback={handleFeedback}
            onShare={handleShareMessage}
            onTTS={handleTTS}
            speakingMsgIdx={speakingMsgIdx}
            onRegenerate={handleRegenerate}
            messagesEndRef={messagesEndRef}
          />
        )}

        <ChatInput
          isAttachmentMenuOpen={isAttachmentMenuOpen}
          onToggleAttachmentMenu={() => setIsAttachmentMenuOpen(v => !v)}
          onPickFile={() => { fileInputRef.current?.click(); setIsAttachmentMenuOpen(false) }}
          fileInputRef={fileInputRef}
          onFileSelected={(e) => { handleFileUpload(e); setIsAttachmentMenuOpen(false) }}
          showDeepResearch={loadSetting('cap_deep_research', true)}
          hasPlusAccess={hasPlusAccess}
          isDeepResearchMode={isDeepResearchMode}
          onDeepResearch={handleDeepResearch}
          assistantType={assistantType}
          onAgentMode={handleAgentMode}
          onCloseMode={() => { setAssistantType('tiger'); setIsDeepResearchMode(false) }}
          hasMessages={messages.length > 0}
          modelSlot={<ModelSelector placement="up" value={selectedModel} onChange={handleModelChange} />}
          isRecording={isRecording}
          onVoiceToggle={handleVoiceToggle}
          textareaRef={textareaRef}
          onInput={autoResize}
          onKeyDown={handleKeyDown}
          isLoading={isLoading}
          onStop={handleStop}
          onSend={handleSend}
          notice={<QuotaNotice quota={quota} />}
        />
      </main>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <Suspense fallback={null}><SettingsModal
          onClose={() => { setIsSettingsOpen(false); setSettingsRevision(value => value + 1) }}
          initialTab={settingsInitialTab}
          theme={theme}
          setTheme={setTheme}
          assistantType={assistantType}
          setAssistantType={setAssistantType}
          customAssistants={customAssistants}
          setCustomAssistants={setCustomAssistants}
          pluginOverrides={pluginOverrides}
          setPluginOverrides={setPluginOverrides}
          availableTools={runtimeAvailableTools}
          gmailConnection={gmailConnection}
          isConnectingGmail={isConnectingGmail}
          onConnectGmail={handleConnectGmail}
          onDisconnectGmail={handleDisconnectGmail}
          currentUser={currentUser}
          hasPlusAccess={hasPlusAccess}
          onBillingStatusChange={(data) => setHasPlusAccess(data?.billing?.plan === 'pro' && data?.billing?.status === 'active')}
          memories={userMemories}
          memoriesLoading={memoriesLoading}
          memoriesFailed={memoriesFailed}
          onImportMemories={handleImportMemories}
          onRefreshMemories={() => refreshMemories()}
          onDeleteMemory={handleDeleteMemory}
          onClearMemories={handleClearMemories}
          documents={documents}
          documentsLoading={documentsLoading}
          documentsLoadingMore={documentsLoadingMore}
          documentsError={documentsError}
          documentsNextCursor={documentsNextCursor}
          uploadProgress={uploadProgress}
          onLoadMoreDocuments={loadMoreDocuments}
          onRetryDocuments={() => refreshDocuments()}
          onUploadDocument={handleUploadDocument}
          onCancelUploadDocument={handleCancelUploadDocument}
          onDeleteDocument={handleDeleteDocument}
          useRag={useRag}
          setUseRag={setUseRag}
          onExportAll={handleExportAllChats}
          onExportFormat={handleExportFormat}
          onProfileUpdated={() => setProfileRevision(v => v + 1)}
          onExportAccount={handleExportAccount}
          onClearAllChats={handleClearAllChats}
          onDeleteAccount={handleDeleteAccount}
          showToast={showToast}
          chats={chats}
          dailyUsage={dailyUsage}
          onLogout={handleLogout}
          onImportChats={(imported) => {
            const mergedMap = new Map()
            for (const c of chats) mergedMap.set(String(c.id), c)
            for (const c of imported) mergedMap.set(String(c.id), c)
            const merged = [...mergedMap.values()]
            setChats(merged)
            showToast(`${imported.length} sohbet içe aktarıldı.`, 'success')
          }}
        /></Suspense>
      )}

      {chatDialog === 'rename' && activeChat && (
        <PromptDialog
          title="Yeniden adlandır"
          initial={activeChat.title}
          placeholder="Yeni sohbet adı..."
          onSubmit={(title) => setChats(prev => prev.map(c => c.id === activeChat.id ? { ...c, title, titleManuallySet: true } : c))}
          onClose={() => setChatDialog(null)}
        />
      )}
      {chatDialog === 'delete' && activeChat && (
        <ConfirmDialog
          title="Sohbet silinsin mi?"
          message="Bu işlem geri alınamaz."
          action="Sil"
          danger
          icon={IconDelete}
          onConfirm={() => handleDeleteChat({ stopPropagation() {} }, activeChat.id)}
          onClose={() => setChatDialog(null)}
        />
      )}

      {/* Firebase Auth Modal */}
      {isAuthModalOpen && <Suspense fallback={null}><AuthModal onClose={() => setIsAuthModalOpen(false)} /></Suspense>}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <PwaAutoUpdate />
    </div>
      {showFeedbackReason && (
        <FeedbackReasonSheet onSubmit={finishDownFeedback} onSkip={() => finishDownFeedback()} />
      )}
      {showOnboarding && (
        <Onboarding
          key={currentUser.uid}
          onComplete={() => finishOnboarding()}
          onSkip={() => finishOnboarding()}
          onPickPrompt={(suggestion) => finishOnboarding(suggestion)}
        />
      )}
    </>
  )
}

export default App
