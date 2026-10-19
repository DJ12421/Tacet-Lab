import { expect, it } from 'vitest'
import { echoNameThreshold } from './echo-name-threshold'

it('keeps pale title pixels while rejecting bright saturated artwork behind them', () => {
  const width = 12, height = 6
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index++) pixels.set([40, 30, 50, 255], index * 4)
  for (let y = 1; y < 5; y++) for (let x = 1; x < 4; x++) pixels.set([247, 235, 166, 255], (y * width + x) * 4)
  pixels.set([247, 235, 166, 255], (3 * width + 9) * 4)
  pixels.set([255, 170, 35, 255], (3 * width + 10) * 4)

  const result = echoNameThreshold(pixels, width, height)
  expect(result?.[3 * width + 9]).toBe(0)
  expect(result?.[3 * width + 10]).toBe(255)
  expect(result?.[3 * width + 6]).toBe(255)
  expect(result?.[4 * width + 2]).toBe(0)
})
