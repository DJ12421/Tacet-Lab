import { describe, expect, it } from 'vitest'
import { candidateErrors, normalizeOcrText, parseEchoText, parseStatLine } from './parser'
import { tunableRolls } from '../game-data/tunable-rolls'

describe('English Echo OCR parser', () => {
  it('normalizes common OCR punctuation without translating text', () => {
    expect(normalizeOcrText('  Crit.  Rate  6.3\uFF05\r\n\u2014 ATK 40 ')).toEqual(['Crit. Rate 6.3%', '- ATK 40'])
  })

  it('parses percent and flat English stat labels', () => {
    expect(parseStatLine('Crit. DMG 18.6%')).toEqual({ key: 'critDamage', value: 18.6 })
    expect(parseStatLine('Crit. Rate 10.5%,')).toEqual({ key: 'critRate', value: 10.5 })
    expect(parseStatLine('Crit. BMG 15%')).toEqual({ key: 'critDamage', value: 15 })
    expect(parseStatLine('ATK 40')).toEqual({ key: 'atk', value: 40 })
    expect(parseStatLine('ATK % 18.0%')).toEqual({ key: 'atkPercent', value: 18 })
    expect(parseStatLine('Resonance Skill DMG 8.6%')).toEqual({ key: 'skillDamage', value: 8.6 })
    expect(parseStatLine('Crit. Rate 220%')).toEqual({ key: 'critRate', value: 22 })
    expect(parseStatLine('Crit. DMG 186%')).toEqual({ key: 'critDamage', value: 18.6 })
    expect(parseStatLine('Crit. Rate 63%')).toEqual({ key: 'critRate', value: 6.3 })
    expect(parseStatLine('DEF 50')).toEqual({ key: 'def', value: 50 })
  })

  it('recovers a partial stat label only when its exact roll identifies one stat', () => {
    expect(parseStatLine('DEF Co 50')).toEqual({ key: 'def', value: 50 })
    expect(parseStatLine('ATK oo 8.6%')).toEqual({ key: 'atkPercent', value: 8.6 })
    expect(parseStatLine('Crit noise 15%')).toEqual({ key: 'critDamage', value: 15 })
    expect(parseStatLine('DEF Co 55')).toBeUndefined()
    expect(parseStatLine('Res noise 8.6%')).toBeUndefined()
    expect(parseStatLine('noise 50')).toBeUndefined()
    expect(parseStatLine('ATK and DEF 50')).toBeUndefined()
    expect(parseStatLine('ATK DEF 50')).toBeUndefined()
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

  it('recovers stats when OCR splits a label or value across lines', async () => {
    const candidate = await parseEchoText('Cyan-Feathered Heron\nCost 3\nLv. 25\nFusion DMG Bonus 30.0%\nATK 100\nCrit. Rate\n6.3%\nResonance Skill DMG\nBonus 8.6%\nATK 40', 'data:image/png;base64,split-rows', 'screenshot')
    expect(candidate.fields.subStats.map((field) => field.value)).toEqual([
      { key: 'critRate', value: 6.3 },
      { key: 'skillDamage', value: 8.6 },
      { key: 'atk', value: 40 }
    ])
  })

  it('removes only the fixed secondary main stat and preserves a matching flat ATK substat', async () => {
    const candidate = await parseEchoText('Cyan-Feathered Heron\nCost 3\n5 Star\nLv. 25\nCelestial Light\nFusion DMG Bonus 30.0%\nATK 100\nATK 50\nCrit. Rate 6.3%', 'data:image/png;base64,flat-atk', 'screenshot')
    expect(candidate.fields.mainStat.value).toEqual({ key: 'fusionDamage', value: 30 })
    expect(candidate.fields.subStats.map((field) => field.value)).toEqual([{ key: 'atk', value: 50 }, { key: 'critRate', value: 6.3 }])
  })

  it('does not promote a Character Menu substat when its main-stat OCR is missing', async () => {
    const text = 'Sentry Construct\nLv. 25\nCost 4\nATK 150\nCrit. DMG 15.0%\nCrit. Rate 6.3%'
    const candidate = await parseEchoText(text, 'data:image/png;base64,anchored-stats', 'screenshot', {}, {
      main: '', substats: 'Crit. DMG 15.0%\nCrit. Rate 6.3%'
    })
    expect(candidate.fields.mainStat.value.value).toBe(0)
    expect(candidate.fields.mainStat.confidence).toBeLessThan(.55)
    expect(candidate.fields.subStats.map((field) => field.value)).toEqual([
      { key: 'critDamage', value: 15 }, { key: 'critRate', value: 6.3 }
    ])
  })

  it('keeps the Character Menu main stat out of its substat list', async () => {
    const text = 'Sentry Construct\nLv. 25\nCost 4\nCrit. Rate 22.0%\nATK 150\nCrit. DMG 15.0%'
    const candidate = await parseEchoText(text, 'data:image/png;base64,separate-stats', 'screenshot', {}, {
      main: 'Crit. Rate 22.0%', substats: 'Crit. Rate 22.0%\nCrit. DMG 15.0%'
    })
    expect(candidate.fields.mainStat.value).toEqual({ key: 'critRate', value: 22 })
    expect(candidate.fields.subStats.map((field) => field.value)).toEqual([{ key: 'critDamage', value: 15 }])
  })

  it('recovers a Character Menu main stat from a close OCR label and its level value', async () => {
    const candidate = await parseEchoText('Forbidden Bastion\nLv. 25\nCost 3\nEnerqv Regen 32.0%\nATK 100', 'data:image/png;base64,fuzzy-main', 'screenshot', {
      sonata: { value: 'Song of Feathered Trace', confidence: .9 }
    }, {
      main: 'Enerqv Regen 32.0%', substats: 'HP 8.6%\nATK 8.6%\nHP 510\nDEF 10.0%\nCrit. Rate 9.9%'
    })
    expect(candidate.fields.mainStat.value).toEqual({ key: 'energyRegen', value: 32 })
    expect(candidate.fields.subStats).toHaveLength(5)
    expect(candidateErrors(candidate)).toEqual([])
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

  it('fuzzy-matches catalog source identity and Sonata names after OCR drift', async () => {
    const candidate = await parseEchoText('Cyan Feathered Her0n +25\nCOST 3\nCelestiaI Light\nSpectro DMG Bonus 30.0%\nCrit. Rate 6.3%', 'data:image/png;base64,fuzzy', 'screenshot')
    expect(candidate.fields.name.value).toBe('Cyan-Feathered Heron')
    expect(candidate.fields.cost.value).toBe(3)
    expect(candidate.fields.sonata.value).toBe('Celestial Light')
  })

  it('prefers a full catalog name over its shorter substring', async () => {
    const candidate = await parseEchoText('Nightmare: Aero Predator\nCost 1\nLv. 25\nATK 18.0%', 'data:image/png;base64,nightmare-name', 'screenshot')
    expect(candidate.fields.name.value).toBe('Nightmare: Aero Predator')
  })

  it('joins a wrapped Character Menu Echo name before matching the catalog', async () => {
    const candidate = await parseEchoText('Nightmare: Violet-Feathered\nHeron\nLv. 25\nCost 3\nAero DMG Bonus 30.0%', 'data:image/png;base64,wrapped-name', 'screenshot')
    expect(candidate.fields.name.value).toBe('Nightmare: Violet-Feathered Heron')
  })

  it('matches a Phantom variant by its catalog base name when artwork corrupts the suffix', async () => {
    const candidate = await parseEchoText('Phantom: Dreamlesg(e--+- 4 /,\nCost 4\nLv. 25\nCrit. DMG 44.0%', 'data:image/png;base64,phantom-name', 'screenshot')
    expect(candidate.fields.name.value).toBe('Dreamless')
  })

  it('matches accented Echo names when English OCR drops the accent', async () => {
    const candidate = await parseEchoText('Jue\nCost 4\nLv. 25\nCrit. Rate 22.0%', 'data:image/png;base64,jue', 'screenshot')
    expect(candidate.fields.name.value).toBe('Jué')
  })

  it('uses the recognized set symbol for an Echo with multiple possible Sonatas', async () => {
    const candidate = await parseEchoText('Cyan-Feathered\nHeron +25\nCOST 3\nSpectro DMG Bonus 30.0%', 'data:image/png;base64,symbol', 'screenshot', { sonata: { value: 'Sierra Gale', confidence: 0.91 } })
    expect(candidate.fields.name.value).toBe('Cyan-Feathered Heron')
    expect(candidate.fields.sonata).toMatchObject({ value: 'Sierra Gale', confidence: 0.91 })
  })

  it('requires review when a recognized Echo and Sonata cannot occur together', async () => {
    const candidate = await parseEchoText('Frostbite Coleoid\nCost 3\nLv. 25\nGlacio DMG Bonus 30.0%', 'data:image/png;base64,mismatch', 'screenshot', { sonata: { value: 'Pact of Neonlight Leap', confidence: .9 } })
    expect(candidate.fields.sonata.value).toBe('Pact of Neonlight Leap')
    expect(candidateErrors(candidate)).toContain('Frostbite Coleoid cannot use Pact of Neonlight Leap. Choose one of its available Sonata sets.')
    const weak = await parseEchoText('Frostbite Coleoid\nCost 3\nLv. 25\nGlacio DMG Bonus 30.0%', 'data:image/png;base64,weak-mismatch', 'screenshot', { sonata: { value: 'Pact of Neonlight Leap', confidence: .7 } })
    expect(weak.fields.sonata.value).not.toBe('Pact of Neonlight Leap')
  })

  it('snaps plausible OCR drift to exact tunable rolls and rejects impossible values', async () => {
    const candidate = await parseEchoText('Hooscamp\nCost 1\nLv. 25\nLingering Tunes\nATK % 18.0%\nCrit. Rate 6.2%\nATK 39', 'data:image/png;base64,rolls', 'screenshot')
    expect(candidate.fields.subStats.map((field) => field.value.value)).toEqual([6.3, 40])
    expect(candidateErrors(candidate)).toEqual([])
    candidate.fields.subStats[0].value.value = 6.5
    expect(candidateErrors(candidate)).toContain('Each tunable substat must match an exact in-game roll value.')
    expect(tunableRolls.critRate?.find((roll) => roll.value === 6.3)?.probability).toBe(23.33)
  })

  it('leaves an ambiguous dropped leading digit for review', async () => {
    const candidate = await parseEchoText('Hooscamp\nCost 1\nLv. 25\nLingering Tunes\nATK % 18.0%\nEnergy Regen 1.6%\nCrit. DMG 11.4%', 'data:image/png;base64,ambiguous-digits', 'screenshot')
    expect(candidate.fields.subStats.map((field) => field.value)).toEqual([
      { key: 'energyRegen', value: 1.6 },
      { key: 'critDamage', value: 17.4 }
    ])
    expect(candidate.fields.subStats.map((field) => field.raw)).toEqual(['1.6', '11.4'])
    expect(candidate.fields.subStats.map((field) => field.confidence)).toEqual([0.52, 0.84])
    expect(candidateErrors(candidate)).toContain('Each tunable substat must match an exact in-game roll value.')
  })
})
