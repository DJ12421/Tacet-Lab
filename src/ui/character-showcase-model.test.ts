import { describe, expect, it } from 'vitest'
import type { Echo, OwnedCharacter, OwnedWeapon } from '../domain/types'
import { characterCatalog, weaponCatalog } from '../game-data'
import { resolveCharacterShowcaseModel } from './character-showcase-model'

const ownedCharacter: OwnedCharacter = {
  id: 'owned-aemeath', catalogId: '1210', level: 90, sequence: 0, locked: false, createdAt: 1,
  enabledSkillTreeBonusIds: ['normalAttack:0', 'normalAttack:1', 'resonanceSkill:0', 'resonanceSkill:1', 'resonanceLiberation:0', 'resonanceLiberation:1', 'introSkill:0', 'introSkill:1']
}
const weaponCatalogEntry = weaponCatalog.find((entry) => entry.name === "Defier's Thorn")!
const ownedWeapon: OwnedWeapon = { id: 'owned-weapon', catalogId: weaponCatalogEntry.id, level: 1, rank: 1, locked: false, equippedBy: ownedCharacter.id, createdAt: 1 }
const echo = (id: string): Echo => ({ id, name: id, cost: 1, rarity: 5, level: 0, sonata: 'Molten Rift', mainStat: { key: 'atk', value: 0 }, subStats: [], locked: false, excluded: false, createdAt: 1, source: 'manual' })

describe('character showcase passive stats', () => {
  it('includes enabled skill-tree nodes and the always-on weapon passive', () => {
    const catalog = characterCatalog.find((entry) => entry.id === ownedCharacter.catalogId)!
    const model = resolveCharacterShowcaseModel({ character: ownedCharacter, catalog, weapons: [ownedWeapon], echoes: [], builds: [] })!
    expect(model.finalStats.hp).toBe(Math.floor(model.characterBaseStats.hp * 1.28))
    expect(model.finalStats.atk).toBe(Math.floor((model.characterBaseStats.atk + 33) * 1.12))
    expect(model.finalStats.critRate).toBeCloseTo(13)
  })

  it('excludes disabled skill-tree nodes', () => {
    const catalog = characterCatalog.find((entry) => entry.id === ownedCharacter.catalogId)!
    const model = resolveCharacterShowcaseModel({ character: { ...ownedCharacter, enabledSkillTreeBonusIds: [] }, catalog, weapons: [], echoes: [], builds: [] })!
    expect(model.finalStats.atk).toBeCloseTo(model.characterBaseStats.atk)
    expect(model.finalStats.critRate).toBeCloseTo(catalog.baseStats.critRate)
  })

  it('enables every skill-tree node by default when no saved selection exists', () => {
    const catalog = characterCatalog.find((entry) => entry.id === ownedCharacter.catalogId)!
    const model = resolveCharacterShowcaseModel({ character: { ...ownedCharacter, enabledSkillTreeBonusIds: undefined }, catalog, weapons: [], echoes: [], builds: [] })!
    expect(model.finalStats.atk).toBe(Math.floor(model.characterBaseStats.atk * 1.12))
    expect(model.finalStats.critRate).toBeCloseTo(13)
  })

  it('includes only unconditional character-wide stats from unlocked Sequences', () => {
    const baseCatalog = characterCatalog.find((entry) => entry.id === ownedCharacter.catalogId)!
    const catalog = { ...baseCatalog, sequenceIcons: [
      { sequence: 1, name: 'Static bonus', description: 'ATK is increased by 20%.', iconSourceUrl: '' },
      { sequence: 2, name: 'Triggered bonus', description: 'After casting Intro Skill, Crit. Rate is increased by 15% for 10s.', iconSourceUrl: '' }
    ] }
    const model = resolveCharacterShowcaseModel({ character: { ...ownedCharacter, sequence: 2, enabledSkillTreeBonusIds: [] }, catalog, weapons: [], echoes: [], builds: [] })!
    expect(model.finalStats.atk).toBe(Math.floor(model.characterBaseStats.atk * 1.2))
    expect(model.finalStats.critRate).toBeCloseTo(catalog.baseStats.critRate)
  })

  it('includes unconditional stats from enabled inherent-skill nodes', () => {
    const baseCatalog = characterCatalog.find((entry) => entry.id === ownedCharacter.catalogId)!
    const catalog = { ...baseCatalog, skillTreeExtras: { ...baseCatalog.skillTreeExtras, inherentSkills: [
      { name: 'Permanent training', description: 'ATK is increased by 10%.', iconSourceUrl: '' },
      { name: 'Triggered training', description: 'After casting Intro Skill, Crit. Rate is increased by 15% for 10s.', iconSourceUrl: '' }
    ] } }
    const model = resolveCharacterShowcaseModel({ character: { ...ownedCharacter, enabledSkillTreeBonusIds: ['inherent:0', 'inherent:1'] }, catalog, weapons: [], echoes: [], builds: [] })!
    expect(model.finalStats.atk).toBe(Math.floor(model.characterBaseStats.atk * 1.1))
    expect(model.finalStats.critRate).toBeCloseTo(catalog.baseStats.critRate)
  })

  it('includes unlocked always-on Sonata effects but excludes conditional ones', () => {
    const catalog = characterCatalog.find((entry) => entry.id === ownedCharacter.catalogId)!
    const echoes = Array.from({ length: 5 }, (_, index) => echo(`echo-${index}`))
    const build = { id: 'build', name: 'build', resonatorId: ownedCharacter.catalogId, weaponId: '', echoIds: echoes.map((entry) => entry.id), level: 90, skillLevel: 1 }
    const model = resolveCharacterShowcaseModel({ character: ownedCharacter, catalog, weapons: [], echoes, builds: [build] })!
    expect(model.finalStats.fusionDamage).toBeCloseTo(10)
    expect(model.statBonusSources.find((source) => source.label === 'Molten Rift · 5-piece')?.hasConditionalStats).toBe(true)
  })
})
