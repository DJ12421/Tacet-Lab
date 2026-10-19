import { createCalibrationProfile, detectRightPanel, findCompatibleProfile } from './calibration'
import { createLocalId } from '../domain/id'
import { defaultPanelRectForLayout } from './regions'
import type { CalibrationProfile, ScanFrame, ScanLayout, ScanRect, ScanSource } from './types'
import { detectBuildCardFormat } from './build-card-detection'
import type { BuildCardFormatPreference } from './build-card-formats'
import { readCardMetadata } from './card-metadata'

const loadImage = async (dataUrl: string) => { const image = new Image(); image.src = dataUrl; await image.decode(); return image }

function snapshotVideo(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The captured frame is not ready.')
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth; canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The captured frame could not be prepared.')
  context.drawImage(video, 0, 0)
  return canvas
}

function panelFingerprint(context: CanvasRenderingContext2D) {
  const sample = document.createElement('canvas'); sample.width = 32; sample.height = 16
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) return []
  sampleContext.drawImage(context.canvas, 0, 0, context.canvas.width, context.canvas.height, 0, 0, 32, 16)
  const pixels = sampleContext.getImageData(0, 0, 32, 16).data
  const coarse = Array.from({ length: 512 }, (_, index) => {
    const offset = index * 4
    return Math.round((pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722) / 16)
  })
  sample.width = 64; sample.height = 48
  sampleContext.drawImage(context.canvas,
    context.canvas.width * .1, context.canvas.height * .21,
    context.canvas.width * .85, context.canvas.height * .25,
    0, 0, 64, 48)
  const statPixels = sampleContext.getImageData(0, 0, 64, 48).data
  return [...coarse, ...Array.from({ length: 64 * 48 }, (_, index) => {
    const offset = index * 4
    return Math.round((statPixels[offset] * .2126 + statPixels[offset + 1] * .7152 + statPixels[offset + 2] * .0722) / 16)
  })]
}

export interface PreparedFrame { frame: ScanFrame; profile: CalibrationProfile; detectionConfidence: number }

export async function prepareScanFrame(
  sourceImage: string | HTMLVideoElement,
  source: ScanSource,
  sessionId: string,
  sequence: number,
  preferredProfile?: CalibrationProfile,
  preferredLayout?: Exclude<ScanLayout, 'unknown'>,
  preferredBuildCardFormat: BuildCardFormatPreference = 'auto'
): Promise<PreparedFrame> {
  const image = typeof sourceImage === 'string' ? await loadImage(sourceImage) : snapshotVideo(sourceImage)
  const cardMetadata = source === 'screenshot' && typeof sourceImage === 'string' ? readCardMetadata(sourceImage) : undefined
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height
  if (!width || !height) throw new Error('The captured frame is not ready.')
  const detected = detectRightPanel(image, width, height)
  const dimensionCompatiblePreferred = preferredProfile && (source === 'screenshot' || preferredProfile.layout !== 'build-card') && Math.abs(preferredProfile.sourceWidth - width) <= 2 && Math.abs(preferredProfile.sourceHeight - height) <= 2 ? preferredProfile : undefined
  const formatDetection = source === 'screenshot' && 'naturalWidth' in image
    ? detectBuildCardFormat(image, preferredBuildCardFormat)
    : { id: 'discord-bot' as const, confidence: 0, certain: false }
  const requestedLayout = preferredLayout ?? dimensionCompatiblePreferred?.layout
  const buildCard = source === 'screenshot' && (cardMetadata || requestedLayout === 'build-card' || (!requestedLayout && formatDetection.certain))
  const layout: Exclude<ScanLayout, 'unknown'> = buildCard ? 'build-card' : (source !== 'screenshot' && requestedLayout === 'build-card' ? undefined : requestedLayout) ?? (detected.layout === 'unknown' ? 'echo-detail' : detected.layout)
  const format = cardMetadata ? 'tacet-lab' : buildCard ? formatDetection.id : undefined
  const compatiblePreferred = dimensionCompatiblePreferred?.layout === layout
    && (layout !== 'build-card' || (dimensionCompatiblePreferred.buildCardFormat ?? 'discord-bot') === format)
    ? dimensionCompatiblePreferred
    : undefined
  const saved = findCompatibleProfile(width, height, layout, compatiblePreferred?.uiScale, format)
  const defaultPanel = defaultPanelRectForLayout(layout)
  const profile = compatiblePreferred ?? saved ?? createCalibrationProfile(width, height, defaultPanel, layout, 1, format)
  const rect: ScanRect = profile.panelRect
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * rect.width)); canvas.height = Math.max(1, Math.round(height * rect.height))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('The captured panel could not be prepared.')
  context.drawImage(image, width * rect.x, height * rect.y, width * rect.width, height * rect.height, 0, 0, canvas.width, canvas.height)
  const panelImageDataUrl = canvas.toDataURL('image/jpeg', .92)
  return {
    frame: {
      id: createLocalId(), sessionId, sequence, source, capturedAt: Date.now(), width, height,
      panelRect: { ...rect }, panelImageDataUrl, fingerprint: panelFingerprint(context), layout: profile.layout,
      buildCardFormat: format, buildCardFormatConfidence: cardMetadata ? 1 : buildCard ? formatDetection.confidence : undefined, cardMetadata,
      calibrationProfileId: saved?.id ?? compatiblePreferred?.id
    },
    profile, detectionConfidence: layout === 'build-card' ? 1 : detected.confidence
  }
}

export function captureSourceDataUrl(source: CanvasImageSource, width: number, height: number, quality = .92) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (!context) throw new Error('Capture canvas is unavailable.')
  context.drawImage(source, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', quality)
}
