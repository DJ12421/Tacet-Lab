import { describe, expect, it } from 'vitest'
import { classifyEchoState, classifyWuwaflexSonata } from './visual'
import { wuwaflexSonataSignatures } from './wuwaflex-sonata-signatures'

const pixels = (color: [number, number, number], count = 100) => new Uint8ClampedArray(Array.from({ length: count }, () => [...color, 255]).flat())

describe('Echo HUD state recognition', () => {
  it('treats a red Z indicator as discarded and never locked', () => {
    const result = classifyEchoState(pixels([220, 35, 45]), pixels([245, 245, 245]))
    expect(result.excluded?.value).toBe(true)
    expect(result.locked?.value).toBe(false)
  })

  it('recognizes a bright C lock indicator when discard is inactive', () => {
    const result = classifyEchoState(pixels([55, 60, 65]), pixels([245, 245, 245]))
    expect(result.excluded?.value).toBe(false)
    expect(result.locked?.value).toBe(true)
  })

  it('allows neither state to be active', () => {
    const result = classifyEchoState(pixels([55, 60, 65]), pixels([60, 65, 70]))
    expect(result.excluded?.value).toBe(false)
    expect(result.locked?.value).toBe(false)
  })
})

describe('WuWaFlex Sonata badges', () => {
  it('reads a green ring without the bright orange card background', () => {
    const template = wuwaflexSonataSignatures.find((entry) => entry.name === 'Halo of Starry Radiance')!
    const badge = new Uint8ClampedArray(24 * 24 * 4)
    for (let y = 0; y < 24; y += 1) {
      const row = Number.parseInt(template.mask.slice(y * 6, y * 6 + 6), 16)
      for (let x = 0; x < 24; x += 1) {
        const distance = Math.hypot(x - 9, y - 9.5)
        badge.set(row & (1 << (23 - x)) ? [240, 240, 240, 255] : distance > 6 && distance < 8 ? [145, 205, 42, 255] : [210, 110, 25, 255], (y * 24 + x) * 4)
      }
    }
    expect(classifyWuwaflexSonata(badge)?.value).toBe('Halo of Starry Radiance')
  })

  it('ignores card background color behind a white Tidebreaking Courage ring', () => {
    const mask = '00000000000003f800070c000c060019f30013b900300d802466802ce6802db2802db2802ce680246680360080131d8019ff000c0200060e0003f80000e000000000000000000'
    const badge = new Uint8ClampedArray(24 * 24 * 4)
    for (let y = 0; y < 24; y += 1) {
      const row = Number.parseInt(mask.slice(y * 6, y * 6 + 6), 16)
      for (let x = 0; x < 24; x += 1) badge.set(row & (1 << (23 - x)) ? [240, 240, 240, 255] : [170, 35, 45, 255], (y * 24 + x) * 4)
    }
    expect(classifyWuwaflexSonata(badge)?.value).toBe('Tidebreaking Courage')
  })

  it('recognizes a shifted Rejuvenating Glow glyph using its green ring', () => {
    const mask = '000000000000000000000000000000000000000000001800001800001800007a0000fe0000fe0000d800005800001800001000000000000000000000000000000000000000000000'
    const badge = new Uint8ClampedArray(24 * 24 * 4)
    for (let y = 0; y < 24; y += 1) {
      const row = Number.parseInt(mask.slice(y * 6, y * 6 + 6), 16)
      for (let x = 0; x < 24; x += 1) {
        const distance = Math.hypot(x - 11, y - 11.5)
        badge.set(row & (1 << (23 - x)) ? [240, 240, 240, 255] : distance > 6 && distance < 8 ? [132, 187, 43, 255] : [45, 85, 35, 255], (y * 24 + x) * 4)
      }
    }
    expect(classifyWuwaflexSonata(badge)?.value).toBe('Rejuvenating Glow')
  })

  it('uses the ring color when gold and green shield badges have a similar glyph', () => {
    const template = wuwaflexSonataSignatures.find((entry) => entry.name === 'Halo of Starry Radiance')!
    const badge = (ring: [number, number, number]) => {
      const image = new Uint8ClampedArray(24 * 24 * 4)
      for (let y = 0; y < 24; y += 1) {
        const row = Number.parseInt(template.mask.slice(y * 6, y * 6 + 6), 16)
        for (let x = 0; x < 24; x += 1) {
          const radius = Math.hypot(x - 11.5, y - 11.5)
          image.set(row & (1 << (23 - x)) ? [240, 240, 238, 255] : radius > 7 && radius < 9 ? [...ring, 255] : [50, 50, 25, 255], (y * 24 + x) * 4)
        }
      }
      return image
    }
    expect(classifyWuwaflexSonata(badge([140, 183, 41]))?.value).toBe('Halo of Starry Radiance')
    expect(classifyWuwaflexSonata(badge([196, 182, 88]))?.value).not.toBe('Halo of Starry Radiance')
    expect(classifyWuwaflexSonata(badge([196, 182, 88]), ['Halo of Starry Radiance', 'Wishes of Quiet Snowfall'])?.value).toBe('Halo of Starry Radiance')
    expect(classifyWuwaflexSonata(badge([100, 189, 248]), ['Halo of Starry Radiance', 'Wishes of Quiet Snowfall'])?.value).toBe('Wishes of Quiet Snowfall')
  })

  it('recognizes the white glyph despite a colored badge background', () => {
    const template = wuwaflexSonataSignatures.find((entry) => entry.name === 'Pact of Neonlight Leap')!
    const badge = new Uint8ClampedArray(24 * 24 * 4)
    for (let y = 0; y < 24; y += 1) {
      const row = Number.parseInt(template.mask.slice(y * 6, y * 6 + 6), 16)
      for (let x = 0; x < 24; x += 1) {
        const offset = (y * 24 + x) * 4
        const glyph = Boolean(row & (1 << (23 - x)))
        badge.set(glyph ? [240, 240, 238, 255] : [80, 140, 20, 255], offset)
      }
    }
    expect(classifyWuwaflexSonata(badge)?.value).toBe('Pact of Neonlight Leap')
    expect(classifyWuwaflexSonata(badge, ['Halo of Starry Radiance'])?.value).not.toBe('Pact of Neonlight Leap')
  })

  it('recognizes the offset Celestial Light glyph from the local Lucy card', () => {
    const glyph = '000000000000000000000000000000000000000000000800001800003e0000240000db0000db00002400003c00001800000800000000000000000000000000000000000000'
    const badge = new Uint8ClampedArray(24 * 24 * 4)
    for (let offset = 0; offset < badge.length; offset += 4) badge.set([65, 65, 115, 255], offset)
    for (let y = 0; y < 24; y += 1) {
      const row = Number.parseInt(glyph.slice(y * 6, y * 6 + 6), 16)
      for (let x = 0; x < 24; x += 1) {
        if (row & (1 << (23 - x))) badge.set([235, 235, 225, 255], (y * 24 + x) * 4)
      }
    }
    expect(classifyWuwaflexSonata(badge, ['Celestial Light', 'Sierra Gale'])?.value).toBe('Celestial Light')
  })

  it('does not accept a clear badge outside the Echo name’s possible sets', () => {
    const template = wuwaflexSonataSignatures.find((entry) => entry.name === 'Lingering Tunes')!
    const badge = new Uint8ClampedArray(24 * 24 * 4)
    for (let y = 0; y < 24; y += 1) {
      const row = Number.parseInt(template.mask.slice(y * 6, y * 6 + 6), 16)
      for (let x = 0; x < 24; x += 1) badge.set(row & (1 << (23 - x)) ? [240, 240, 240, 255] : [50, 38, 70, 255], (y * 24 + x) * 4)
    }
    expect(classifyWuwaflexSonata(badge, ['Pact of Neonlight Leap'])?.value).not.toBe('Lingering Tunes')
  })
})
