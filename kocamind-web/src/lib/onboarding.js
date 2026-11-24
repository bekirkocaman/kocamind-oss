import { loadSetting, saveSetting } from './settingsStorage'

export const ONBOARDING_VERSION = 1
export const ONBOARDING_STORAGE_KEY = 'onboarding'

function onboardingKey(uid, version) {
  return `${ONBOARDING_STORAGE_KEY}:${uid}:${version}`
}

function readStoredPrefs(key, storage) {
  if (storage) {
    try {
      const raw = storage.getItem(`kocamind_${key}`)
      return raw !== null ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }
  return loadSetting(key, null)
}

function writeStoredPrefs(key, value, storage) {
  if (storage) {
    try {
      storage.setItem(`kocamind_${key}`, JSON.stringify(value))
    } catch {
      /* depolama kapalı ya da dolu */
    }
    return
  }
  saveSetting(key, value)
}

/**
 * Web arayüzünde giriş yapmamış (misafir) kullanıcılar AuthGate görür;
 * onboarding yalnızca oturum açmış ve güncel sürümü tamamlamamış/atlamamış kullanıcılara gösterilir.
 */
export function shouldShowOnboarding({ user, prefs, version = ONBOARDING_VERSION, storage } = {}) {
  if (!user?.uid) return false
  const resolved = prefs !== undefined ? prefs : readStoredPrefs(onboardingKey(user.uid, version), storage)
  const seenVersion = typeof resolved?.onboardingVersion === 'number' ? resolved.onboardingVersion : 0
  return seenVersion < version
}

export function markOnboardingDone(prefs, { user, version = ONBOARDING_VERSION, storage } = {}) {
  const base = prefs && typeof prefs === 'object' ? prefs : {}
  const next = {
    ...base,
    onboardingVersion: version,
    completedAt: Date.now(),
  }
  if (user?.uid) writeStoredPrefs(onboardingKey(user.uid, version), next, storage)
  return next
}
