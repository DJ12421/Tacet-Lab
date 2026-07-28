import type { Echo } from './types'
import { effectiveSubStats } from '../game-data/echo-main-stats'
import { substatTierPoints } from './echo-roll-tier'

export { substatTierPoints } from './echo-roll-tier'

export type EchoRollGrade = 'E' | 'D' | 'C' | 'B' | 'A' | 'S' | 'SS' | 'SSS'
export type EchoRollColor = 'white' | 'green' | 'blue' | 'purple' | 'gold' | 'red'

const MAX_TIER_POINTS = 8
const MAX_SUBSTATS = 5

// These simple average cutoffs are the rounded, mentally calculable form of
// the official substat-selection and roll-value probability distributions.
// For five rolls they produce totals of 27, 24, 22, 20, 18, 16, and 13.
const gradeBands: ReadonlyArray<{ minimumAverage: number; grade: EchoRollGrade; color: EchoRollColor }> = [
  { minimumAverage: 5.4, grade: 'SSS', color: 'red' },
  { minimumAverage: 4.8, grade: 'SS', color: 'gold' },
  { minimumAverage: 4.4, grade: 'S', color: 'gold' },
  { minimumAverage: 4, grade: 'A', color: 'purple' },
  { minimumAverage: 3.6, grade: 'B', color: 'purple' },
  { minimumAverage: 3.2, grade: 'C', color: 'blue' },
  { minimumAverage: 2.6, grade: 'D', color: 'green' },
  { minimumAverage: 0, grade: 'E', color: 'white' }
]

export interface EchoRollRating {
  points: number
  maximum: number
  average: number
  equivalentFiveRollPoints: number
  revealedRolls: number
  grade?: EchoRollGrade
  color?: EchoRollColor
  provisional: boolean
  valid: boolean
}

export function echoRollPoints(echo: Pick<Echo, 'level' | 'subStats'>) {
  return effectiveSubStats(echo).reduce((sum, stat) => sum + substatTierPoints(stat.key, stat.value), 0)
}

export function echoRollRating(echo: Pick<Echo, 'level' | 'subStats'>): EchoRollRating {
  const subStats = effectiveSubStats(echo)
  const rollPoints = subStats.map((stat) => substatTierPoints(stat.key, stat.value))
  const revealedRolls = rollPoints.length
  const points = rollPoints.reduce((sum, value) => sum + value, 0)
  const maximum = revealedRolls * MAX_TIER_POINTS
  const valid = revealedRolls > 0 && rollPoints.every((value) => value > 0)
  const average = valid ? points / revealedRolls : 0
  const band = valid ? gradeBands.find((entry) => average >= entry.minimumAverage) : undefined
  return {
    points,
    maximum,
    average,
    equivalentFiveRollPoints: average * MAX_SUBSTATS,
    revealedRolls,
    grade: band?.grade,
    color: band?.color,
    provisional: revealedRolls < MAX_SUBSTATS,
    valid
  }
}
