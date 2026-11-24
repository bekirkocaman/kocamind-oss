import { describe, expect, it } from 'vitest'
import { filterChatsByRetention } from './retention'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 7, 3)

describe('filterChatsByRetention', () => {
  const chats = [
    { id: 'recent', updatedAt: NOW - 5 * DAY },
    { id: 'old', updatedAt: NOW - 100 * DAY },
  ]

  it('sınırsız saklamada tüm sohbetleri korur', () => {
    expect(filterChatsByRetention(chats, 'forever', NOW)).toEqual(chats)
  })

  it('seçilen süreden eski sohbetleri filtreler', () => {
    expect(filterChatsByRetention(chats, '1month', NOW)).toEqual([chats[0]])
  })
})
