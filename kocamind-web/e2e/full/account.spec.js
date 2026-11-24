import { test, expect } from '@playwright/test'
import { cloudDoc, createVerifiedUser, fillLogin, login } from './helpers'

test('hesap silme talebi hesabı kilitler; giriş yapınca geri alınabilir', async ({ page }) => {
  const user = await createVerifiedUser()
  await login(page, user)

  // Klon düzeni: çekmecedeki profil yuvarlağı Ayarlar'ı açar; hesap silme Profil'de, "SİL" yazılarak onaylanır.
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await page.getByRole('navigation', { name: 'Ayar bölümleri' }).getByRole('button', { name: 'Profil', exact: true }).click()
  await page.getByRole('button', { name: /^Hesabı sil/ }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByRole('button', { name: 'Hesabı sil' })).toBeDisabled()
  await dialog.getByLabel('Onay kelimesi').fill('sil')
  await dialog.getByRole('button', { name: 'Hesabı sil' }).click()

  // Talep sonrası oturum kapanır; silme kaydı backend'de durur.
  await expect(page.getByRole('button', { name: 'E-posta ile devam et' })).toBeVisible({ timeout: 20000 })
  await expect.poll(async () => Boolean(await cloudDoc(`account_deletions/${user.uid}`)), { timeout: 15000 }).toBe(true)

  // Tekrar girişte kilit ekranı; geri alınca hesap açılır, kayıt silinir.
  await fillLogin(page, user)
  await expect(page.getByRole('heading', { name: 'Hesabın silinmeye planlandı' })).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: 'Hesabımı geri al' }).click()
  await expect(page.getByRole('textbox', { name: 'Mesajını yaz' })).toBeVisible({ timeout: 20000 })
  expect(await cloudDoc(`account_deletions/${user.uid}`)).toBeNull()
})
