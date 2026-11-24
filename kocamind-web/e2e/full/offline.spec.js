import { test, expect } from '@playwright/test'
import { createVerifiedUser, login, sendMessage } from './helpers'

test('bağlantı kesikken yazılan mesaj kuyruğa alınır, bağlantı gelince gönderilir', async ({ page, context }) => {
  const user = await createVerifiedUser()
  await login(page, user)
  await context.setOffline(true)
  await sendMessage(page, 'Çevrimdışı yazdım')
  await expect(page.getByText('İnternet gelince mesajın otomatik gönderilecek.')).toBeVisible()
  await expect(page.getByRole('main').getByText('Merhaba, ben test modeliyim.')).toHaveCount(0)

  await context.setOffline(false)
  await expect(page.getByRole('main').getByText('Merhaba, ben test modeliyim.')).toBeVisible({ timeout: 20000 })
})
