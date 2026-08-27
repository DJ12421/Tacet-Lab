import { describe, expect, it } from 'vitest'
import { availableSubstatKeys, dedupeBySubstatKey, duplicateSubstatKeys } from './echo-substats'

describe('Echo substat integrity', () => {
  const stats = [{ key: 'critRate' as const }, { key: 'atkFlat' as const }, { key: 'critRate' as const }]

  it('reports duplicate keys once', () => {
    expect(duplicateSubstatKeys(stats)).toEqual(['critRate'])
  })

  it('keeps the current row key while excluding keys used by other rows', () => {
    expect(availableSubstatKeys(['critRate', 'atkFlat', 'critDamage'], stats.slice(0, 2), 0)).toEqual(['critRate', 'critDamage'])
  })

  it('deduplicates stably', () => {
    expect(dedupeBySubstatKey(stats, (stat) => stat.key)).toEqual({ values: stats.slice(0, 2), duplicates: ['critRate'] })
  })
})
