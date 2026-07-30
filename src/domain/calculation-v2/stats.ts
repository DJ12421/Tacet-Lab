import type { AggregatedStats, Element } from '../types'
import type { CalculationStatsV2 } from './types'

const elements: Element[] = ['spectro', 'fusion', 'glacio', 'electro', 'aero', 'havoc']

export function calculationStatsFromAggregated(stats: AggregatedStats): CalculationStatsV2 {
  return {
    baseHp: stats.baseHp,
    baseAtk: stats.baseAtk,
    baseDef: stats.baseDef,
    hp: stats.hp,
    atk: stats.atk,
    def: stats.def,
    critRate: stats.critRate,
    critDamage: stats.critDamage,
    energyRegen: stats.energyRegen,
    healingBonus: stats.healingBonus,
    shieldBonus: 0,
    damageBonus: 0,
    elementalDamage: {
      spectro: stats.spectroDamage,
      fusion: stats.fusionDamage,
      glacio: stats.glacioDamage,
      electro: stats.electroDamage,
      aero: stats.aeroDamage,
      havoc: stats.havocDamage
    },
    typeDamage: {
      basic: stats.basicDamage,
      heavy: stats.heavyDamage,
      skill: stats.skillDamage,
      liberation: stats.liberationDamage
    }
  }
}

export function emptyCalculationStatsV2(): CalculationStatsV2 {
  return {
    baseHp: 0,
    baseAtk: 0,
    baseDef: 0,
    hp: 0,
    atk: 0,
    def: 0,
    critRate: 5,
    critDamage: 150,
    energyRegen: 100,
    healingBonus: 0,
    shieldBonus: 0,
    damageBonus: 0,
    elementalDamage: Object.fromEntries(elements.map((element) => [element, 0])) as CalculationStatsV2['elementalDamage'],
    typeDamage: {}
  }
}

export function cloneCalculationStatsV2(stats: CalculationStatsV2): CalculationStatsV2 {
  return {
    ...stats,
    elementalDamage: { ...stats.elementalDamage },
    typeDamage: { ...stats.typeDamage }
  }
}
