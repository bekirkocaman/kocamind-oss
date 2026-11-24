import { GoogleAuthProvider, signInWithCredential, signInWithCustomToken } from 'firebase/auth'
import { auth } from './firebase'
import { API } from './api'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID
  || '956051927831-jmel0ke1knjvenfemc1bmd0o1dg15k9l.apps.googleusercontent.com'
const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client'
const BASE_SCOPES = 'openid email profile'
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const FIREBASE_FALLBACK_CODES = new Set([
  'auth/internal-error',
  'auth/invalid-credential',
  'auth/operation-not-allowed',
])

let scriptPromise

function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT}"]`)
    const script = existing || document.createElement('script')
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google giriş servisi yüklenemedi.'))
    if (!existing) {
      script.src = GOOGLE_SCRIPT
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  })
  return scriptPromise
}

async function signInThroughBackend(accessToken) {
  const response = await fetch(API.googleAuth, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.customToken) {
    throw new Error(data.error || 'Google oturumu sunucuda tamamlanamadı.')
  }
  return signInWithCustomToken(auth, data.customToken)
}

// Giriş ekranı açılınca betik önceden yüklenir; tıklamadan sonra yüklenirse tarayıcı açılır pencereyi engelleyebiliyor.
export function preloadGoogleIdentity() {
  return loadGoogleIdentity().catch(() => {})
}

export async function signInWithGoogleIdentity({ gmail = false, hint = '' } = {}) {
  await loadGoogleIdentity()

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: gmail ? `${BASE_SCOPES} ${GMAIL_SCOPE}` : BASE_SCOPES,
      hint: hint || undefined,
      include_granted_scopes: true,
      callback: async (tokenResponse) => {
        if (tokenResponse?.error || !tokenResponse?.access_token) {
          reject(new Error(tokenResponse?.error_description || tokenResponse?.error || 'Google erişim izni alınamadı.'))
          return
        }

        try {
          const credential = GoogleAuthProvider.credential(null, tokenResponse.access_token)
          let result
          try {
            result = await signInWithCredential(auth, credential)
          } catch (firebaseError) {
            if (!FIREBASE_FALLBACK_CODES.has(firebaseError?.code)) throw firebaseError
            result = await signInThroughBackend(tokenResponse.access_token)
          }
          resolve({
            result,
            accessToken: tokenResponse.access_token,
            expiresIn: Number(tokenResponse.expires_in) || 3600,
          })
        } catch (error) {
          reject(error)
        }
      },
      error_callback: (error) => {
        const message = error?.type === 'popup_closed'
          ? 'Google giriş penceresi kapatıldı.'
          : 'Google giriş penceresi açılamadı.'
        reject(Object.assign(new Error(message), { code: `google/${error?.type || 'popup_error'}` }))
      },
    })

    tokenClient.requestAccessToken({ prompt: gmail ? 'consent' : 'select_account' })
  })
}
