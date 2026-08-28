import type { Echo } from '../domain/types'
import type { VisualRecognition } from './parser'
import type { ScanRect } from './types'
import { generatedSonataSignatures } from '../game-data/scanner-signatures.generated'

const DETAIL_VISUAL_CROPS = {
  sonata: { x: 0.54, y: 0.035, width: 0.13, height: 0.085 },
  discard: { x: 0.60, y: 0.045, width: 0.10, height: 0.075 },
  lock: { x: 0.79, y: 0.045, width: 0.10, height: 0.075 }
}
const INVENTORY_VISUAL_CROPS = {
  sonata: { x: 0.21, y: 0.105, width: 0.11, height: 0.08 },
  discard: { x: 0.11, y: 0.255, width: 0.15, height: 0.11 },
  lock: { x: 0.29, y: 0.255, width: 0.15, height: 0.11 }
}
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

function cropPixels(image: HTMLImageElement, crop: { x: number; y: number; width: number; height: number }) {
  const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return new Uint8ClampedArray()
  context.drawImage(image, image.naturalWidth * crop.x, image.naturalHeight * crop.y, image.naturalWidth * crop.width, image.naturalHeight * crop.height, 0, 0, 32, 32)
  return context.getImageData(0, 0, 32, 32).data
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

function classifySonataCandidates(captured: number[][], templates: Array<{ name: string; signature: number[] }>, allowedNames?: string[]): VisualRecognition['sonata'] {
  const allowed = allowedNames?.length ? new Set(allowedNames) : undefined
  const candidates = allowed ? templates.filter((template) => allowed.has(template.name)) : templates
  const ranked = candidates.map((template) => ({
    name: template.name,
    score: Math.max(...captured.map((signature) => 1 - template.signature.reduce((sum, value, index) => sum + Math.abs(value - signature[index]), 0) / (signature.length * 4)))
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

function loadSonataSignatures() {
  return generatedSonataSignatures.map((entry) => ({
    name: entry.name,
    signature: Array.from(entry.signature, (value) => value / 32)
  }))
}

export async function recognizeSonataAt(imageDataUrl: string, rect: ScanRect, allowedNames?: string[]) {
  const image = new Image(); image.src = imageDataUrl; await image.decode()
  return classifySonataCandidates(sonataSignaturesInBox(image, rect), await loadSonataSignatures(), allowedNames)
}

export async function recognizeVisualFields(imageDataUrl: string, sonataRect?: ScanRect, allowedSonatas?: string[]): Promise<VisualRecognition> {
  const image = new Image()
  image.src = imageDataUrl
  await image.decode()
  const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 24
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return {}
  const crops = image.naturalWidth / image.naturalHeight > .58 ? INVENTORY_VISUAL_CROPS : DETAIL_VISUAL_CROPS
  const state = classifyEchoState(cropPixels(image, crops.discard), cropPixels(image, crops.lock))
  const sonata = classifySonataCandidates(sonataSignaturesInBox(image, sonataRect ?? crops.sonata), await loadSonataSignatures(), allowedSonatas)
  const rarityCanvas = document.createElement('canvas'); rarityCanvas.width = Math.max(1, Math.round(image.naturalWidth * .72)); rarityCanvas.height = Math.max(1, Math.round(image.naturalHeight * .075))
  const rarityContext = rarityCanvas.getContext('2d', { willReadFrequently: true }); if (!rarityContext) return { sonata, ...state }
  rarityContext.drawImage(image, 0, 0, rarityCanvas.width, rarityCanvas.height, 0, 0, rarityCanvas.width, rarityCanvas.height)
  return { rarity: classifyRarityPixels(rarityContext.getImageData(0, 0, rarityCanvas.width, rarityCanvas.height).data), sonata, ...state }
}
