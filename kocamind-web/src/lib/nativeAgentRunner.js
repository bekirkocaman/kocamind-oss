import { API, authFetch } from './api'

async function consumeAgentStream(response, handlers, state) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error?.message || data.error || `Agent hatası (${response.status})`)
  }
  if (!response.body) throw new Error('Agent akışı başlatılamadı.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const processBlock = async (block) => {
    const dataLine = block.split('\n').find(line => line.startsWith('data:'))
    if (!dataLine) return
    let event
    try { event = JSON.parse(dataLine.slice(5).trim()) } catch { return }

    if (event.type === 'status') handlers.onStatus?.(event.message)
    if (event.type === 'tool_started') {
      handlers.onStatus?.(`${event.name} çalıştırılıyor…`)
    }
    if (event.type === 'tool_completed') {
      const step = {
        name: event.name,
        arguments: event.arguments || {},
        result: event.output?.ok
          ? JSON.stringify(event.output.result ?? event.output)
          : (event.output?.error || 'Araç hatası'),
      }
      state.steps.push(step)
      handlers.onStepsChange?.([...state.steps])
    }
    if (event.type === 'text_delta') {
      state.text += event.delta || ''
      handlers.onDraft?.(state.text)
    }
    if (event.type === 'completed') {
      state.text = event.text || state.text
      state.sources = event.sources || []
    }
    if (event.type === 'approval_required') state.approval = event
    if (event.type === 'error') throw new Error(event.error || 'Agent çalıştırılamadı.')
  }

  while (true) {
    const { value, done } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let boundary
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      await processBlock(block)
    }
    if (done) break
  }
  if (buffer.trim()) await processBlock(buffer)
}

async function postAgentStream(url, body, signal) {
  return authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

export async function runNativeAgent({
  history,
  message,
  instructions,
  mode = 'agent',
  enabledTools,
  signal,
  onStatus,
  onDraft,
  onStepsChange,
  onApprovalRequired,
}) {
  const state = { text: '', steps: [], sources: [], approval: null, progressed: false }
  const cleanHistory = (history || [])
    .slice(0, -1)
    .slice(-60)
    .filter(item => ['user', 'ai', 'assistant'].includes(item?.role))
    .map(item => ({
      role: item.role,
      content: String(item.content || '').slice(0, 30000),
    }))
  const cleanTools = [...new Set((enabledTools || []).filter(name => typeof name === 'string'))].slice(0, 30)
  try {
    let response = await postAgentStream(API.agentRun, {
      history: cleanHistory,
      message: String(message || '').slice(0, 30000),
      instructions: String(instructions || '').slice(0, 30000),
      model: 'gpt-5.6-luna',
      mode,
      enabledTools: cleanTools,
    }, signal)

    while (true) {
      state.approval = null
      await consumeAgentStream(response, { onStatus, onDraft, onStepsChange }, state)
      if (!state.approval) break
      state.progressed = true
      const approved = await onApprovalRequired(state.approval)
      onStatus?.(approved ? 'Onaylandı, işlem uygulanıyor…' : 'İşlem iptal edildi, cevap hazırlanıyor…')
      response = await postAgentStream(API.agentConfirm(state.approval.runId), {
        confirmationId: state.approval.confirmationId,
        approved,
      }, signal)
    }
  } catch (error) {
    // Hiçbir araç çalışmadan, metin akmadan ve onay istenmeden düşen istek güvenle sohbet yoluna devredilebilir.
    if (error && typeof error === 'object') error.agentUnavailable = !state.progressed && !state.approval && !state.text && state.steps.length === 0 && error.name !== 'AbortError'
    throw error
  }

  let finalText = state.text
  if (state.sources.length) {
    const existing = new Set((finalText.match(/https?:\/\/[^\s)]+/g) || []).map(url => url.replace(/[.,;]+$/, '')))
    const missing = state.sources.filter(source => !existing.has(source.url))
    if (missing.length) {
      finalText += `\n\n### Kaynaklar\n${missing.map(source => `- [${source.title || source.url}](${source.url})`).join('\n')}`
    }
  }
  return { finalText, steps: state.steps }
}
