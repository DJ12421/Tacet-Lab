import { expect, it } from 'vitest'
import { characterCatalog, echoCatalog, weaponCatalog } from '../../../game-data'
import type { Build, Echo, OwnedCharacter, OwnedWeapon, Team } from '../../types'
import { YANGYANG } from './resonators/aero/yangyang.js'
import { JIYAN } from './resonators/aero/jiyan.js'
import { YINLIN } from './resonators/electro/yinlin.js'
import { XUANLING } from './resonators/havoc/xuanling.js'
import { CHISA } from './resonators/havoc/chisa.js'
import { SUISUI } from './resonators/glacio/suisui.js'
import { statefulPreview } from './preview'
import { calculateBuildModes } from '../runtime'
import { menuStats } from './engine/context.js'
import { Gear } from './engine/gear.js'
import { Attribute, Stat, Type, splitStat } from './engine/stats.js'

function fixtureEchoes(mainName: string, sonata: string): Echo[] {
  const mainCost = echoCatalog.find((entry) => entry.name === mainName)!.cost
  const costs = mainCost === 3 ? [3, 3, 3, 1, 1] as const : [4, 3, 3, 1, 1] as const
  return costs.map((cost, index) => {
    const catalog = index === 0 ? echoCatalog.find((entry) => entry.name === mainName)
      : echoCatalog.find((entry) => entry.cost === cost && entry.sonatas.includes(sonata))
    expect(catalog?.cost).toBe(cost)
    expect(catalog?.sonatas).toContain(sonata)
    return { id: `echo-${index}`, name: catalog!.name, sonata, cost, rarity: 5, level: 25,
      mainStat: { key: 'critRate', value: 0.22 }, subStats: [], locked: false, excluded: false,
      createdAt: 0, source: 'manual' }
  })
}

it('counts each scoped equipped stat once', () => {
  const entries = menuStats([new Gear({ stats: [
    [Stat.DmgBonus, 12, Type.Basic], [Stat.DmgBonus, 5, Attribute.Aero]
  ] })])
  expect(entries.map((entry) => [splitStat(entry.stat)[1], entry.value])).toEqual([
    [Type.Basic, 12], [Attribute.Aero, 5]
  ])
})

it('reports complete coverage only for an equipped and mapped cast', () => {
  const character: OwnedCharacter = { id: 'character', catalogId: '1402', level: 90, sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 0 }
  const catalogWeapon = weaponCatalog.find((entry) => entry.name === YANGYANG.refinements[0]?.[0]?.name.replace(/ R\d$/, ''))
  expect(catalogWeapon).toBeDefined()
  const weapon: OwnedWeapon = { id: 'weapon', catalogId: catalogWeapon!.id, level: 90, rank: 1, locked: false, createdAt: 0 }
  const name = YANGYANG.echoLoadouts[0]!.mainslot.name
  const sonata = YANGYANG.echoLoadouts[0]!.sets[0]!.name.replace(/ \dpc$/, '')
  const echoes = fixtureEchoes(name, sonata)
  const build: Build = { id: 'build', name: 'Fixture', characterId: character.id, resonatorId: character.catalogId, weaponId: weapon.id, echoIds: echoes.map((echo) => echo.id), level: 90, skillLevel: 10 }
  const action = { id: 'cast', timestamp: 0, buildId: build.id, attackId: '1402-1-0' }
  const team: Team = { id: 'team', name: 'Fixture', buildIds: [build.id], enemy: { level: 100, resistance: 20, damageReduction: 0 }, rotationDuration: 1, actions: [action] }
  const members = [{ build, character, weapon, echoes }]
  const rows = [{ action, attack: { id: action.attackId, group: 'basic' } }]

  const result = statefulPreview(team, members, rows)
  const formula = calculateBuildModes({ build, character, weapon, echoes, enemy: team.enemy, targetId: action.attackId })
  expect(result?.normal).toBe(formula.values.normal)
  expect(result?.critical).toBe(formula.values.critical)
  expect(result?.expected).toBe(formula.values.expected)
  expect(result?.coveredActions).toBe(1)
  expect(result?.complete).toBe(true)
  expect(result?.expected).toBeGreaterThan(0)
  expect(result!.normal).toBeLessThan(result!.expected)
  expect(result!.expected).toBeLessThan(result!.critical)
  expect(statefulPreview(team, [{ ...members[0], echoes: echoes.map((echo) => ({ ...echo, cost: 4 })) }], rows)?.complete).toBe(false)
  expect(statefulPreview(team, [{ ...members[0], echoes: [{ ...echoes[0], sonata: 'Freezing Frost' }, ...echoes.slice(1)] }], rows)?.complete).toBe(false)
  expect(statefulPreview(team, [{ ...members[0], echoes: [echoes[0], { ...echoes[1], name: 'Unknown Echo' }, ...echoes.slice(2)] }], rows)?.complete).toBe(false)

  const skillOne = statefulPreview(team, [{ ...members[0], character: { ...character, skillLevels: [1, 1, 1, 1, 1] } }], rows)
  expect(skillOne?.complete).toBe(true)
  expect(skillOne?.expected).toBeGreaterThan(0)
  expect(skillOne?.expected).toBeLessThan(result!.expected)

  const reduced = statefulPreview({ ...team, enemy: { ...team.enemy, damageReduction: 10 } }, members, rows)
  expect(reduced?.complete).toBe(true)
  expect(reduced?.expected).toBeLessThan(result!.expected)
  expect(reduced?.expected).toBeGreaterThan(0)
  const bane = statefulPreview({ ...team, enemy: { ...team.enemy, havocBaneStacks: 3 } }, members, rows)
  expect(bane?.complete).toBe(true)
  expect(bane!.expected).toBeGreaterThan(result!.expected)
  expect(statefulPreview({ ...team, enemy: { ...team.enemy, havocBaneStacks: 4 } }, members, rows)?.complete).toBe(false)

  const rage = statefulPreview({ ...team, enemy: { ...team.enemy, electroRageStacks: 1 } }, members, rows)
  expect(rage?.complete).toBe(true)
  expect(statefulPreview({ ...team, enemy: { ...team.enemy, electroRageStacks: 14 } }, members, rows)?.complete).toBe(false)
  expect(statefulPreview({ ...team, enemy: { ...team.enemy, cost: 3 } }, members, rows)?.complete).toBe(false)

  const lowerLevel = statefulPreview(team, [{ ...members[0], character: { ...character, level: 80 } }], rows)
  expect(lowerLevel?.complete).toBe(true)
  expect(lowerLevel?.expected).toBeGreaterThan(0)
  expect(lowerLevel?.expected).toBeLessThan(result!.expected)

  const lowerWeapon = statefulPreview(team, [{ ...members[0], weapon: { ...weapon, level: 80 } }], rows)
  expect(lowerWeapon?.complete).toBe(true)
  expect(lowerWeapon?.expected).toBeLessThan(result!.expected)

  const otherSword = weaponCatalog.find((entry) => entry.name === 'Red Spring')
  expect(otherSword).toBeDefined()
  const otherGear = statefulPreview(team, [{ ...members[0], weapon: { ...weapon, catalogId: otherSword!.id } }], rows)
  expect(otherGear?.complete).toBe(true)
  expect(otherGear?.expected).toBeGreaterThan(0)

  const otherEchoes = fixtureEchoes('Bell-Borne Geochelone', 'Rejuvenating Glow')
  const otherSet = statefulPreview(team, [{ ...members[0], echoes: otherEchoes }], rows)
  expect(otherSet?.complete).toBe(true)
  expect(otherSet?.expected).toBeGreaterThan(0)

  const secondAction = { ...action, id: 'cast-2', timestamp: 1 }
  const repeatedTeam = { ...team, rotationDuration: 2, actions: [action, secondAction] }
  const repeatedRows = [...rows, { action: secondAction, attack: rows[0].attack }]
  const unbuffed = statefulPreview(repeatedTeam, members, repeatedRows)
  const lateAction = { ...secondAction, timestamp: 4 }
  const lateRows = [...rows, { action: lateAction, attack: rows[0].attack }]
  const lateTeam = { ...team, rotationDuration: 5, actions: [action, lateAction] }
  const noStatus = statefulPreview(lateTeam, members, lateRows)
  const erosion = statefulPreview({ ...lateTeam, enemy: { ...team.enemy, statusStacks: { 'aero-erosion': 1 } } }, members, lateRows)
  expect(erosion?.complete).toBe(true)
  expect(erosion!.expected).toBeGreaterThan(noStatus!.expected)
  expect(statefulPreview({ ...team, enemy: { ...team.enemy, statusStacks: { 'aero-erosion': 4 } } }, members, rows)?.complete).toBe(false)
  for (const target of ['self', 'team'] as const) {
    const buffed = statefulPreview({ ...repeatedTeam, buffs: [{ id: 'manual', name: 'Manual ATK', sourceBuildId: build.id,
      target, triggerAttackId: action.attackId, duration: 10, stat: 'atkPercent', value: 20, stackingGroup: 'manual' }] }, members, repeatedRows)
    expect(buffed?.complete).toBe(true)
    expect(buffed!.expected).toBeGreaterThan(unbuffed!.expected)
  }
  const expired = statefulPreview({ ...repeatedTeam, buffs: [{ id: 'short', name: 'Short buff', sourceBuildId: build.id,
    target: 'self', triggerAttackId: action.attackId, duration: 0.5, stat: 'atkPercent', value: 20,
    stackingGroup: 'short' }] }, members, repeatedRows)
  expect(expired?.expected).toBe(unbuffed?.expected)
  expect(statefulPreview({ ...repeatedTeam, buffs: [{ id: 'next', name: 'Next member', sourceBuildId: build.id,
    target: 'next', triggerAttackId: action.attackId, duration: 10, stat: 'atkPercent', value: 20,
    stackingGroup: 'next' }] }, members, repeatedRows)?.expected).toBe(unbuffed?.expected)
})

it('applies a next-member buff to the first teammate cast', () => {
  const yangyang: OwnedCharacter = { id: 'yangyang', catalogId: '1402', level: 90, sequence: 0,
    skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 0 }
  const yinlin: OwnedCharacter = { ...yangyang, id: 'yinlin', catalogId: '1302' }
  const sourceWeapon = weaponCatalog.find((entry) => entry.name === YANGYANG.refinements[0]![0]!.name.replace(/ R\d$/, ''))!
  const targetWeapon = weaponCatalog.find((entry) => entry.name === YINLIN.refinements[0]![0]!.name.replace(/ R\d$/, ''))!
  const firstWeapon: OwnedWeapon = { id: 'first-weapon', catalogId: sourceWeapon.id, level: 90, rank: 1, locked: false, createdAt: 0 }
  const secondWeapon: OwnedWeapon = { ...firstWeapon, id: 'second-weapon', catalogId: targetWeapon.id }
  const firstEchoes = fixtureEchoes(YANGYANG.echoLoadouts[0]!.mainslot.name, YANGYANG.echoLoadouts[0]!.sets[0]!.name.replace(/ \dpc$/, ''))
  const secondEchoes = fixtureEchoes(YINLIN.echoLoadouts[0]!.mainslot.name, YINLIN.echoLoadouts[0]!.sets[0]!.name.replace(/ \dpc$/, ''))
    .map((echo) => ({ ...echo, id: `second-${echo.id}` }))
  const firstBuild: Build = { id: 'first', name: 'First', characterId: yangyang.id, resonatorId: yangyang.catalogId,
    weaponId: firstWeapon.id, echoIds: firstEchoes.map((echo) => echo.id), level: 90, skillLevel: 10 }
  const secondBuild: Build = { ...firstBuild, id: 'second', name: 'Second', characterId: yinlin.id,
    resonatorId: yinlin.catalogId, weaponId: secondWeapon.id, echoIds: secondEchoes.map((echo) => echo.id) }
  const first = { id: 'first-cast', timestamp: 0, buildId: firstBuild.id, attackId: '1402-1-0' }
  const second = { id: 'second-cast', timestamp: 33 / 60, buildId: secondBuild.id, attackId: '1302-1-0' }
  const team: Team = { id: 'team', name: 'Two', buildIds: [firstBuild.id, secondBuild.id],
    enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 2, actions: [first, second] }
  const members = [{ build: firstBuild, character: yangyang, weapon: firstWeapon, echoes: firstEchoes },
    { build: secondBuild, character: yinlin, weapon: secondWeapon, echoes: secondEchoes }]
  const rows = [{ action: first, attack: { id: first.attackId, group: 'basic' } },
    { action: second, attack: { id: second.attackId, group: 'basic' } }]
  const baseline = statefulPreview(team, members, rows)
  const buffed = statefulPreview({ ...team, buffs: [{ id: 'next', name: 'Next member', sourceBuildId: firstBuild.id,
    target: 'next', triggerAttackId: first.attackId, duration: 10, stat: 'atkPercent', value: 20,
    stackingGroup: 'next' }] }, members, rows)
  expect(baseline?.complete).toBe(true)
  expect(buffed?.complete).toBe(true)
  expect(buffed!.expected).toBeGreaterThan(baseline!.expected)
  const third = { ...second, id: 'third-cast', timestamp: 1.2 }
  const longerTeam = { ...team, actions: [first, second, third] }
  const longerRows = [...rows, { action: third, attack: rows[1].attack }]
  const longerBase = statefulPreview(longerTeam, members, longerRows)
  const longerBuffed = statefulPreview({ ...longerTeam, buffs: [{ id: 'next', name: 'Next member', sourceBuildId: firstBuild.id,
    target: 'next', triggerAttackId: first.attackId, duration: 10, stat: 'atkPercent', value: 20,
    stackingGroup: 'next' }] }, members, longerRows)
  expect(longerBase?.complete).toBe(true)
  expect(longerBuffed?.complete).toBe(true)
  expect(longerBuffed!.expected - longerBase!.expected).toBe(buffed!.expected - baseline!.expected)
})

it('matches an imported cast while preserving its status-only bullet', () => {
  const character: OwnedCharacter = { id: 'character', catalogId: '1610', level: 90, sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 0 }
  const catalogWeapon = weaponCatalog.find((entry) => entry.name === XUANLING.refinements[0]![0]!.name.replace(/ R\d$/, ''))!
  const weapon: OwnedWeapon = { id: 'weapon', catalogId: catalogWeapon.id, level: 90, rank: 1, locked: false, createdAt: 0 }
  const echoes = fixtureEchoes(XUANLING.echoLoadouts[0]!.mainslot.name, XUANLING.echoLoadouts[0]!.sets[0]!.name.replace(/ \dpc$/, ''))
  const build: Build = { id: 'build', name: 'Fixture', characterId: character.id, resonatorId: character.catalogId, weaponId: weapon.id, echoIds: echoes.map((echo) => echo.id), level: 90, skillLevel: 10 }
  const action = { id: 'heavy', timestamp: 0, buildId: build.id, attackId: '1610:imported:447' }
  const team: Team = { id: 'team', name: 'Fixture', buildIds: [build.id], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 2, actions: [action] }
  const result = statefulPreview(team, [{ build, character, weapon, echoes }], [{ action, attack: { id: action.attackId, group: 'forte' } }])
  expect(result?.warnings.some((warning) => warning.includes('no compatible stateful cast'))).toBe(false)
  expect(result?.warnings.some((warning) => warning.includes('swaps in'))).toBe(true)
  const azure = { ...action, id: 'azure-2', attackId: '1610-1-1', label: 'Basic: Azure Sword 2' }
  const azureResult = statefulPreview({ ...team, actions: [azure] }, [{ build, character, weapon, echoes }], [{ action: azure, attack: { id: azure.attackId, group: 'basic' } }])
  expect(azureResult?.warnings.some((warning) => warning.includes('no compatible stateful cast'))).toBe(false)
})

it('maps an imported zero-hit Outro to its kit cast', () => {
  const character: OwnedCharacter = { id: 'character', catalogId: '1110', level: 90, sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 0 }
  const catalogWeapon = weaponCatalog.find((entry) => entry.name === SUISUI.refinements[0]![0]!.name.replace(/ R\d$/, ''))!
  const weapon: OwnedWeapon = { id: 'weapon', catalogId: catalogWeapon.id, level: 90, rank: 1, locked: false, createdAt: 0 }
  const echoes = fixtureEchoes(SUISUI.echoLoadouts[0]!.mainslot.name, SUISUI.echoLoadouts[0]!.sets[0]!.name.replace(/ \dpc$/, ''))
  const build: Build = { id: 'build', name: 'Fixture', characterId: character.id, resonatorId: character.catalogId, weaponId: weapon.id, echoIds: echoes.map((echo) => echo.id), level: 90, skillLevel: 10 }
  const action = { id: 'outro', timestamp: 0, buildId: build.id, attackId: '1110:imported:483' }
  const team: Team = { id: 'team', name: 'Fixture', buildIds: [build.id], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 2, actions: [action] }
  const result = statefulPreview(team, [{ build, character, weapon, echoes }], [{ action, attack: { id: action.attackId, group: 'outro' } }])
  expect(result).toBeDefined()
  expect(result?.warnings.some((warning) => warning.includes('no compatible stateful cast'))).toBe(false)
  expect(result?.warnings.some((warning) => warning.includes('No saved cast is mapped'))).toBe(false)
  expect(result?.warnings.some((warning) => warning.includes('swaps in'))).toBe(true)
  const song = { ...action, id: 'song', attackId: 'wuwalab:Song%20of%20Thoroughfare', label: 'Liberation: Song of Thoroughfare', duration: 0.8 }
  const songResult = statefulPreview({ ...team, actions: [song] }, [{ build, character, weapon, echoes }], [{ action: song, attack: { id: song.attackId, group: 'liberation' } }])
  expect(songResult?.warnings.some((warning) => warning.includes('no compatible stateful cast'))).toBe(false)
  expect(songResult?.warnings.some((warning) => warning.includes('ends before'))).toBe(false)
})

it('matches Chisa casts outside the kit optimizer rotation', () => {
  const character: OwnedCharacter = { id: 'character', catalogId: '1508', level: 90, sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 0 }
  const catalogWeapon = weaponCatalog.find((entry) => entry.name === CHISA.refinements[0]![0]!.name.replace(/ R\d$/, ''))!
  const weapon: OwnedWeapon = { id: 'weapon', catalogId: catalogWeapon.id, level: 90, rank: 1, locked: false, createdAt: 0 }
  const echoes = fixtureEchoes(CHISA.echoLoadouts[0]!.mainslot.name, CHISA.echoLoadouts[0]!.sets[0]!.name.replace(/ \dpc$/, ''))
  const build: Build = { id: 'build', name: 'Fixture', characterId: character.id, resonatorId: character.catalogId, weaponId: weapon.id, echoIds: echoes.map((echo) => echo.id), level: 90, skillLevel: 10 }
  const action = { id: 'blitz', timestamp: 0, buildId: build.id, attackId: '1508-7-0' }
  const team: Team = { id: 'team', name: 'Fixture', buildIds: [build.id], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 2, actions: [action] }
  const result = statefulPreview(team, [{ build, character, weapon, echoes }], [{ action, attack: { id: action.attackId, group: 'forte' } }])
  expect(result?.warnings.some((warning) => warning.includes('no compatible stateful cast'))).toBe(false)
})

it('maps an owned catalog attack when imported timing data is absent', () => {
  const character: OwnedCharacter = { id: 'character', catalogId: '1404', level: 90, sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: 0 }
  const weaponName = JIYAN.refinements[0]![0]!.name.replace(/ R\d$/, '')
  const catalogWeapon = weaponCatalog.find((entry) => entry.name === weaponName)!
  const weapon: OwnedWeapon = { id: 'weapon', catalogId: catalogWeapon.id, level: 90, rank: 1, locked: false, createdAt: 0 }
  const name = JIYAN.echoLoadouts[0]!.mainslot.name
  const sonata = JIYAN.echoLoadouts[0]!.sets[0]!.name.replace(/ \dpc$/, '')
  const echoes = fixtureEchoes(name, sonata)
  const build: Build = { id: 'build', name: 'Fixture', characterId: character.id, resonatorId: character.catalogId, weaponId: weapon.id,
    echoIds: echoes.map((echo) => echo.id), level: 90, skillLevel: 10 }
  const attack = characterCatalog.find((entry) => entry.id === character.catalogId)!.attacks.find((entry) =>
    entry.hitMultipliers.length === 1 && Math.round(entry.hitMultipliers[0][9] * 10000) === 7316)!
  expect(attack).toBeDefined()
  const action = { id: 'cast', timestamp: 0, buildId: build.id, attackId: attack.id }
  const team: Team = { id: 'team', name: 'Fixture', buildIds: [build.id], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 1, actions: [action] }
  const result = statefulPreview(team, [{ build, character, weapon, echoes }], [{ action, attack: { id: attack.id, group: 'basic' } }])
  const formula = calculateBuildModes({ build, character, weapon, echoes, enemy: team.enemy, targetId: attack.id })
  expect(result?.complete).toBe(true)
  expect(result?.normal).toBe(formula.values.normal)
  expect(result?.critical).toBe(formula.values.critical)
  expect(result?.expected).toBe(formula.values.expected)
  expect(result?.expected).toBeGreaterThan(0)
  const timed = { ...action, cancel: 'normal' as const, cancelFrame: 8, swapFrame: 12 }
  const unsupported = statefulPreview({ ...team, actions: [timed] }, [{ build, character, weapon, echoes }], [{ action: timed, attack: { id: attack.id, group: 'basic' } }])
  expect(unsupported?.complete).toBe(false)
  expect(unsupported?.warnings.some((warning) => warning.includes('cannot replay yet'))).toBe(true)
})
