export function stripEphemeralMessages(messages = []) {
  if (!Array.isArray(messages)) return []
  return messages.filter(message => {
    if (!message || message.ephemeral === true || message.source === 'gmail') return false
    // İlk Gmail sürümünün kalıcı kayda girmiş olabilecek kesin çıktı biçimi.
    // Eski kayıtlar bir daha yüklendiğinde de temizlenir.
    const legacyGmailResult = message.role === 'ai'
      && /^📧\s*\*\*Son\s+\d+\s+mail:\*\*/u.test(String(message.content || ''))
    return !legacyGmailResult
  })
}
