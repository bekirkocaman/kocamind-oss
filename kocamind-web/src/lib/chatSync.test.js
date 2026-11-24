import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatSync, reconcileChats } from './chatSync'
import { toCloudChat } from './chatSchema'

function memoryStorage() {
  const map = new Map()
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) }
}

function fakeApi() {
  const docs = new Map()
  const listeners = new Set()
  return {
    docs,
    failWrites: false,
    async list() { return [...docs.entries()] },
    async delete(uid, id) { if (this.failWrites) throw new Error('ağ yok'); docs.delete(id) },
    async transact(uid, id, update) {
      if (this.failWrites) throw new Error('ağ yok')
      const next = update(docs.get(id) ?? null)
      if (next) docs.set(id, next)
    },
    listen(uid, onDocs) { listeners.add(onDocs); return () => listeners.delete(onDocs) },
    emit() { for (const l of listeners) l([...docs.entries()]) },
  }
}

const msg = (id, t, content = `m${id}`, role = 'user') => ({ id, role, content, timestamp: t })
const chat = (id, updatedAt, messages, extra = {}) => ({ id, title: id, createdAt: 1, updatedAt, messages, ...extra })
const contents = (c) => c.messages.map(m => m.content)

describe('chatSync', () => {
  let api, sync
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api = fakeApi()
    sync = createChatSync({ api, storage: memoryStorage() })
  })

  it('başarısız yazmayı bekletir ve yeniden dener', async () => {
    api.failWrites = true
    const c = chat('c1', 100, [msg('1', 10)])
    expect(await sync.push('u1', c)).toBeNull()
    expect(sync.hasPending('u1')).toBe(true)
    api.failWrites = false
    const merged = await sync.retryPending('u1', id => (id === 'c1' ? c : null))
    expect(merged.map(x => x.id)).toEqual(['c1'])
    expect(api.docs.has('c1')).toBe(true)
    expect(sync.hasPending('u1')).toBe(false)
  })

  it('başarısız silmeyi bekletir ve yeniden dener', async () => {
    api.docs.set('c1', toCloudChat(chat('c1', 100, [msg('1', 10)])))
    api.failWrites = true
    expect(await sync.deleteCloud('u1', 'c1')).toBe(false)
    api.failWrites = false
    await sync.retryPending('u1', () => null)
    expect(api.docs.has('c1')).toBe(false)
    expect(sync.hasPending('u1')).toBe(false)
  })

  it('başka cihazın eklediği mesajla birleştirerek yazar', async () => {
    const first = chat('c1', 100, [msg('1', 10, 'soru')])
    await sync.push('u1', first)
    api.docs.set('c1', toCloudChat({ ...first, updatedAt: 200, messages: [...first.messages, msg('2', 20, 'telefondan', 'ai')] }))
    const merged = await sync.push('u1', { ...first, updatedAt: 300, messages: [...first.messages, msg('3', 30, 'webden')] })
    expect(contents(merged)).toEqual(['soru', 'telefondan', 'webden'])
    expect(api.docs.get('c1').messages.map(m => m.content)).toEqual(['soru', 'telefondan', 'webden'])
  })

  it('başka cihazda silinen sohbet geri gelmez', async () => {
    const local = [chat('c1', 100, [msg('1', 10)])]
    const afterFirst = await sync.sync('u1', local)
    expect(api.docs.has('c1')).toBe(true)
    api.docs.delete('c1')
    expect(await sync.sync('u1', afterFirst)).toEqual([])
    expect(api.docs.has('c1')).toBe(false)
  })

  it('eski kimliksiz kayıt bulutta da kimliksizse mesajlar çoğalmaz', async () => {
    const legacy = { id: '1700', title: 'eski', createdAt: 1700, updatedAt: 1800, messages: [{ role: 'user', content: 'a' }, { role: 'ai', content: 'b' }] }
    api.docs.set('1700', { ...legacy, messages: legacy.messages })
    const [result] = await sync.sync('u1', [legacy])
    expect(contents(result)).toEqual(['a', 'b'])
    expect(result.messages.map(m => m.id)).toEqual(['1700-0', '1700-1'])
  })

  it('dinleyici kapatılabilir', () => {
    const seen = []
    const stop = sync.listen('u1', docs => seen.push(docs.length))
    api.docs.set('x', {})
    api.emit()
    stop()
    api.emit()
    expect(seen).toEqual([1])
  })
})

describe('reconcileChats', () => {
  it('eşitleme sırasında kullanıcının değiştirdiği, eklediği ve sildiği sohbetleri korur', () => {
    const a = chat('a', 1, [])
    const b = chat('b', 1, [])
    const c = chat('c', 1, [])
    const before = [a, b, c]
    const finals = [{ ...a, title: 'buluttan' }, { ...b, title: 'buluttan' }, { ...c, title: 'buluttan' }, chat('d', 1, [])]
    const editedA = { ...a, title: 'kullanıcı' }
    const created = chat('e', 1, [])
    const now = [editedA, b, created] // c silindi, a düzenlendi, e eklendi
    const out = reconcileChats(now, before, finals)
    expect(out.map(x => `${x.id}:${x.title}`).sort()).toEqual(['a:kullanıcı', 'b:buluttan', 'd:d', 'e:e'])
  })
})
