export const ERROR_REPLY_PREFIX = 'Üzgünüm, bir hata oluştu: '

export function errorReplyText(error) {
  const detail = String(error?.message || '').replace(/^(?:Hata:\s*)+/i, '').trim()
  return ERROR_REPLY_PREFIX + (detail || 'Bilinmeyen hata')
}

export function isErrorReply(message) {
  return message?.role === 'ai' && (message.error === true || String(message.content || '').startsWith(ERROR_REPLY_PREFIX))
}

// Hata, bu isteğin yanıt satırına yazılır; yanıt satırı yoksa kullanıcının mesajına dokunmadan sona eklenir.
export function applyErrorReply(messages, historyLength, error) {
  const reply = { role: 'ai', content: errorReplyText(error), error: true }
  const last = messages[messages.length - 1]
  if (last?.role === 'ai' && messages.length > historyLength) {
    return [...messages.slice(0, -1), { ...last, ...reply }]
  }
  return [...messages, reply]
}
