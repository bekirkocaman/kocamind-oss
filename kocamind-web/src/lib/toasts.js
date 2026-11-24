// useToasts'un saf kısmı: aynı bildirim tekrar eklenmez, en fazla 5 tutulur.
export function addToast(prev, toast) {
  if (prev.some(t => t.message === toast.message && t.type === toast.type)) return prev
  const next = [...prev, toast]
  return next.length > 5 ? next.slice(-5) : next
}

// Eylemli bildirim ("Geri al") okunup basılabilsin diye hata bildirimi kadar kalır.
export function toastDuration(type, action) {
  return type === 'error' || action ? 6000 : 3500
}
