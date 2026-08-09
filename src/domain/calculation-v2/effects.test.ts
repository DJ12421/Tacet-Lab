import { describe, expect, it } from 'vitest'
import { emptyStats } from '../damage'
import { applyCalculationEffects, createEffectAccumulator } from './effects'
import { calculationStatsFromAggregated } from './stats'
import type { CalculationEffectDefinition } from './types'

const sourceScaledCritEffect = (sourceBuildId?: string): CalculationEffectDefinition => ({
  id: 'universal-source-scaled-crit',
  key: 'UniversalSourceScaledCrit',
  name: 'Source-scaled team Crit',
  description: 'Test fixture for any provider-scaled team effect.',
  sourceKind: sourceBuildId ? 'party' : 'character',
  sourceId: 'fixture-provider',
  sourceBuildId,
  scope: sourceBuildId ? 'team' : 'self',
  valueUnit: 'decimal',
  alwaysEnabled: false,
  hasStacks: false,
  minStacks: 0,
  maxStacks: 0,
  modifiers: [{
    modifier: 'CritRate:AdditionalBase',
    modifierValue: 0.00001,
    maximumValue: 0.125,
    modifierStep: 0.02,
    modifierBasedOn: 'EnergyRegen',
    modifierTargetAttr: 'CritRate',
    minStatValue: 0
  }]
})

describe('Calculation V2 universal source-scaled effects', () => {
  it('reads a team effect dependency from the provider instead of the recipient', () => {
    const recipient = calculationStatsFromAggregated({ ...emptyStats(), energyRegen: 100, critRate: 5 })
    const provider = calculationStatsFromAggregated({ ...emptyStats(), energyRegen: 250 })
    const accumulator = createEffectAccumulator(recipient)
    const effect = sourceScaledCritEffect('provider-build')

    applyCalculationEffects(
      accumulator,
      [effect],
      { [effect.id]: { enabled: true } },
      { key: 'attack', name: 'Attack' },
      {},
      0,
      undefined,
      { 'provider-build': provider }
    )

    expect(accumulator.stats.critRate).toBeCloseTo(17.5)
  })

  it('keeps the recipient as the dependency owner for self effects', () => {
    const recipient = calculationStatsFromAggregated({ ...emptyStats(), energyRegen: 100, critRate: 5 })
    const accumulator = createEffectAccumulator(recipient)
    const effect = sourceScaledCritEffect()

    applyCalculationEffects(accumulator, [effect], { [effect.id]: { enabled: true } }, { key: 'attack', name: 'Attack' }, {}, 0)

    expect(accumulator.stats.critRate).toBeCloseTo(10)
  })

  it('applies only the strongest enabled effect in a shared stacking group', () => {
    const recipient = calculationStatsFromAggregated({ ...emptyStats(), critRate: 5 })
    const accumulator = createEffectAccumulator(recipient)
    const weak = {
      ...sourceScaledCritEffect('first-provider'),
      id: 'weak-team-crit',
      stackingGroup: 'shared-team-crit',
      modifiers: [{ modifier: 'CritRate', modifierValue: 0.1 }]
    } satisfies CalculationEffectDefinition
    const strong = {
      ...sourceScaledCritEffect('second-provider'),
      id: 'strong-team-crit',
      stackingGroup: 'shared-team-crit',
      modifiers: [{ modifier: 'CritRate', modifierValue: 0.2 }]
    } satisfies CalculationEffectDefinition

    applyCalculationEffects(accumulator, [weak, strong], {
      [weak.id]: { enabled: true },
      [strong.id]: { enabled: true }
    }, { key: 'attack', name: 'Attack' }, {}, 0)

    expect(accumulator.stats.critRate).toBeCloseTo(25)
  })
})
