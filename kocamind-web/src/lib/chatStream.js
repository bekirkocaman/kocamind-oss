

export function waitWithSignal(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('İşlem durduruldu', 'AbortError'))
    }, { once: true })
  })
}

export function createSmoothTextStream(onText, signal) {
  let target = ''
  let visibleLength = 0
  let timer = null
  let waiters = []

  const settle = () => {
    const pending = waiters
    waiters = []
    pending.forEach(resolve => resolve())
  }

  const tick = () => {
    timer = null
    if (signal?.aborted) {
      settle()
      return
    }

    const remaining = target.length - visibleLength
    if (remaining <= 0) {
      settle()
      return
    }

    const step = remaining > 600 ? 12 : remaining > 240 ? 8 : remaining > 80 ? 5 : 2
    visibleLength = Math.min(target.length, visibleLength + step)
    onText(target.slice(0, visibleLength))
    timer = setTimeout(tick, 24)
  }

  const push = (text) => {
    target = String(text || '')
    if (visibleLength > target.length) {
      visibleLength = target.length
      onText(target)
    }
    if (!timer && visibleLength < target.length) tick()
  }

  const finish = (text) => {
    push(text)
    if (signal?.aborted || visibleLength >= target.length) return Promise.resolve()
    return new Promise(resolve => waiters.push(resolve))
  }

  return { push, finish }
}
