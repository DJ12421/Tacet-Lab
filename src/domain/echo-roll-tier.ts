import { tunableRolls } from '../game-data/tunable-rolls'
import type { StatKey } from './types'

const FLAT_STAT_POINTS = 3
const FLAT_STATS = new Set<StatKey>(['hp', 'atk', 'def'])

export function substatTierPoints(key: StatKey, value: number) {
  if (FLAT_STATS.has(key)) return FLAT_STAT_POINTS
  const rolls = tunableRolls[key]
  if (!rolls?.length) return 0
  const tierIndex = rolls.findIndex((roll) => Math.abs(roll.value - value) < 0.001)
  return tierIndex < 0 ? 0 : tierIndex + 1
}
