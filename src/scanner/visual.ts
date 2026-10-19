import type { Echo } from '../domain/types'
import type { VisualRecognition } from './parser'
import type { ScanRect, ScanRegion } from './types'
import { regionsForLayout } from './regions'
import { generatedSonataSignatures } from '../game-data/scanner-signatures.generated'
import { wuwaflexSonataSignatures } from './wuwaflex-sonata-signatures'
import { iconColor, iconColorDistance, type IconColor } from './icon-color'

function rgbToHsl(red: number, green: number, blue: number) {
  const [r, g, b] = [red, green, blue].map((value) => value / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), lightness = (max + min) / 2, delta = max - min
  if (!delta) return { hue: 0, saturation: 0, lightness }
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  const hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4)
  return { hue: hue < 0 ? hue + 360 : hue, saturation, lightness }
}

export function classifyRarityPixels(pixels: Uint8ClampedArray): VisualRecognition['rarity'] {
  const scores: Record<Echo['rarity'], number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < 180) continue
    const { hue, saturation, lightness } = rgbToHsl(pixels[offset], pixels[offset + 1], pixels[offset + 2])
    if (lightness < 0.58) continue
    if (saturation < 0.18) scores[1] += 1
    else if (hue >= 75 && hue < 175) scores[2] += 1
    else if (hue >= 175 && hue < 250) scores[3] += 1
    else if (hue >= 250 && hue < 335) scores[4] += 1
    else if (hue >= 32 && hue < 75) scores[5] += 1
  }
  const ranked = (Object.entries(scores) as Array<[string, number]>).sort((left, right) => right[1] - left[1])
  const total = ranked.reduce((sum, entry) => sum + entry[1], 0), best = ranked[0]
  if (!best || best[1] < 8 || total === 0) return
  return { value: Number(best[0]) as Echo['rarity'], confidence: Math.min(0.95, 0.55 + best[1] / total * 0.4) }
}

export function classifyEchoState(discardPixels: Uint8ClampedArray, lockPixels: Uint8ClampedArray): Pick<VisualRecognition, 'excluded' | 'locked'> {
  let red = 0, discardVisible = 0, lockActive = 0, lockVisible = 0
  for (let offset = 0; offset < discardPixels.length; offset += 4) {
    if (discardPixels[offset + 3] < 180) continue
    discardVisible += 1
    if (discardPixels[offset] > 145 && discardPixels[offset] > discardPixels[offset + 1] * 1.35 && discardPixels[offset] > discardPixels[offset + 2] * 1.2) red += 1
  }
  for (let offset = 0; offset < lockPixels.length; offset += 4) {
    if (lockPixels[offset + 3] < 180) continue
    lockVisible += 1
    const red = lockPixels[offset], green = lockPixels[offset + 1], blue = lockPixels[offset + 2]
    const { hue, saturation, lightness } = rgbToHsl(red, green, blue)
    const brightNeutral = lightness > .64 && saturation < .22
    const activeGold = lightness > .42 && saturation > .22 && hue >= 28 && hue <= 72 && red > blue * 1.18
    if (brightNeutral || activeGold) lockActive += 1
  }
  const discardScore = discardVisible ? red / discardVisible : 0
  const lockScore = lockVisible ? lockActive / lockVisible : 0
  const discardThreshold = .055
  const lockThreshold = .045
  const excluded = discardScore > discardThreshold
  const locked = !excluded && lockScore > lockThreshold
  const evidenceConfidence = (score: number, threshold: number, active: boolean) => active
    ? Math.min(.98, .7 + (score - threshold) / Math.max(threshold, .001) * .18)
    : Math.min(.96, .55 + (threshold - score) / Math.max(threshold, .001) * .36)
  return {
    excluded: { value: excluded, confidence: evidenceConfidence(discardScore, discardThreshold, excluded) },
    locked: { value: locked, confidence: excluded ? evidenceConfidence(discardScore, discardThreshold, true) : evidenceConfidence(lockScore, lockThreshold, locked) }
  }
}

function cropPixels(image: HTMLImageElement, crop: { x: number; y: number; width: number; height: number }, size = 32) {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return new Uint8ClampedArray()
  context.drawImage(image, image.naturalWidth * crop.x, image.naturalHeight * crop.y, image.naturalWidth * crop.width, image.naturalHeight * crop.height, 0, 0, size, size)
  return context.getImageData(0, 0, size, size).data
}

function pixelSignature(pixels: Uint8ClampedArray) {
  const values: number[] = []
  for (let offset = 0; offset < pixels.length; offset += 4) values.push(pixels[offset + 3] < 40 ? 0 : (pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722) / 255)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) || 1
  return values.map((value) => Math.max(-2, Math.min(2, (value - mean) / deviation)))
}

function sonataSignaturesInBox(image: HTMLImageElement, crop: ScanRect) {
  const boxX = image.naturalWidth * crop.x, boxY = image.naturalHeight * crop.y
  const boxWidth = image.naturalWidth * crop.width, boxHeight = image.naturalHeight * crop.height
  const shortestSide = Math.max(1, Math.min(boxWidth, boxHeight))
  const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return []
  const signatures: number[][] = []
  for (const scale of [.45, .6, .75, .9, 1]) {
    const size = shortestSide * scale
    const xTravel = Math.max(0, boxWidth - size), yTravel = Math.max(0, boxHeight - size)
    for (const xStep of [0, .25, .5, .75, 1]) for (const yStep of [0, .5, 1]) {
      context.clearRect(0, 0, 16, 16)
      context.drawImage(image, boxX + xTravel * xStep, boxY + yTravel * yStep, size, size, 0, 0, 16, 16)
      signatures.push(pixelSignature(context.getImageData(0, 0, 16, 16).data))
    }
  }
  return signatures
}

export function classifySonataCandidates(captured: number[][], templates: Array<{ name: string; signature: number[]; color?: IconColor }>, allowedNames?: string[], capturedColor?: IconColor): VisualRecognition['sonata'] {
  const allowed = allowedNames?.length ? new Set(allowedNames) : undefined
  const candidates = allowed ? templates.filter((template) => allowed.has(template.name)) : templates
  const ranked = candidates.map((template) => ({
    name: template.name,
    score: Math.max(...captured.map((signature) => 1 - template.signature.reduce((sum, value, index) => sum + Math.abs(value - signature[index]), 0) / (signature.length * 4)))
      - (capturedColor && template.color ? .3 * sonataHueDistance(capturedColor, template.color) : 0)
  })).sort((left, right) => right.score - left.score)
  const best = ranked[0], runnerUp = ranked[1]
  const minimumScore = candidates.length === 1 ? .42 : .48
  const minimumMargin = candidates.length === 1 ? 0 : .005
  if (!best || best.score < minimumScore || best.score - (runnerUp?.score ?? 0) < minimumMargin) return
  return { value: best.name, confidence: Math.min(.96, .55 + best.score * .4) }
}

export function classifySonataSignatures(captured: number[], templates: Array<{ name: string; signature: number[] }>): VisualRecognition['sonata'] {
  const ranked = templates.map((template) => ({ name: template.name, score: 1 - template.signature.reduce((sum, value, index) => sum + Math.abs(value - captured[index]), 0) / (captured.length * 4) })).sort((left, right) => right.score - left.score)
  const best = ranked[0], runnerUp = ranked[1]
  if (!best || best.score < .63 || best.score - (runnerUp?.score ?? 0) < .015) return
  return { value: best.name, confidence: Math.min(.96, .62 + best.score * .34) }
}

const sonataSignatureTemplates = generatedSonataSignatures.map((entry) => ({
  name: entry.name,
  signature: Array.from(entry.signature, (value) => value / 32),
  color: 'color' in entry ? entry.color : undefined
}))

function sonataHueDistance(left: IconColor, right: IconColor) {
  const chroma = (color: IconColor) => {
    const darkest = Math.min(...color), range = Math.max(...color) - darkest || 1
    return color.map((channel) => (channel - darkest) / range)
  }
  const a = chroma(left), b = chroma(right)
  return a.reduce((sum, channel, index) => sum + Math.abs(channel - b[index]), 0) / 3
}

export function classifySonataColor(pixels: Uint8ClampedArray, allowedNames?: string[]): VisualRecognition['sonata'] {
  if (!allowedNames || allowedNames.length < 2) return
  const captured = iconColor(pixels, 80, 15)
  if (!captured) return
  const ranked = allowedNames.map((name) => {
    const reference = sonataSignatureTemplates.find((template) => template.name === name)?.color
    return reference ? { name, reference, distance: sonataHueDistance(captured, reference) } : undefined
  })
  if (ranked.some((entry) => !entry)) return
  const [best, runnerUp] = ranked.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.distance - right.distance)
  if (!best || !runnerUp || best.distance >= .18 || runnerUp.distance - best.distance < .08
    || sonataHueDistance(best.reference, runnerUp.reference) < .15) return
  return { value: best.name, confidence: Math.min(.95, .65 + runnerUp.distance - best.distance) }
}

export async function recognizeSonataAt(image: HTMLImageElement, rect: ScanRect, allowedNames?: string[], colorAware = false) {
  return classifySonataCandidates(sonataSignaturesInBox(image, rect), sonataSignatureTemplates, allowedNames,
    colorAware ? iconColor(cropPixels(image, rect), 80, 15) : undefined)
}

function centeredGlyph(mask: boolean[]) {
  const points = mask.flatMap((visible, index) => visible ? [index] : [])
  if (!points.length) return mask
  const xs = points.map((index) => index % 24), ys = points.map((index) => Math.floor(index / 24))
  const dx = 12 - Math.round((Math.min(...xs) + Math.max(...xs)) / 2)
  const dy = 12 - Math.round((Math.min(...ys) + Math.max(...ys)) / 2)
  const centered = Array<boolean>(24 * 24).fill(false)
  for (const index of points) {
    const x = index % 24 + dx, y = Math.floor(index / 24) + dy
    if (x >= 0 && x < 24 && y >= 0 && y < 24) centered[y * 24 + x] = true
  }
  return centered
}

function sonataGlyph(mask: string) {
  const expected: boolean[] = []
  for (let y = 0; y < 24; y += 1) {
    const row = Number.parseInt(mask.slice(y * 6, y * 6 + 6), 16)
    for (let x = 0; x < 24; x += 1) expected.push(Boolean(row & (1 << (23 - x))))
  }
  return expected
}

function glyphOverlap(left: boolean[], right: boolean[]) {
  let intersection = 0, union = 0
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] && right[index]) intersection += 1
    if (left[index] || right[index]) union += 1
  }
  return union ? intersection / union : 0
}

export function classifyBackpackSonataGlyph(pixels: Uint8ClampedArray, allowedNames?: string[]): VisualRecognition['sonata'] {
  if (pixels.length !== 24 * 24 * 4 || !allowedNames || allowedNames.length < 2) return
  const color = iconColor(pixels, 80, 15)
  if (!color) return
  const nearColors = allowedNames.filter((name) => {
    const reference = sonataSignatureTemplates.find((template) => template.name === name)?.color
    return reference && sonataHueDistance(color, reference) < .18
  })
  if (nearColors.length < 2 || nearColors.some((name) => !wuwaflexSonataSignatures.some((entry) => entry.name === name))) return
  const captured = centeredGlyph(Array.from({ length: 24 * 24 }, (_, index) => {
    const offset = index * 4
    const channels = [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
    return pixels[offset + 3] > 80 && Math.min(...channels) >= 130 && Math.max(...channels) - Math.min(...channels) <= 35
  }))
  const ranked = nearColors.map((name) => ({ name, score: Math.max(...wuwaflexSonataSignatures
    .filter((entry) => entry.name === name)
    .map((entry) => glyphOverlap(captured, centeredGlyph(sonataGlyph(entry.mask))))) }))
    .sort((left, right) => right.score - left.score)
  const [best, runnerUp] = ranked
  // Small in-game glyphs score lower than card badges, so require a clear lead.
  if (!best || !runnerUp || best.score < .23 || best.score - runnerUp.score < .1) return
  return { value: best.name, confidence: Math.min(.9, .55 + best.score * .4) }
}

export function classifyWuwaflexSonata(pixels: Uint8ClampedArray, allowedNames?: string[]): VisualRecognition['sonata'] {
  if (pixels.length !== 24 * 24 * 4) return
  const allowed = allowedNames?.length ? new Set(allowedNames) : undefined
  const captured = Array.from({ length: 24 * 24 }, (_, index) => {
    const offset = index * 4
    const channels = [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
    return pixels[offset + 3] > 80 && Math.min(...channels) >= 130 && Math.max(...channels) - Math.min(...channels) <= 35
  })
  const whiteRing = captured.reduce((count, visible, index) => {
    const x = index % 24 - 11.5, y = Math.floor(index / 24) - 11.5
    const radius = x * x + y * y
    return count + Number(visible && radius >= 36 && radius <= 100)
  }, 0) >= 35
  // A white ring reveals the card background, which is not the Sonata's color.
  const corners = [0, 23, 24 * 23, 24 * 24 - 1]
  const background = [0, 1, 2].map((channel) => corners.reduce((sum, index) => sum + pixels[index * 4 + channel], 0) / corners.length)
  const ringPixels = pixels.slice()
  for (let index = 0; index < 24 * 24; index += 1) {
    const offset = index * 4
    const contrast = background.reduce((sum, channel, color) => sum + Math.abs(ringPixels[offset + color] - channel), 0)
    if (contrast < 90) ringPixels[offset + 3] = 0
  }
  const badgeColor = whiteRing ? undefined : iconColor(ringPixels, 140)
  if (badgeColor && allowed && allowed.size > 1) {
    const colors = [...allowed].map((name) => {
      const references: IconColor[] = wuwaflexSonataSignatures.filter((entry) => entry.name === name).map((entry) => entry.color)
      const catalog = generatedSonataSignatures.find((entry) => entry.name === name)
      if (!references.length && catalog && 'color' in catalog) references.push(catalog.color)
      return references.length ? { name, distance: Math.min(...references.map((color) => iconColorDistance(badgeColor, color))) } : undefined
    })
    if (colors.every((entry) => entry !== undefined)) {
      const [best, runnerUp] = colors.sort((left, right) => left!.distance - right!.distance)
      if (best && runnerUp && best.distance < .18 && runnerUp.distance - best.distance >= .04)
        return { value: best.name, confidence: Math.min(.95, .65 + (runnerUp.distance - best.distance)) }
    }
  }
  const colorMatched = badgeColor && wuwaflexSonataSignatures.some((template) => iconColorDistance(badgeColor, template.color) < .12)
  const ranked = new Map<string, number>(), allowedRanked = new Map<string, number>(), centeredRanked = new Map<string, number>()
  const centeredCaptured = (allowed || colorMatched) ? centeredGlyph(captured) : undefined
  for (const template of wuwaflexSonataSignatures) {
    const expected = sonataGlyph(template.mask)
    const score = glyphOverlap(captured, expected)
    const colorCompatible = !badgeColor || !colorMatched || iconColorDistance(badgeColor, template.color) < .12
    if (colorCompatible) ranked.set(template.name, Math.max(ranked.get(template.name) ?? 0, score))
    if (allowed ? allowed.has(template.name) : colorCompatible) {
      allowedRanked.set(template.name, Math.max(allowedRanked.get(template.name) ?? 0, score))
      if (centeredCaptured) centeredRanked.set(template.name, Math.max(centeredRanked.get(template.name) ?? 0, glyphOverlap(centeredCaptured, centeredGlyph(expected))))
    }
  }
  const select = (scores: Map<string, number>, minimum: number, margin: number) => {
    const [best, runnerUp] = [...scores].sort((left, right) => right[1] - left[1])
    return best && best[1] >= minimum && (!runnerUp || best[1] - runnerUp[1] >= margin)
      ? { value: best[0], confidence: Math.min(.96, .55 + best[1] * .4) } : undefined
  }
  const visual = select(ranked, .62, .1)
  if (visual && (!allowed || allowed.has(visual.value))) return visual
  // A conflicting badge is rechecked by shape against only the Echo's possible sets.
  return select(allowedRanked, allowed ? .55 : .4, allowed ? .05 : .035)
    ?? (centeredCaptured ? select(centeredRanked, .55, .05) : undefined)
}

export async function recognizeWuwaflexSonataAt(image: HTMLImageElement, rect: ScanRect, allowedNames?: string[]) {
  const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 24
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return
  let best: VisualRecognition['sonata']
  for (const yOffset of [0, -.2]) {
    context.clearRect(0, 0, 24, 24)
    context.drawImage(image, image.naturalWidth * rect.x, image.naturalHeight * (rect.y + rect.height * yOffset), image.naturalWidth * rect.width, image.naturalHeight * rect.height, 0, 0, 24, 24)
    const candidate = classifyWuwaflexSonata(context.getImageData(0, 0, 24, 24).data, allowedNames)
    if (candidate && (!best || candidate.confidence > best.confidence)) best = candidate
  }
  if (best || !allowedNames?.length) return best
  const catalogMatch = classifySonataCandidates(sonataSignaturesInBox(image, rect), sonataSignatureTemplates, allowedNames)
  return catalogMatch && catalogMatch.confidence >= .85 ? catalogMatch : undefined
}

export async function recognizeVisualFields(imageDataUrl: string, sonataRect?: ScanRect, allowedSonatas?: string[], regions?: ScanRegion[]): Promise<VisualRecognition> {
  const image = new Image()
  image.src = imageDataUrl
  await image.decode()
  const inventory = image.naturalWidth / image.naturalHeight > .58
  const defaults = regionsForLayout(inventory ? 'echo-management' : 'echo-detail')
  const rectFor = (kind: ScanRegion['kind']) => regions?.find((region) => region.kind === kind)?.rect ?? defaults.find((region) => region.kind === kind)?.rect
  const state = classifyEchoState(cropPixels(image, rectFor('discarded')!), cropPixels(image, rectFor('locked')!))
  const iconRect = sonataRect ?? rectFor('sonata')!
  const iconPixels = cropPixels(image, iconRect)
  const neutralIcon = !iconColor(iconPixels, 80, 15)
  const signatures = sonataSignaturesInBox(image, iconRect)
  const iconMatch = classifySonataCandidates(signatures, sonataSignatureTemplates, undefined, neutralIcon ? undefined : iconColor(iconPixels, 80, 15))
  const sonata = (iconMatch && iconMatch.confidence >= .85 ? iconMatch : undefined)
    ?? classifySonataColor(iconPixels, allowedSonatas)
    ?? classifyBackpackSonataGlyph(cropPixels(image, iconRect, 24), allowedSonatas)
    ?? classifySonataCandidates(signatures, neutralIcon ? sonataSignatureTemplates.filter((entry) => !entry.color) : sonataSignatureTemplates, allowedSonatas)
  return { rarity: classifyRarityPixels(cropPixels(image, rectFor('rarity')!)), sonata, ...state }
}
