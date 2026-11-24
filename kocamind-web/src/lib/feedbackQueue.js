export function withFeedbackVote(votes, key, type) {
  const updated = { ...votes }
  if (type === null) delete updated[key]
  else updated[key] = type
  return updated
}

export function isCurrentFeedbackVote(intent, uid, latestIntent, votes) {
  return intent.uid === uid && intent === latestIntent && (votes[intent.key] ?? null) === intent.type
}

export function createFeedbackQueue() {
  const pendingByKey = new Map()

  return function enqueueFeedback({ key, shouldSend, send, onAccepted, onRejected }) {
    const previous = pendingByKey.get(key) ?? Promise.resolve()
    const pending = previous.then(async () => {
      if (!shouldSend()) return

      let response
      try {
        response = await send()
      } catch {
        onRejected()
        return
      }
      if (response?.accepted === true) onAccepted()
      else onRejected()
    })
    pendingByKey.set(key, pending)
    const clear = () => {
      if (pendingByKey.get(key) === pending) pendingByKey.delete(key)
    }
    pending.then(clear, clear)
    return pending
  }
}
