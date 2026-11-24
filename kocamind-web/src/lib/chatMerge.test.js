import { describe, expect, it } from 'vitest'
import { baseOf, mergeChat, mergeMessages, planSync } from './chatMerge'

// Android'deki ChatMergeTest.kt ile aynı vakalar.
const m = (id, t, content = `m${id}`, role = 'user') => ({ id, role, content, timestamp: t })
const ids = (list) => list.map(x => x.id)
const chat = (id, updatedAt, messages, extra = {}) => ({ id, title: id, updatedAt, createdAt: 1, messages, ...extra })

describe('mergeMessages', () => {
  it('taban yoksa yeni olan kazanır', () => {
    expect(ids(mergeMessages([m('1', 10), m('3', 30)], [m('1', 10), m('2', 20)], null))).toEqual(['1', '3'])
  })

  it('iki cihazın eş zamanlı eklediği mesajlar zaman sırasıyla kalır', () => {
    const out = mergeMessages([m('1', 10), m('2', 20), m('4', 40)], [m('1', 10), m('2', 20), m('3', 30)], ['1', '2'])
    expect(ids(out)).toEqual(['1', '2', '3', '4'])
  })

  it('düzenlemede kesilen mesajlar geri gelmez', () => {
    const out = mergeMessages([m('1', 10), m('9', 90)], [m('1', 10), m('2', 20), m('3', 30)], ['1', '2', '3'])
    expect(ids(out)).toEqual(['1', '9'])
  })

  it('eski taraftaki düzenleme de geçerlidir, yeni taraftaki ekleme korunur', () => {
    const out = mergeMessages([m('1', 10), m('2', 20), m('3', 30), m('4', 40)], [m('1', 10), m('5', 50)], ['1', '2', '3'])
    expect(ids(out)).toEqual(['1', '4', '5'])
  })

  it('aynı kimlikte yeni içerik kazanır; eşit zamanlı mesaj arkaya gelir', () => {
    const out = mergeMessages([m('1', 10, 'yeni'), m('2', 20)], [m('1', 10, 'eski'), m('3', 20)], ['1'])
    expect(ids(out)).toEqual(['1', '2', '3'])
    expect(out[0].content).toBe('yeni')
  })
})

describe('mergeChat', () => {
  it('başlık ve sabitleme yeni olandan, mesajlar birleşik, zaman en büyük', () => {
    const local = chat('c', 100, [m('1', 10), m('2', 20)], { title: 'yerel' })
    const cloud = chat('c', 200, [m('1', 10), m('3', 30)], { title: 'bulut', pinned: true })
    const out = mergeChat(local, cloud, { updatedAt: 50, ids: ['1'] })
    expect(out.title).toBe('bulut')
    expect(out.pinned).toBe(true)
    expect(out.updatedAt).toBe(200)
    expect(ids(out.messages)).toEqual(['1', '2', '3'])
  })
})

describe('planSync', () => {
  it('bütün durumları karşılar', () => {
    const same = chat('same', 100, [m('1', 10)])
    const newLocal = chat('newLocal', 100, [m('1', 10)])
    const goneRemote = chat('goneRemote', 100, [m('1', 10)])
    const editedLocal = chat('editedLocal', 300, [m('1', 10), m('2', 20)])
    const newCloud = chat('newCloud', 100, [m('1', 10)])
    const goneLocal = chat('goneLocal', 100, [m('1', 10)])
    const editedCloud = chat('editedCloud', 300, [m('1', 10), m('2', 20)])
    const pendingDel = chat('pendingDel', 100, [m('1', 10)])
    const bases = {
      same: baseOf(same),
      goneRemote: baseOf(goneRemote),
      editedLocal: { updatedAt: 100, ids: ['1'] },
      goneLocal: baseOf(goneLocal),
      editedCloud: { updatedAt: 100, ids: ['1'] },
    }
    const plan = planSync(
      [same, newLocal, goneRemote, editedLocal, pendingDel],
      [same, newCloud, goneLocal, editedCloud, pendingDel],
      bases,
      new Set(['pendingDel']),
    )
    expect(new Set(plan.chats.map(c => c.id))).toEqual(new Set(['same', 'newLocal', 'editedLocal', 'newCloud', 'editedCloud']))
    expect(new Set(plan.upload)).toEqual(new Set(['newLocal', 'editedLocal']))
    expect(new Set(plan.deleteCloud)).toEqual(new Set(['goneLocal', 'pendingDel']))
    expect(new Set(Object.keys(plan.agreed))).toEqual(new Set(['same', 'newCloud', 'editedCloud']))
    expect(plan.forget).toEqual(['goneRemote'])
  })
})
