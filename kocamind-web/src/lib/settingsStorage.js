

export function loadSetting(key, fallback) {
  try { const v = localStorage.getItem(`kocamind_${key}`); return v !== null ? JSON.parse(v) : fallback }
  catch { return fallback }
}

export function saveSetting(key, value) {
  try { localStorage.setItem(`kocamind_${key}`, JSON.stringify(value)) } catch { /* kota */ }
}
