import { describe, expect, it } from 'vitest'
import { canUseStatBlockWithoutRows, cardEchoConcurrency, classifyDiscordSequence, classifyWuwaflexSequence, confirmedDroppedDigitValue, discordCharacterLevelField, echoSignatureCandidates, findGoldBadgeRun, mapCardEchoes, mergeVerifiedStatRows, parseBuildCardStats, resolveKernelPuppetTint } from './build-card'
import { buildCardFormat, buildCardFormatRegions } from './build-card-formats'

it('distinguishes red Anger art from other similarly shaped Kernel Puppets', () => {
  const art = new Uint8ClampedArray(16 * 16 * 4)
  for (let pixel = 0; pixel < 30; pixel += 1) art.set([220, 65, 45, 255], pixel * 4)
  expect(resolveKernelPuppetTint('Kernel Puppet: Worry', art)).toBe('Kernel Puppet: Anger')
  expect(resolveKernelPuppetTint('Kernel Puppet: Fright', art)).toBe('Kernel Puppet: Anger')
  for (let pixel = 0; pixel < 30; pixel += 1) art.set([45, 110, 220, 255], pixel * 4)
  expect(resolveKernelPuppetTint('Kernel Puppet: Worry', art)).toBe('Kernel Puppet: Worry')
  expect(resolveKernelPuppetTint('Abyssal Gladius', art)).toBe('Abyssal Gladius')
})

it('scans up to three Echoes at once and keeps card order', async () => {
  let active = 0, peak = 0
  const results = await mapCardEchoes(5, async (index) => {
    active += 1; peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5 - index))
    active -= 1
    return index
  })
  expect(peak).toBe(3)
  expect(results).toEqual([0, 1, 2, 3, 4])
})

it('allows all five Echoes to scan together when given more than four OCR workers', async () => {
  expect(cardEchoConcurrency(4)).toBe(3)
  expect(cardEchoConcurrency(6)).toBe(5)
  expect(cardEchoConcurrency(8)).toBe(5)
  let active = 0, peak = 0
  const results = await mapCardEchoes(5, async (index) => {
    active += 1; peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active -= 1
    return index
  }, cardEchoConcurrency(6))
  expect(peak).toBe(5)
  expect(results).toEqual([0, 1, 2, 3, 4])
})

describe('Discord Bot character level badge', () => {
  it('reads a level only from the badge text', () => {
    expect(discordCharacterLevelField('Verina LV.80').value).toBe(80)
    expect(discordCharacterLevelField('LV.8O').value).toBe(80)
    expect(discordCharacterLevelField('80').value).toBe(80)
    expect(discordCharacterLevelField('Verina').confidence).toBe(.25)
  })
  it('finds the badge after names of different lengths and ignores short gold artwork', () => {
    for (const badgeStart of [35, 180]) {
      const pixels = new Uint8ClampedArray(280 * 4)
      for (const [start, end] of [[5, 13], [badgeStart, badgeStart + 62]]) {
        for (let x = start; x < end; x += 1) pixels.set([180, 150, 70, 255], x * 4)
      }
      expect(findGoldBadgeRun(pixels, 30)).toEqual({ start: badgeStart, length: 62 })
    }
  })
})

it('uses a strong Lamp of Nether Road badge to exclude similar Echo art from other sets', () => {
  const names = echoSignatureCandidates(1, 'Lamp of Nether Road').map((entry) => entry.name)
  expect(names).toContain('Kernel Puppet: Grief')
  expect(names).not.toContain('Kernel Puppet: Joy')
})

describe('Discord Bot sequence stars', () => {
  it('counts the filled prefix and lowers confidence for inconsistent stars', () => {
    const two = classifyDiscordSequence([180, 177, 114, 114, 113, 114])
    expect(two.value).toBe(2)
    expect(two.confidence).toBeGreaterThan(.8)
    expect(classifyDiscordSequence([114, 115, 114, 114, 113, 113]).value).toBe(0)
    expect(classifyDiscordSequence([180, 177, 180, 177, 180, 177]).value).toBe(6)
    expect(classifyDiscordSequence([180, 114, 180, 114, 114, 114]).confidence).toBe(.25)
    expect(classifyDiscordSequence([NaN, 114, 114, 114, 114, 114]).confidence).toBe(0)
    expect(classifyDiscordSequence([20, 20, 20, 20, 20, 20]).confidence).toBe(0)
  })
})

describe('WuWaFlex card layout and sequence icons', () => {
  it('uses one label for all sizes and includes sequence and Echo name regions', () => {
    for (const id of ['wuwaflex', 'wuwaflex-1580', 'wuwaflex-1272', 'wuwaflex-1377'] as const) {
      expect(buildCardFormat(id).label).toBe('WuWaFlex')
      expect(buildCardFormatRegions(id).some((region) => region.id === 'sequence')).toBe(true)
      expect(buildCardFormatRegions(id).filter((region) => /^echo-\d+-name$/.test(region.id))).toHaveLength(5)
    }
  })

  it('uses the tighter five-row spacing only for 3416×1580 cards', () => {
    for (let index = 0; index < 5; index += 1) {
      const shorter = buildCardFormat('wuwaflex-1580').echoes[index].stats
      const standard = buildCardFormat('wuwaflex').echoes[index].stats
      expect(shorter.y * 1580).toBeCloseTo(1224)
      expect(shorter.height * 1580 / 5).toBeCloseTo(60.8)
      expect((shorter.y + shorter.height) * 1580).toBeCloseTo(1528)
      expect(standard.height * 1600 / 5).toBeCloseTo(72)
    }
  })

  it('counts only a consistent prefix of white sequence icons', () => {
    expect(classifyWuwaflexSequence([0, 0, 0, 0, 0, 0]).value).toBe(0)
    expect(classifyWuwaflexSequence([.3, .32, 0, 0, 0, 0]).value).toBe(2)
    expect(classifyWuwaflexSequence([.25, .32, .25, .3, 0, 0]).value).toBe(4)
    expect(classifyWuwaflexSequence([.3, .3, .3, .3, .3, .3]).value).toBe(6)
    expect(classifyWuwaflexSequence([.3, 0, .3, 0, 0, 0]).confidence).toBe(.25)
    expect(classifyWuwaflexSequence([NaN, 0, 0, 0, 0, 0]).confidence).toBe(0)
  })
})

describe('official build-card stat parsing', () => {
  it('skips row OCR only for five distinct exact rolls read with high confidence', () => {
    const block = 'ATK 40\nCrit. DMG 13.8%\nEnergy Regen 7.6%\nHeavy Attack 8.6%\nHP 7.9%'
    expect(canUseStatBlockWithoutRows(block, .96)).toBe(true)
    expect(canUseStatBlockWithoutRows(block, .94)).toBe(false)
    expect(canUseStatBlockWithoutRows(block.replace('7.6%', '7.5%'), .96)).toBe(false)
    expect(canUseStatBlockWithoutRows(block.replace('7.6%', '76%'), .96)).toBe(false)
    expect(canUseStatBlockWithoutRows(block.replace('HP 7.9%', 'ATK 40'), .96)).toBe(false)
  })
  it('keeps Discord Bot substats separate when the main-stat value OCR drops digits', () => {
    const reactor = parseBuildCardStats('ATK 40\nCrit. DMG 13.8%\nEnergy Regen 10.8%\nHeavy Attack DMG Bonus 8.6%\nHP 7.9%', 4, { label: 'DEF', value: '1.8%' })
    expect(reactor.mainStat.key).toBe('defPercent')
    expect(reactor.subStats.map((field) => field.value)).toEqual([
      { key: 'atk', value: 40 }, { key: 'critDamage', value: 13.8 }, { key: 'energyRegen', value: 10.8 },
      { key: 'heavyDamage', value: 8.6 }, { key: 'hpPercent', value: 7.9 }
    ])

    const drone = parseBuildCardStats('ATK 8.6%\nHeavy Attack DMG Bonus 10.1%\nDEF 60\nResonance Liberation 6.4%', 1, { label: 'DEF', value: '318%' })
    expect(drone.mainStat.key).toBe('defPercent')
    expect(drone.subStats[0].value).toEqual({ key: 'atkPercent', value: 8.6 })
  })
  it('uses an exact high-confidence row value without losing other block rows', () => {
    const block = 'Crit. Rate 7.5%\nEnergy Regen 1.6%\nATK 50\nHeavy Attack 7.9%\nCrit. DMG 12.6%'
    const rows = ['?', 'Energy Regen 11.6%', '', 'Heavy Attack 7.9%', 'Crit. DMG 12.6%'].map((text) => ({ text, confidence: .94 }))
    const merged = mergeVerifiedStatRows(block, rows)
    expect(merged).toContain('Energy Regen 11.6%')
    expect(parseBuildCardStats(merged, 3, { label: 'Spectro DMG', value: '30%' }).subStats.map((field) => field.value)).toContainEqual({ key: 'energyRegen', value: 11.6 })
  })
  it('ignores isolated OCR punctuation after a WuWaFlex stat label', () => {
    const parsed = parseBuildCardStats('ATK ! 9.4%\nCrit. Rate 9.3%', 1, { label: 'ATK', value: '18%' })
    expect(parsed.subStats[0].value).toEqual({ key: 'atkPercent', value: 9.4 })
  })
  it('ignores a stray single letter after a stat label', () => {
    const parsed = parseBuildCardStats('Res. Liberation j 10.9%\nCrit. DMG j 15%', 4, { label: 'Crit. DMG', value: '44%' })
    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'liberationDamage', value: 10.9 },
      { key: 'critDamage', value: 15 }
    ])
  })
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

  it('keeps a dropped leading digit unresolved when both 7.X and 11.X are possible', () => {
    const parsed = parseBuildCardStats('Fusion DMG 30.0%\nCrit. Rate 10.5%\nEnergy Regen 1.6%', 3)

    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'critRate', value: 10.5 },
      { key: 'energyRegen', value: 1.6 }
    ])
    expect(parsed.subStats[1]).toMatchObject({ raw: '1.6', confidence: .5 })
    expect(parseBuildCardStats('Crit. Rate 1.5%', 1, { label: 'ATK', value: '18%' }).subStats[0])
      .toMatchObject({ value: { key: 'critRate', value: 7.5 }, confidence: .8 })
  })

  it('accepts only a matching exact roll from a second value read', () => {
    expect(confirmedDroppedDigitValue('Energy Regen 1.6%', '7.6%')).toBe('Energy Regen 7.6%')
    expect(confirmedDroppedDigitValue('Energy Regen 1.6%', '11.6%')).toBe('Energy Regen 11.6%')
    expect(confirmedDroppedDigitValue('Energy Regen 1.6%', '11.8%')).toBeUndefined()
    expect(confirmedDroppedDigitValue('Crit. Rate 1.5%', '11.5%')).toBeUndefined()
  })

  it('restores a dropped leading digit only when one exact roll is possible', () => {
    const parsed = parseBuildCardStats('DEF 1.8%\nCrit. DMG 2.6%', 4, { label: 'DEF', value: '41.8%' })
    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'defPercent', value: 11.8 },
      { key: 'critDamage', value: 12.6 }
    ])
    expect(parsed.subStats.map((field) => field.confidence)).toEqual([.8, .8])
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

  it('parses five WuWaFlex rows with abbreviated Resonance and flat stats', () => {
    const parsed = parseBuildCardStats('Res. Liberation 10.9%\nCrit. DMG 15%\nHP 7.9%\nDEF 50\nCrit. Rate 9.9%', 4, { label: 'Crit. DMG', value: '44%' })

    expect(parsed.mainStat).toEqual({ key: 'critDamage', value: 44 })
    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'liberationDamage', value: 10.9 },
      { key: 'critDamage', value: 15 },
      { key: 'hpPercent', value: 7.9 },
      { key: 'def', value: 50 },
      { key: 'critRate', value: 9.9 }
    ])
  })

  it('keeps each Echo row from a WuWaFlex card as a separate stat', () => {
    const parsed = parseBuildCardStats('Crit. Rate 7.5%\nHP 390\nEnergy Regen 9.2%\nHeavy Attack 9.4%\nCrit. DMG 13.8%', 1, { label: 'HP', value: '22.8%' })

    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'critRate', value: 7.5 },
      { key: 'hp', value: 390 },
      { key: 'energyRegen', value: 9.2 },
      { key: 'heavyDamage', value: 9.4 },
      { key: 'critDamage', value: 13.8 }
    ])
  })

  it('recovers a partially recognized WuWaFlex row among five different substats', () => {
    const parsed = parseBuildCardStats('ATK 8.6%\nDEF Co 50\nCritDMG 15%\nCrit. Rate 9.3%\nATK 40', 4, { label: 'Crit. DMG', value: '44%' })
    expect(parsed.subStats.map((field) => field.value)).toEqual([
      { key: 'atkPercent', value: 8.6 },
      { key: 'def', value: 50 },
      { key: 'critDamage', value: 15 },
      { key: 'critRate', value: 9.3 },
      { key: 'atk', value: 40 }
    ])
  })
})
