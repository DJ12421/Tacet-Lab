import { buildCardFormats, type BuildCardFormatId, type BuildCardFormatPreference } from './build-card-formats'

export interface BuildCardFormatDetection { id: BuildCardFormatId; confidence: number; certain: boolean }

function regionMetrics(image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 24
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return undefined
  context.drawImage(image, image.naturalWidth * x, image.naturalHeight * y, image.naturalWidth * width, image.naturalHeight * height, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let lightness = 0, neutral = 0, brightNeutral = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
    const value = (red * .2126 + green * .7152 + blue * .0722) / 255
    const isNeutral = Math.max(red, green, blue) - Math.min(red, green, blue) < 18
    lightness += value; neutral += Number(isNeutral); brightNeutral += Number(isNeutral && value > .72)
  }
  const count = pixels.length / 4
  return { lightness: lightness / count, neutral: neutral / count, brightNeutral: brightNeutral / count }
}

export function detectBuildCardFormat(image: HTMLImageElement, preference: BuildCardFormatPreference = 'auto'): BuildCardFormatDetection {
  if (preference !== 'auto') return { id: preference, confidence: 1, certain: true }
  const ratio = image.naturalWidth / image.naturalHeight
  const aspectScore = (target: number) => Math.max(0, 1 - Math.abs(ratio - target) / .16)
  const scores = new Map<BuildCardFormatId, number>(buildCardFormats.map((format) => [format.id, aspectScore(format.aspectRatio)]))

  if (ratio > 2) scores.set('wuwaflex', (scores.get('wuwaflex') ?? 0) + .55)
  if (ratio > 1.58 && ratio < 1.72) scores.set('wuwa-optimizer', (scores.get('wuwa-optimizer') ?? 0) + .55)
  if (ratio < 1.48) scores.set('the-wuwa-calculator', (scores.get('the-wuwa-calculator') ?? 0) + .55)
  if (ratio > 1.72 && ratio < 1.84) {
    const topRight = regionMetrics(image, .88, .015, .105, .085)
    const bottomCenter = regionMetrics(image, .35, .93, .3, .055)
    if (topRight && topRight.brightNeutral > .055) scores.set('discord-bot', (scores.get('discord-bot') ?? 0) + .7)
    else scores.set('tacet-lab', (scores.get('tacet-lab') ?? 0) + .6)
  }

  const ranked = [...scores].sort((left, right) => right[1] - left[1])
  const [best, runnerUp] = ranked
  const margin = best[1] - (runnerUp?.[1] ?? 0)
  const confidence = Math.min(.99, .45 + best[1] * .3 + margin * .35)
  return { id: best[0], confidence, certain: best[1] >= .8 && margin >= .18 }
}
