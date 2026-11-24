export const RETENTION_DAYS = {
  '1month': 30,
  '3months': 90,
  '6months': 180,
  '1year': 365,
}

export function filterChatsByRetention(chats, retention = 'forever', now = Date.now()) {
  const days = RETENTION_DAYS[retention]
  if (!days) return chats
  const cutoff = now - days * 24 * 60 * 60 * 1000
  return chats.filter(chat => (chat.updatedAt || chat.createdAt || Number(chat.id) || 0) >= cutoff)
}
