import { expect, it } from 'vitest'
import { wideCardNameThreshold } from './wide-card-name'

it('compares header letters with their local background across dark and bright colors', () => {
  for (const background of [[45, 35, 60], [160, 65, 35], [55, 165, 40]]) {
    const pixels = new Uint8ClampedArray(4 * 8 * 4)
    for (let index = 0; index < 32; index += 1) pixels.set([...background, 255], index * 4)
    pixels.set(background.map((value) => Math.min(255, value + 70)).concat(255), (3 * 4 + 1) * 4)
    pixels.set([255, 255, 255, 255], (7 * 4 + 1) * 4)
    const mask = wideCardNameThreshold(pixels, 4, 8)
    expect(mask[3 * 4 + 1]).toBe(0)
    expect(mask[3 * 4 + 2]).toBe(255)
    expect(mask[7 * 4 + 1]).toBe(255)
  }
})
