import type { ScanSession } from '../scanner/types'
import { Panel } from './components'

export function ScanSessionSummary({ session }: { session?: ScanSession }) {
  if (!session) return null
  const metrics = session.metrics
  const elapsed = Math.max(1, (metrics.completedAt ?? Date.now()) - metrics.startedAt)
  const throughput = metrics.processedFrames / (elapsed / 1000)
  const values = [
    ['Workers', metrics.workerCount], ['Queue', metrics.queueDepth], ['Active jobs', metrics.activeJobs],
    ['Processed', metrics.processedFrames], ['Skipped', metrics.skippedFrames], ['Duplicates', metrics.duplicates],
    ['Failures', metrics.failures], ['New', metrics.newCandidates], ['Corrected', metrics.corrected],
    ['Rejected', metrics.rejected], ['Approved', metrics.approved], ['Session rate', `${throughput.toFixed(2)} frames/s`]
  ]
  return <Panel className="scan-session-summary"><header><div><span className="eyebrow">Session telemetry</span><h3>{session.status}</h3></div><code>{session.id.slice(0, 8)}</code></header><div>{values.map(([label, value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div></Panel>
}
