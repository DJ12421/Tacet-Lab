import type { ScanCandidate, ScanField, StatLine } from '../domain/types'
import type { BuildCardFormatId } from './build-card-formats'

export type ScanSource = 'screen' | 'screenshot' | 'video' | 'manual'
export type ScanLayout = 'echo-detail' | 'echo-management' | 'build-card' | 'unknown'
export type ScanRegionKind =
  | 'name' | 'level' | 'cost' | 'rarity' | 'sonata'
  | 'main-stat-label' | 'main-stat-value' | 'substats-block' | 'substat-row'
  | 'equipped-character' | 'locked' | 'discarded'

export interface ScanRect { x: number; y: number; width: number; height: number }

export interface ScanRegion {
  id: string
  kind: ScanRegionKind
  label: string
  rect: ScanRect
  index?: number
  recognition: 'text' | 'number' | 'visual'
}

export interface ScanValidation {
  valid: boolean
  messages: string[]
}

export interface ScanEvidence<T = unknown> {
  region: ScanRegion
  originalCrop: string
  processedCrop: string
  rawOcr: string
  confidence: number
  parsedValue?: T
  validation: ScanValidation
  workerId: string
  jobId: string
  processingMs: number
  preprocessing: string
}

export interface ScanFrame {
  id: string
  sessionId: string
  sequence: number
  source: ScanSource
  capturedAt: number
  width: number
  height: number
  panelRect: ScanRect
  panelImageDataUrl: string
  fingerprint: number[]
  layout: ScanLayout
  buildCardFormat?: BuildCardFormatId
  buildCardFormatConfidence?: number
  calibrationProfileId?: string
}

export type ScanJobStatus = 'queued' | 'preprocessing' | 'recognizing' | 'completed' | 'cancelled' | 'failed'

export interface ScanJob {
  id: string
  sessionId: string
  frameId: string
  frameSequence: number
  regionId: string
  queuedAt: number
  startedAt?: number
  completedAt?: number
  workerId?: string
  status: ScanJobStatus
  error?: string
}

export interface ScanSessionMetrics {
  workerCount: number
  queueDepth: number
  activeJobs: number
  processedFrames: number
  skippedFrames: number
  failures: number
  duplicates: number
  newCandidates: number
  corrected: number
  rejected: number
  approved: number
  totalFrames: number
  startedAt: number
  completedAt?: number
}

export interface ScanSession {
  id: string
  source: ScanSource
  status: 'idle' | 'running' | 'stopping' | 'completed' | 'cancelled' | 'failed'
  createdAt: number
  nextFrameSequence: number
  metrics: ScanSessionMetrics
}

export interface CalibrationProfile {
  id: string
  name: string
  layout: Exclude<ScanLayout, 'unknown'>
  buildCardFormat?: BuildCardFormatId
  sourceWidth: number
  sourceHeight: number
  uiScale: number
  panelRect: ScanRect
  regions: ScanRegion[]
  createdAt: number
  updatedAt: number
}

export interface DiagnosticScanCandidate extends ScanCandidate {
  sessionId?: string
  frameSequence?: number
  evidence?: Record<string, ScanEvidence>
  reviewState?: 'new' | 'duplicate' | 'corrected' | 'rejected' | 'failed'
  selected?: boolean
}

export interface RecognizedFields {
  name?: ScanField<string>
  level?: ScanField<number>
  cost?: ScanField<1 | 3 | 4>
  rarity?: ScanField<1 | 2 | 3 | 4 | 5>
  sonata?: ScanField<string>
  mainStat?: ScanField<StatLine>
  subStats?: ScanField<StatLine>[]
  equippedBy?: ScanField<string>
  locked?: ScanField<boolean>
  excluded?: ScanField<boolean>
}

export type OcrWorkerPreference = 'auto' | 1 | 2 | 4
