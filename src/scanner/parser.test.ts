import { describe, expect, it } from 'vitest'
import { candidateErrors, normalizeOcrText, parseEchoText, parseStatLine } from './parser'
import { tunableRolls } from '../game-data/tunable-rolls'

describe('English Echo OCR parser', () => {
  it('normalizes common OCR punctuation without translating text', () => {
    expect(normalizeOcrText('  Crit.  Rate  6.3\uFF05\r\n\u2014 ATK 40 ')).toEqual(['Crit. Rate 6.3%', '- ATK 40'])
  })

  it('parses percent and flat English stat labels', () => {
    expect(parseStatLine('Crit. DMG 18.6%')).toEqual({ key: 'critDamage', value: 18.6 })
    expect(parseStatLine('ATK 40')).toEqual({ key: 'atk', value: 40 })
    expect(parseStatLine('ATK % 18.0%')).toEqual({ key: 'atkPercent', value: 18 })
    expect(parseStatLine('Resonance Skill DMG 8.6%')).toEqual({ key: 'skillDamage', value: 8.6 })
    expect(parseStatLine('Crit. Rate 220%')).toEqual({ key: 'critRate', value: 22 })
    expect(parseStatLine('Crit. DMG 186%')).toEqual({ key: 'critDamage', value: 18.6 })
    expect(parseStatLine('Crit. Rate 63%')).toEqual({ key: 'critRate', value: 6.3 })
    expect(parseStatLine('DEF 50')).toEqual({ key: 'def', value: 50 })
  })

  it('returns low confidence defaults instead of silently inventing missing fields', async () => {
    const candidate = await parseEchoText('Hooscamp\nCost 1\n5 Star\nLv. 25\nLingering Tunes\nATK % 18.0%\nCrit. Rate 6.3%', 'data:image/png;base64,abc', 'screenshot')
    expect(candidate.fields.name.value).toBe('Hooscamp')
    expect(candidate.fields.sonata.value).toBe('Lingering Tunes')
    expect(candidate.fields.subStats[0].value.key).toBe('critRate')
  })

  it('uses the parsed level when limiting recognized substats', async () => {
    const candidate = await parseEchoText('Hooscamp\nCost 1\n5 Star\nLv. 5\nLingering Tunes\nATK % 6.4%\nCrit. Rate 6.3%\nATK 40', 'data:image/png;base64,level', 'screenshot')
    expect(candidate.fields.level.value).toBe(5)
    expect(candidate.fields.subStats.map((field) => field.value.key)).toEqual(['critRate'])
  })

  it('removes only the fixed secondary main stat and preserves a matching flat ATK substat', async () => {
    const candidate = await parseEchoText('Cyan-Feathered Heron\nCost 3\n5 Star\nLv. 25\nCelestial Light\nFusion DMG Bonus 30.0%\nATK 100\nATK 50\nCrit. Rate 6.3%', 'data:image/png;base64,flat-atk', 'screenshot')
    expect(candidate.fields.mainStat.value).toEqual({ key: 'fusionDamage', value: 30 })
    expect(candidate.fields.subStats.map((field) => field.value)).toEqual([{ key: 'atk', value: 50 }, { key: 'critRate', value: 6.3 }])
  })

  it('removes only the fixed secondary main stat and preserves a matching flat HP substat', async () => {
    const candidate = await parseEchoText('Hooscamp\nCost 1\n5 Star\nLv. 25\nLingering Tunes\nATK % 18.0%\nHP 2280\nHP 470\nCrit. Rate 6.3%', 'data:image/png;base64,flat-hp', 'screenshot')
    expect(candidate.fields.subStats.map((field) => field.value)).toEqual([{ key: 'hp', value: 470 }, { key: 'critRate', value: 6.3 }])
  })
  it('uses catalog metadata and limits tuned stats to the detail block', async () => {
    const candidate = await parseEchoText('Cyan Feathered Heron +25\nCOST 3\nCelestial Light\nSpectro DMG Bonus 30.0%\nATK 100\nCrit. DMG 12.6%\nEcho Skills: Countermeasures\nAero DMG 236.80%\nEquipped by Lucy', 'data:image/png;base64,cyan', 'screenshot', { rarity: { value: 5, confidence: 0.94 } })
    expect(candidate.fields.name.value).toBe('Cyan-Feathered Heron')
    expect(candidate.fields.sonata.value).toBe('Celestial Light')
    expect(candidate.fields.subStats.map((field) => field.value.value)).toEqual([12.6])
    expect(candidate.fields.equippedBy.value).toBe('Lucy')
  })

  it('reads equipment only from the footer instead of skill prose', async () => {
    const candidate = await parseEchoText('Reminiscence - Nightmare: Adam\nSmasher +25\nCOST 4\nCrit. Rate 220%\nATK 150\nCrit. DMG 186%\nCrit. Rate 63%\nDEF 50\nHeavy Attack DMG Bonus 7.9%\nEcho Skill\nWhen Lucy uses this skill, if equipped by Lucy press the Echo Skill button\n窶｢ Equipped by Lucy\nSwitch\nUpgrade', 'data:image/png;base64,adam', 'screenshot')
    expect(candidate.fields.name.value).toBe('Reminiscence - Nightmare: Adam Smasher')
    expect(candidate.fields.sonata.value).toBe('Shadow of Shattered Dreams')
    expect(candidate.fields.mainStat.value.value).toBe(22)
    expect(candidate.fields.subStats.map((field) => field.value.value)).toEqual([18.6, 6.3, 50, 7.9])
    expect(candidate.fields.equippedBy.value).toBe('Lucy')
  })

  it('preserves punctuation in equipped character names and accepts punctuation separators', async () => {
    const colonName = await parseEchoText('Hooscamp\nCost 1\nLv. 25\nLingering Tunes\nATK % 18.0%\nEquipped by Yangyang: Xuanling', 'data:image/png;base64,equipped-colon', 'screenshot')
    const separator = await parseEchoText('Hooscamp\nCost 1\nLv. 25\nLingering Tunes\nATK % 18.0%\nEquipped by; Yangyang: Xuanling', 'data:image/png;base64,equipped-separator', 'screenshot')
    expect(colonName.fields.equippedBy.value).toBe('Yangyang: Xuanling')
    expect(separator.fields.equippedBy.value).toBe('Yangyang: Xuanling')
  })

  it('fuzzy-matches Nanoka identity and Sonata names after OCR drift', async () => {
    const candidate = await parseEchoText('Cyan Feathered Her0n +25\nCOST 3\nCelestiaI Light\nSpectro DMG Bonus 30.0%\nCrit. Rate 6.3%', 'data:image/png;base64,fuzzy', 'screenshot')
    expect(candidate.fields.name.value).toBe('Cyan-Feathered Heron')
    expect(candidate.fields.cost.value).toBe(3)
    expect(candidate.fields.sonata.value).toBe('Celestial Light')
  })

  it('uses the recognized set symbol for an Echo with multiple possible Sonatas', async () => {
    const candidate = await parseEchoText('Cyan-Feathered\nHeron +25\nCOST 3\nSpectro DMG Bonus 30.0%', 'data:image/png;base64,symbol', 'screenshot', { sonata: { value: 'Sierra Gale', confidence: 0.91 } })
    expect(candidate.fields.name.value).toBe('Cyan-Feathered Heron')
    expect(candidate.fields.sonata).toMatchObject({ value: 'Sierra Gale', confidence: 0.91 })
  })

  it('snaps plausible OCR drift to exact tunable rolls and rejects impossible values', async () => {
    const candidate = await parseEchoText('Hooscamp\nCost 1\nLv. 25\nLingering Tunes\nATK % 18.0%\nCrit. Rate 6.2%\nATK 39', 'data:image/png;base64,rolls', 'screenshot')
    expect(candidate.fields.subStats.map((field) => field.value.value)).toEqual([6.3, 40])
    expect(candidateErrors(candidate)).toEqual([])
    candidate.fields.subStats[0].value.value = 6.5
    expect(candidateErrors(candidate)).toContain('Each tunable substat must match an exact in-game roll value.')
    expect(tunableRolls.critRate?.find((roll) => roll.value === 6.3)?.probability).toBe(23.33)
  })

  it('resolves an OCR-confused 1 or 7 only when the swap produces one exact roll', async () => {
    const candidate = await parseEchoText('Hooscamp\nCost 1\nLv. 25\nLingering Tunes\nATK % 18.0%\nEnergy Regen 1.6%\nCrit. DMG 11.4%', 'data:image/png;base64,ambiguous-digits', 'screenshot')
    expect(candidate.fields.subStats.map((field) => field.value)).toEqual([
      { key: 'energyRegen', value: 7.6 },
      { key: 'critDamage', value: 17.4 }
    ])
    expect(candidate.fields.subStats.map((field) => field.raw)).toEqual(['1.6', '11.4'])
    expect(candidate.fields.subStats.map((field) => field.confidence)).toEqual([0.84, 0.84])
  })
})
