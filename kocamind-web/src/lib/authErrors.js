// Giriş hatalarının kullanıcıya gösterilen Türkçe karşılıkları (Android AuthViewModel metinleriyle uyumlu).
const MESSAGES = {
  'auth/user-not-found': 'Bu e-posta ile kayıtlı hesap yok.',
  'auth/wrong-password': 'Şifre yanlış.',
  'auth/invalid-credential': 'E-posta veya şifre hatalı.',
  'auth/email-already-in-use': 'Bu e-posta zaten kullanımda.',
  'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
  'auth/invalid-email': 'Geçersiz e-posta adresi.',
  'auth/too-many-requests': 'Çok fazla deneme yaptın. Biraz bekleyip tekrar dene.',
  'auth/network-request-failed': 'Bağlantı hatası. İnternetini kontrol et.',
  'auth/popup-closed-by-user': 'Giriş penceresi kapatıldı.',
  'auth/popup-blocked': 'Açılır pencere engellendi. Tarayıcının açılır pencere iznini kontrol et.',
  'auth/account-exists-with-different-credential': 'Bu e-posta başka bir yöntemle kayıtlı.',
  'auth/unauthorized-domain': 'Bu adresten giriş yapılamıyor. kocamind.com üzerinden dene.',
  'google/popup_closed': 'Google giriş penceresi kapatıldı.',
  'google/popup_failed_to_open': 'Google giriş penceresi açılamadı. Tarayıcının bu site için açılır pencere iznini kontrol edip tekrar dene.',
}

export function authErrorMessage(error) {
  return MESSAGES[error?.code] || error?.message || 'Bir hata oluştu, tekrar dene.'
}

export function validateAuthForm({ tab, name, email, password }) {
  if (tab === 'register' && !name.trim()) return 'Adını yaz.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Geçerli bir e-posta adresi yaz.'
  if (password.length < 6) return 'Şifre en az 6 karakter olmalı.'
  return null
}
