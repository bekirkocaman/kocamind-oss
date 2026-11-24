// Sohbetleri dışa aktarma (Android ExportFormats): Markdown ve düz metin.
// Boş mesajlar ve geçici sistem mesajları yazılmaz.
const exportable = message => typeof message?.content === 'string' && message.content.trim() && (message.role === 'user' || message.role === 'ai') && !message.ephemeral

const exportMessages = chat => (chat.messages || []).filter(exportable)

export function exportMessageCount(chats) {
  return chats.reduce((sum, chat) => sum + exportMessages(chat).length, 0)
}

export function exportFileName(ext, chatCount, date = new Date()) {
  const day = date.toISOString().slice(0, 10)
  return `kocamind-${chatCount === 1 ? 'sohbet' : 'sohbetler'}-${day}.${ext}`
}

function exportMeta(chats, now) {
  const when = now.toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `KocaMind · ${when} · ${exportMessageCount(chats)} mesaj`
}

export function markdownToText(md) {
  return md
    .replace(/```[a-z0-9]*\n?([\s\S]*?)```/gi, (_, code) => code.replace(/\n$/, '').split('\n').map(line => `    ${line}`).join('\n'))
    .replace(/^#{1,6}\s+(.*)$/gm, (_, heading) => heading.toLocaleUpperCase('tr'))
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/^\n+|\s+$/g, '')
}

export function buildExport(format, chats, now = new Date()) {
  const title = chats.length === 1 ? chats[0].title : `${chats.length} sohbet`
  const meta = exportMeta(chats, now)
  const multi = chats.length > 1
  if (format === 'markdown') {
    const body = chats.map(chat => (multi ? `## ${chat.title}\n\n` : '') + exportMessages(chat)
      .map(m => m.role === 'user' ? `**Sen:** ${m.content.trim()}` : `**KocaMind:**\n\n${m.content.trim()}`)
      .join('\n\n')).join('\n\n---\n\n')
    return `# ${title}\n\n_${meta}_\n\n${body}\n`
  }
  const line = '─'.repeat(40)
  const body = chats.map(chat => (multi ? `${chat.title.toLocaleUpperCase('tr')}\n\n` : '') + exportMessages(chat)
    .map(m => m.role === 'user' ? `Sen:\n${m.content.trim()}` : `KocaMind:\n${markdownToText(m.content)}`)
    .join('\n\n')).join(`\n\n${line}\n\n`)
  return `${title}\n${meta}\n${line}\n\n${body}\n`
}
