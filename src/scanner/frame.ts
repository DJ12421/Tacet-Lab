import { createCalibrationProfile, detectRightPanel, findCompatibleProfile } from './calibration'
import { createLocalId } from '../domain/id'
import { defaultPanelRectForLayout } from './regions'
import type { CalibrationProfile, ScanFrame, ScanLayout, ScanRect, ScanSource } from './types'
import { detectBuildCardFormat } from './build-card-detection'
import type { BuildCardFormatPreference } from './build-card-formats'

const loadImage = async (dataUrl: string) => { const image = new Image(); image.src = dataUrl; await image.decode(); return image }

function panelFingerprint(context: CanvasRenderingContext2D) {
  const sample = document.createElement('canvas'); sample.width = 32; sample.height = 16
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) return []
  sampleContext.drawImage(context.canvas, 0, 0, context.canvas.width, context.canvas.height, 0, 0, 32, 16)
  const pixels = sampleContext.getImageData(0, 0, 32, 16).data
  return Array.from({ length: 512 }, (_, index) => {
    const offset = index * 4
    return Math.round((pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722) / 16)
  })
}

export interface PreparedFrame { frame: ScanFrame; profile: CalibrationProfile; detectionConfidence: number; needsCalibration: boolean }

export async function prepareScanFrame(
  sourceDataUrl: string,
  source: ScanSource,
  sessionId: string,
  sequence: number,
  preferredProfile?: CalibrationProfile,
  preferredLayout?: Exclude<ScanLayout, 'unknown'>,
  preferredBuildCardFormat: BuildCardFormatPreference = 'auto'
): Promise<PreparedFrame> {
  const image = await loadImage(sourceDataUrl)
  const width = image.naturalWidth, height = image.naturalHeight
  const detected = detectRightPanel(image, width, height)
  const dimensionCompatiblePreferred = preferredProfile && Math.abs(preferredProfile.sourceWidth - width) <= 2 && Math.abs(preferredProfile.sourceHeight - height) <= 2 ? preferredProfile : undefined
  const formatDetection = source === 'screenshot'
    ? detectBuildCardFormat(image, preferredBuildCardFormat)
    : { id: 'discord-bot' as const, confidence: 0, certain: false }
  const buildCard = source === 'screenshot' && (preferredLayout === 'build-card' || formatDetection.certain)
  const layout: Exclude<ScanLayout, 'unknown'> = buildCard ? 'build-card' : preferredLayout ?? dimensionCompatiblePreferred?.layout ?? (detected.layout === 'unknown' ? 'echo-detail' : detected.layout)
  const format = buildCard ? formatDetection.id : undefined
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
      buildCardFormat: buildCard ? formatDetection.id : undefined, buildCardFormatConfidence: buildCard ? formatDetection.confidence : undefined,
      calibrationProfileId: saved?.id ?? compatiblePreferred?.id
    },
    profile, detectionConfidence: layout === 'build-card' ? 1 : detected.confidence, needsCalibration: !saved && !compatiblePreferred
  }
}

export function captureSourceDataUrl(source: CanvasImageSource, width: number, height: number, quality = .92) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (!context) throw new Error('Capture canvas is unavailable.')
  context.drawImage(source, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', quality)
}
