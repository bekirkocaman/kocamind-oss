export const REASONS = [
  { id: 'wrong', label: 'Yanlış bilgi' },
  { id: 'incomplete', label: 'Eksik' },
  { id: 'cut_off', label: 'Yarıda kesildi' },
  { id: 'language', label: 'Dil/üslup kötü' },
  { id: 'unsafe', label: 'Uygunsuz' },
  { id: 'slow', label: 'Çok yavaş' },
  { id: 'other', label: 'Diğer' },
]

export const FEEDBACK_NOTE_MAX = 500
export const BUG_TEXT_MIN = 10
export const BUG_TEXT_MAX = 4000

const VALID_REASON_IDS = new Set(REASONS.map(r => r.id))

function extractTools(answer) {
  if (Array.isArray(answer?.agentSteps)) {
    const names = [...new Set(
      answer.agentSteps
        .map(step => (typeof step?.name === 'string' ? step.name.trim() : ''))
        .filter(Boolean)
    )]
    if (names.length > 0) return names.slice(0, 10)
  }
  if (Array.isArray(answer?.tools)) {
    const names = [...new Set(
      answer.tools
        .map(tool => (typeof tool === 'string' ? tool.trim() : ''))
        .filter(Boolean)
    )]
    if (names.length > 0) return names.slice(0, 10)
  }
  return null
}

function buildContext({ answer, appVersion }) {
  const context = { platform: 'web' }

  if (typeof appVersion === 'string' && appVersion.trim()) {
    context.appVersion = appVersion.trim()
  }
  if (typeof answer?.finishReason === 'string' && answer.finishReason.trim()) {
    context.finishReason = answer.finishReason.trim()
  }
  if (typeof answer?.latencyMs === 'number' && Number.isFinite(answer.latencyMs) && answer.latencyMs >= 0) {
    context.latencyMs = answer.latencyMs
  }
  if (typeof answer?.deepThink === 'boolean') {
    context.deepThink = answer.deepThink
  } else if (typeof answer?.thinking === 'string' && answer.thinking.trim().length > 0) {
    context.deepThink = true
  }
  const tools = extractTools(answer)
  if (tools) {
    context.tools = tools
  }

  return context
}

export function buildFeedbackPayload({
  type,
  chatId,
  msgIdx,
  answer,
  question,
  selectedModel,
  assistantType,
  reason,
  note,
  appVersion,
}) {
  const payload = {
    type,
    chatId: chatId || 'temp',
    messageId: String(msgIdx),
    provider: answer?.answeredBy?.provider || selectedModel?.provider || null,
    model: answer?.answeredBy?.model || selectedModel?.id || null,
    assistantType,
    question: question?.content || '',
    answer: answer?.content || '',
    context: buildContext({ answer, appVersion }),
  }

  if (type === 'down') {
    if (typeof reason === 'string' && VALID_REASON_IDS.has(reason)) {
      payload.reason = reason
    }
    if (typeof note === 'string') {
      const cleanedNote = note.trim().slice(0, FEEDBACK_NOTE_MAX)
      if (cleanedNote) payload.note = cleanedNote
    }
  }

  return payload
}

export function validateBugText(text) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (trimmed.length < BUG_TEXT_MIN) {
    return { ok: false, error: `En az ${BUG_TEXT_MIN} karakter yazmalısın.` }
  }
  if (trimmed.length > BUG_TEXT_MAX) {
    return { ok: false, error: `Bildirim en fazla ${BUG_TEXT_MAX} karakter olabilir.` }
  }
  return { ok: true, error: null }
}
