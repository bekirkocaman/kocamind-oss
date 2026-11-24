import { beforeEach, describe, expect, it } from 'vitest'

const store = new Map()
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
  clear: () => store.clear(),
  key: index => [...store.keys()][index] ?? null,
  get length() { return store.size },
}

const { loadChats, saveChats, clearLegacySharedStorage, STORAGE_KEY } = await import('./chatStorage')

const chat = (id, text) => ({ id, title: text, updatedAt: Date.now(), messages: [{ role: 'user', content: text }] })

describe('hesap bazlı sohbet saklama', () => {
  beforeEach(() => store.clear())

  it('bir hesabın sohbetleri başka hesapta görünmez', () => {
    saveChats([chat('a1', 'A hesabının sohbeti')], 'userA')
    saveChats([chat('b1', 'B hesabının sohbeti')], 'userB')
    expect(loadChats('userA').map(c => c.id)).toEqual(['a1'])
    expect(loadChats('userB').map(c => c.id)).toEqual(['b1'])
  })

  it('oturum yokken ne okur ne yazar', () => {
    saveChats([chat('x', 'misafir')], null)
    expect(store.size).toBe(0)
    expect(loadChats(null)).toEqual([])
  })

  it('eski ortak sohbet deposu hiçbir hesaba aktarılmaz ve temizlenir', () => {
    store.set(STORAGE_KEY, JSON.stringify([chat('eski', 'ortak')]))
    store.set('kocamind_assistants', '[]')
    expect(loadChats('userA')).toEqual([])
    clearLegacySharedStorage()
    expect(store.has(STORAGE_KEY)).toBe(false)
    expect(store.has('kocamind_assistants')).toBe(false)
  })
})
