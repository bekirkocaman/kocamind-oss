import { auth } from './firebase'
import { signInWithGoogleIdentity } from './googleIdentity'

const STORAGE_KEY = 'kocamind_gmail_session'

export function loadGmailConnection() {
  try {
    const connection = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null')
    if (!connection?.accessToken || Number(connection.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return connection
  } catch { return null }
}

export async function connectGmailAccount() {
  const user = auth.currentUser
  if (!user) throw new Error('Önce KocaMind hesabına giriş yapmalısın.')

  const { result, accessToken, expiresIn } = await signInWithGoogleIdentity({
    gmail: true,
    hint: user.email || '',
  })
  return saveGmailConnection(result, accessToken, expiresIn)
}

export function saveGmailConnection(result, accessToken, expiresIn = 3600) {
  if (!accessToken) throw new Error('Google, Gmail erişim izni vermedi.')

  const connection = {
    accessToken,
    email: result.user.email || auth.currentUser?.email || '',
    expiresAt: Date.now() + Math.max(60, Number(expiresIn) - 300) * 1000,
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(connection))
  return connection
}

export function disconnectGmailAccount() {
  sessionStorage.removeItem(STORAGE_KEY)
}
