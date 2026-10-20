import { expect, it, vi } from 'vitest'
import { needsReviewImages, releaseCandidateImages } from './review-images'
import type { DiagnosticScanCandidate, ScanEvidence } from './types'

vi.mock('./parser', () => ({ candidateErrors: (candidate: DiagnosticScanCandidate) => candidate.id === 'invalid' ? ['Missing field'] : [] }))

const evidence = (kind: ScanEvidence['region']['kind'], valid: boolean): ScanEvidence => ({
  region: { id: kind, kind, label: kind, rect: { x: 0, y: 0, width: 1, height: 1 }, recognition: 'text' },
  originalCrop: 'original', processedCrop: 'processed', rawOcr: 'recognized', confidence: valid ? .9 : .25,
  validation: { valid, messages: valid ? [] : ['Low confidence'] }, workerId: 'ocr', jobId: 'job', processingMs: 1, preprocessing: 'text'
})

it('drops clean image payloads while retaining actionable review images', () => {
  const original = evidence('name', true)
  const clean = { id: 'clean', imageDataUrl: 'panel', fields: { equippedBy: { value: '' } }, evidence: { name: original, equipped: evidence('equipped-character', false) } } as unknown as DiagnosticScanCandidate
  expect(needsReviewImages(clean)).toBe(false)
  expect(needsReviewImages({ ...clean, duplicateOf: 'existing' })).toBe(false)
  releaseCandidateImages(clean)
  expect(clean.imageDataUrl).toBe('')
  expect(clean.evidence?.name.originalCrop).toBe('')
  expect(clean.evidence?.name.rawOcr).toBe('recognized')
  expect(original.originalCrop).toBe('original')

  const uncertain = { ...clean, evidence: { name: evidence('name', false) } }
  expect(needsReviewImages(uncertain)).toBe(true)
  expect(needsReviewImages({ ...uncertain, duplicateOf: 'existing' })).toBe(false)
  expect(needsReviewImages({ ...uncertain, id: 'invalid' })).toBe(true)
  expect(needsReviewImages({ ...uncertain, id: 'invalid', duplicateOf: 'existing' })).toBe(true)
})
