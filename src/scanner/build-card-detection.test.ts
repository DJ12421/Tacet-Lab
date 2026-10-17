import { describe, expect, it } from 'vitest'
import { detectBuildCardFormat } from './build-card-detection'

describe('WuWaFlex card detection', () => {
  it.each([
    [1272, 'wuwaflex-1272'],
    [1377, 'wuwaflex-1377']
  ] as const)('recognizes the supplied 2724x%i export', (height, id) => {
    const image = { naturalWidth: 2724, naturalHeight: height } as HTMLImageElement

    expect(detectBuildCardFormat(image)).toMatchObject({ id, certain: true })
  })

  it.each([1540, 1600])('recognizes a 3416x%i supplied card', (height) => {
    const image = { naturalWidth: 3416, naturalHeight: height } as HTMLImageElement

    expect(detectBuildCardFormat(image)).toMatchObject({ id: 'wuwaflex', certain: true })
  })

  it('uses the shorter WuWaFlex calibration for a 3416x1580 export', () => {
    const image = { naturalWidth: 3416, naturalHeight: 1580 } as HTMLImageElement
    expect(detectBuildCardFormat(image)).toMatchObject({ id: 'wuwaflex-1580', certain: true })
  })

  it.each([
    [3416, 1600, 'wuwaflex'],
    [3416, 1580, 'wuwaflex-1580'],
    [2724, 1272, 'wuwaflex-1272'],
    [2724, 1377, 'wuwaflex-1377']
  ] as const)('selects the matching layout under one WuWaFlex preference for %ix%i', (width, height, id) => {
    const image = { naturalWidth: width, naturalHeight: height } as HTMLImageElement
    expect(detectBuildCardFormat(image, 'wuwaflex')).toMatchObject({ id, certain: true })
  })
})
