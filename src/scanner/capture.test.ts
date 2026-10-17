import { describe, expect, it } from 'vitest'
import { ECHO_CROP, fingerprintDistance } from './capture'

describe('capture fingerprints', () => {
  it('captures only the compact Echo details column', () => {
    expect(ECHO_CROP).toEqual({ x: 0.77, y: 0.12, width: 0.22, height: 0.86 })
  })
  it('returns zero for the same sampled panel', () => {
    expect(fingerprintDistance([1, 2, 3], [1, 2, 3])).toBe(0)
  })

  it('normalizes changed pixels and rejects mismatched samples', () => {
    expect(fingerprintDistance([0, 0], [16, 16])).toBe(1)
    expect(fingerprintDistance([0], [0, 0])).toBe(1)
  })
  it('detects a stat-area digit change hidden by the coarse panel sample', () => {
    const first = Array(512 + 64 * 48).fill(0)
    const second = [...first]
    for (let index = 512; index < 520; index += 1) second[index] = 16
    expect(fingerprintDistance(first, second)).toBeGreaterThan(.035)
  })
})
