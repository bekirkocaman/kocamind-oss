import { describe, expect, it, vi } from 'vitest'
import {
  buildCallbackUrl,
  clearIdeLoginParams,
  loadIdeLoginParams,
  parseIdeLoginParams,
  requestIdeCode,
  saveIdeLoginParams,
} from './ideLogin'

describe('ideLogin yardımcıları', () => {
  const validState = 'aB0_-'.repeat(8) // 40 karakter

  it('geçerli ide_giris ve port parametrelerini ayrıştırır', () => {
    expect(parseIdeLoginParams(`?ide_giris=${validState}&port=45123`)).toEqual({
      state: validState,
      port: 45123,
    })
    expect(parseIdeLoginParams(`?ide_giris=${validState}&port=1024`)).toEqual({
      state: validState,
      port: 1024,
    })
    expect(parseIdeLoginParams(`?ide_giris=${validState}&port=65535`)).toEqual({
      state: validState,
      port: 65535,
    })
  })

  it('geçersiz port sınırlarını ve biçimlerini reddeder', () => {
    expect(parseIdeLoginParams(`?ide_giris=${validState}&port=1023`)).toBeNull()
    expect(parseIdeLoginParams(`?ide_giris=${validState}&port=65536`)).toBeNull()
    expect(parseIdeLoginParams(`?ide_giris=${validState}&port=80`)).toBeNull()
    expect(parseIdeLoginParams(`?ide_giris=${validState}&port=0`)).toBeNull()
    expect(parseIdeLoginParams(`?ide_giris=${validState}&port=-3000`)).toBeNull()
    expect(parseIdeLoginParams(`?ide_giris=${validState}&port=3000.5`)).toBeNull()
    expect(parseIdeLoginParams(`?ide_giris=${validState}&port=3000abc`)).toBeNull()
    expect(parseIdeLoginParams(`?ide_giris=${validState}`)).toBeNull()
  })

  it('kısa, uzun veya yasak karakterli state değerlerini reddeder', () => {
    expect(parseIdeLoginParams('?ide_giris=kisa&port=4000')).toBeNull()
    expect(parseIdeLoginParams(`?ide_giris=${'x'.repeat(31)}&port=4000`)).toBeNull()
    expect(parseIdeLoginParams(`?ide_giris=${'x'.repeat(201)}&port=4000`)).toBeNull()
    expect(parseIdeLoginParams(`?ide_giris=${'x'.repeat(32)}!@&port=4000`)).toBeNull()
    expect(parseIdeLoginParams('?port=4000')).toBeNull()
    expect(parseIdeLoginParams('')).toBeNull()
  })

  it('callback adresini yalnızca 127.0.0.1 üzerinde ve URLSearchParams ile kodlayarak üretir', () => {
    const url = buildCallbackUrl({
      port: 51234,
      code: 'code_123+abc',
      state: validState,
    })
    const parsed = new URL(url)
    expect(parsed.protocol).toBe('http:')
    expect(parsed.hostname).toBe('127.0.0.1')
    expect(parsed.port).toBe('51234')
    expect(parsed.pathname).toBe('/callback')
    expect(parsed.searchParams.get('code')).toBe('code_123+abc')
    expect(parsed.searchParams.get('state')).toBe(validState)

    expect(() => buildCallbackUrl({ port: 80, code: 'abc', state: validState })).toThrow()
    expect(() => buildCallbackUrl({ port: 70000, code: 'abc', state: validState })).toThrow()
  })

  it('requestIdeCode POST /ide/auth/code çağırır ve hata durumunda fırlatır', async () => {
    const okFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'generated-code-123' }),
    })

    const res = await requestIdeCode({
      state: validState,
      authFetch: okFetch,
      apiBase: 'https://api.kocamind.com/',
    })
    expect(res).toEqual({ code: 'generated-code-123' })
    expect(okFetch).toHaveBeenCalledWith('https://api.kocamind.com/ide/auth/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: validState }),
    })

    const failFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Geçersiz istek.' } }),
    })
    await expect(
      requestIdeCode({ state: validState, authFetch: failFetch, apiBase: 'https://api.kocamind.com' })
    ).rejects.toThrow('Geçersiz istek.')
  })

  function createMemoryStorage() {
    const map = new Map()
    return {
      getItem: vi.fn((k) => (map.has(k) ? map.get(k) : null)),
      setItem: vi.fn((k, v) => map.set(k, String(v))),
      removeItem: vi.fn((k) => map.delete(k)),
    }
  }

  it('saveIdeLoginParams ve loadIdeLoginParams gecerli parametreleri saklar ve yukler', () => {
    const storage = createMemoryStorage()
    const now = () => 1_000_000
    saveIdeLoginParams({ state: validState, port: 45123 }, storage, now)
    expect(loadIdeLoginParams(storage, () => 1_000_000 + 60_000)).toEqual({
      state: validState,
      port: 45123,
    })
  })

  it('10 dakikadan eski kaydi siler ve null dondurur', () => {
    const storage = createMemoryStorage()
    saveIdeLoginParams({ state: validState, port: 45123 }, storage, () => 1_000_000)
    const tenMinLater = 1_000_000 + 10 * 60 * 1000 + 1
    expect(loadIdeLoginParams(storage, () => tenMinLater)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith('kocamind_ide_login')
  })

  it('bozuk JSON veya gecersiz port iceren kayitta null dondurur ve siler', () => {
    const storage = createMemoryStorage()
    storage.setItem('kocamind_ide_login', '{bozuk-json')
    expect(loadIdeLoginParams(storage, () => 1_000_000)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith('kocamind_ide_login')

    storage.removeItem.mockClear()
    storage.setItem(
      'kocamind_ide_login',
      JSON.stringify({ state: validState, port: 80, savedAt: 1_000_000 })
    )
    expect(loadIdeLoginParams(storage, () => 1_000_000)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith('kocamind_ide_login')
  })

  it('clearIdeLoginParams kaydi temizler', () => {
    const storage = createMemoryStorage()
    saveIdeLoginParams({ state: validState, port: 45123 }, storage, () => 1_000_000)
    clearIdeLoginParams(storage)
    expect(storage.removeItem).toHaveBeenCalledWith('kocamind_ide_login')
    expect(loadIdeLoginParams(storage, () => 1_000_000)).toBeNull()
  })
})
