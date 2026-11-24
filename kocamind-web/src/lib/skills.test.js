import { describe, expect, it } from 'vitest'
import { groupSkills, skillSourceLabel } from './skills'

describe('groupSkills', () => {
  it('kurulan skilleri yerleşiklerden ayırır', () => {
    const groups = groupSkills([
      { name: 'genel', alwaysOn: true },
      { name: 'dilekce', alwaysOn: false },
      { name: 'sunum', alwaysOn: false, installed: true },
    ])
    expect(groups.installed.map(s => s.name)).toEqual(['sunum'])
    expect(groups.always.map(s => s.name)).toEqual(['genel'])
    expect(groups.onDemand.map(s => s.name)).toEqual(['dilekce'])
  })
})

describe('skillSourceLabel', () => {
  it('kaynak adresini kısaltır', () => {
    expect(skillSourceLabel('https://raw.githubusercontent.com/ornek/skills/main/x/SKILL.md')).toBe('github.com/ornek/skills')
    expect(skillSourceLabel('https://github.com/ornek/skills/tree/main/x')).toBe('github.com/ornek/skills')
    expect(skillSourceLabel('bozuk')).toBe('')
  })
})
