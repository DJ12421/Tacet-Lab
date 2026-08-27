import type { Echo } from '../domain/types'
import { createLocalId } from '../domain/id'
import { fingerprintDistance } from './capture'
import { findDuplicate } from './deduplication'
import { prepareScanFrame, type PreparedFrame } from './frame'
import { OcrPool, type OcrPoolMetrics } from './ocr-pool'
import { PreprocessClient } from './preprocess'
import { recognizeFrame, rerunRegion } from './recognize'
import { recognizeBuildCard } from './build-card'
import type { CalibrationProfile, DiagnosticScanCandidate, OcrWorkerPreference, ScanSession, ScanSource } from './types'
import type { BuildCardFormatPreference } from './build-card-formats'

interface QueuedFrame { prepared: PreparedFrame; resolve: (accepted: boolean) => void; reject: (error: Error) => void }
export interface ScanControllerCallbacks {
  onCandidate: (candidate: DiagnosticScanCandidate) => void
  onSession: (session: ScanSession) => void
  onProgress?: (progress: number, status: string) => void
  getEchoes?: () => Echo[]
  getPending?: () => DiagnosticScanCandidate[]
}

export class ScanSessionController {
  readonly session: ScanSession
  private pool: OcrPool
  private preprocess = new PreprocessClient()
  private queue: QueuedFrame[] = []
  private active = false
  private cancelled = false
  private fingerprints: number[][] = []
  private frameCache = new Map<string, PreparedFrame>()
  private buildCardFormatPreference: BuildCardFormatPreference = 'auto'

  constructor(source: ScanSource, private callbacks: ScanControllerCallbacks, preference: OcrWorkerPreference = 'auto') {
    const now = Date.now()
    this.session = {
      id: createLocalId(), source, status: 'running', createdAt: now, nextFrameSequence: 0,
      metrics: { workerCount: 0, queueDepth: 0, activeJobs: 0, processedFrames: 0, skippedFrames: 0, failures: 0, duplicates: 0, newCandidates: 0, corrected: 0, rejected: 0, approved: 0, totalFrames: 0, startedAt: now }
    }
    this.pool = new OcrPool({ preference, onMetrics: (metrics) => this.applyPoolMetrics(metrics), onProgress: callbacks.onProgress })
    void this.pool.warm()
    this.emit()
  }

  setWorkerPreference(preference: OcrWorkerPreference) { this.pool.setPreference(preference) }
  setBuildCardFormatPreference(preference: BuildCardFormatPreference) { this.buildCardFormatPreference = preference }

  private applyPoolMetrics(metrics: OcrPoolMetrics) {
    this.session.metrics.workerCount = metrics.workerCount
    this.session.metrics.activeJobs = metrics.activeJobs
    this.session.metrics.failures = Math.max(this.session.metrics.failures, metrics.failures)
    this.updateQueueDepth()
  }

  private updateQueueDepth() { this.session.metrics.queueDepth = this.queue.length + this.pool.metrics().queueDepth; this.emit() }
  private emit() { this.callbacks.onSession(structuredClone(this.session)) }

  hasCapacity(source = this.session.source) {
    const max = source === 'screen' ? 2 : source === 'video' ? 4 : Number.POSITIVE_INFINITY
    return this.queue.length < max
  }

  async enqueue(dataUrl: string, source: ScanSource = this.session.source, preferredProfile?: CalibrationProfile): Promise<boolean> {
    if (this.cancelled || this.session.status !== 'running') return false
    if (source === 'screen' && !this.hasCapacity(source)) {
      const obsoleteIndex = this.queue.findIndex((entry) => entry.prepared.frame.source === 'screen')
      if (obsoleteIndex >= 0) { const [obsolete] = this.queue.splice(obsoleteIndex, 1); obsolete.resolve(false); this.session.metrics.skippedFrames += 1 }
    }
    if (source === 'video' && !this.hasCapacity(source)) return false
    const sequence = this.session.nextFrameSequence++
    const prepared = await prepareScanFrame(dataUrl, source, this.session.id, sequence, preferredProfile, undefined, this.buildCardFormatPreference)
    this.session.metrics.totalFrames += 1
    if ((source === 'screen' || source === 'video') && this.fingerprints.some((fingerprint) => fingerprintDistance(fingerprint, prepared.frame.fingerprint) <= .018)) {
      this.session.metrics.skippedFrames += 1; this.session.metrics.duplicates += 1; this.emit(); return false
    }
    this.fingerprints.push(prepared.frame.fingerprint)
    if (this.fingerprints.length > 80) this.fingerprints.shift()
    this.frameCache.set(prepared.frame.id, prepared)
    const accepted = new Promise<boolean>((resolve, reject) => this.queue.push({ prepared, resolve, reject }))
    this.updateQueueDepth(); void this.drain()
    return accepted
  }

  private async drain() {
    if (this.active) return
    this.active = true
    while (!this.cancelled && this.queue.length) {
      const item = this.queue.shift()!; this.updateQueueDepth()
      try {
        const candidates = item.prepared.frame.layout === 'build-card'
          ? await recognizeBuildCard(item.prepared.frame, item.prepared.profile, this.pool, this.preprocess, this.callbacks.onProgress)
          : [await recognizeFrame(item.prepared.frame, item.prepared.profile, this.pool, this.preprocess, { onStage: this.callbacks.onProgress })]
        if (this.cancelled || candidates.some((candidate) => candidate.sessionId !== this.session.id)) { item.resolve(false); continue }
        for (const candidate of candidates) {
          const duplicateOf = findDuplicate(candidate, this.callbacks.getEchoes?.() ?? [], [...(this.callbacks.getPending?.() ?? []), ...candidates.filter((entry) => entry.id !== candidate.id)])
          if (duplicateOf) { candidate.duplicateOf = duplicateOf; candidate.reviewState = 'duplicate'; this.session.metrics.duplicates += 1 }
          else this.session.metrics.newCandidates += 1
          this.callbacks.onCandidate(candidate)
        }
        this.session.metrics.processedFrames += 1
        item.resolve(true)
      } catch (error) {
        this.session.metrics.failures += 1
        item.reject(error instanceof Error ? error : new Error('Frame recognition failed.'))
      } finally { this.emit() }
    }
    this.active = false
    if (!this.cancelled && this.session.status === 'stopping') this.finish('completed')
  }

  markCorrected() { this.session.metrics.corrected += 1; this.emit() }
  markRejected() { this.session.metrics.rejected += 1; this.emit() }
  markApproved() { this.session.metrics.approved += 1; this.emit() }
  markDuplicate() { this.session.metrics.duplicates += 1; this.emit() }

  async rerunField(candidate: DiagnosticScanCandidate, regionId: string) {
    const prepared = [...this.frameCache.values()].find((entry) => entry.frame.sequence === candidate.frameSequence)
    if (!prepared || this.cancelled) throw new Error('The source frame is no longer available in this session.')
    const rescanned = await rerunRegion(prepared.frame, prepared.profile, candidate, regionId, this.pool, this.preprocess, this.callbacks.onProgress)
    this.markCorrected()
    return rescanned
  }

  requestCompletion() { this.session.status = this.active || this.queue.length ? 'stopping' : 'completed'; if (this.session.status === 'completed') this.session.metrics.completedAt = Date.now(); this.emit() }

  private finish(status: ScanSession['status']) { this.session.status = status; this.session.metrics.completedAt = Date.now(); this.emit() }

  async cancel() {
    if (this.cancelled) return
    this.cancelled = true; this.session.status = 'cancelled'; this.session.metrics.completedAt = Date.now()
    const error = new Error('Scan session cancelled.')
    this.queue.splice(0).forEach((item) => item.reject(error))
    this.preprocess.terminate(); await this.pool.cancel(); this.updateQueueDepth(); this.emit()
  }
}
