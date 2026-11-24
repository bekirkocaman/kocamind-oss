// Emülatör yardımcıları: temizleme, doğrulanmış kullanıcı açma, Firestore okuma, giriş.
import { expect } from '@playwright/test'

const PROJECT = 'demo-kocamind'
const AUTH = 'http://127.0.0.1:9099'
const FIRESTORE = 'http://127.0.0.1:8080'
// Emülatörde "owner" token'ı güvenlik kurallarını atlar (yalnızca yerel emülatör).
const OWNER = { Authorization: 'Bearer owner' }

export async function resetEmulators() {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
}

let counter = 0
export async function createVerifiedUser(name = 'Test') {
  counter += 1
  const email = `e2e-${Date.now()}-${counter}@test.local`
  const password = 'sifre-123456'
  const signUp = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: name, returnSecureToken: true }),
  }).then(r => r.json())
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...OWNER },
    body: JSON.stringify({ localId: signUp.localId, emailVerified: true }),
  })
  return { uid: signUp.localId, email, password }
}

// users/{uid}/chats belgeleri (REST biçiminden sade nesneye).
export async function cloudChats(uid) {
  const data = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}/chats`, { headers: OWNER }).then(r => r.json())
  return (data.documents || []).map(doc => ({ id: doc.name.split('/').pop(), fields: doc.fields }))
}

export async function cloudDoc(path) {
  const res = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: OWNER })
  return res.ok ? res.json() : null
}

// Sahte modelin döndürdüğü DeepSeek modeli seçili gelsin (tek seferlik model geçişleri atlanır).
export async function preferFakeModel(page) {
  await page.addInitScript(() => {
    localStorage.setItem('kocamind_model', JSON.stringify({ id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek V3' }))
    localStorage.setItem('kocamind_openai_56_migrated', '1')
    localStorage.setItem('kocamind_claude_migrated', '1')
  })
}

// Android giriş akışı: karşılama ekranından "E-posta ile devam et", sonra form.
export async function fillLogin(page, user) {
  await page.getByRole('button', { name: 'E-posta ile devam et' }).click()
  await page.getByRole('textbox', { name: 'E-posta' }).fill(user.email)
  await page.getByLabel('Şifre', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Giriş Yap', exact: true }).click()
}

export async function login(page, user) {
  await preferFakeModel(page)
  await page.goto('/')
  await fillLogin(page, user)
  await expect(page.getByRole('textbox', { name: 'Mesajını yaz' })).toBeVisible({ timeout: 20000 })
}

export async function sendMessage(page, text) {
  const box = page.getByRole('textbox', { name: 'Mesajını yaz' })
  await box.fill(text)
  await box.press('Enter')
}
