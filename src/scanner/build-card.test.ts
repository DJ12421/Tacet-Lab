import { describe, expect, it } from 'vitest'
import { parseBuildCardStats } from './build-card'

describe('official build-card stat parsing', () => {
  it('preserves a flat ATK substat when the fixed secondary main stat is outside the substat crop', () => {
    const parsed = parseBuildCardStats([
      'Fusion DMG 30.0%',
      'ATK 9.4%',
      'Heavy Attack DMG Bonus 8.6%',
      'Crit. Rate 9.3%',
      'ATK 30',
      'Resonance Liberation DMG Bonus 8.6%'
    ].join('\n'), 3)

    expect(parsed.mainStat).toEqual({ key: 'fusionDamage', value: 30 })
    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'atkPercent', value: 9.4 },
      { key: 'heavyDamage', value: 8.6 },
      { key: 'critRate', value: 9.3 },
      { key: 'atk', value: 30 },
      { key: 'liberationDamage', value: 8.6 }
    ])
  })

  it('preserves a flat HP substat for one-cost Echo build cards', () => {
    const parsed = parseBuildCardStats('ATK 18.0%\nHP 470\nCrit. Rate 6.3%', 1)

    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'hp', value: 470 },
      { key: 'critRate', value: 6.3 }
    ])
  })

  it('resolves a build-card 1/7 OCR confusion to the exact Energy Regen roll', () => {
    const parsed = parseBuildCardStats('Fusion DMG 30.0%\nCrit. Rate 10.5%\nEnergy Regen 1.6%', 3)

    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'critRate', value: 10.5 },
      { key: 'energyRegen', value: 7.6 }
    ])
    expect(parsed.subStats[1]).toMatchObject({ raw: '1.6', confidence: .8 })
  })

  it('joins separate WuWaFlex main-stat OCR while preserving the same substat', () => {
    const parsed = parseBuildCardStats('Crit. Rate 8.1%\nHP 8.6%', 4, { label: 'Crit. Rate\n', value: '22%\n' })

    expect(parsed.mainStat).toEqual({ key: 'critRate', value: 22 })
    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'critRate', value: 8.1 },
      { key: 'hpPercent', value: 8.6 }
    ])
  })

  it('treats a one-cost WuWaFlex HP main as percentage when number OCR drops the percent sign', () => {
    const parsed = parseBuildCardStats('HP 8.6%\nCrit. Rate 8.1%', 1, { label: 'HP', value: '22.8' })

    expect(parsed.mainStat).toEqual({ key: 'hpPercent', value: 22.8 })
    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'hpPercent', value: 8.6 },
      { key: 'critRate', value: 8.1 }
    ])
  })
})
