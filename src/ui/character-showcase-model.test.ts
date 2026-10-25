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

  it('applies Jingran\'s permanent HP conversions from his equipped stats', () => {
    const character = { ...ownedCharacter, id: 'owned-jingran', catalogId: '1212', enabledSkillTreeBonusIds: [] }
    const hpEcho = { ...echo('hp-echo'), name: 'Myriad Snare: Rustfire Chassis', level: 25, mainStat: { key: 'hpPercent' as const, value: 22.8 } }
    const build = { id: 'jingran-build', name: 'Jingran', resonatorId: '1212', weaponId: '', echoIds: [hpEcho.id], level: 90, skillLevel: 1 }
    const model = resolveCharacterShowcaseModel({ character, weapons: [], echoes: [hpEcho], builds: [build] })!
    const steps = Math.floor(Math.min(model.equipmentStats.hp, 50000) / 1000)
    expect(model.finalStats.fusionDamage).toBeCloseTo(steps * 1.5 + 12)
    expect(model.finalStats.atk - model.characterBaseStats.atk).toBeCloseTo(steps * 36)
    expect(model.finalStats.def).toBe(0)
    expect(model.incomingHealingBonus).toBeCloseTo(steps * 6.2)
  })

  it('matches the supplied level-90 Jingran card', () => {
    const character = { ...ownedCharacter, id:'owned-jingran', catalogId:'1212', sequence:6, skillLevels:[10, 10, 10, 10, 9] }
    const weapon = { id:'weapon', catalogId:'21010076', level:90, rank:1, locked:false, createdAt:1 }
    const echoes: Echo[] = [
      { ...echo('main'), name:'Myriad Snare: Rustfire Chassis', cost:4, level:25, sonata:'Lamp of Nether Road', mainStat:{ key:'critDamage', value:44 }, subStats:[{ key:'hpPercent', value:8.6 }, { key:'atkPercent', value:10.1 }, { key:'critDamage', value:15 }, { key:'hp', value:510 }, { key:'critRate', value:6.3 }] },
      { ...echo('four'), cost:4, level:25, sonata:'Lamp of Nether Road', mainStat:{ key:'critDamage', value:44 }, subStats:[{ key:'critDamage', value:15 }, { key:'hpPercent', value:7.1 }, { key:'energyRegen', value:10.8 }, { key:'critRate', value:6.3 }, { key:'skillDamage', value:10.1 }] },
      { ...echo('one-a'), level:25, sonata:'Lamp of Nether Road', mainStat:{ key:'hpPercent', value:22.8 }, subStats:[{ key:'critDamage', value:17.4 }, { key:'energyRegen', value:6.8 }, { key:'hpPercent', value:10.9 }, { key:'critRate', value:8.7 }, { key:'atk', value:40 }] },
      { ...echo('one-b'), level:25, sonata:'Lamp of Nether Road', mainStat:{ key:'hpPercent', value:22.8 }, subStats:[{ key:'hpPercent', value:9.4 }, { key:'critRate', value:9.3 }, { key:'critDamage', value:15 }, { key:'basicDamage', value:8.6 }, { key:'hp', value:360 }] },
      { ...echo('one-c'), level:25, sonata:'Lamp of Nether Road', mainStat:{ key:'atkPercent', value:18 }, subStats:[{ key:'defPercent', value:11.9 }, { key:'critDamage', value:18.6 }, { key:'critRate', value:7.5 }, { key:'energyRegen', value:9.2 }, { key:'atkPercent', value:8.6 }] }
    ]
    const build = { id:'jingran-card', name:'Jingran card', resonatorId:'1212', weaponId:weapon.id, echoIds:echoes.map((entry) => entry.id), level:90, skillLevel:10 }
    const model = resolveCharacterShowcaseModel({ character, weapons:[weapon], echoes, builds:[build] })!
    expect(Math.ceil(model.finalStats.hp)).toBe(50115)
    expect(Math.ceil(model.finalStats.atk)).toBe(3130)
    expect(model.finalStats.def).toBe(0)
    expect(model.finalStats.energyRegen).toBeCloseTo(126.8)
    expect(model.finalStats.critRate).toBeCloseTo(51.1)
    expect(model.finalStats.critDamage).toBeCloseTo(319)
    expect(model.finalStats.fusionDamage).toBeCloseTo(99)
    expect(model.finalStats.heavyDamage).toBeCloseTo(12)
    expect(model.finalStats.skillDamage).toBeCloseTo(10.1)
    expect(model.finalStats.basicDamage).toBeCloseTo(8.6)
    expect(model.finalStats.liberationDamage).toBe(0)
    expect(model.finalStats.healingBonus).toBe(0)
    expect(model.incomingHealingBonus).toBe(310)
  })
})
