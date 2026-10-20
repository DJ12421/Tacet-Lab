import { candidateErrors } from './parser'
import type { DiagnosticScanCandidate, ScanEvidence } from './types'

export function actionableEvidenceWarning(candidate: DiagnosticScanCandidate, evidence: ScanEvidence) {
  return (evidence.confidence < .55 || !evidence.validation.valid)
    && !(evidence.region.kind === 'equipped-character' && !candidate.fields.equippedBy.value.trim())
}

export function needsReviewImages(candidate: DiagnosticScanCandidate) {
  if (candidateErrors(candidate).length) return true
  if (candidate.duplicateOf) return false
  return Object.values(candidate.evidence ?? {}).some((evidence) => actionableEvidenceWarning(candidate, evidence))
}

export function releaseCandidateImages(candidate: DiagnosticScanCandidate) {
  candidate.imageDataUrl = ''
  if (candidate.evidence) candidate.evidence = Object.fromEntries(Object.entries(candidate.evidence).map(([id, evidence]) => [id, {
    ...evidence, originalCrop: '', processedCrop: ''
  }]))
}
