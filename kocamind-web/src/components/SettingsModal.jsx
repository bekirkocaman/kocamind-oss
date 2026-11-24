import DataPanel from "./settings/DataPanel";
import DocumentsPanel from "./settings/DocumentsPanel";
import MemoryPanel from "./settings/MemoryPanel";
import PluginsPanel from "./settings/PluginsPanel";
import BillingPanel from "./settings/BillingPanel";
import UsagePanel from "./settings/UsagePanel";
import StylesPanel from "./settings/StylesPanel";
import ConnectorsPanel from "./settings/ConnectorsPanel";
import SkillsPanel from "./settings/SkillsPanel";
import CapabilitiesPanel from "./settings/CapabilitiesPanel";
import PrivacyPanel from "./settings/PrivacyPanel";
import AccountPanel, { AccountDangerZone } from "./settings/AccountPanel";
import GeneralPanel from "./settings/GeneralPanel";
import AppearancePanel from "./settings/AppearancePanel";
import VoicePanel from "./settings/VoicePanel";
import NotificationsPanel from "./settings/NotificationsPanel";
import AboutPanel from "./settings/AboutPanel";
import BugReportPanel from "./settings/BugReportPanel";
import { SegmentedControl, SettingRow, SettingsGroup } from "./settings/Fields";

import { DOC_TEXT_EXTENSIONS, SETTINGS_TABS, SETTINGS_TAB_GROUPS, SETTINGS_SECTIONS, DEFAULT_SETTINGS_TAB, LANGUAGES, FONTS, resolveSettingsTab } from "./settings/options";
import { loadSetting, saveSetting } from "../lib/settingsStorage";
import { useState, useRef, useEffect, useMemo } from "react";
import { IconBack, IconClose, IconDisclosure } from "./icons.jsx";
import { isPluginAvailable } from "../lib/pluginManager";

const sectionDomId = (section) => `settings-section-${section}`

// ════════════════════════════════════════════════

export default function SettingsModal({
  onClose,
  initialTab = null,
  // Mevcut App state bağlantıları
  theme, setTheme,
  pluginOverrides, setPluginOverrides, availableTools,
  gmailConnection, isConnectingGmail, onConnectGmail, onDisconnectGmail,
  currentUser,
  hasPlusAccess,
  onProfileUpdated,
  onBillingStatusChange,
  memories, memoriesLoading, memoriesFailed, onRefreshMemories, onDeleteMemory, onClearMemories, onImportMemories,
  documents, documentsLoading, documentsLoadingMore, documentsError, documentsNextCursor, uploadProgress,
  onLoadMoreDocuments, onRetryDocuments, onUploadDocument, onCancelUploadDocument, onDeleteDocument,
  useRag, setUseRag,
  onExportAll, onExportFormat, onExportAccount, onClearAllChats, onDeleteAccount,
  showToast,
  chats,
  dailyUsage,
  onLogout,
  onImportChats,
}) {
  // Eski sekme kimlikleri (billing, memory, connectors, skills...) options.js'teki tek eşlemeyle yeni sekmeye düşer.
  const [initialTarget] = useState(() => resolveSettingsTab(initialTab))
  const [activeTab, setActiveTab] = useState(() => initialTarget?.tab || DEFAULT_SETTINGS_TAB)
  // Dar ekranda Android gibi önce liste, dokununca sayfa açılır.
  const [showPanel, setShowPanel] = useState(() => Boolean(initialTarget))
  // Her istek yeni nesne: aynı bölüme ikinci kez gitmek de kaydırmayı tetikler.
  const [scrollRequest, setScrollRequest] = useState(() => ({ section: initialTarget?.section || null }))
  const contentRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.km-dialog-overlay')) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Sekme değişince başa dön; bir bölüm istendiyse o bölüme kaydır.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const target = scrollRequest.section ? content.querySelector(`#${sectionDomId(scrollRequest.section)}`) : null
    if (target && target !== content.querySelector('.settings-block')) {
      target.scrollIntoView?.({ block: 'start' })
      return
    }
    content.scrollTop = 0
    const body = content.querySelector('.modal-body')
    if (body) body.scrollTop = 0
  }, [activeTab, scrollRequest])

  const openTab = (id, section = null) => { setActiveTab(id); setScrollRequest({ section }); setShowPanel(true) }
  const [statsNow] = useState(() => Date.now())

  // ─── Genel state ───
  const [userName, setUserName] = useState(() => loadSetting('user_name', ''))
  const [aiName, setAiName] = useState(() => loadSetting('ai_name', ''))
  const [occupations, setOccupations] = useState(() => loadSetting('occupations', []))
  const [preferences, setPreferences] = useState(() => loadSetting('preferences', ''))
  const [font, setFont] = useState(() => loadSetting('font', 'default'))
  const [language, setLanguage] = useState(() => loadSetting('language', 'tr'))

  // ─── Hesap state ───
  const [locationEnabled, setLocationEnabled] = useState(() => loadSetting('location_enabled', false))
  const [locationQueryTypes, setLocationQueryTypes] = useState(() => loadSetting('location_query_types', []))

  // ─── Gizlilik state ───
  const [searchInHistory, setSearchInHistory] = useState(() => loadSetting('search_in_history', true))
  const [memoryEnabled, setMemoryEnabled] = useState(() => loadSetting('memory_enabled', true))
  const [autoMemory, setAutoMemory] = useState(() => loadSetting('auto_memory', true))
  const [dataRetention, setDataRetention] = useState(() => loadSetting('data_retention', 'forever'))

  // ─── Yetenekler state ───
  const [webSearch, setWebSearch] = useState(() => loadSetting('cap_web_search', true))
  const [imageGeneration, setImageGeneration] = useState(() => loadSetting('cap_image_gen', true))
  const [deepResearch, setDeepResearch] = useState(() => loadSetting('cap_deep_research', true))

  // ─── Bağlantılar state ───
  // ─── Stiller state ───
  const [activeTone, setActiveTone] = useState(() => loadSetting('active_tone', 'normal'))
  const [customStyleText, setCustomStyleText] = useState('')
  const [customStylePrompt, setCustomStylePrompt] = useState(() => loadSetting('custom_style_prompt', ''))

  const docInputRef = useRef(null)
  const importRef = useRef(null)

  // ─── Auto-save immediate fields ───
  // ─── Tüm ayarları otomatik kaydet ───
  useEffect(() => {
    saveSetting('occupations', occupations)
    saveSetting('font', font)
    saveSetting('language', language)
    saveSetting('location_enabled', locationEnabled)
    saveSetting('location_query_types', locationQueryTypes)
    saveSetting('search_in_history', searchInHistory)
    saveSetting('memory_enabled', memoryEnabled)
    saveSetting('auto_memory', autoMemory)
    saveSetting('data_retention', dataRetention)
    saveSetting('cap_web_search', webSearch)
    saveSetting('cap_image_gen', imageGeneration)
    saveSetting('cap_deep_research', deepResearch)
    saveSetting('active_tone', activeTone)
    saveSetting('custom_style_prompt', customStylePrompt)
    saveSetting('user_name', userName)
    saveSetting('ai_name', aiName)
    saveSetting('preferences', preferences)
  }, [occupations, font, language, locationEnabled, locationQueryTypes, searchInHistory, memoryEnabled, autoMemory, dataRetention, webSearch, imageGeneration, deepResearch, activeTone, customStylePrompt, userName, aiName, preferences])

  // ─── Font uygula ───
  useEffect(() => {
    const root = document.documentElement
    const fontObj = FONTS.find(f => f.id === font) || FONTS[0]
    // Varsayılan yazı temadaki --font-ui'dir; kendine atıf (var(--font-ui)) değişkeni geçersiz kılıp serif'e düşürüyordu.
    if (font === 'default') root.style.removeProperty('--font-ui')
    else root.style.setProperty('--font-ui', fontObj.family)
    if (font === 'dyslexia') {
      root.style.setProperty('--font-mono', fontObj.family)
      root.style.setProperty('letter-spacing', '0.02em')
      root.style.setProperty('word-spacing', '0.05em')
    } else {
      root.style.removeProperty('--font-mono')
      root.style.removeProperty('letter-spacing')
      root.style.removeProperty('word-spacing')
    }
  }, [font])

  const isPluginEnabled = (p) => isPluginAvailable(p, availableTools)
    && (pluginOverrides[p.id] !== undefined ? pluginOverrides[p.id] : p.enabled)

  const togglePlugin = (plugin) => {
    if (!isPluginAvailable(plugin, availableTools)) {
      showToast('Bu bağlantı henüz sunucuda yapılandırılmamış.', 'info')
      return
    }
    if (plugin.requiresAuth && !currentUser) {
      showToast('Bu eklenti için giriş yapmalısın.', 'info')
      return
    }
    setPluginOverrides(prev => ({ ...prev, [plugin.id]: !isPluginEnabled(plugin) }))
  }

  const handleDocPick = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase()
    if (!DOC_TEXT_EXTENSIONS.includes(ext) && !file.type.startsWith('text/')) {
      showToast('Şimdilik sadece metin tabanlı dosyalar destekleniyor (txt, md, csv, kod...)', 'info')
      e.target.value = ''
      return
    }
    try {
      const content = await file.text()
      if (!content.trim()) {
        showToast('Dosya boş görünüyor.', 'error')
        return
      }
      onUploadDocument(file.name, content)
    } catch (err) {
      showToast('Dosya okunamadı: ' + err.message, 'error')
    } finally {
      e.target.value = ''
    }
  }

  const toggleOccupations = (occ) => {
    setOccupations(prev => prev.includes(occ) ? prev.filter(o => o !== occ) : [...prev, occ])
  }

  const toggleLocationType = (type) => {
    setLocationQueryTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
  }

  const handleCreateStyle = () => {
    if (!customStyleText.trim()) return
    const prompt = `Aşağıdaki yazım tarzımı analiz et ve bu tarzda cevaplar ver. Ton, kelime seçimi, cümle yapısı ve detay seviyesi olarak bu metne benzer şekilde konuş:\n\n"""\n${customStyleText.trim()}\n"""\n\nBu tarzı her mesajında koru.`
    setCustomStylePrompt(prompt)
    setActiveTone('custom')
    showToast('Özel stil oluşturuldu! Artık senin tarzında cevap verecek.', 'success')
  }

  const handleSelectTone = (toneId) => {
    setActiveTone(toneId)
    if (toneId !== 'custom') setCustomStylePrompt('')
  }

  // ─── Kullanım istatistikleri (gerçek sohbet verisinden) ───
  const usageStats = useMemo(() => {
    if (!chats || chats.length === 0) return { totalMessages: 0, activeDays: 0, topTopics: [], peakHours: [], weeklyAvg: 0, monthlyAvg: 0 }
    const allMsgs = chats.flatMap(c => c.messages || [])
    const totalMessages = allMsgs.length
    const userMsgs = allMsgs.filter(m => m.role === 'user')
    const daySet = new Set()
    userMsgs.forEach(m => {
      if (m.timestamp) daySet.add(new Date(m.timestamp).toDateString())
    })
    const weekAgo = statsNow - 7 * 24 * 60 * 60 * 1000
    const monthAgo = statsNow - 30 * 24 * 60 * 60 * 1000
    const weeklyMsgs = userMsgs.filter(m => m.timestamp && m.timestamp > weekAgo).length
    const monthlyMsgs = userMsgs.filter(m => m.timestamp && m.timestamp > monthAgo).length
    const topics = {}
    userMsgs.forEach(m => {
      const words = (m.content || '').toLowerCase().split(/\s+/).filter(w => w.length > 4)
      words.forEach(w => { topics[w] = (topics[w] || 0) + 1 })
    })
    const sortedTopics = Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k.charAt(0).toUpperCase() + k.slice(1))
    const hours = {}
    userMsgs.forEach(m => {
      if (m.timestamp) { const h = new Date(m.timestamp).getHours(); hours[h] = (hours[h] || 0) + 1 }
    })
    const sortedHours = Object.entries(hours).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => String(h).padStart(2, '0') + ':00')
    return {
      totalMessages,
      activeDays: daySet.size,
      topTopics: sortedTopics.length ? sortedTopics : ['—'],
      peakHours: sortedHours.length ? sortedHours : ['—'],
      weeklyAvg: weeklyMsgs,
      monthlyAvg: monthlyMsgs,
    }
  }, [chats, statsNow])

  const activeTabDef = SETTINGS_TABS.find(tab => tab.id === activeTab) || SETTINGS_TABS[0]
  const activeLabel = activeTabDef.label
  const avatarInitial = (currentUser?.displayName || currentUser?.email || 'M').trim()[0]?.toLocaleUpperCase('tr')

  // Bölüm kimliği -> panel. Paneller, state ve prop'lar öncekiyle aynı; sadece sekmelere dağılımları değişti.
  const renderSection = (section) => {
    switch (section) {
      // ─── Genel ───
      case 'appearance': return <AppearancePanel theme={theme} setTheme={setTheme} font={font} setFont={setFont} />
      case 'language': return (
        <SettingsGroup>
          <SettingRow
            label="Uygulama dili"
            control={<SegmentedControl options={LANGUAGES} value={language} onChange={setLanguage} label="Uygulama dili" />}
          />
        </SettingsGroup>
      )
      case 'voice': return <VoicePanel showToast={showToast} />
      case 'notifications': return <NotificationsPanel />
      // ─── Kişiselleştirme ───
      case 'general': return <GeneralPanel userName={userName} setUserName={setUserName} aiName={aiName} setAiName={setAiName} occupations={occupations} toggleOccupations={toggleOccupations} preferences={preferences} setPreferences={setPreferences} />
      case 'styles': return <StylesPanel activeTone={activeTone} handleSelectTone={handleSelectTone} customStyleText={customStyleText} setCustomStyleText={setCustomStyleText} handleCreateStyle={handleCreateStyle} customStylePrompt={customStylePrompt} />
      // ─── Hafıza ───
      case 'memory': return <MemoryPanel currentUser={currentUser} onRefreshMemories={onRefreshMemories} memoriesLoading={memoriesLoading} memoriesFailed={memoriesFailed} memories={memories} onDeleteMemory={onDeleteMemory} onClearMemories={onClearMemories} onImportMemories={onImportMemories} memoryEnabled={memoryEnabled} setMemoryEnabled={setMemoryEnabled} autoMemory={autoMemory} setAutoMemory={setAutoMemory} showToast={showToast} />
      // ─── Özellikler, Skill'ler, Eklentiler, Dokümanlar ───
      case 'capabilities': return <CapabilitiesPanel webSearch={webSearch} setWebSearch={setWebSearch} imageGeneration={imageGeneration} setImageGeneration={setImageGeneration} deepResearch={deepResearch} setDeepResearch={setDeepResearch} hasPlusAccess={hasPlusAccess} useRag={useRag} setUseRag={setUseRag} />
      case 'skills': return <SkillsPanel currentUser={currentUser} showToast={showToast} />
      case 'plugins': return <PluginsPanel availableTools={availableTools} isPluginEnabled={isPluginEnabled} togglePlugin={togglePlugin} />
      case 'documents': return (
        <DocumentsPanel
          currentUser={currentUser}
          docInputRef={docInputRef}
          handleDocPick={handleDocPick}
          documentsLoading={documentsLoading}
          documentsLoadingMore={documentsLoadingMore}
          documentsError={documentsError}
          documents={documents}
          documentsNextCursor={documentsNextCursor}
          uploadProgress={uploadProgress}
          onCancelUpload={onCancelUploadDocument}
          onLoadMoreDocuments={onLoadMoreDocuments}
          onRetryDocuments={onRetryDocuments}
          onDeleteDocument={onDeleteDocument}
        />
      )
      // ─── Bağlantılar ───
      case 'connectors': return <ConnectorsPanel gmailConnection={gmailConnection} onDisconnectGmail={onDisconnectGmail} onConnectGmail={onConnectGmail} isConnectingGmail={isConnectingGmail} currentUser={currentUser} showToast={showToast} />
      // ─── Veri ve Gizlilik ───
      case 'privacy': return <PrivacyPanel searchInHistory={searchInHistory} setSearchInHistory={setSearchInHistory} dataRetention={dataRetention} setDataRetention={setDataRetention} />
      case 'data': return <DataPanel onExportAll={onExportAll} onExportFormat={onExportFormat} currentUser={currentUser} onExportAccount={onExportAccount} importRef={importRef} onImportChats={onImportChats} showToast={showToast} onClearAllChats={onClearAllChats} />
      // ─── Hesap / Plan ve kullanım ───
      case 'account': return <AccountPanel currentUser={currentUser} isPro={hasPlusAccess} onProfileUpdated={onProfileUpdated} locationEnabled={locationEnabled} setLocationEnabled={setLocationEnabled} locationQueryTypes={locationQueryTypes} toggleLocationType={toggleLocationType} showToast={showToast} />
      case 'billing': return <BillingPanel currentUser={currentUser} showToast={showToast} onStatusChange={onBillingStatusChange} />
      case 'usage': return <UsagePanel currentUser={currentUser} dailyUsage={dailyUsage} usageStats={usageStats} />
      case 'account_danger': return currentUser ? <AccountDangerZone onLogout={onLogout} onClose={onClose} onDeleteAccount={onDeleteAccount} /> : null
      // ─── Yardım ───
      case 'about': return <AboutPanel />
      case 'bug_report': return <BugReportPanel />
      default: return null
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-full-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}>
        <div className="modal-header settings-modal-header">
          {showPanel && (
            <button className="close-btn settings-back-btn" onClick={() => setShowPanel(false)} aria-label="Ayarlara dön"><IconBack size={20} /></button>
          )}
          <h2 id="settings-title"><span className="settings-title-main">Ayarlar</span><span className="settings-title-tab">{activeLabel}</span></h2>
          <button className="close-btn" onClick={onClose} aria-label="Ayarları kapat"><IconClose size={20} /></button>
        </div>

        <div className={`settings-layout ${showPanel ? 'show-panel' : ''}`}>
          {/* ─── Sol menü: hesap satırı ve kartsız düz sekme listesi (gruplar arası yalnızca boşluk) ─── */}
          <nav className="settings-sidebar" aria-label="Ayar bölümleri">
            <button type="button" className={`settings-account-row ${activeTab === 'account' ? 'active' : ''}`} onClick={() => openTab('account')} aria-label={`Profil: ${currentUser?.email || 'Misafir'}`}>
              {currentUser?.photoURL
                ? <img src={currentUser.photoURL} alt="" referrerPolicy="no-referrer" />
                : <span className="settings-account-avatar">{avatarInitial}</span>}
              <span className="settings-account-email">{currentUser?.email || 'Misafir'}</span>
              {currentUser && <span className="settings-plan-pill">{hasPlusAccess ? 'Pro' : 'Ücretsiz'}</span>}
            </button>
            {SETTINGS_TAB_GROUPS.map((group, index) => (
              <div key={index} className="settings-nav-group">
                {group.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={`settings-sidebar-tab ${activeTab === id ? 'active' : ''}`}
                    onClick={() => openTab(id)}
                    aria-current={activeTab === id ? 'page' : undefined}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                    <IconDisclosure size={16} className="settings-tab-chevron" />
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {/* ─── Sağ panel: sekme başlığı ve başlıklı bölümler ─── */}
          <div className="settings-content" ref={contentRef}>
            <div className="modal-body">
              <h3 className="settings-tab-title">{activeLabel}</h3>
              {activeTabDef.sections.map(section => {
                const content = renderSection(section)
                if (!content) return null
                const meta = SETTINGS_SECTIONS[section] || {}
                return (
                  <section
                    key={section}
                    id={sectionDomId(section)}
                    className={`settings-block ${meta.title ? 'has-title' : ''}`}
                  >
                    {meta.title && (
                      <h3 className="settings-block-title">{meta.title}</h3>
                    )}
                    <div className={`settings-block-body ${meta.hidePanelTitle ? 'hide-panel-title' : ''}`}>
                      {content}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
