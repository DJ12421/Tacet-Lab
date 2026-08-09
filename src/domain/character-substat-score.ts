import type { CharacterCatalogEntry } from '../game-data'
import {
  characterSubstatPreferences,
  type CharacterSubstatPreferenceWeight
} from '../game-data/character-substat-preferences'
import { effectiveSubStats } from '../game-data/echo-main-stats'
import { substatTierPoints } from './echo-roll-tier'
import type { Echo, StatKey } from './types'

export type CharacterSubstatWeight = CharacterSubstatPreferenceWeight
export type CharacterSubstatGrade = 'E' | 'D' | 'C' | 'B' | 'A' | 'S' | 'SS' | 'SSS'

export interface CharacterSubstatProfile {
  characterId: string
  characterName: string
  weights: Partial<Record<StatKey, CharacterSubstatWeight>>
  maximum: number
  basis: string
}

export interface CharacterSubstatContribution {
  key: StatKey
  tier: number
  weight: CharacterSubstatWeight
  points: number
}

export interface CharacterSubstatScore {
  points: number
  maximum: number
  percentage: number
  grade?: CharacterSubstatGrade
  provisional: boolean
  valid: boolean
  contributions: CharacterSubstatContribution[]
}

const gradeBands: ReadonlyArray<{ minimum: number; grade: CharacterSubstatGrade }> = [
  { minimum: 75, grade: 'SSS' },
  { minimum: 65, grade: 'SS' },
  { minimum: 55, grade: 'S' },
  { minimum: 45, grade: 'A' },
  { minimum: 35, grade: 'B' },
  { minimum: 25, grade: 'C' },
  { minimum: 15, grade: 'D' },
  { minimum: 0, grade: 'E' }
]

export function resolveCharacterSubstatProfile(
  catalog: CharacterCatalogEntry,
  customWeights?: Partial<Record<StatKey, number>>
): CharacterSubstatProfile {
  const preference = characterSubstatPreferences[catalog.name] ?? { weights: {} }
  const weights: Partial<Record<StatKey, CharacterSubstatWeight>> = customWeights
    ? Object.fromEntries(Object.entries(customWeights)
      .filter((entry): entry is [StatKey, number] => Number.isFinite(entry[1]) && entry[1] >= 0.5)
      .map(([key, weight]) => [key, Math.min(4, Math.max(0.5, Math.round(weight * 2) / 2)) as CharacterSubstatWeight]))
    : preference.weights
  const flatStats = new Set<StatKey>(['hp', 'atk', 'def'])
  const nonFlatWeights = Object.entries(weights)
    .filter(([key, weight]) => !flatStats.has(key as StatKey) && weight > 0)
    .map(([, weight]) => weight)
    .sort((left, right) => right - left)
    .slice(0, 5)
  const flatWeight = Object.entries(weights)
    .filter(([key, weight]) => flatStats.has(key as StatKey) && weight > 0)
    .map(([, weight]) => weight)
    .sort((left, right) => right - left)[0] ?? 0
  const configuredWeightCount = nonFlatWeights.length + (flatWeight > 0 ? 1 : 0)
  const customMaximum = Object.entries(weights)
    .map(([key, weight]) => (flatStats.has(key as StatKey) ? 3 : 8) * weight)
    .sort((left, right) => right - left)
    .slice(0, 5)
    .reduce((sum, points) => sum + points, 0)
  return {
    characterId: catalog.id,
    characterName: catalog.name,
    weights,
    maximum: customWeights
      ? customMaximum
      : 8 * nonFlatWeights.reduce<number>((sum, weight) => sum + weight, 0) + 3 * flatWeight,
    basis: configuredWeightCount
      ? customWeights ? 'Customized in local settings.' : 'Using bundled character recommendations.'
      : 'Not configured. Add weights in character-substat-preferences.ts.'
  }
}

export function scoreCharacterSubstats(
  echo: Pick<Echo, 'level' | 'subStats'>,
  profile: CharacterSubstatProfile
): CharacterSubstatScore {
  const subStats = effectiveSubStats(echo)
  const contributions = subStats.map((stat) => {
    const tier = substatTierPoints(stat.key, stat.value)
    const weight = profile.weights[stat.key] ?? 0
    return { key: stat.key, tier, weight, points: tier * weight }
  })
  const valid = profile.maximum > 0 && subStats.length > 0 && contributions.every((entry) => entry.tier > 0)
  const points = contributions.reduce((sum, entry) => sum + entry.points, 0)
  const percentage = valid && profile.maximum > 0 ? Math.min(100, points / profile.maximum * 100) : 0
  return {
    points,
    maximum: profile.maximum,
    percentage,
    grade: valid ? gradeBands.find((band) => percentage >= band.minimum)?.grade : undefined,
    provisional: subStats.length < 5,
    valid,
    contributions
  }
}
