import { describe, expect, it, vi } from 'vitest'
import { ECHO_CROP, fingerprintDistance, probeEchoSubstats } from './capture'
import type { CalibrationProfile } from './types'

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

  it('probes the calibrated substat area of a video without capturing the full frame', () => {
    const drawImage = vi.fn()
    const sample = document.createElement('canvas')
    Object.defineProperty(sample, 'getContext', { value: () => ({ drawImage, getImageData: () => ({ data: new Uint8ClampedArray(64 * 32 * 4).fill(128) }) }) })
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement
    const profile = {
      panelRect: { x: .6, y: .1, width: .3, height: .8 },
      regions: [{ id: 'substats-block', kind: 'substats-block', label: 'Substats', rect: { x: .1, y: .5, width: .8, height: .4 }, recognition: 'text' }]
    } as CalibrationProfile
    expect(probeEchoSubstats(video, profile, sample)).toHaveLength(64 * 32)
    expect(drawImage).toHaveBeenCalledWith(video, 1920 * (.6 + .3 * .1), 1080 * (.1 + .8 * .5), 1920 * .3 * .8, 1080 * .8 * .4, 0, 0, 64, 32)
  })
})
