import { test, expect } from '@playwright/test'
import { cloudChats, createVerifiedUser, login, resetEmulators, sendMessage } from './helpers'

test.beforeAll(resetEmulators)

test('giriş yapmış kullanıcı sohbet eder; sohbet ortak şemayla buluta yazılır', async ({ page }) => {
  const user = await createVerifiedUser()
  await login(page, user)
  await sendMessage(page, 'Merhaba, nasılsın?')
  await expect(page.getByRole('main').getByText('Merhaba, ben test modeliyim.')).toBeVisible({ timeout: 20000 })

  await expect.poll(async () => (await cloudChats(user.uid)).length, { timeout: 15000 }).toBe(1)
  const [chat] = await cloudChats(user.uid)
  const messages = chat.fields.messages.arrayValue.values.map(v => v.mapValue.fields)
  expect(messages.map(m => m.role.stringValue)).toEqual(['user', 'ai'])
  expect(messages[0].content.stringValue).toBe('Merhaba, nasılsın?')
  // Ortak şema: her mesajda kimlik ve milisaniye zaman.
  for (const m of messages) {
    expect(m.id.stringValue).toBeTruthy()
    expect(Number(m.timestamp.integerValue ?? m.timestamp.doubleValue)).toBeGreaterThan(0)
  }
})

test('düşünen modelde düşünme penceresi açılır, cevap gelince "N saniye düşündü" olarak kapanır', async ({ page }) => {
  const user = await createVerifiedUser()
  await login(page, user)
  await sendMessage(page, '[düşün] Selam')
  const main = page.getByRole('main')
  await expect(main.getByText('Düşünüyor')).toBeVisible({ timeout: 20000 })
  await expect(main.getByText('Kullanıcı selam veriyor.', { exact: false })).toBeVisible()
  await expect(main.getByText('Merhaba, ben test modeliyim.')).toBeVisible({ timeout: 20000 })
  const done = main.getByRole('button', { name: /saniye düşündü/ })
  await expect(done).toBeVisible()
  await expect(done).toHaveAttribute('aria-expanded', 'false')
  await done.click()
  await expect(done).toHaveAttribute('aria-expanded', 'true')
})
