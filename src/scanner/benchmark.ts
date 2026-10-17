import type { AccuracyResult, ExpectedOcrFixture } from './accuracy'
import type { DiagnosticScanCandidate, OcrWorkerPreference } from './types'

export interface ScannerBenchmarkSample {
  fixture: ExpectedOcrFixture
  candidate: DiagnosticScanCandidate
  accuracy: AccuracyResult
  latencyMs: number
  peakQueueDepth: number
}

export interface ScannerBenchmarkResult {
  workers: 1 | 2 | 4 | 6 | 8
  samples: ScannerBenchmarkSample[]
  fieldAccuracy: number
  completeEchoAccuracy: number
  averageLatencyMs: number
  throughputPerSecond: number
  peakQueueDepth: number
  approximateMemoryBytes?: number
}

const memoryUsage = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize

export async function benchmarkWorkerCounts(
  fixtures: ExpectedOcrFixture[],
  run: (fixture: ExpectedOcrFixture, preference: OcrWorkerPreference) => Promise<ScannerBenchmarkSample>,
  onResult?: (result: ScannerBenchmarkResult) => void
) {
  const reports: ScannerBenchmarkResult[] = []
  for (const workers of [1, 2, 4, 6, 8] as const) {
    const memoryBefore = memoryUsage(), started = performance.now(), samples: ScannerBenchmarkSample[] = []
    for (const fixture of fixtures) samples.push(await run(fixture, workers))
    const elapsed = performance.now() - started
    const matched = samples.reduce((sum, sample) => sum + sample.accuracy.matchedFields, 0)
    const total = samples.reduce((sum, sample) => sum + sample.accuracy.totalFields, 0)
    const memoryAfter = memoryUsage()
    const result: ScannerBenchmarkResult = {
      workers, samples, fieldAccuracy: total ? matched / total : 0,
      completeEchoAccuracy: samples.length ? samples.filter((sample) => sample.accuracy.completeEcho).length / samples.length : 0,
      averageLatencyMs: samples.length ? samples.reduce((sum, sample) => sum + sample.latencyMs, 0) / samples.length : 0,
      throughputPerSecond: samples.length / Math.max(.001, elapsed / 1000), peakQueueDepth: Math.max(0, ...samples.map((sample) => sample.peakQueueDepth)),
      approximateMemoryBytes: memoryBefore === undefined || memoryAfter === undefined ? undefined : Math.max(0, memoryAfter - memoryBefore)
    }
    reports.push(result); onResult?.(result)
  }
  return reports
}

