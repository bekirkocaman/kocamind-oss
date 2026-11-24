import { stripEphemeralMessages } from "./messagePrivacy";
import { DEEP_RESEARCH_PROMPT, visibleAssistantDraft, appendSearchSources, needsToolLoop, detectMediaTool, inferMediaAspectRatio, needsGmailTool, needsAutomaticTool, activityLabel } from "./chatText";
import { loadSetting, buildSettingsContext } from "./chatStorage";
import { API, authFetch, postJSON, ragQuery, memoryExtract, memorySummarize, memoryDelete } from "./api";
import { selectRelevantMemories, formatMemoriesForPrompt, planConversationContext, contextBudgetChars, toSummaryMessages, SUMMARY_HEADER } from "./memoryContext";
import { trackEvent } from "./telemetry";
import { waitWithSignal, createSmoothTextStream } from "./chatStream";
import { readGmailInbox } from "./pluginManager";
import { disconnectGmailAccount } from "./gmail";
import { WEB_SEARCH_RULES, KISILIK_KURALLARI } from "./prompts";
import { runNativeAgent } from "./nativeAgentRunner";
import { reasoningChunk } from "./thinking";
import { nextQuotaReset, parseQuotaHeaders } from "./usage";
import { undoableMemoryKeys } from "./memoryView";
import { applyErrorReply } from "./chatErrors";

// Hesap değişince (çıkış ya da başka hesap) önceki hesabın süren cevabı yeni hesabın ekranına
// ve sohbet listesine yazılmaz (Android ChatViewModel ile aynı kural).
// Sunucuda doküman deposu kapalıysa her mesajda boşuna sormamak için oturum boyunca hatırlanır.
let ragUnavailable = false

export function ownerGuard(getCurrentUid, ownerUid, fn) {
  return (...args) => {
    if (!ownerUid || getCurrentUid() !== ownerUid) return undefined
    return fn(...args)
  }
}

// Yarıda kalan düşünme penceresi kapanır; geçici alanlar kayda girmez.
function settleThinking(message) {
  if (!message?.thinkingActive && message?.thinkingStartedAt == null) return message
  const { thinkingActive, thinkingStartedAt, ...rest } = message
  return thinkingActive ? { ...rest, thinkingMs: rest.thinkingMs ?? Date.now() - thinkingStartedAt } : rest
}

export function createChatSubmission({
  setIsLoading,
  setIsStreaming,
  abortControllerRef,
  setAgentStatus,
  isDeepResearchMode,
  hasPlusAccess,
  setMessages: setMessagesForAnyOwner,
  persistCurrentChat: persistForAnyOwner,
  getCurrentUid,
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
  onQuota
}) {
  const setMessages = ownerGuard(getCurrentUid, currentUser?.uid, setMessagesForAnyOwner)
  const persistCurrentChat = ownerGuard(getCurrentUid, currentUser?.uid, persistForAnyOwner)
  const rememberInBackground = (userText) => {
    if (!currentUser || !loadSetting('memory_enabled', true) || !loadSetting('auto_memory', true)) return
    memoryExtract(userText).then(result => {
      const saved = result?.saved || []
      const forgotten = result?.forgotten || []
      if (saved.length === 0 && forgotten.length === 0) return
      refreshMemories()
      const keys = undoableMemoryKeys(saved)
      if (keys.length === 0) return showToast?.('Hafıza güncellendi', 'info')
      showToast?.(`Hafızaya eklendi: ${keys.join(', ')}`, 'info', {
        label: 'Geri al',
        onClick: () => Promise.all(keys.map(key => memoryDelete(currentUser.uid, key)))
          .then(() => showToast?.('Geri alındı', 'success'))
          .catch(() => showToast?.('Geri alınamadı', 'error'))
          .finally(() => refreshMemories())
      })
    }).catch(() => {})
  }

  const prepareConversationContext = async (msgHistory, signal, restoreStatus) => {
    const plan = planConversationContext(msgHistory.slice(0, -1), contextBudgetChars(selectedModel?.provider))
    if (!plan.needsSummary) return { messages: msgHistory, summary: plan.summary, recent: plan.recent }
    try {
      setAgentStatus('Sohbetin önceki kısmını özetliyorum')
      const summary = await memorySummarize(plan.summary, toSummaryMessages(plan.toSummarize), signal)
      if (!summary) throw new Error('Boş özet')
      const messages = msgHistory.map((message, index) => index === plan.newSummaryIndex ? { ...message, contextSummary: summary } : message)
      return { messages, summary, recent: plan.recent }
    } catch (error) {
      if (signal.aborted) throw error
      return { messages: msgHistory, summary: plan.summary, recent: [...plan.toSummarize, ...plan.recent] }
    } finally {
      setAgentStatus(restoreStatus)
    }
  }

  const sendMessage = async (userText, msgHistory) => {
    // Geçici Gmail sonuçları ne modele ne de sonraki kalıcı sohbet kaydına taşınır.
    msgHistory = stripEphemeralMessages(msgHistory)
    setIsLoading(true)
    setIsStreaming(false)
    const thinkingStartedAt = Date.now()

    const controller = new AbortController()
    abortControllerRef.current = controller
    const requestedMediaTool = detectMediaTool(userText)
    const requestedAspectRatio = inferMediaAspectRatio(userText, requestedMediaTool)

    let initialStatus = 'Yanıtını hazırlıyorum'
    if (requestedMediaTool === 'image') initialStatus = 'Görselini oluşturuyorum'
    else if (requestedMediaTool === 'video') initialStatus = 'Video oluşturma servisine bağlanıyorum'
    else if (needsGmailTool(userText)) initialStatus = 'Gmail’e bağlanıyorum'
    else if (isDeepResearchMode) initialStatus = 'Web’de kapsamlı araştırma yapıyorum'
    else if (/https?:\/\//i.test(userText)) initialStatus = 'Web sitesini inceliyorum'
    else if (needsToolLoop(userText)) initialStatus = 'Web’de araştırıyorum'
    setAgentStatus(initialStatus)

    const memoryEnabled = loadSetting('memory_enabled', true)
    const promptMemories = memoryEnabled ? selectRelevantMemories(userMemories, userText) : []
    const memoryPrompt = formatMemoriesForPrompt(promptMemories)

    try {
      if (requestedMediaTool === 'image') {
        if (!loadSetting('cap_image_gen', true)) throw new Error('Görsel üretimi ayarlardan kapalı.')
        const data = await postJSON(API.generateImage, { prompt: userText, aspectRatio: requestedAspectRatio }, controller.signal)
        const generatedImage = data.url || (data.image ? `data:${data.mimeType || 'image/png'};base64,${data.image}` : '')
        if (!generatedImage) throw new Error('Görsel üretilemedi, bir daha dener misin?')
        const finalMessages = [...msgHistory, {
          role: 'ai',
          content: 'Fotoğraf hazır.',
          generatedImage,
          mediaPrompt: userText,
          mediaAspectRatio: requestedAspectRatio,
        }]
        setMessages(finalMessages)
        persistCurrentChat(finalMessages)
        trackEvent('image_generated', { aspectRatio: requestedAspectRatio, automatic: true })
        setIsLoading(false)
        return
      }

      if (requestedMediaTool === 'video') {
        const data = await postJSON(API.generateVideo, { prompt: userText, aspectRatio: requestedAspectRatio }, controller.signal)
        if (!data.jobId) throw new Error('Video işlemi başlatılamadı.')

        const pendingMessage = {
          role: 'ai',
          content: 'Video hazırlanıyor… Bu işlem birkaç dakika sürebilir.',
          mediaJobId: data.jobId,
          mediaStatus: 'processing',
          mediaPrompt: userText,
          mediaAspectRatio: requestedAspectRatio,
        }
        let videoMessages = [...msgHistory, pendingMessage]
        setMessages(videoMessages)
        persistCurrentChat(videoMessages)
        trackEvent('video_generation_started', { aspectRatio: requestedAspectRatio, automatic: true })

        for (let attempt = 0; attempt < 90; attempt += 1) {
          await waitWithSignal(10000, controller.signal)
          const response = await authFetch(API.videoStatus(data.jobId), { signal: controller.signal })
          const status = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(status.error || 'Video durumu alınamadı.')
          if (status.status === 'failed') throw new Error(status.error || 'Video üretilemedi.')
          if (status.status === 'completed' && status.videoUrl) {
            videoMessages = [...msgHistory, {
              ...pendingMessage,
              content: 'Video hazır.',
              generatedVideo: status.videoUrl,
              mediaStatus: 'completed',
            }]
            setMessages(videoMessages)
            persistCurrentChat(videoMessages)
            trackEvent('video_generated', { aspectRatio: requestedAspectRatio, automatic: true })
            setIsLoading(false)
            return
          }
        }
        throw new Error('Video arka planda hazırlanıyor. Biraz sonra “Kontrol et” düğmesine basabilirsin.')
      }

      // Gmail okuma isteğini modelin araç seçimine bırakma. Bağlı hesaptan
      // doğrudan mailleri getir; böylece model "entegrasyon yok" diyemez.
      if (needsGmailTool(userText)) {
        if (!gmailConnection?.accessToken) {
          setSettingsInitialTab('connectors')
          setIsSettingsOpen(true)
          throw new Error('Gmail bağlantının süresi dolmuş. Gmail hesabını yeniden bağla.')
        }

        setAgentStatus('📧 Gmail gelen kutusu kontrol ediliyor…')
        setIsStreaming(true)
        const gmailResult = await readGmailInbox({
          count: 5,
          gmailAccessToken: gmailConnection.accessToken,
          allowGmailData: true,
        })

        const connectionExpired = /süresi doldu|yeniden bağlan|izninin/i.test(gmailResult)
        if (connectionExpired) {
          disconnectGmailAccount()
          setGmailConnection(null)
          setSettingsInitialTab('connectors')
          setIsSettingsOpen(true)
        }

        const gmailTextStream = createSmoothTextStream((text) => {
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.role === 'ai') {
              const updated = [...prev]
              updated[updated.length - 1] = { ...last, content: text, ephemeral: true, source: 'gmail' }
              return updated
            }
            return [...prev, { role: 'ai', content: text, ephemeral: true, source: 'gmail' }]
          })
        }, controller.signal)
        await gmailTextStream.finish(gmailResult)

        const gmailMessages = [...msgHistory, { role: 'ai', content: gmailResult, ephemeral: true, source: 'gmail' }]
        setMessages(gmailMessages)
        // Gmail başlıkları ve kısa önizlemeleri yalnızca bu açık oturumda gösterilir.
        // Google kullanıcı verisini yerel/bulut sohbet geçmişine kalıcı olarak yazma.
        return
      }

      rememberInBackground(userText)

      const conversation = await prepareConversationContext(msgHistory, controller.signal, initialStatus)
      msgHistory = conversation.messages
      const historySummary = conversation.summary
      const summaryPrompt = historySummary
        ? `\n\n${SUMMARY_HEADER}\n${historySummary}`
        : ''
      const tigerHistory = conversation.recent.map(m => ({ role: m.role, content: m.content }))

      let customPrompt = undefined
      let backendAssistantType = assistantType

      // Eğer seçilen asistan custom ise
      const customObj = customAssistants.find(a => a.id === assistantType)
      if (customObj) {
        backendAssistantType = 'custom'
        customPrompt = customObj.prompt
      }

      const deepResearchActive = hasPlusAccess && isDeepResearchMode && loadSetting('cap_deep_research', true)

      // Derin araştırmada yalnızca asistanın adı değişmez; web sonuçları zorunlu bağlam olur.
      if (deepResearchActive) {
        backendAssistantType = 'deep_research'
        customPrompt = DEEP_RESEARCH_PROMPT
        setIsDeepResearchMode(false) // Kullanım sonrası kapat
      }

      // ─── RAG: dokümanlardan bağlam çek ───
      let ragContext = ''
      if (useRag && currentUser && !deepResearchActive && !ragUnavailable) {
        try {
          const ragRes = await ragQuery(currentUser.uid, userText, 4)
          if (ragRes.disabled) ragUnavailable = true
          if (ragRes.contexts?.length > 0) ragContext = ragRes.contextString
        } catch { /* RAG kapalıysa sessiz geç */ }
      }

      // Web aramasında önce modelden tool istemek yerine aramayı doğrudan yap.
      // Böylece arama + tool kararı + cevap olmak üzere üç bekleme yerine tek AI turu kalır.
      let webSearchContext = ''
      let fastWebSearch = false
      if (selectedModel.provider !== 'openai' && (deepResearchActive || loadSetting('cap_web_search', true)) && (deepResearchActive || needsToolLoop(userText))) {
        try {
          // Açık bir soruda eski mesajları sorguya eklemek sonuçları bozuyordu.
          // Yalnızca "peki ya o?" gibi bağlama muhtaç kısa sorularda son mesajı kullan.
          const needsPreviousContext = userText.length < 18 || /\b(peki|ya|o|onun|bunun|şunun|orada|aynısı|devam)\b/i.test(userText)
          const previousUserText = needsPreviousContext
            ? msgHistory.slice(0, -1).filter(message => message.role === 'user').at(-1)?.content || ''
            : ''
          const searchQuery = deepResearchActive
            ? `${userText} güncel veriler resmi kaynaklar karşılaştırmalı analiz`.slice(-500)
            : `${previousUserText} ${userText}`.trim().slice(-500)
          const searchResponse = await authFetch(API.search, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: searchQuery }),
            signal: controller.signal,
          })
          const searchData = await searchResponse.json()
          if (!searchResponse.ok) throw new Error('Arama servisi yanıt vermedi')

          const items = (searchData.items || []).slice(0, 5)
          const resultParts = []
          if (searchData.aiSummary) resultParts.push(`Arama özeti:\n${searchData.aiSummary}`)
          if (items.length > 0) {
            resultParts.push(items.map((item, index) => {
              const source = item.link ? `\nKaynak: ${item.link}` : ''
              return `${index + 1}. ${item.title || 'Web sonucu'}\n${item.snippet || ''}${source}`
            }).join('\n\n'))
          }
          webSearchContext = resultParts.filter(Boolean).join('\n\n')
          if (!webSearchContext) {
            webSearchContext = `"${userText}" sorgusu için doğrulanabilir bir web sonucu bulunamadı.`
          }
          fastWebSearch = true
        } catch (error) {
          if (controller.signal.aborted) throw error
          // Başarısız aramada modeli yeniden araç döngüsüne sokma; düzgün bir nihai cevap üretmesini sağla.
          webSearchContext = `"${userText}" için web araması denendi ancak doğrulanabilir sonuç alınamadı.`
          fastWebSearch = true
        }
      }

      // ─── OTOMATİK ARAÇ SEÇİMİ ───
      // Kullanıcı mod seçmez. Model isteği analiz eder; gerekiyorsa uygun aracı
      // çağırır, gerekmiyorsa doğrudan yanıt verir.
      const hasAutomaticTools = modelSafePlugins.some(plugin => plugin.enabled && plugin.tools.length > 0)
      const automaticToolNeeded = needsAutomaticTool(userText)
      if (deepResearchActive || needsGmailTool(userText) || (!fastWebSearch && hasAutomaticTools && automaticToolNeeded)) {
        const showAgentProgress = deepResearchActive || needsGmailTool(userText)
        let agentBasePrompt = customPrompt || 'Sen KocaMind, kullanıcının kişisel asistanısın. Türkçe konuşuyorsun.'
        agentBasePrompt += buildSettingsContext()
        agentBasePrompt += WEB_SEARCH_RULES + KISILIK_KURALLARI
        agentBasePrompt += memoryPrompt + summaryPrompt
        if (ragContext) {
          agentBasePrompt += `\n\nKullanıcının dokümanlarından bu soruyla ilgili alıntılar:\n${ragContext}\n\nCevabını bu alıntılara dayandır ve kaynak dosya adını belirt.`
        }

        setIsStreaming(true)
        setMessages(prev => [...prev, {
          role: 'ai',
          content: '',
          agentSteps: [],
          agentRunning: showAgentProgress,
        }])

        try {
          const agentTextStream = createSmoothTextStream((text) => {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: text }
              return updated
            })
          }, controller.signal)

          const requestApproval = (approval) => new Promise(resolve => {
            approvalWaitersRef.current.set(approval.confirmationId, resolve)
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { ...updated[updated.length - 1], agentApproval: approval }
              return updated
            })
          })
          const { finalText, steps } = await runNativeAgent({
            history: [...conversation.recent, msgHistory[msgHistory.length - 1]],
            message: userText,
            instructions: agentBasePrompt,
            mode: deepResearchActive ? 'deep_research' : 'agent',
            enabledTools: modelSafePlugins.filter(plugin => plugin.enabled).flatMap(plugin => plugin.tools.map(tool => tool.name)),
            signal: controller.signal,
            onStatus: (s) => setAgentStatus(activityLabel(s)),
            onDraft: agentTextStream.push,
            onStepsChange: (s) => showAgentProgress && setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { ...updated[updated.length - 1], agentSteps: s }
              return updated
            }),
            onApprovalRequired: requestApproval,
          })
          if (steps.some(step => step.name === 'save_memory')) refreshMemories()

          await agentTextStream.finish(finalText)

          const cleanFinalText = appendSearchSources(finalText, steps)
          const agentFinalMessages = [...msgHistory, { role: 'ai', content: cleanFinalText, agentSteps: showAgentProgress ? steps : [] }]
          setMessages(agentFinalMessages)
          persistCurrentChat(agentFinalMessages)
          return
        } catch (agentError) {
          // Ajan sağlayıcısı kullanılamıyorsa (anahtar yok, 401/402/403...) seçili modelle normal sohbete düş.
          if (controller.signal.aborted || !agentError?.agentUnavailable) throw agentError
          console.warn('Agent kullanılamadı, normal sohbete geçiliyor:', agentError.message)
          setIsStreaming(false)
          setMessages(prev => {
            const last = prev[prev.length - 1]
            return prev.length > msgHistory.length && last?.role === 'ai' && !last.content && !(last.agentSteps?.length)
              ? prev.slice(0, -1)
              : prev
          })
          setAgentStatus(initialStatus)
        }
      }

      const hasExtras = ragContext || webSearchContext || memoryPrompt
      if (hasExtras) {
        backendAssistantType = 'custom'
        let prompt = customPrompt || 'Sen KocaMind, kullanıcının kişisel asistanısın. Türkçe konuşuyorsun.'
        prompt += buildSettingsContext()
        prompt += memoryPrompt
        if (ragContext) {
          prompt += `\n\nKullanıcının dokümanlarından bu soruyla ilgili alıntılar:\n${ragContext}\n\nCevabını bu alıntılara dayandır ve kaynak dosya adını belirt.`
        }
        if (webSearchContext) {
          prompt += `\n\nTAMAMLANMIŞ WEB ARAMASI:\n${webSearchContext}`
        }
        prompt += KISILIK_KURALLARI
        if (webSearchContext) {
          prompt += `\n\nWEB SONUCU İÇİN KESİN CEVAP KURALLARI:
- Arama işlemi zaten tamamlandı. Tekrar arama yapacağını söyleme ve kullanıcıdan sorguyu değiştirmesini isteme.
- "Bakıyorum", "biraz daha arayayım" gibi süreç cümleleri yazma; yalnızca nihai cevabı ver.
- Sonuç yeterliyse soruyu ilk cümlede doğrudan cevapla.
- Sonuç yetersizse bunu tek, tamamlanmış cümleyle açıkla; tahmin veya gelecek zamanlı söz verme.
- Yarım Markdown işaretleri bırakma.
- Gerçek bağlantı varsa en sonda "📌 Kaynaklar:" altında göster; bağlantı yoksa kaynak başlığı ekleme.`
        }
        customPrompt = prompt
      }

      const response = await authFetch(API.chat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          history: tigerHistory.length > 0 ? tigerHistory : undefined,
          history_summary: historySummary || undefined,
          assistant_type: backendAssistantType,
          custom_prompt: customPrompt,
          provider: selectedModel.provider,
          model: selectedModel.id,
          // Normal sohbette sağlayıcının kendiliğinden web araması yapıp alakasız
          // kaynaklar eklemesini engelle. Web araması yukarıdaki niyet tespitinde
          // veya Derin Araştırma modunda ayrıca çalıştırılıyor.
          web_search: deepResearchActive || needsToolLoop(userText),
          stream: true
        }),
        signal: controller.signal
      })

      if (response.status === 429) {
        // Hak bitti: hata balonu yerine mesaj kutusunun üstündeki geri sayım gösterilir.
        onQuota?.({ remaining: 0, limit: Number(response.headers.get('X-Daily-Limit')) || 0, resetAt: nextQuotaReset() })
        const quotaError = new Error('Günlük mesaj hakkı bitti')
        quotaError.quotaExhausted = true
        throw quotaError
      }
      onQuota?.(parseQuotaHeaders(response.headers))

      if (!response.ok) {
        let errMsg = 'API Hatası'
        try { const errJson = await response.json(); errMsg = errJson.error?.message || response.statusText } catch { /* yoksay */ }
        throw new Error(errMsg)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false, aiText = '', buffer = ''
      // Düşünme penceresi (Android ThinkingPanel): düşünce metni akarken açık, ilk yanıt metninde kapanır.
      let thinkingText = '', thinkingMs = null
      const upsertReply = (patch) => setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'ai' && last !== msgHistory[msgHistory.length - 1]) {
          const updated = [...prev]
          updated[updated.length - 1] = { ...last, ...patch }
          return updated
        }
        return [...prev, { role: 'ai', content: '', ...patch }]
      })
      const backendTextStream = createSmoothTextStream((text) => {
        upsertReply(thinkingText
          ? { content: text, thinking: thinkingText, thinkingActive: false, thinkingMs }
          : { content: text })
      }, controller.signal)

      const consumeBackendEvent = (line) => {
        if (!line.startsWith('data:')) return
        const dataStr = line.slice(5).trim()
        if (!dataStr || dataStr === '[DONE]') return
        try {
          const dataObj = JSON.parse(dataStr)
          const thought = reasoningChunk(dataObj)
          if (thought && thinkingMs === null) {
            thinkingText += thought
            upsertReply({ thinking: thinkingText, thinkingActive: true, thinkingStartedAt })
          }
          const textChunk = dataObj.choices?.[0]?.delta?.content
            || dataObj.delta?.text
            || dataObj.content?.[0]?.text
            || dataObj.candidates?.[0]?.content?.parts?.[0]?.text
            || dataObj.candidates?.[0]?.output?.content?.parts?.[0]?.text
          if (textChunk) {
            if (thinkingMs === null) thinkingMs = Date.now() - thinkingStartedAt
            aiText += textChunk
            setIsStreaming(true)
            backendTextStream.push(visibleAssistantDraft(aiText))
          }
        } catch { /* JSON parse hatası — sonraki parçayı bekle */ }
      }

      while (!done) {
        const { value, done: doneReading } = await reader.read()
        done = doneReading
        if (value) buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          consumeBackendEvent(line)
        }
      }

      // Bazı sağlayıcılar son SSE satırını satır sonu olmadan gönderir.
      if (buffer.trim()) consumeBackendEvent(buffer.trim())

      aiText = visibleAssistantDraft(aiText)

      await backendTextStream.finish(aiText)

      const finalText = webSearchContext
        ? appendSearchSources(aiText, [{ name: 'web_search', result: webSearchContext }])
        : aiText
      const answeredBy = response.headers.get('X-KocaMind-Model')
        ? { provider: response.headers.get('X-KocaMind-Provider'), model: response.headers.get('X-KocaMind-Model') }
        : { provider: selectedModel.provider, model: selectedModel.id }
      // Seçilen model doluydu ve cevabı yedek model verdi: kullanıcı hangi modelin yazdığını bilsin.
      if (response.headers.get('X-KocaMind-Fallback-From')) {
        answeredBy.label = response.headers.get('X-KocaMind-Model-Label') || answeredBy.model
        answeredBy.fallbackFromLabel = response.headers.get('X-KocaMind-Fallback-From-Label') || response.headers.get('X-KocaMind-Fallback-From')
      }
      const finalMessages = [...msgHistory, thinkingText
        ? { role: 'ai', content: finalText, thinking: thinkingText, thinkingMs: thinkingMs ?? Date.now() - thinkingStartedAt, answeredBy }
        : { role: 'ai', content: finalText, answeredBy }]
      setMessages(finalMessages)
      persistCurrentChat(finalMessages)

    } catch (error) {
      if (error.quotaExhausted) {
        setMessages(prev => {
          // Yalnızca bu istek için eklenmiş boş yanıt satırı kalkar; önceki mesajlara dokunulmaz.
          const settled = prev.filter((m, i) => !(i >= msgHistory.length && m.role === 'ai' && !m.content))
          persistCurrentChat(settled)
          return settled
        })
      } else if (error.name === 'AbortError') {
        setMessages(prev => {
          const settled = prev.map(settleThinking)
          persistCurrentChat(settled)
          return settled
        })
      } else {
        console.error(error)
        setMessages(prev => applyErrorReply(prev, msgHistory.length, error))
      }
    } finally {
      setAgentStatus(null)
      // Yarım kalan agent mesajındaki "çalışıyor" işaretini temizle (durdurma/hata durumu)
      setMessages(prev => prev.some(m => m.agentRunning)
        ? prev.map(m => m.agentRunning ? { ...m, agentRunning: false } : m)
        : prev)
      setIsLoading(false)
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }
  return { sendMessage };
}
