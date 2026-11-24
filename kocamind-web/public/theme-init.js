(function () {
  var root = document.documentElement
  var theme

  try {
    var stored = localStorage.getItem('kocamind_theme')
    if (stored === 'light' || stored === 'dark') theme = stored
    else if (stored === 'system') theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    else theme = 'dark'
  } catch {
    theme = 'dark'
  }

  var background = theme === 'light' ? '#f9f9f7' : '#151515'

  root.setAttribute('data-theme', theme)
  root.style.setProperty('--boot-bg', background)
  root.style.backgroundColor = background
  root.style.colorScheme = theme

  try {
    if (localStorage.getItem('kocamind_reply_font') === 'serif') root.setAttribute('data-reply-font', 'serif')
    else root.removeAttribute('data-reply-font')
    if (localStorage.getItem('kocamind_reduce_motion') === '1') root.setAttribute('data-reduce-motion', 'true')
  } catch { /* depolama kapalı */ }

  var themeMeta = document.querySelector('meta[name="theme-color"]')
  if (themeMeta) themeMeta.setAttribute('content', background)
})()
