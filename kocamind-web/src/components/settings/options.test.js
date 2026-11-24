import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS_TAB,
  LEGACY_TAB_MAP,
  SETTINGS_SECTIONS,
  SETTINGS_TAB_GROUPS,
  SETTINGS_TABS,
  resolveSettingsTab,
} from './options'

describe('settings tab structure and legacy mapping', () => {
  it('lists the 14 top-level tabs across 6 groups in the expected order', () => {
    expect(SETTINGS_TAB_GROUPS).toHaveLength(6)
    expect(SETTINGS_TAB_GROUPS.map(g => g.length)).toEqual([3, 2, 5, 1, 2, 1])

    expect(SETTINGS_TABS.map(t => t.id)).toEqual([
      'main',
      'notifications',
      'voice',
      'personalization',
      'memory',
      'capabilities',
      'skills',
      'plugins',
      'documents',
      'connectors',
      'data_privacy',
      'account',
      'billing',
      'help',
    ])
    expect(SETTINGS_TABS.map(t => t.label)).toEqual([
      'Genel',
      'Bildirimler',
      'Ses',
      'Kişiselleştirme',
      'Hafıza',
      'Özellikler',
      "Skill'ler",
      'Eklentiler',
      'Dokümanlar',
      'Bağlantılar',
      'Veri ve Gizlilik',
      'Hesap',
      'Plan ve kullanım',
      'Yardım',
    ])
    expect(DEFAULT_SETTINGS_TAB).toBe('main')
  })

  it('maps every legacy tab id to a valid new tab and section', () => {
    const tabById = new Map(SETTINGS_TABS.map(t => [t.id, t]))

    for (const [legacyId, expected] of Object.entries(LEGACY_TAB_MAP)) {
      const resolved = resolveSettingsTab(legacyId)
      expect(resolved).toEqual(expected)

      const tab = tabById.get(resolved.tab)
      expect(tab, `missing tab for legacy id "${legacyId}"`).toBeDefined()
      expect(tab.sections, `section "${resolved.section}" not in tab "${resolved.tab}"`).toContain(resolved.section)
      expect(SETTINGS_SECTIONS[resolved.section], `missing section meta for "${resolved.section}"`).toBeDefined()
    }
  })

  it('resolves all 18 legacy call-site ids to the right tabs and sections', () => {
    expect(resolveSettingsTab('appearance')).toEqual({ tab: 'main', section: 'appearance' })
    expect(resolveSettingsTab('notifications')).toEqual({ tab: 'notifications', section: 'notifications' })
    expect(resolveSettingsTab('voice')).toEqual({ tab: 'voice', section: 'voice' })
    expect(resolveSettingsTab('general')).toEqual({ tab: 'personalization', section: 'general' })
    expect(resolveSettingsTab('styles')).toEqual({ tab: 'personalization', section: 'styles' })
    expect(resolveSettingsTab('memory')).toEqual({ tab: 'memory', section: 'memory' })
    expect(resolveSettingsTab('capabilities')).toEqual({ tab: 'capabilities', section: 'capabilities' })
    expect(resolveSettingsTab('skills')).toEqual({ tab: 'skills', section: 'skills' })
    expect(resolveSettingsTab('plugins')).toEqual({ tab: 'plugins', section: 'plugins' })
    expect(resolveSettingsTab('documents')).toEqual({ tab: 'documents', section: 'documents' })
    expect(resolveSettingsTab('connectors')).toEqual({ tab: 'connectors', section: 'connectors' })
    expect(resolveSettingsTab('privacy')).toEqual({ tab: 'data_privacy', section: 'privacy' })
    expect(resolveSettingsTab('data')).toEqual({ tab: 'data_privacy', section: 'data' })
    expect(resolveSettingsTab('account')).toEqual({ tab: 'account', section: 'account' })
    expect(resolveSettingsTab('billing')).toEqual({ tab: 'billing', section: 'billing' })
    expect(resolveSettingsTab('usage')).toEqual({ tab: 'billing', section: 'usage' })
    expect(resolveSettingsTab('about')).toEqual({ tab: 'help', section: 'about' })
    expect(resolveSettingsTab('bug_report')).toEqual({ tab: 'help', section: 'bug_report' })
  })

  it('resolves f15e497 8-tab ids and top-level multi-section tab ids', () => {
    expect(resolveSettingsTab('main')).toEqual({ tab: 'main', section: null })
    expect(resolveSettingsTab('personalization')).toEqual({ tab: 'personalization', section: null })
    expect(resolveSettingsTab('data_privacy')).toEqual({ tab: 'data_privacy', section: null })
    expect(resolveSettingsTab('help')).toEqual({ tab: 'help', section: null })
  })

  it('rejects unknown, malformed, case-mismatched, and prototype keys', () => {
    const invalidInputs = [
      null,
      undefined,
      '',
      42,
      {},
      'assistants',
      'BILLING',
      'billing ',
      ' billing',
      'billing.',
      'billing2',
      'hesap',
      'hafıza',
      'toString',
      'constructor',
      '__proto__',
    ]
    for (const input of invalidInputs) {
      expect(resolveSettingsTab(input), `expected null for ${String(input)}`).toBeNull()
    }
  })

  it('returns a fresh copy so callers cannot mutate LEGACY_TAB_MAP', () => {
    const first = resolveSettingsTab('billing')
    first.tab = 'tampered'
    expect(resolveSettingsTab('billing')).toEqual({ tab: 'billing', section: 'billing' })
  })
})
