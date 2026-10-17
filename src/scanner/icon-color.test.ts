import { expect, it } from 'vitest'
import { iconColor, scoreIconSignature } from './icon-color'

it('uses foreground color to distinguish similarly shaped Echo art', () => {
  const redArt = new Uint8ClampedArray([152, 89, 77, 255, 0, 0, 0, 255])
  const captured = iconColor(redArt)
  expect(captured).toEqual([152, 89, 77])
  expect(scoreIconSignature([1, 0], [1, 0], captured, [160, 104, 93]))
    .toBeGreaterThan(scoreIconSignature([1, 0], [1, 0], captured, [124, 87, 147]))
})
