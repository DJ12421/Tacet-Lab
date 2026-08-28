import type { StatKey } from './types'

export function duplicateSubstatKeys(stats: ReadonlyArray<{ key: StatKey }>) {
  const seen = new Set<StatKey>()
  const duplicates = new Set<StatKey>()
  for (const stat of stats) {
    if (seen.has(stat.key)) duplicates.add(stat.key)
    else seen.add(stat.key)
  }
  return [...duplicates]
}

export function availableSubstatKeys(
  allKeys: readonly StatKey[],
  stats: ReadonlyArray<{ key: StatKey }>,
  currentIndex?: number
) {
  const used = new Set(stats.flatMap((stat, index) => index === currentIndex ? [] : [stat.key]))
  return allKeys.filter((key) => !used.has(key))
}

export function dedupeBySubstatKey<T>(values: readonly T[], keyOf: (value: T) => StatKey) {
  const seen = new Set<StatKey>()
  const duplicates = new Set<StatKey>()
  const unique = values.filter((value) => {
    const key = keyOf(value)
    if (seen.has(key)) { duplicates.add(key); return false }
    seen.add(key)
    return true
  })
  return { values: unique, duplicates: [...duplicates] }
}
