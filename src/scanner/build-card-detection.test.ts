import { describe, expect, it } from 'vitest'
import { detectBuildCardFormat } from './build-card-detection'

describe('Wide card card detection', () => {
  it.each([
    [1272, 'wide-card-1272'],
    [1377, 'wide-card-1377']
  ] as const)('recognizes the supplied 2724x%i export', (height, id) => {
    const image = { naturalWidth: 2724, naturalHeight: height } as HTMLImageElement

    expect(detectBuildCardFormat(image)).toMatchObject({ id, certain: true })
  })

  it.each([1540, 1600])('recognizes a 3416x%i supplied card', (height) => {
    const image = { naturalWidth: 3416, naturalHeight: height } as HTMLImageElement

    expect(detectBuildCardFormat(image)).toMatchObject({ id: 'wide-card', certain: true })
  })

  it('uses the shorter Wide card calibration for a 3416x1580 export', () => {
    const image = { naturalWidth: 3416, naturalHeight: 1580 } as HTMLImageElement
    expect(detectBuildCardFormat(image)).toMatchObject({ id: 'wide-card-1580', certain: true })
  })

  it.each([
    [3416, 1600, 'wide-card'],
    [3416, 1580, 'wide-card-1580'],
    [2724, 1272, 'wide-card-1272'],
    [2724, 1377, 'wide-card-1377']
  ] as const)('selects the matching layout under one Wide card preference for %ix%i', (width, height, id) => {
    const image = { naturalWidth: width, naturalHeight: height } as HTMLImageElement
    expect(detectBuildCardFormat(image, 'wide-card')).toMatchObject({ id, certain: true })
  })
})
