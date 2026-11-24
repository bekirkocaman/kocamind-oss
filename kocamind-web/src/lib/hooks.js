import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Offline tespiti ───
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}

// ─── Debounce hook ───
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

// ─── Fetch with timeout ───
export function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  return fetch(url, { ...options, signal: controller.signal }).then(res => {
    clearTimeout(timeoutId)
    return res
  }).catch(err => {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError' && !options.signal?.aborted) {
      throw new Error('İstek zaman aşımına uğradı. Lütfen tekrar dene.')
    }
    throw err
  })
}

// ─── Idle detection (session timeout) ───
export function useIdleTimer({ timeout = 30 * 60 * 1000, onIdle }) {
  const timerRef = useRef(null)

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(onIdle, timeout)
  }, [timeout, onIdle])

  useEffect(() => {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, resetTimer))
    resetTimer()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      events.forEach(e => window.removeEventListener(e, resetTimer))
    }
  }, [resetTimer])

  return resetTimer
}

// ─── useDebouncedCallback (debounce edilmiş callback) ───
export function useDebouncedCallback(callback, delay = 300) {
  const timerRef = useRef(null)
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const debouncedFn = useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => callbackRef.current(...args), delay)
  }, [delay])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return debouncedFn
}
