import { describe, expect, it } from 'vitest'
import { authErrorMessage, validateAuthForm } from './authErrors'

describe('authErrorMessage', () => {
  it('bilinen kodlar Türkçe, ham kod gösterilmez', () => {
    expect(authErrorMessage({ code: 'google/popup_failed_to_open' })).toMatch(/açılamadı/)
    expect(authErrorMessage({ code: 'auth/invalid-credential' })).toBe('E-posta veya şifre hatalı.')
    expect(authErrorMessage({})).toBe('Bir hata oluştu, tekrar dene.')
  })
})

describe('validateAuthForm', () => {
  it('kayıtta ad, her durumda e-posta ve şifre denetlenir', () => {
    expect(validateAuthForm({ tab: 'register', name: ' ', email: 'a@b.co', password: '123456' })).toBe('Adını yaz.')
    expect(validateAuthForm({ tab: 'login', name: '', email: 'yanlis', password: '123456' })).toMatch(/e-posta/)
    expect(validateAuthForm({ tab: 'login', name: '', email: 'a@b.co', password: '123' })).toMatch(/6 karakter/)
    expect(validateAuthForm({ tab: 'login', name: '', email: ' a@b.co ', password: '123456' })).toBeNull()
  })
})
