import { describe, expect, it } from 'vitest'
import { addToast, toastDuration } from './toasts'

describe('bildirimler', () => {
  it('eylemli bildirim eylemi taşır ve daha uzun kalır', () => {
    const onClick = () => {}
    const [toast] = addToast([], { id: 1, message: 'Hafızaya eklendi: şehir', type: 'info', action: { label: 'Geri al', onClick } })
    expect(toast.action.label).toBe('Geri al')
    expect(toastDuration('info', toast.action)).toBe(6000)
    expect(toastDuration('info')).toBe(3500)
    expect(toastDuration('error')).toBe(6000)
  })

  it('aynı bildirimi tekrar eklemez, en fazla 5 tutar', () => {
    let list = addToast([], { id: 1, message: 'a', type: 'info' })
    list = addToast(list, { id: 2, message: 'a', type: 'info' })
    expect(list).toHaveLength(1)
    for (let i = 0; i < 6; i++) list = addToast(list, { id: 10 + i, message: `m${i}`, type: 'info' })
    expect(list).toHaveLength(5)
    expect(list.at(-1).message).toBe('m5')
  })
})
