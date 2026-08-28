import { createScheduler, createWorker, PSM, type Scheduler, type Worker } from 'tesseract.js'
import { createLocalId } from '../domain/id'
import type { OcrWorkerPreference, ScanRegion } from './types'

export interface OcrPoolMetrics { workerCount: number; queueDepth: number; activeJobs: number; averageJobMs: number; failures: number }
export interface OcrRecognition { text: string; confidence: number; workerId: string; jobId: string; processingMs: number }
export interface OcrPoolOptions { preference?: OcrWorkerPreference; onMetrics?: (metrics: OcrPoolMetrics) => void; onProgress?: (progress: number, status: string) => void }

interface Slot { id: string; worker: Worker; scheduler: Scheduler; pending: number; chain: Promise<void> }

const isMobile = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
const textWhitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?'-–—&()/+%"
const numberWhitelist = '0123456789+-.,:%'

function autoWorkerCount(queuePressure = 0, averageJobMs = 0) {
  const cores = Math.max(1, navigator.hardwareConcurrency || 2)
  if (isMobile() || cores <= 2) return 1
  if (cores >= 8 && (queuePressure >= 6 || averageJobMs > 1400)) return 4
  return cores >= 4 ? 2 : 1
}

const parametersFor = (region: ScanRegion) => {
  const normalizedInput = { preserve_interword_spaces: '1', user_defined_dpi: '300', tessedit_do_invert: '0' }
  if (region.recognition === 'number') return { ...normalizedInput, tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: numberWhitelist }
  if (region.kind === 'name') return { ...normalizedInput, tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: textWhitelist }
  if (region.kind === 'main-stat-label') return { ...normalizedInput, tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: textWhitelist }
  if (region.kind === 'equipped-character') return { ...normalizedInput, tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: textWhitelist }
  if (region.kind === 'substats-block' || region.id === 'substats-block') return { ...normalizedInput, tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: textWhitelist }
  if (region.kind === 'substat-row') return { ...normalizedInput, tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: textWhitelist }
  return { ...normalizedInput, tessedit_pageseg_mode: PSM.SINGLE_BLOCK }
}

export class OcrPool {
  private slots: Slot[] = []
  private warming = new Map<number, Promise<void>>()
  private generation = 0
  private completedMs = 0
  private completedJobs = 0
  private failures = 0
  private preference: OcrWorkerPreference

  constructor(private options: OcrPoolOptions = {}) { this.preference = options.preference ?? 'auto' }

  private desiredCount() {
    if (this.preference !== 'auto') return this.preference
    return autoWorkerCount(this.metrics().queueDepth, this.metrics().averageJobMs)
  }

  metrics(): OcrPoolMetrics {
    return {
      workerCount: this.slots.length, queueDepth: this.slots.reduce((sum, slot) => sum + slot.pending, 0),
      activeJobs: this.slots.filter((slot) => slot.pending > 0).length,
      averageJobMs: this.completedJobs ? this.completedMs / this.completedJobs : 0, failures: this.failures
    }
  }

  private emit() { this.options.onMetrics?.(this.metrics()) }

  setPreference(preference: OcrWorkerPreference) {
    this.preference = preference
    void this.warm()
  }

  async warm() {
    const desired = this.desiredCount()
    await Promise.all(Array.from({ length: desired }, (_, index) => this.ensureSlot(index)))
  }

  private async ensureSlot(index: number) {
    if (this.slots[index]) return
    const existing = this.warming.get(index); if (existing) return existing
    const generation = this.generation
    const promise = (async () => {
      const id = `ocr-${index + 1}`
      const worker = await createWorker('eng', 1, { logger: (message) => this.options.onProgress?.(message.progress, `${id}: ${message.status}`) })
      if (generation !== this.generation) { await worker.terminate(); return }
      const scheduler = createScheduler(); scheduler.addWorker(worker)
      this.slots[index] = { id, worker, scheduler, pending: 0, chain: Promise.resolve() }
      this.emit()
    })().finally(() => this.warming.delete(index))
    this.warming.set(index, promise)
    return promise
  }

  async recognize(image: string | Blob, region: ScanRegion, requestedJobId?: string): Promise<OcrRecognition> {
    const desired = this.desiredCount()
    await Promise.all(Array.from({ length: desired }, (_, index) => this.ensureSlot(index)))
    const slot = this.slots.slice(0, desired).sort((left, right) => left.pending - right.pending || left.id.localeCompare(right.id))[0]
    if (!slot) throw new Error('No OCR worker is available.')
    const generation = this.generation
    const jobId = requestedJobId ?? createLocalId()
    slot.pending += 1; this.emit()
    let resolveResult!: (value: OcrRecognition) => void
    let rejectResult!: (error: Error) => void
    const result = new Promise<OcrRecognition>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    slot.chain = slot.chain.then(async () => {
      if (generation !== this.generation) { rejectResult(new Error('OCR job cancelled.')); return }
      const started = performance.now()
      try {
        await slot.worker.setParameters(parametersFor(region))
        const recognition = await slot.scheduler.addJob('recognize', image, {}, { text: true }, jobId)
        if (generation !== this.generation) throw new Error('OCR job cancelled.')
        const processingMs = performance.now() - started
        this.completedMs += processingMs; this.completedJobs += 1
        resolveResult({ text: recognition.data.text, confidence: Math.max(0, Math.min(1, recognition.data.confidence / 100)), workerId: slot.id, jobId, processingMs })
      } catch (error) {
        this.failures += 1
        rejectResult(error instanceof Error ? error : new Error('OCR recognition failed.'))
      } finally { slot.pending = Math.max(0, slot.pending - 1); this.emit() }
    })
    return result
  }

  async cancel() {
    this.generation += 1
    const slots = this.slots.splice(0)
    this.warming.clear()
    await Promise.allSettled(slots.map((slot) => slot.scheduler.terminate()))
    this.emit()
  }

  async terminate() { await this.cancel() }
}
