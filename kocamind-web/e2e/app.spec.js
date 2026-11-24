import { test, expect } from '@playwright/test'

test('giriş yapmamış ziyaretçi yalnızca giriş ekranını görür', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/KocaMind/i)
  await expect(page.getByRole('button', { name: 'Google ile devam et' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Mesajını yaz' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Araç menüsünü aç' })).toHaveCount(0)
})

test('giriş ekranı kapatılamaz', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Google ile devam et' })).toBeVisible()
  await expect(page.getByTitle('Kapat')).toHaveCount(0)
  await page.mouse.click(5, 5)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Google ile devam et' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Mesajını yaz' })).toHaveCount(0)
})

test('kayıt ol ekranına geçilebilir', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'E-posta ile devam et' }).click()
  await page.getByRole('tab', { name: 'Kayıt Ol' }).click()
  await expect(page.getByRole('textbox', { name: 'Ad Soyad' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hesap Oluştur' })).toBeVisible()
})

test('gizlilik ve kullanım koşulları giriş yapmadan açılır', async ({ page }) => {
  for (const path of ['/privacy.html', '/terms.html']) {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('button', { name: 'Google ile devam et' })).toHaveCount(0)
  }
})
