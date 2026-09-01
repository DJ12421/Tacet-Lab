import type { Echo, StatKey, StatLine } from '../domain/types'

// Source ranges checked against https://wutheringwaves.fandom.com/wiki/Echo/Stats (2026-07-14).
// Primary and secondary main stats scale deterministically with level and are not user-entered rolls.
export const mainStatKeysByCost: Record<Echo['cost'], readonly StatKey[]> = {
  1: ['hpPercent', 'atkPercent', 'defPercent'],
  3: ['hpPercent', 'atkPercent', 'defPercent', 'glacioDamage', 'fusionDamage', 'electroDamage', 'aeroDamage', 'spectroDamage', 'havocDamage', 'energyRegen'],
  4: ['hpPercent', 'atkPercent', 'defPercent', 'critRate', 'critDamage', 'healingBonus']
}

export const maxLevelByRarity: Record<Echo['rarity'], number> = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25 }
type Range = readonly [number, number]
type Ranges = Partial<Record<Echo['rarity'], Range>>
const ranges = (r2: Range, r3: Range, r4: Range, r5: Range): Ranges => ({ 2: r2, 3: r3, 4: r4, 5: r5 })
const commonPercent = {
  hpPercent: ranges([2.8, 7.2], [3, 10.2], [3.4, 14.2], [4.5, 22.8]),
  atkPercent: ranges([2.2, 5.7], [2.4, 8.1], [2.7, 11.3], [3.6, 18]),
  defPercent: ranges([2.2, 5.7], [2.4, 8.1], [2.7, 11.3], [3.6, 18])
}
const eliteNormal = ranges([3.7, 9.6], [4, 14], [4.5, 18.9], [6, 30])
const primaryRanges: Record<Echo['cost'], Partial<Record<StatKey, Ranges>>> = {
  1: commonPercent,
  3: { hpPercent: eliteNormal, atkPercent: eliteNormal, defPercent: ranges([4.7, 12.3], [5, 17], [5.7, 23.9], [7.6, 38]), glacioDamage: eliteNormal, fusionDamage: eliteNormal, electroDamage: eliteNormal, aeroDamage: eliteNormal, spectroDamage: eliteNormal, havocDamage: eliteNormal, energyRegen: ranges([3.8, 10], [4.2, 14.2], [4.8, 20.1], [6.4, 32]) },
  4: { hpPercent: ranges([4.1, 10.6], [4.3, 14.6], [4.9, 20.5], [6.6, 33]), atkPercent: ranges([4.1, 10.6], [4.3, 14.6], [4.9, 20.5], [6.6, 33]), defPercent: ranges([5.2, 13.5], [5.5, 18.7], [6.2, 26], [8.3, 41.5]), critRate: ranges([2.7, 7.1], [2.9, 9.8], [3.3, 13.8], [4.4, 22]), critDamage: ranges([5.4, 14.3], [5.8, 19.7], [6.6, 27.7], [8.8, 44]), healingBonus: ranges([3.3, 8.5], [3.5, 11.9], [3.9, 16.3], [5.2, 26.4]) }
}
const secondaryRanges: Record<Echo['cost'], Ranges> = {
  1: ranges([114, 296], [152, 516], [228, 957], [456, 2280]),
  3: ranges([12, 31], [13, 44], [15, 63], [20, 100]),
  4: ranges([18, 46], [20, 68], [22, 92], [30, 150])
}
function scaledValue([start, end]: Range, level: number, maxLevel: number, flat = false) {
  const value = start + (end - start) * Math.max(0, Math.min(maxLevel, level)) / maxLevel
  // The game displays scaled Echo mains by truncating hidden precision rather
  // than rounding to nearest. Keep a tiny epsilon so exact endpoints are not
  // lost to floating-point representation (for example, 29.999999999).
  return flat ? Math.floor(value + Number.EPSILON * 100) : Math.floor(value * 10 + Number.EPSILON * 100) / 10
}
export function isMainStatAllowed(cost: Echo['cost'], key: StatKey) { return mainStatKeysByCost[cost].includes(key) }
export function primaryMainStatValue(cost: Echo['cost'], rarity: Echo['rarity'], level: number, key: StatKey) {
  const statRange = primaryRanges[cost][key]?.[rarity]
  return statRange ? scaledValue(statRange, level, maxLevelByRarity[rarity]) : undefined
}
export function normalizeEchoMainStat(echo: Pick<Echo, 'cost' | 'rarity' | 'level' | 'mainStat'>): StatLine {
  const key = isMainStatAllowed(echo.cost, echo.mainStat.key) ? echo.mainStat.key : mainStatKeysByCost[echo.cost][0]
  return { key, value: primaryMainStatValue(echo.cost, echo.rarity, echo.level, key) ?? 0 }
}
export function mainStatError(cost: Echo['cost'], rarity: Echo['rarity'], level: number, stat: StatLine) {
  if (!isMainStatAllowed(cost, stat.key)) return `Cost ${cost} Echoes cannot have that primary main stat.`
  if (level < 0 || level > maxLevelByRarity[rarity]) return `A ${rarity}-star Echo can only reach level ${maxLevelByRarity[rarity]}.`
  const expected = primaryMainStatValue(cost, rarity, level, stat.key)
  if (expected !== undefined && Math.abs(stat.value - expected) > 0.051) return `This main stat must be ${expected} at level ${level}.`
}
export function fixedSecondaryMainStat(echo: Pick<Echo, 'cost' | 'rarity' | 'level'>): StatLine {
  return { key: echo.cost === 1 ? 'hp' : 'atk', value: scaledValue(secondaryRanges[echo.cost][echo.rarity] ?? secondaryRanges[echo.cost][2]!, echo.level, maxLevelByRarity[echo.rarity], true) }
}
export function maxSubStatsForLevel(level: number) { return Math.max(0, Math.min(5, Math.floor(level / 5))) }
export function effectiveSubStats(echo: Pick<Echo, 'level' | 'subStats'>) { return echo.subStats.slice(0, maxSubStatsForLevel(echo.level)) }
export function echoStatLines(echo: Pick<Echo, 'cost' | 'rarity' | 'level' | 'mainStat' | 'subStats'>) { return [echo.mainStat, fixedSecondaryMainStat(echo), ...effectiveSubStats(echo)] }
