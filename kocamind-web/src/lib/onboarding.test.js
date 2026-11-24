import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_VERSION,
  markOnboardingDone,
  shouldShowOnboarding,
} from './onboarding'

function createMemoryStorage(initial = {}) {
  const store = { ...initial }
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    },
    setItem(key, value) {
      store[key] = String(value)
    },
    _store: store,
  }
}

const SIGNED_IN_USER = { uid: 'user-1', email: 'test@kocamind.app' }
const OTHER_USER = { uid: 'user-10' }
const USER_STORAGE_KEY = `kocamind_${ONBOARDING_STORAGE_KEY}:${SIGNED_IN_USER.uid}:${ONBOARDING_VERSION}`

describe('shouldShowOnboarding', () => {
  it('misafir kullanıcıda (oturum yokken) göstermez', () => {
    expect(shouldShowOnboarding({ user: null, prefs: null })).toBe(false)
    expect(shouldShowOnboarding({ user: undefined, prefs: {} })).toBe(false)
    expect(shouldShowOnboarding({ user: {}, prefs: {} })).toBe(false)
    expect(shouldShowOnboarding()).toBe(false)
  })

  it('giriş yapmış ve daha önce tamamlamamış kullanıcıda gösterir', () => {
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, prefs: null })).toBe(true)
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, prefs: {} })).toBe(true)
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, prefs: { onboardingVersion: 0 } })).toBe(true)
  })

  it('güncel sürümü tamamlamış ya da geçmiş kullanıcıda göstermez', () => {
    expect(shouldShowOnboarding({
      user: SIGNED_IN_USER,
      prefs: { onboardingVersion: ONBOARDING_VERSION },
    })).toBe(false)

    expect(shouldShowOnboarding({
      user: SIGNED_IN_USER,
      prefs: { onboardingVersion: ONBOARDING_VERSION + 1 },
    })).toBe(false)
  })

  it('sürüm yükselince onboarding tekrar gösterilir', () => {
    const oldPrefs = { onboardingVersion: 1 }
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, prefs: oldPrefs, version: 1 })).toBe(false)
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, prefs: oldPrefs, version: 2 })).toBe(true)
  })

  it('depodan okurken kayıtlı sürümü dikkate alır', () => {
    const storage = createMemoryStorage()
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, storage })).toBe(true)

    markOnboardingDone(null, { user: SIGNED_IN_USER, storage })
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, storage })).toBe(false)
    expect(shouldShowOnboarding({ user: OTHER_USER, storage })).toBe(true)
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, storage, version: ONBOARDING_VERSION + 1 })).toBe(true)
  })

  it('hesap bilgisi olmayan eski tarayıcı kaydını kullanmaz', () => {
    const storage = createMemoryStorage({
      [`kocamind_${ONBOARDING_STORAGE_KEY}`]: JSON.stringify({ onboardingVersion: ONBOARDING_VERSION }),
    })
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, storage })).toBe(true)
    expect(shouldShowOnboarding({ user: OTHER_USER, storage })).toBe(true)
  })

  it('depolama okuma hatasında ya da bozuk JSON durumunda çökmez', () => {
    const brokenStorage = {
      getItem() {
        throw new Error('SecurityError')
      },
    }
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, storage: brokenStorage })).toBe(true)

    const corruptStorage = createMemoryStorage({
      [USER_STORAGE_KEY]: '{bozuk-json',
    })
    expect(shouldShowOnboarding({ user: SIGNED_IN_USER, storage: corruptStorage })).toBe(true)
  })
})

describe('markOnboardingDone', () => {
  it('mevcut tercihleri koruyarak sürümü kaydeder', () => {
    const storage = createMemoryStorage()
    const result = markOnboardingDone({ existing: true }, { user: SIGNED_IN_USER, storage })

    expect(result.existing).toBe(true)
    expect(result.onboardingVersion).toBe(ONBOARDING_VERSION)
    expect(typeof result.completedAt).toBe('number')

    const saved = JSON.parse(storage.getItem(USER_STORAGE_KEY))
    expect(saved.onboardingVersion).toBe(ONBOARDING_VERSION)
  })

  it('depolama yazma hatasında çökmez ve güncel nesneyi döner', () => {
    const fullStorage = {
      setItem() {
        throw new Error('QuotaExceededError')
      },
    }
    const result = markOnboardingDone({}, { user: SIGNED_IN_USER, storage: fullStorage })
    expect(result.onboardingVersion).toBe(ONBOARDING_VERSION)
  })
})
