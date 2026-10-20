import { beforeEach, expect, it, vi } from 'vitest'
import { ScanSessionController } from './session'
import type { PreparedFrame } from './frame'
import type { DiagnosticScanCandidate } from './types'

const mocks = vi.hoisted(() => ({ prepareScanFrame: vi.fn(), recognizeBuildCard: vi.fn(), rerunRegion: vi.fn(), terminatePool: vi.fn(), terminatePreprocess: vi.fn() }))
vi.mock('./frame', () => ({ prepareScanFrame: mocks.prepareScanFrame }))
vi.mock('./ocr-pool', () => ({ OcrPool: class {
  warm() { return Promise.resolve() }
  cancel() { mocks.terminatePool(); return Promise.resolve() }
  terminate() { mocks.terminatePool(); return Promise.resolve() }
  metrics() { return { queueDepth: 0 } }
} }))
vi.mock('./preprocess', () => ({ PreprocessClient: class { release() {} terminate() { mocks.terminatePreprocess() } } }))
vi.mock('./build-card', () => ({ recognizeBuildCard: mocks.recognizeBuildCard }))
vi.mock('./recognize', () => ({ recognizeFrame: vi.fn(), rerunRegion: mocks.rerunRegion }))
vi.mock('./deduplication', () => ({ findDuplicate: () => undefined }))
vi.mock('./parser', () => ({ candidateErrors: (candidate: DiagnosticScanCandidate) => candidate.id === 'clean' ? [] : ['Needs review'] }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepareScanFrame.mockImplementation(async (_image, _source, sessionId, sequence) => ({
    frame: { id: 'frame', sessionId, sequence, source: 'screenshot', layout: 'build-card', panelImageDataUrl: 'panel', fingerprint: [] },
    profile: {}, detectionConfidence: 1
  } as unknown as PreparedFrame))
  mocks.recognizeBuildCard.mockImplementation(async (frame) => [0, 1].map((index) => ({
    id: `echo-${index}`, sessionId: frame.sessionId, frameSequence: frame.sequence + index / 10
  } as DiagnosticScanCandidate)))
  mocks.rerunRegion.mockImplementation(async (_frame, _profile, candidate) => candidate)
})

it('keeps a build-card frame until its last retained candidate is reviewed', async () => {
  const candidates: DiagnosticScanCandidate[] = []
  const controller = new ScanSessionController('screenshot', { onCandidate: (candidate) => { candidates.push(candidate) }, onSession: () => {} })
  await controller.enqueue('image')
  controller.markApproved(candidates[0])
  await expect(controller.rerunField(candidates[1], 'name')).resolves.toBe(candidates[1])
  controller.markRejected(candidates[1])
  await expect(controller.rerunField(candidates[1], 'name')).rejects.toThrow('no longer available')
  await controller.cancel()
})

it('does not keep frames whose candidates are ignored', async () => {
  let ignored: DiagnosticScanCandidate | undefined
  const controller = new ScanSessionController('screenshot', { onCandidate: (candidate) => { ignored = candidate; return false }, onSession: () => {} })
  await controller.enqueue('image')
  await expect(controller.rerunField(ignored!, 'name')).rejects.toThrow('no longer available')
  await controller.cancel()
})

it('releases images and retry frames for a clean scanned card', async () => {
  let clean: DiagnosticScanCandidate | undefined
  mocks.recognizeBuildCard.mockImplementationOnce(async (frame) => [{
    id: 'clean', sessionId: frame.sessionId, frameSequence: frame.sequence,
    imageDataUrl: 'echo-image', buildCard: { id: 'card', sourceImageDataUrl: 'card-image' }
  } as DiagnosticScanCandidate])
  const controller = new ScanSessionController('screenshot', { onCandidate: (candidate) => { clean = candidate }, onSession: () => {} })

  await controller.enqueue('image')
  expect(clean?.imageDataUrl).toBe('')
  expect(clean?.buildCard?.sourceImageDataUrl).toBe('')
  await expect(controller.rerunField(clean!, 'name')).rejects.toThrow('no longer available')
  await controller.cancel()
})

it('releases OCR workers after scanning and keeps field retry available', async () => {
  let candidate: DiagnosticScanCandidate | undefined
  const controller = new ScanSessionController('screenshot', { onCandidate: (entry) => { candidate = entry }, onSession: () => {} })
  await controller.enqueue('image')
  mocks.terminatePool.mockClear()
  mocks.terminatePreprocess.mockClear()

  controller.requestCompletion()
  expect(mocks.terminatePool).toHaveBeenCalledOnce()
  expect(mocks.terminatePreprocess).toHaveBeenCalledOnce()
  await expect(controller.rerunField(candidate!, 'name')).resolves.toBe(candidate)
  expect(mocks.terminatePool).toHaveBeenCalledTimes(2)
  expect(mocks.terminatePreprocess).toHaveBeenCalledTimes(2)
  await controller.cancel()
})
