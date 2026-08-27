import { describe, expect, it } from 'vitest'
import { calcDamage, calcHeal, calcShield } from './formulas'

describe('Tacet Lab calculation formulas', () => {
  it('calculates multi-hit damage, crit, defense, resistance, and bonuses independently', () => {
    const result = calcDamage('90', 100, 0.1, '50%*2', 2_000, 0, 0.2, 0.1, 0, 0.15, 0, 0.5, 2, 0, 0, 0, 1)
    const defense = 1_520 / (1_520 + 1_592)
    const expectedNormal = 2_000 * 1 * 1.3 * 1.15 * defense * 0.9
    expect(result.totalDamage).toBeCloseTo(expectedNormal)
    expect(result.critDamage).toBeCloseTo(expectedNormal * 2)
    expect(result.avgDamage).toBeCloseTo(expectedNormal * 1.5)
    expect(result.instanceDamageEntries).toHaveLength(2)
  })

  it('supports both percent-plus-flat and flat-plus-percent healing formulas', () => {
    expect(calcHeal('10% + 100', 1_000).healAmount).toBe(200)
    expect(calcHeal('100 + 10%', 1_000).healAmount).toBe(200)
  })

  it('applies shield bonus without applying critical damage', () => {
    expect(calcShield('20% + 50', 1_000, 0.3).shieldAmount).toBe(325)
  })
})
