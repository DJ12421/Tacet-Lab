import { describe, expect, it } from 'vitest'
import type { Echo } from './types'
import { characterCatalog } from '../game-data'
import { tunableRolls } from '../game-data/tunable-rolls'
import { resolveCharacterSubstatProfile, scoreCharacterBuildSubstats, scoreCharacterSubstats, type CharacterSubstatProfile } from './character-substat-score'

const profile: CharacterSubstatProfile = {
  characterId: 'test-character',
  characterName: 'Test Character',
  weights: { critRate: 1, critDamage: 1, atkPercent: 1, hpPercent: 1, defPercent: 1, energyRegen: 4 },
  maximum: 40,
  basis: 'Test profile'
}

const maximumRolls = [
  { key: 'critRate' as const, value: 10.5 },
  { key: 'critDamage' as const, value: 21 },
  { key: 'atkPercent' as const, value: 11.6 },
  { key: 'hpPercent' as const, value: 11.6 },
  { key: 'defPercent' as const, value: 14.7 }
]

function echo(id: string, subStats: Echo['subStats']): Echo {
  return {
    id, name: 'Hooscamp', cost: 1, rarity: 5, level: 25, sonata: 'Lingering Tunes',
    mainStat: { key: 'atkPercent', value: 18 }, subStats,
    locked: false, excluded: false, createdAt: 1, source: 'manual'
  }
}

describe('character Substat Score Energy Regen handling', () => {
  it('anchors good fourth-tier rolls at 100 and lets maximum rolls reach 200', () => {
    const goodRolls = maximumRolls.map(({ key }) => ({ key, value: tunableRolls[key]![3].value }))
    const strong = scoreCharacterSubstats(echo('good', goodRolls), profile)
    const exceptional = scoreCharacterSubstats(echo('exceptional', maximumRolls), profile)
    expect(strong.percentage).toBe(100)
    expect(strong.grade).toBe('SS')
    expect(exceptional.percentage).toBe(200)
    expect(exceptional.grade).toBe('SSS')
  })

  it('uses only five attainable stat slots for bundled priorities', () => {
    const catalog = characterCatalog.find((entry) => entry.name === 'Mornye')!
    const resolved = resolveCharacterSubstatProfile(catalog)
    const candidates = Object.entries(resolved.weights)
      .filter(([key]) => key !== 'energyRegen')
      .map(([key, weight]) => (['hp', 'atk', 'def'].includes(key) ? 3 : 8) * weight)
      .sort((left, right) => right - left)
    expect(candidates.length).toBeGreaterThan(5)
    expect(resolved.maximum).toBe(candidates.slice(0, 5).reduce((sum, value) => sum + value, 0))
  })

  it('excludes Energy Regen and reduces an Echo denominator by that occupied slot', () => {
    const score = scoreCharacterSubstats(echo('echo', [...maximumRolls.slice(0, 4), { key: 'energyRegen', value: 14.9 }]), profile)

    expect(score).toMatchObject({ points: 32, maximum: 16, percentage: 200, grade: 'SSS' })
    expect(score.contributions.some((entry) => entry.key === 'energyRegen')).toBe(false)
  })

  it('adjusts each Echo reference for ER and lowers one grade below the ER minimum', () => {
    const echoes = Array.from({ length: 5 }, (_, index) => echo(`echo-${index}`, [...maximumRolls]))
    echoes[0].subStats[4] = { key: 'energyRegen', value: 14.9 }
    echoes[1].subStats[4] = { key: 'energyRegen', value: 14.9 }
    echoes[2].subStats[4] = { key: 'energyRegen', value: 14.9 }

    expect(scoreCharacterBuildSubstats(echoes, profile, 130, 125)).toMatchObject({
      points: 176,
      maximum: 88,
      eligibleSubstatCount: 22,
      energyRegenSubstatCount: 3,
      grade: 'SS',
      earnedGrade: 'SSS',
      energyRequirementMet: false
    })
    expect(scoreCharacterBuildSubstats(echoes, profile, 130, 125).percentage).toBe(200)
  })
})
