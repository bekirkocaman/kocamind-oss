import { useId, useState } from 'react'
import { IconBack, IconClose, IconHidePassword, IconLock, IconMail, IconProfile, IconShowPassword } from './icons.jsx'
import {
  auth, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile,
  sendPasswordResetEmail, sendEmailVerification,
} from '../lib/firebase'
import { signInWithGoogleIdentity } from '../lib/googleIdentity'
import { authErrorMessage } from '../lib/authErrors'
import './AuthModal.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ERROR_MAP = {
  'auth/user-not-found': 'Bu email kayıtlı değil.',
  'auth/wrong-password': 'Şifre yanlış.',
  'auth/email-already-in-use': 'Bu email zaten kullanımda.',
  'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
  'auth/invalid-email': 'Geçersiz email adresi.',
  'auth/invalid-credential': 'Email veya şifre hatalı.',
  'auth/too-many-requests': 'Çok fazla deneme yaptın. Biraz bekle.',
  'auth/network-request-failed': 'Bağlantı hatası. İnternetini kontrol et.',
  'auth/popup-closed-by-user': 'Giriş penceresi kapatıldı.',
  'auth/popup-blocked': 'Açılır pencere engellendi. Tarayıcı ayarlarını kontrol et.',
  'auth/account-exists-with-different-credential': 'Bu email başka bir yöntemle kayıtlı.',
}

export default function AuthModal({ onClose, dismissible = true }) {
  const errorId = useId()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [verifySent, setVerifySent] = useState(false)

  const clearError = () => setError('')

  const handleGoogle = async () => {
    setLoading(true)
    setError('')
    try {
      await signInWithGoogleIdentity()
      onClose()
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const handleEmailAuth = async (e) => {
    e.preventDefault()
    if (!email || !password) return
    if (!EMAIL_RE.test(email)) { setError('Geçerli bir email adresi gir.'); return }
    if (password.length < 6) { setError('Şifre en az 6 karakter olmalı.'); return }
    setLoading(true)
    setError('')
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        if (!displayName.trim()) { setError('İsim gerekli.'); setLoading(false); return }
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(cred.user, { displayName: displayName.trim() })
        try { await sendEmailVerification(cred.user) } catch { /* yoksay */ }
        setVerifySent(true)
        setError('')
        return
      }
      onClose()
    } catch (e) {
      setError(ERROR_MAP[e.code] || 'Bir hata oluştu: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!email || !EMAIL_RE.test(email)) { setError('Şifre sıfırlama için geçerli bir email gir.'); return }
    setLoading(true)
    setError('')
    try {
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
      setError('')
    } catch (e) {
      setError(ERROR_MAP[e.code] || 'Şifre sıfırlama başarısız: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={dismissible ? 'auth-overlay' : 'auth-embedded'} onClick={dismissible ? onClose : undefined}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        {dismissible && (
          <button type="button" className="auth-close" onClick={onClose} title="Kapat" aria-label="Kapat">
            <IconClose size={18} />
          </button>
        )}

        {mode === 'reset' ? (
          <>
            <div className="auth-header">
              <button type="button" className="auth-back-btn" onClick={() => { setMode('login'); setResetSent(false); clearError() }} aria-label="Geri dön">
                <IconBack size={18} />
              </button>
              <h2 className="auth-title">Şifre Sıfırla</h2>
              <p className="auth-subtitle">
                {resetSent ? 'Email adresine sıfırlama linki gönderildi.' : 'Email adresini gir, sana sıfırlama linki gönderelim.'}
              </p>
            </div>

            {!resetSent && (
              <form className="auth-form" onSubmit={e => { e.preventDefault(); handleResetPassword() }}>
                <div className="auth-input-wrap">
                  <IconMail size={16} className="auth-input-icon" />
                  <input type="email" className={`auth-input${error ? ' is-invalid' : ''}`} placeholder="E-posta" aria-label="E-posta" aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} value={email} onChange={e => { setEmail(e.target.value); clearError() }} />
                </div>
                {error && <div id={errorId} className="auth-error" role="alert">{error}</div>}
                <button type="submit" className="auth-submit" disabled={loading || !email}>
                  {loading ? 'Gönderiliyor…' : 'Sıfırlama Linki Gönder'}
                </button>
              </form>
            )}

            <p className="auth-toggle">
              <button type="button" className="auth-toggle-btn" onClick={() => { setMode('login'); setResetSent(false); clearError() }}>
                Giriş sayfasına dön
              </button>
            </p>
          </>
        ) : verifySent ? (
          <div className="auth-header auth-verify-header">
            <h2 className="auth-title">Email Doğrulama</h2>
            <p className="auth-subtitle auth-verify-subtitle">
              {email} adresine doğrulama linki gönderdik. Lütfen gelen kutunu kontrol et.
            </p>
            <button type="button" className="auth-submit auth-submit-full" onClick={onClose}>
              Tamam
            </button>
          </div>
        ) : (
          <>
            <div className="auth-header">
              <div className="auth-logo-badge">
                <img src="/favicon.svg" alt="KocaMind" />
              </div>
              <h2 className="auth-title">
                {mode === 'login' ? 'Tekrar hoş geldin' : 'Hesap oluştur'}
              </h2>
              <p className="auth-subtitle">
                {mode === 'login' ? "KocaMind'e giriş yap" : 'KocaMind ailesine katıl'}
              </p>
            </div>

            <button type="button" className="auth-google-btn" onClick={handleGoogle} disabled={loading}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Google ile {mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}
            </button>

            <div className="auth-divider">
              <span className="auth-divider-line" />
              <span className="auth-divider-text">ya da</span>
              <span className="auth-divider-line" />
            </div>

            <form className="auth-form" onSubmit={handleEmailAuth}>
              {mode === 'register' && (
                <div className="auth-input-wrap">
                  <IconProfile size={16} className="auth-input-icon" />
                  <input type="text" className={`auth-input${error ? ' is-invalid' : ''}`} placeholder="Adın" aria-label="Adın" aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} value={displayName} onChange={e => { setDisplayName(e.target.value); clearError() }} />
                </div>
              )}

              <div className="auth-input-wrap">
                <IconMail size={16} className="auth-input-icon" />
                <input type="email" className={`auth-input${error ? ' is-invalid' : ''}`} placeholder="E-posta" aria-label="E-posta" aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} value={email} onChange={e => { setEmail(e.target.value); clearError() }} />
              </div>

              <div className="auth-input-wrap">
                <IconLock size={16} className="auth-input-icon" />
                <input type={showPass ? 'text' : 'password'} className={`auth-input auth-input-pass${error ? ' is-invalid' : ''}`} placeholder="Şifre" aria-label="Şifre" aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} value={password} onChange={e => { setPassword(e.target.value); clearError() }} />
                <button type="button" className="auth-eye-btn" onClick={() => setShowPass(v => !v)} title={showPass ? 'Şifreyi gizle' : 'Şifreyi göster'} aria-label={showPass ? 'Şifreyi gizle' : 'Şifreyi göster'}>
                  {showPass ? <IconHidePassword size={16} /> : <IconShowPassword size={16} />}
                </button>
              </div>

              {error && <div id={errorId} className="auth-error" role="alert">{error}</div>}

              <button type="submit" className="auth-submit" disabled={loading || !email || !password}>
                {loading ? 'Lütfen bekle…' : mode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur'}
              </button>
            </form>

            {mode === 'login' && (
              <button type="button" className="auth-forgot-btn" onClick={() => { setMode('reset'); clearError() }}>
                Şifremi unuttum
              </button>
            )}

            <p className="auth-toggle">
              {mode === 'login' ? 'Hesabın yok mu?' : 'Zaten hesabın var mı?'}
              {' '}
              <button type="button" className="auth-toggle-btn" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); clearError() }}>
                {mode === 'login' ? 'Kayıt ol' : 'Giriş yap'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
