import { useCallback, useState } from 'react'
import { addToast, toastDuration } from '../lib/toasts'

export function useToasts() {
  const [toasts, setToasts] = useState([])

  // action: { label, onClick } — bildirimde düğme olarak görünür ("Geri al").
  const showToast = useCallback((message, type = 'info', action) => {
    const id = Date.now() + Math.random()
    setToasts(prev => addToast(prev, { id, message, type, action }))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), toastDuration(type, action))
  }, [])

  const dismissToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  return { toasts, showToast, dismissToast }
}
