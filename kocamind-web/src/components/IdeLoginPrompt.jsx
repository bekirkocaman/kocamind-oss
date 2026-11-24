import { useEffect, useState } from 'react'
import {
  buildCallbackUrl,
  clearIdeLoginParams,
  loadIdeLoginParams,
  parseIdeLoginParams,
  requestIdeCode,
  saveIdeLoginParams,
} from '../lib/ideLogin'
import './Dialogs.css'

export default function IdeLoginPrompt({ user, authFetch, apiBase }) {
  const [params, setParams] = useState(() => {
    if (typeof window === 'undefined') return null
    const fromUrl = parseIdeLoginParams(window.location.search)
    if (fromUrl) {
      saveIdeLoginParams(fromUrl)
      return fromUrl
    }
    return loadIdeLoginParams()
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!params || typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.has('ide_giris') || url.searchParams.has('port')) {
      url.searchParams.delete('ide_giris')
      url.searchParams.delete('port')
      const nextUrl = `${url.pathname}${url.search}${url.hash}`
      window.history.replaceState(window.history.state, '', nextUrl)
    }
  }, [params])

  if (!params) return null

  if (!user) {
    return (
      <div className="ide-login-notice" role="status">
        IDE&apos;ye bağlanmak için önce giriş yap.
      </div>
    )
  }

  const email = user.email || user.displayName || 'KocaMind'

  const handleConnect = async () => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const { code } = await requestIdeCode({
        state: params.state,
        authFetch,
        apiBase,
      })
      clearIdeLoginParams()
      window.location.href = buildCallbackUrl({
        port: params.port,
        code,
        state: params.state,
      })
    } catch {
      setError('Bağlanamadı, tekrar dene.')
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    if (submitting) return
    clearIdeLoginParams()
    setParams(null)
    setError('')
  }

  return (
    <div className="km-dialog-overlay" onClick={handleCancel}>
      <div
        className="km-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ide-login-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="ide-login-dialog-title">KocaMind IDE&apos;ye bağlanılsın mı?</h2>
        <p>Bu bilgisayardaki KocaMind IDE, {email} hesabıyla giriş yapacak.</p>
        {error && (
          <p className="km-dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="km-dialog-actions">
          <button
            type="button"
            className="km-dialog-btn"
            onClick={handleCancel}
            disabled={submitting}
          >
            Vazgeç
          </button>
          <button
            type="button"
            className="km-dialog-btn primary"
            onClick={handleConnect}
            disabled={submitting}
          >
            Bağla
          </button>
        </div>
      </div>
    </div>
  )
}
