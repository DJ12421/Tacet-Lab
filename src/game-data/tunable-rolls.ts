import type { StatKey } from '../domain/types'

export interface TunableRoll { value: number; probability: number }

// Official in-game substat roll values and probabilities supplied 2026-07-28.
const commonPercent: TunableRoll[] = [
  [6.4, 6.8], [7.1, 7.77], [7.9, 20.39], [8.6, 24.27],
  [9.4, 17.48], [10.1, 14.56], [10.9, 5.83], [11.6, 2.91]
].map(([value, probability]) => ({ value, probability }))

export const tunableRolls: Partial<Record<StatKey, TunableRoll[]>> = {
  hp: [[320, 6.8], [360, 7.77], [390, 20.39], [430, 24.27], [470, 17.48], [510, 14.56], [540, 5.83], [580, 2.91]].map(([value, probability]) => ({ value, probability })),
  atk: [[30, 6.8], [40, 52.43], [50, 37.86], [60, 2.91]].map(([value, probability]) => ({ value, probability })),
  def: [[40, 14.56], [50, 44.66], [60, 32.04], [70, 8.74]].map(([value, probability]) => ({ value, probability })),
  hpPercent: commonPercent,
  atkPercent: commonPercent,
  defPercent: [[8.1, 6.8], [9, 7.77], [10, 20.39], [10.9, 24.27], [11.8, 17.48], [12.8, 14.56], [13.8, 5.83], [14.7, 2.91]].map(([value, probability]) => ({ value, probability })),
  energyRegen: [[6.8, 6.8], [7.6, 7.77], [8.4, 20.39], [9.2, 24.27], [10, 17.48], [10.8, 14.56], [11.6, 5.83], [12.4, 2.91]].map(([value, probability]) => ({ value, probability })),
  basicDamage: commonPercent,
  heavyDamage: commonPercent,
  skillDamage: commonPercent,
  liberationDamage: commonPercent,
  critRate: [[6.3, 23.33], [6.9, 23.33], [7.5, 23.33], [8.1, 8], [8.7, 8], [9.3, 8], [9.9, 3], [10.5, 3]].map(([value, probability]) => ({ value, probability })),
  critDamage: [[12.6, 23.33], [13.8, 23.33], [15, 23.33], [16.2, 8], [17.4, 8], [18.6, 8], [19.8, 3], [21, 3]].map(([value, probability]) => ({ value, probability }))
}

export function exactTunableRoll(key: StatKey, value: number) {
  return tunableRolls[key]?.find((roll) => Math.abs(roll.value - value) < 0.001)
}

export function closestTunableRoll(key: StatKey, value: number) {
  const rolls = tunableRolls[key]
  if (!rolls?.length || !Number.isFinite(value)) return
  const closest = rolls.reduce((best, roll) => Math.abs(roll.value - value) < Math.abs(best.value - value) ? roll : best)
  const tolerance = ['hp', 'atk', 'def'].includes(key) ? Math.max(3, closest.value * 0.08) : 0.35
  return Math.abs(closest.value - value) <= tolerance ? closest : undefined
}
