import { describe, expect, it } from 'vitest'
import { brightSubstatThreshold } from './bright-substat'

describe('WuWaFlex highlighted stat rows', () => {
  it('keeps bright label and colored value text while clearing a changing background', () => {
    const width = 120, height = 30
    const pixels = new Uint8Array(width * height)
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = x >= 90 ? 38 : 58 + y * 2 + Math.round(x / 10)
    }
    for (let y = 10; y < 22; y += 1) {
      pixels[y * width + 18] = 220
      pixels[y * width + 103] = 145
    }
    const result = brightSubstatThreshold(pixels, width, height)
    expect(result[15 * width + 18]).toBe(0)
    expect(result[15 * width + 103]).toBe(0)
    expect(result[15 * width + 50]).toBe(255)
    expect(result[27 * width + 70]).toBe(255)
    expect(result[5 * width + 105]).toBe(255)
  })

  it('removes isolated starfield dots but keeps decimal and label punctuation', () => {
    const width = 120, height = 30
    const pixels = new Uint8Array(width * height).fill(50)
    const mark = (x: number, y: number, size = 1) => {
      for (let dy = 0; dy < size; dy += 1) for (let dx = 0; dx < size; dx += 1) pixels[(y + dy) * width + x + dx] = 220
    }
    for (let y = 9; y < 22; y += 1) { mark(18, y); mark(28, y); mark(98, y); mark(108, y) }
    mark(31, 20, 2) // Period after a label.
    mark(103, 20, 2) // Decimal between digits.
    mark(50, 13, 2); mark(64, 17, 2); mark(78, 8, 2)
    const result = brightSubstatThreshold(pixels, width, height)
    expect(result[13 * width + 50]).toBe(255)
    expect(result[17 * width + 64]).toBe(255)
    expect(result[8 * width + 78]).toBe(255)
    expect(result[20 * width + 31]).toBe(0)
    expect(result[20 * width + 103]).toBe(0)
    expect(result[15 * width + 98]).toBe(0)
  })
})

it('keeps the fifth Backpack substat above a lighter lower gradient', () => {
  const width = 120, height = 150
  const pixels = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    pixels[y * width + x] = 50 + Math.round(y * .65)
  }
  for (const row of [12, 38, 64, 90, 116]) for (let y = row; y < row + 10; y += 1) {
    pixels[y * width + 12] = 225
    pixels[y * width + 102] = 225
  }
  const result = brightSubstatThreshold(pixels, width, height, true)
  expect(result[120 * width + 12]).toBe(0)
  expect(result[120 * width + 102]).toBe(0)
  expect(result[120 * width + 60]).toBe(255)
  expect(result[140 * width + 60]).toBe(255)
})
