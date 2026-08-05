import { describe, expect, it } from 'vitest'
import { emptyStats } from '../damage'
import { createEffectAccumulator } from './effects'
import { calculateAttackV2, calculateAttackV2Compact } from './damage'
import { calculationStatsFromAggregated } from './stats'
import type { CalculationAttackDefinition, CalculationEnemyV2 } from './types'

describe('Calculation V2 compact optimizer result', () => {
  it('matches the traced calculation result without allocating traces', () => {
    const stats = emptyStats()
    Object.assign(stats, { baseAtk: 900, atk: 1800, critRate: 60, critDamage: 220, fusionDamage: 30, skillDamage: 20 })
    const attack: CalculationAttackDefinition = {
      id: 'compact-test', key: 'compact-test', name: 'Compact test', group: 'Resonance Skill',
      type: 'skill', element: 'fusion', attribute: 'attack', talents: { '1': '100%' }, count: 1
    }
    const enemy: CalculationEnemyV2 = {
      level: 100, resistance: 10, damageReduction: 0, defenseIgnore: 0, defenseReduction: 0,
      resistanceIgnore: 0, resistanceReduction: 0, specialMultiplier: 0, enemyClass: 'overlord', statusStacks: {}
    }
    const traced = calculateAttackV2({ attack, talentLevel: 1, characterLevel: 90, accumulator: createEffectAccumulator(calculationStatsFromAggregated(stats)), enemy })
    const compact = calculateAttackV2Compact({ attack, talentLevel: 1, characterLevel: 90, accumulator: createEffectAccumulator(calculationStatsFromAggregated(stats)), enemy })
    expect(compact).toEqual({
      attackId: traced.attackId,
      normal: traced.normal,
      critical: traced.critical,
      expected: traced.expected
    })
  })
})
