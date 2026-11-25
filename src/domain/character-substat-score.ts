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

export interface CharacterBuildSubstatScore extends CharacterSubstatScore {
  earnedGrade?: CharacterSubstatGrade
  eligibleSubstatCount: number
  energyRegenSubstatCount: number
  energyRequirementMet: boolean
}

const gradeBands: ReadonlyArray<{ minimum: number; grade: CharacterSubstatGrade }> = [
  { minimum: 110, grade: 'SSS' },
  { minimum: 100, grade: 'SS' },
  { minimum: 90, grade: 'S' },
  { minimum: 70, grade: 'A' },
  { minimum: 50, grade: 'B' },
  { minimum: 30, grade: 'C' },
  { minimum: 10, grade: 'D' },
  { minimum: 0, grade: 'E' }
]

const gradeOrder: CharacterSubstatGrade[] = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS']
const gradeFor = (percentage: number) => gradeBands.find((band) => percentage >= band.minimum)?.grade
const lowerGrade = (grade: CharacterSubstatGrade) => gradeOrder[Math.max(0, gradeOrder.indexOf(grade) - 1)]

// A fourth-tier roll is the good-build reference (100%). Higher legal tiers
// can exceed it. Flat stats have no tier progression and keep their 3 points.
function referencePoints(profile: CharacterSubstatProfile, slots: number): number {
  return Object.entries(profile.weights)
    .filter(([key, weight]) => key !== 'energyRegen' && weight > 0)
    .map(([key, weight]) => (key === 'hp' || key === 'atk' || key === 'def' ? 3 : 4) * weight)
    .sort((left, right) => right - left)
    .slice(0, Math.max(0, slots))
    .reduce((sum, value) => sum + value, 0)
}

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
  const scoringWeights = Object.entries(weights).filter(([key]) => key !== 'energyRegen')
  const configuredWeightCount = scoringWeights.filter(([, weight]) => weight > 0).length
  // An Echo has only five distinct substat slots. Select the five largest
  // attainable contributions for both bundled and customized priorities.
  const maximum = scoringWeights
    .map(([key, weight]) => (flatStats.has(key as StatKey) ? 3 : 8) * weight)
    .sort((left, right) => right - left)
    .slice(0, 5)
    .reduce((sum, points) => sum + points, 0)
  return {
    characterId: catalog.id,
    characterName: catalog.name,
    weights,
    maximum,
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
  const energyRegenSubstatCount = subStats.filter((stat) => stat.key === 'energyRegen').length
  const contributions = subStats.filter((stat) => stat.key !== 'energyRegen').map((stat) => {
    const tier = substatTierPoints(stat.key, stat.value)
    const weight = profile.weights[stat.key] ?? 0
    return { key: stat.key, tier, weight, points: tier * weight }
  })
  const maximum = referencePoints(profile, 5 - energyRegenSubstatCount)
  const valid = maximum > 0 && subStats.length > 0 && contributions.length > 0 && contributions.every((entry) => entry.tier > 0)
  const points = contributions.reduce((sum, entry) => sum + entry.points, 0)
  const percentage = valid ? points / maximum * 100 : 0
  return {
    points,
    maximum,
    percentage,
    grade: valid ? gradeFor(percentage) : undefined,
    provisional: subStats.length < 5,
    valid,
    contributions
  }
}

export function scoreCharacterBuildSubstats(
  echoes: Array<Pick<Echo, 'level' | 'subStats'>>,
  profile: CharacterSubstatProfile,
  minimumEnergyRegen = 0,
  totalEnergyRegen = 0
): CharacterBuildSubstatScore {
  const subStats = echoes.slice(0, 5).flatMap(effectiveSubStats)
  const energyRegenSubstatCount = subStats.filter((stat) => stat.key === 'energyRegen').length
  const contributions = subStats.filter((stat) => stat.key !== 'energyRegen').map((stat) => {
    const tier = substatTierPoints(stat.key, stat.value)
    const weight = profile.weights[stat.key] ?? 0
    return { key: stat.key, tier, weight, points: tier * weight }
  })
  const eligibleSubstatCount = 25 - energyRegenSubstatCount
  // Utility rolls reduce only their own Echo's reference. Empty Echo slots
  // retain the full reference so partial builds do not get a free boost.
  const maximum = Array.from({ length: 5 }, (_, index) => {
    const echo = echoes[index]
    const erSlots = echo ? effectiveSubStats(echo).filter((stat) => stat.key === 'energyRegen').length : 0
    return referencePoints(profile, 5 - erSlots)
  }).reduce((sum, value) => sum + value, 0)
  const valid = maximum > 0 && echoes.length > 0 && contributions.length > 0 && contributions.every((entry) => entry.tier > 0)
  const points = contributions.reduce((sum, entry) => sum + entry.points, 0)
  const percentage = valid ? points / maximum * 100 : 0
  const earnedGrade = valid ? gradeFor(percentage) : undefined
  const energyRequirementMet = minimumEnergyRegen <= 0 || totalEnergyRegen >= minimumEnergyRegen
  return {
    points,
    maximum,
    percentage,
    grade: earnedGrade && !energyRequirementMet ? lowerGrade(earnedGrade) : earnedGrade,
    earnedGrade,
    provisional: echoes.length < 5 || echoes.some((echo) => effectiveSubStats(echo).length < 5),
    valid,
    contributions,
    eligibleSubstatCount,
    energyRegenSubstatCount,
    energyRequirementMet
  }
}
