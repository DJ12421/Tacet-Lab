import { describe, expect, it } from 'vitest'
import { characterCatalog } from '../game-data'
import type { CharacterSubstatProfile } from '../domain/character-substat-score'
import { echoRollBreakdown, prioritizedBuildCardStats } from './CharacterBuildCard'

const lucy = characterCatalog.find((entry) => entry.name === 'Lucy')!

function profile(weights: CharacterSubstatProfile['weights']): CharacterSubstatProfile {
  return { characterId: lucy.id, characterName: lucy.name, weights, maximum: 100, basis: 'Test profile' }
}

describe('prioritizedBuildCardStats', () => {
  it('keeps core stats and merges percentage priorities into their displayed totals', () => {
    const rows = prioritizedBuildCardStats(lucy, profile({ atk: 1, atkPercent: 3, critRate: 4, heavyDamage: 2 }))
    expect(rows.map((row) => row.key)).toEqual(['hp', 'atk', 'def', 'energyRegen', 'critRate', 'heavyDamage', 'spectroDamage'])
  })

  it('uses a compact general-purpose fallback when no character profile is configured', () => {
    const rows = prioritizedBuildCardStats(lucy, profile({}))
    expect(rows.map((row) => row.key)).toEqual(['hp', 'atk', 'def', 'energyRegen', 'critRate', 'critDamage', 'spectroDamage'])
  })
})

describe('echoRollBreakdown', () => {
  it('resolves eight-tier percentage rolls', () => {
    expect(echoRollBreakdown({ key: 'critRate', value: 10.5 })).toMatchObject({ tier: 8, tierCount: 8, valid: true })
  })

  it('resolves four-tier flat rolls independently from Substat Score points', () => {
    expect(echoRollBreakdown({ key: 'atk', value: 40 })).toMatchObject({ tier: 2, tierCount: 4, valid: true })
  })

  it('marks values outside the legal roll table as unknown', () => {
    expect(echoRollBreakdown({ key: 'critDamage', value: 17 })).toMatchObject({ tier: 0, tierCount: 8, valid: false })
  })
})

describe('Nanoka animated card artwork', () => {
  it('uses Lucy\'s Luckdraw animation from the Nanoka character page', () => {
    expect(lucy.spineSkeletonSourceUrl).toBe('https://static.nanoka.cc/assets/ww/luckdraw/luxi/luxi.skel')
    expect(lucy.spineAtlasSourceUrl).toBe('https://static.nanoka.cc/assets/ww/luckdraw/luxi/luxi.atlas')
  })

  it('retains an animated formation fallback for characters without upstream Luckdraw assets', () => {
    expect(characterCatalog.every((entry) => entry.spineSkeletonSourceUrl && entry.spineAtlasSourceUrl)).toBe(true)
  })
})
