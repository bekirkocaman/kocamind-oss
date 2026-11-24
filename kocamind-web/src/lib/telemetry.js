import { API, authFetch } from './api'

const release = import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || import.meta.env.MODE || 'local'

export function reportClientError(error, context = {}) {
  const payload = {
    message: error?.message || String(error || 'Bilinmeyen hata'),
    stack: error?.stack || '',
    componentStack: context.componentStack || '',
    url: window.location.origin + window.location.pathname,
    userAgent: navigator.userAgent,
    release,
  }
  authFetch(API.telemetryError, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {})
}

export function trackEvent(event, properties = {}) {
  authFetch(API.telemetryEvent, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, properties }),
    keepalive: true,
  }).catch(() => {})
}

export function installGlobalErrorTracking() {
  const onError = event => reportClientError(event.error || new Error(event.message || 'Pencere hatası'))
  const onRejection = event => reportClientError(
    event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Promise hatası'))
  )
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
