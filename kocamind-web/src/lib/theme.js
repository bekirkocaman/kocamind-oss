// Renk modu: 'system' işletim sisteminin tercihini izler (Android'deki Sistem / Açık / Koyu).
export const THEME_OPTIONS = [
  { id: 'system', label: 'Sistem' },
  { id: 'light', label: 'Açık' },
  { id: 'dark', label: 'Koyu' },
]

export function resolveTheme(mode, prefersLight) {
  if (mode === 'light' || mode === 'dark') return mode
  if (mode === 'system') return prefersLight ? 'light' : 'dark'
  return 'dark'
}

export function themeLabel(mode) {
  return THEME_OPTIONS.find(option => option.id === mode)?.label || 'Koyu'
}
