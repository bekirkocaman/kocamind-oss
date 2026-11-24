import { test, expect } from '@playwright/test'
import { cloudChats, createVerifiedUser, login, sendMessage } from './helpers'

// İki cihaz: aynı hesapla açılmış iki ayrı tarayıcı bağlamı. Değişiklik gerçek zamanlı dinleyiciyle gelir.
test('bir cihazda başlayan sohbet ve silme öbür cihaza yenilemeden yansır', async ({ browser }) => {
  const user = await createVerifiedUser()
  const deviceA = await browser.newContext()
  const deviceB = await browser.newContext()
  const a = await deviceA.newPage()
  const b = await deviceB.newPage()
  await login(a, user)
  await login(b, user)

  await sendMessage(a, 'İki cihaz denemesi')
  await expect(a.getByRole('main').getByText('Merhaba, ben test modeliyim.')).toBeVisible({ timeout: 20000 })

  // B sayfayı yenilemeden sohbeti görür ve açınca mesajlar oradadır.
  const chatOnB = b.locator('.history-title')
  await expect(chatOnB).toHaveCount(1, { timeout: 20000 })
  await chatOnB.first().click()
  await expect(b.getByRole('main').getByText('İki cihaz denemesi')).toBeVisible()
  await expect(b.getByRole('main').getByText('Merhaba, ben test modeliyim.')).toBeVisible()

  // B'de silinen sohbet A'dan da kalkar ve geri gelmez.
  await chatOnB.first().hover()
  await b.getByTitle('Sohbeti Sil').click()
  await expect(a.locator('.history-title')).toHaveCount(0, { timeout: 20000 })
  await expect.poll(async () => (await cloudChats(user.uid)).length, { timeout: 15000 }).toBe(0)
  await a.reload()
  await expect(a.getByRole('textbox', { name: 'Mesajını yaz' })).toBeVisible({ timeout: 20000 })
  await expect(a.locator('.history-title')).toHaveCount(0)

  await deviceA.close()
  await deviceB.close()
})
