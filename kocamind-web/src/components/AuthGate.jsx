import { useEffect, useId, useState } from 'react'
import {
  IconBack,
  IconHidePassword,
  IconLock,
  IconMail,
  IconProfile,
  IconShowPassword,
  IconVerifyMail,
} from './icons.jsx'
import {
  auth, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile,
  sendPasswordResetEmail, sendEmailVerification,
} from '../lib/firebase'
import { preloadGoogleIdentity, signInWithGoogleIdentity } from '../lib/googleIdentity'
import { authErrorMessage, validateAuthForm } from '../lib/authErrors'
import { LogoMark } from './chat/LogoMark'
import './AuthGate.css'

const GOOGLE_G = (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
  </svg>
)

// Android AuthScreen: önce sade karşılama (işaret, isim, Google ve e-posta düğmeleri);
// e-posta formu yalnızca istenince açılır. Doğrulama maili gönderilince ayrı bir ekran gösterilir.
export default function AuthGate() {
  const errorId = useId()
  const [view, setView] = useState('welcome')
  const [tab, setTab] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => { preloadGoogleIdentity() }, [])

  const google = async () => {
    setBusy('google')
    setError('')
    try {
      await signInWithGoogleIdentity()
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    const problem = validateAuthForm({ tab, name, email, password })
    if (problem) { setError(problem); return }
    setBusy('email')
    setError('')
    setNotice('')
    try {
      if (tab === 'login') {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await updateProfile(cred.user, { displayName: name.trim() })
        try { await sendEmailVerification(cred.user) } catch { /* mail gönderilemese de hesap açıldı */ }
        setView('verify')
      }
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const reset = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Şifre sıfırlama için önce e-posta adresini yaz.'); return }
    setBusy('reset')
    setError('')
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setNotice('Şifre sıfırlama bağlantısı e-posta adresine gönderildi. Gelen kutunu (veya Spam klasörünü) kontrol et.')
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const selectTab = (next) => { setTab(next); setError(''); setNotice('') }

  if (view === 'verify') {
    return (
      <main className="auth-screen">
        <div className="auth-verify">
          <span className="auth-verify-icon"><IconVerifyMail size={40} /></span>
          <h1>E-postanı kontrol et</h1>
          <p><strong>{email.trim()}</strong><br />adresine doğrulama bağlantısı gönderdik.<br />Mailine tıkladıktan sonra giriş yapabilirsin.</p>
          <button type="button" className="auth-btn primary" onClick={() => { setView('email'); selectTab('login') }}>Giriş Yap</button>
        </div>
      </main>
    )
  }

  if (view === 'welcome') {
    return (
      <main className="auth-screen auth-welcome-screen">
        <div className="auth-welcome-body">
          <div className="auth-welcome-center">
            <LogoMark size={40} state="think" label="KocaMind" />
            <h1 className="auth-brand">KocaMind</h1>
          </div>
          <div className="auth-welcome-actions">
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="button" className="auth-btn secondary" onClick={google} disabled={busy === 'google'}>
              {busy === 'google' ? <span className="auth-spinner" aria-hidden="true" /> : GOOGLE_G}
              Google ile devam et
            </button>
            <button type="button" className="auth-btn ghost" onClick={() => { setView('email'); setError('') }}>
              <IconMail size={18} /> E-posta ile devam et
            </button>
            <p className="auth-terms">
              Devam ederek <a href="/terms.html">Kullanım Koşulları</a>'nı ve <a href="/privacy.html">Gizlilik Politikası</a>'nı kabul edersin.
            </p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="auth-screen auth-form-screen">
      <header className="auth-back-row">
        <button type="button" className="auth-back" onClick={() => { setView('welcome'); setError(''); setNotice('') }} aria-label="Geri dön">
          <IconBack size={22} />
        </button>
      </header>
      <div className="auth-form-body">
        <div className="auth-heading">
          <h1>{tab === 'login' ? 'E-posta ile giriş' : 'Hesap oluştur'}</h1>
          <p>{tab === 'login' ? 'E-postan ve şifrenle giriş yap.' : 'Birkaç saniyede hesabını oluştur.'}</p>
        </div>

        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'login'} onClick={() => selectTab('login')}>Giriş Yap</button>
          <button type="button" role="tab" aria-selected={tab === 'register'} onClick={() => selectTab('register')}>Kayıt Ol</button>
        </div>

        <form className="auth-fields" onSubmit={submit} noValidate>
          {tab === 'register' && (
            <label className="auth-field">
              <span>Ad Soyad</span>
              <span className={`auth-input${error ? ' is-invalid' : ''}`}><IconProfile size={18} /><input type="text" autoComplete="name" placeholder="Adınızı girin" aria-label="Ad Soyad" aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} value={name} onChange={e => { setName(e.target.value); setError('') }} /></span>
            </label>
          )}
          <label className="auth-field">
            <span>E-posta</span>
            <span className={`auth-input${error ? ' is-invalid' : ''}`}><IconMail size={18} /><input type="email" autoComplete="email" placeholder="ornek@gmail.com" aria-label="E-posta" aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} value={email} onChange={e => { setEmail(e.target.value); setError('') }} /></span>
          </label>
          <label className="auth-field">
            <span>Şifre</span>
            <span className={`auth-input${error ? ' is-invalid' : ''}`}>
              <IconLock size={18} />
              <input type={showPassword ? 'text' : 'password'} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} placeholder="En az 6 karakter" aria-label="Şifre" aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} value={password} onChange={e => { setPassword(e.target.value); setError('') }} />
              <button type="button" className="auth-eye" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}>
                {showPassword ? <IconHidePassword size={18} /> : <IconShowPassword size={18} />}
              </button>
            </span>
          </label>
          {tab === 'login' && (
            <button type="button" className="auth-forgot" onClick={reset} disabled={busy === 'reset'}>Şifremi Unuttum</button>
          )}
          {error && <p id={errorId} className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <button type="submit" className="auth-btn primary" disabled={busy === 'email'}>
            {busy === 'email' && <span className="auth-spinner" aria-hidden="true" />}
            {tab === 'login' ? 'Giriş Yap' : 'Hesap Oluştur'}
          </button>
        </form>
      </div>
    </main>
  )
}
