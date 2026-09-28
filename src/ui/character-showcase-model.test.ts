import { describe, expect, it } from 'vitest'
import type { Echo, OwnedCharacter } from '../domain/types'
import { characterCatalog } from '../game-data'
import { resolveCharacterShowcaseModel } from './character-showcase-model'

const ownedCharacter: OwnedCharacter = {
  id: 'owned-aemeath', catalogId: '1210', level: 90, sequence: 0, locked: false, createdAt: 1,
  enabledSkillTreeBonusIds: ['normalAttack:0', 'normalAttack:1', 'resonanceSkill:0', 'resonanceSkill:1', 'resonanceLiberation:0', 'resonanceLiberation:1', 'introSkill:0', 'introSkill:1']
}
const echo = (id: string): Echo => ({ id, name: id, cost: 1, rarity: 5, level: 0, sonata: 'Molten Rift', mainStat: { key: 'atk', value: 0 }, subStats: [], locked: false, excluded: false, createdAt: 1, source: 'manual' })

describe('character showcase passive stats', () => {
  it('excludes disabled skill-tree nodes', () => {
    const catalog = characterCatalog.find((entry) => entry.id === ownedCharacter.catalogId)!
    const model = resolveCharacterShowcaseModel({ character: { ...ownedCharacter, enabledSkillTreeBonusIds: [] }, catalog, weapons: [], echoes: [], builds: [] })!
    expect(model.finalStats.atk).toBeCloseTo(model.characterBaseStats.atk)
    expect(model.finalStats.critRate).toBeCloseTo(catalog.baseStats.critRate)
  })

  it('does not execute unreviewed Sequence prose as a stat formula', () => {
    const baseCatalog = characterCatalog.find((entry) => entry.id === ownedCharacter.catalogId)!
    const catalog = { ...baseCatalog, sequenceIcons: [
      { sequence: 1, name: 'Static bonus', description: 'ATK is increased by 20%.', iconSourceUrl: '' },
      { sequence: 2, name: 'Triggered bonus', description: 'After casting Intro Skill, Crit. Rate is increased by 15% for 10s.', iconSourceUrl: '' }
    ] }
    const model = resolveCharacterShowcaseModel({ character: { ...ownedCharacter, sequence: 2, enabledSkillTreeBonusIds: [] }, catalog, weapons: [], echoes: [], builds: [] })!
    expect(model.finalStats.atk).toBeCloseTo(model.characterBaseStats.atk)
    expect(model.finalStats.critRate).toBeCloseTo(catalog.baseStats.critRate)
  })

  it('does not execute unreviewed inherent-skill prose as a stat formula', () => {
    const baseCatalog = characterCatalog.find((entry) => entry.id === ownedCharacter.catalogId)!
    const catalog = { ...baseCatalog, skillTreeExtras: { ...baseCatalog.skillTreeExtras, inherentSkills: [
      { name: 'Permanent training', description: 'ATK is increased by 10%.', iconSourceUrl: '' },
      { name: 'Triggered training', description: 'After casting Intro Skill, Crit. Rate is increased by 15% for 10s.', iconSourceUrl: '' }
    ] } }
    const model = resolveCharacterShowcaseModel({ character: { ...ownedCharacter, enabledSkillTreeBonusIds: ['inherent:0', 'inherent:1'] }, catalog, weapons: [], echoes: [], builds: [] })!
    expect(model.finalStats.atk).toBeCloseTo(model.characterBaseStats.atk)
    expect(model.finalStats.critRate).toBeCloseTo(catalog.baseStats.critRate)
  })

  it('leaves Sonata damage effects to action-context calculation', () => {
    const catalog = characterCatalog.find((entry) => entry.id === ownedCharacter.catalogId)!
    const echoes = Array.from({ length: 5 }, (_, index) => echo(`echo-${index}`))
    const build = { id: 'build', name: 'build', resonatorId: ownedCharacter.catalogId, weaponId: '', echoIds: echoes.map((entry) => entry.id), level: 90, skillLevel: 1 }
    const model = resolveCharacterShowcaseModel({ character: ownedCharacter, catalog, weapons: [], echoes, builds: [build] })!
    expect(model.finalStats.fusionDamage).toBeCloseTo(0)
    expect(model.statBonusSources.find((source) => source.label === 'Molten Rift · 5-piece')?.hasConditionalStats).toBe(true)
  })
})
