import type { CalibrationProfile } from './types'
import { substatBlockFromRegions } from './regions'

export interface CapturedPanel {
  dataUrl: string
  fingerprint: number[]
  sourceWidth: number
  sourceHeight: number
  calibrated: boolean
}

export interface PanelProbe {
  fingerprint: number[]
  sourceWidth: number
  sourceHeight: number
  calibrated: boolean
}

// Compact Echo details column, relative to a calibrated 16:9 game frame.
export const ECHO_CROP = { x: 0.77, y: 0.12, width: 0.22, height: 0.86 }

function detectedRightPanelCrop(source: CanvasImageSource, width: number, height: number) {
  const sample = document.createElement('canvas')
  sample.width = 384
  sample.height = 96
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return ECHO_CROP
  context.drawImage(source, 0, 0, width, height, 0, 0, sample.width, sample.height)
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data
  const columnLightness = (x: number) => {
    let total = 0, count = 0
    for (let y = 12; y < 88; y += 1) {
      const offset = (y * sample.width + x) * 4
      total += pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722
      count += 1
    }
    return total / count
  }
  let best = { x: 0, score: 0 }
  for (let x = Math.round(sample.width * .56); x <= Math.round(sample.width * .84); x += 1) {
    const center = (columnLightness(x - 1) + columnLightness(x) + columnLightness(x + 1)) / 3
    const sides = (columnLightness(x - 5) + columnLightness(x + 5)) / 2
    const score = sides - center
    if (score > best.score) best = { x, score }
  }
  if (best.score < 6) return ECHO_CROP
  const divider = best.x / sample.width
  return divider < .7
    ? { x: Math.max(.6, divider + .004), y: .08, width: Math.min(.39, .99 - divider), height: .86 }
    : { x: divider + .004, y: .1, width: .986 - divider, height: .88 }
}

function cropForSource(source: CanvasImageSource, width: number, height: number) {
  const calibrated = Math.abs(width / height - 16 / 9) < 0.08
  return { calibrated, crop: calibrated ? detectedRightPanelCrop(source, width, height) : { x: 0, y: 0, width: 1, height: 1 } }
}

export function probeEchoPanel(video: HTMLVideoElement): PanelProbe | undefined {
  if (!video.videoWidth || !video.videoHeight) return
  const { calibrated, crop } = cropForSource(video, video.videoWidth, video.videoHeight)
  const sample = document.createElement('canvas')
  sample.width = 32
  sample.height = 16
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return
  // The header and stat block change immediately when another Echo is selected.
  context.drawImage(video, video.videoWidth * crop.x, video.videoHeight * crop.y, video.videoWidth * crop.width, video.videoHeight * crop.height * 0.46, 0, 0, 32, 16)
  const pixels = context.getImageData(0, 0, 32, 16).data
  const coarse = Array.from({ length: 512 }, (_, index) => {
    const offset = index * 4
    return Math.round((pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 16)
  })
  sample.width = 64; sample.height = 48
  context.drawImage(video,
    video.videoWidth * (crop.x + crop.width * .1), video.videoHeight * (crop.y + crop.height * .21),
    video.videoWidth * crop.width * .85, video.videoHeight * crop.height * .25,
    0, 0, 64, 48)
  const statPixels = context.getImageData(0, 0, 64, 48).data
  const fine = Array.from({ length: 64 * 48 }, (_, index) => {
    const offset = index * 4
    return Math.round((statPixels[offset] * .2126 + statPixels[offset + 1] * .7152 + statPixels[offset + 2] * .0722) / 16)
  })
  const fingerprint = [...coarse, ...fine]
  return { fingerprint, sourceWidth: video.videoWidth, sourceHeight: video.videoHeight, calibrated }
}

export function probeEchoSubstats(video: HTMLVideoElement, profile: CalibrationProfile, sample: HTMLCanvasElement): number[] | undefined {
  // shortcut: identical consecutive substat panels look like one Echo; sample the name too if real footage shows this case.
  const block = substatBlockFromRegions(profile.regions)
  if (!block || !video.videoWidth || !video.videoHeight) return
  if (sample.width !== 64) sample.width = 64
  if (sample.height !== 32) sample.height = 32
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return
  const panel = profile.panelRect, region = block.rect
  context.drawImage(video,
    video.videoWidth * (panel.x + panel.width * region.x), video.videoHeight * (panel.y + panel.height * region.y),
    video.videoWidth * panel.width * region.width, video.videoHeight * panel.height * region.height,
    0, 0, sample.width, sample.height)
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data
  return Array.from({ length: sample.width * sample.height }, (_, index) => {
    const offset = index * 4
    return Math.round((pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722) / 16)
  })
}

export async function requestGameWindow() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not supported in this browser.')
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 8, max: 12 } }, audio: false })
}

export function stopGameWindow(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop())
}

export function captureEchoPanel(video: HTMLVideoElement): CapturedPanel | undefined {
  const probe = probeEchoPanel(video)
  if (!probe) return
  const { calibrated, crop } = cropForSource(video, probe.sourceWidth, probe.sourceHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * crop.width)
  canvas.height = Math.round(video.videoHeight * crop.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return
  context.drawImage(video, video.videoWidth * crop.x, video.videoHeight * crop.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), fingerprint: probe.fingerprint, sourceWidth: video.videoWidth, sourceHeight: video.videoHeight, calibrated }
}

export function fingerprintDistance(left: number[], right: number[]) {
  if (left.length !== right.length) return 1
  if (left.length === 512 + 64 * 48) {
    const distance = (start: number, end: number) => left.slice(start, end).reduce((sum, value, index) => sum + Math.abs(value - right[start + index]), 0) / ((end - start) * 16)
    return Math.min(1, Math.max(distance(0, 512), distance(512, left.length) * 24))
  }
  return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) / (left.length * 16)
}

export async function fileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a PNG, JPEG, or WebP screenshot.')
  if (file.size > 20 * 1024 * 1024) throw new Error('Screenshot must be smaller than 20 MB.')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The screenshot could not be read.'))
    reader.readAsDataURL(file)
  })
}

export async function cropScreenshot(dataUrl: string): Promise<{ dataUrl: string; calibrated: boolean }> {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const { calibrated, crop } = cropForSource(image, image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.naturalWidth * crop.width)
  canvas.height = Math.round(image.naturalHeight * crop.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The screenshot could not be prepared for OCR.')
  context.drawImage(image, image.naturalWidth * crop.x, image.naturalHeight * crop.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), calibrated }
}
