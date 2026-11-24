import { describe, expect, it, vi } from 'vitest'
import { createFeedbackQueue, isCurrentFeedbackVote, withFeedbackVote } from './feedbackQueue'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function request(overrides = {}) {
  return {
    key: 'chat_1',
    shouldSend: () => true,
    send: vi.fn().mockResolvedValue({ accepted: true }),
    onAccepted: vi.fn(),
    onRejected: vi.fn(),
    ...overrides,
  }
}

describe('createFeedbackQueue', () => {
  it('aynı mesajın oylarını sırayla gönderir ve diğer mesajı bekletmez', async () => {
    const enqueue = createFeedbackQueue()
    const response = deferred()
    const first = request({ send: vi.fn().mockReturnValue(response.promise) })
    const next = request()
    const other = request({ key: 'chat_2' })
    const firstDone = enqueue(first)
    const nextDone = enqueue(next)
    await enqueue(other)

    expect(first.send).toHaveBeenCalledOnce()
    expect(other.onAccepted).toHaveBeenCalledOnce()
    expect(next.send).not.toHaveBeenCalled()

    response.resolve({ accepted: true })
    await Promise.all([firstDone, nextDone])
    expect(next.onAccepted).toHaveBeenCalledOnce()
    expect(first.onAccepted.mock.invocationCallOrder[0]).toBeLessThan(next.send.mock.invocationCallOrder[0])
  })

  it.each([
    ['hesap değiştiğinde', 'user-10', 'down', false],
    ['oturum kapandığında', null, 'down', false],
    ['oy değiştiğinde', 'user-1', 'up', false],
    ['yeni bir down isteği geldiğinde', 'user-1', 'down', true],
  ])('%s bekleyen down isteğini atar', async (_name, nextUid, nextVote, replaceIntent) => {
    const enqueue = createFeedbackQueue()
    const response = deferred()
    const firstDone = enqueue(request({ send: () => response.promise }))
    const intent = { uid: 'user-1', key: 'chat_1', type: 'down' }
    let uid = intent.uid
    let latestIntent = intent
    let visible = { chat_1: 'down' }
    const pending = request({
      shouldSend: () => isCurrentFeedbackVote(intent, uid, latestIntent, visible),
    })
    expect(pending.shouldSend()).toBe(true)
    const pendingDone = enqueue(pending)
    uid = nextUid
    visible = { chat_1: nextVote }
    if (replaceIntent) latestIntent = { ...intent }
    response.resolve({ accepted: true })
    await Promise.all([firstDone, pendingDone])

    expect(pending.send).not.toHaveBeenCalled()
    expect(pending.onAccepted).not.toHaveBeenCalled()
    expect(pending.onRejected).not.toHaveBeenCalled()
  })

  it.each([
    ['accepted: false', () => Promise.resolve({ accepted: false })],
    ['HTTP 429', () => Promise.reject(Object.assign(new Error(), { status: 429 }))],
  ])('%s yanıtında son doğrulanan oyu kullanır ve sırayı sürdürür', async (_name, send) => {
    const enqueue = createFeedbackQueue()
    let confirmed = {}
    let visible = { chat_1: 'down' }
    const accepted = request({
      onAccepted: () => { confirmed = withFeedbackVote(confirmed, 'chat_1', 'up') },
    })
    const rejected = request({
      send,
      onRejected: () => { visible = withFeedbackVote(visible, 'chat_1', confirmed.chat_1 ?? null) },
    })
    await Promise.all([enqueue(accepted), enqueue(rejected)])
    expect(rejected.onAccepted).not.toHaveBeenCalled()
    expect(visible).toEqual({ chat_1: 'up' })

    await enqueue(request({ onAccepted: () => { visible = withFeedbackVote(visible, 'chat_1', null) } }))
    expect(visible).toEqual({})
  })
})
