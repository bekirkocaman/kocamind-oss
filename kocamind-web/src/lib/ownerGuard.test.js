import { describe, expect, it, vi } from 'vitest'
import { ownerGuard } from './chatSubmission'

describe('ownerGuard', () => {
  it('cevap bitmeden hesap değişirse önceki hesabın sohbeti yazılmaz', () => {
    let uid = 'a'
    const write = vi.fn()
    const guarded = ownerGuard(() => uid, 'a', write)
    guarded('ilk')
    uid = 'b'
    guarded('sonra')
    uid = null
    guarded('çıkışta')
    expect(write.mock.calls).toEqual([['ilk']])
  })

  it('oturum yokken başlayan istek hiç yazmaz', () => {
    const write = vi.fn()
    ownerGuard(() => undefined, undefined, write)('x')
    expect(write).not.toHaveBeenCalled()
  })
})
