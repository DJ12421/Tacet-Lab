import { expect, it } from 'vitest'
import type { ActionFormula } from '../../domain/combat'
import { generatedCharacterCatalog } from '../characters.generated'
import { importedAdditionalActions } from './imported-actions'

const hitValues = (formula: ActionFormula) => formula.kind === 'damage' ? formula.hits.map((hit) => Math.round(hit * 10000)) : []

it('uses catalog hit values at the selected skill level for matched imported variants', () => {
  const catalog = generatedCharacterCatalog.find((character) => character.id === '1505')!
  for (const [importedId, catalogId] of [
    ['1505:imported:333', '1505-7-1'], // Illation
    ['1505:imported:324', '1505-6-1'] // HP-scaling Discernment
  ]) {
    const imported = importedAdditionalActions['1505'][importedId]
    const attack = catalog.attacks.find((entry) => entry.id === catalogId)!
    expect(imported.skillLevelIndex).toBe(attack.skillLevelIndex)
    for (const level of [1, 5, 10]) {
      expect(imported.formulas[level]).toMatchObject({
        kind:'damage', hits:attack.hitMultipliers.map((hit) => hit[level - 1])
      })
    }
  }
  const sanhua = generatedCharacterCatalog.find((character) => character.id === '1102')!
  const detonate = sanhua.attacks.find((attack) => attack.id === '1102-7-0')!
  const heavy = importedAdditionalActions['1102']['1102:imported:999652']
  expect(heavy.skillLevelIndex).toBe(2)
  expect(heavy.formulas[1]).toMatchObject({ kind:'damage', hits:detonate.hitMultipliers.map((hit) => hit[0]) })
})

it('keeps unmatched imported variants limited to their supplied level', () => {
  const action = importedAdditionalActions['1103']['1103:imported:684']
  expect(action.formulas[1].kind).toBe('unsupported')
  expect(action.formulas[10].kind).toBe('damage')
})

it('preserves repeated and partial hit counts while using catalog levels', () => {
  const shorekeeper = generatedCharacterCatalog.find((character) => character.id === '1505')!
  const butterfly = shorekeeper.attacks.find((attack) => attack.id === '1505-2-0')!
  expect(importedAdditionalActions['1505']['1505:imported:331'].formulas[1]).toMatchObject({
    kind:'damage', hits:Array(5).fill(butterfly.hitMultipliers[0][0])
  })

  const zhezhi = generatedCharacterCatalog.find((character) => character.id === '1105')!
  const midair = zhezhi.attacks.find((attack) => attack.id === '1105-1-4')!
  expect(importedAdditionalActions['1105']['1105:imported:576'].formulas[1]).toMatchObject({
    kind:'damage', hits:midair.hitMultipliers.slice(0, 5).map((hit) => hit[0])
  })
})

it('keeps Mornye cast damage separate from Syntony Field damage', () => {
  const actions = importedAdditionalActions['1209']
  expect(actions['1209:imported:417']).toMatchObject({ damageType:'intro', element:'fusion', formulas:{
    1:{ kind:'damage' }, 10:{ kind:'damage' }
  } })
  expect(hitValues(actions['1209:imported:417'].formulas[1])).toEqual([10200])
  expect(hitValues(actions['1209:imported:417'].formulas[10])).toEqual([20279])
  expect(actions['1209:imported:430']).toMatchObject({ damageType:'heavy', element:'fusion', formulas:{
    1:{ kind:'damage' }, 10:{ kind:'damage' }
  } })
  expect(hitValues(actions['1209:imported:430'].formulas[1])).toEqual([2220, 4981])
  expect(hitValues(actions['1209:imported:430'].formulas[10])).toEqual([4414, 9902])
})

it('keeps Electro Rover Thrum damage separate from Thunder Bane', () => {
  for (const characterId of ['1309', '1310']) {
    const actions = importedAdditionalActions[characterId]
    for (const id of [999851, 999852, 999853, 999854, 999855, 999856, 999857, 999858, 999859, 999860, 999861, 999862, 999863, 999864]) {
      expect(actions[`${characterId}:imported:${id}`].formulas[1].kind).toBe('damage')
      expect(actions[`${characterId}:imported:${id}`].formulas[10].kind).toBe('damage')
    }
    expect(actions[`${characterId}:imported:999853`].element).toBe('spectro')
    expect(hitValues(actions[`${characterId}:imported:999853`].formulas[10])).toEqual([9912])
    expect(actions[`${characterId}:imported:999864`].element).toBe('aero')
    expect(hitValues(actions[`${characterId}:imported:999864`].formulas[10])).toEqual([4707, 4707, 4707, 4707, 4707, 23533])
  }
})
