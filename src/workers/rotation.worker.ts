/// <reference lib="webworker" />
import { statefulPreview, type StatefulPreview } from '../domain/combat/stateful/preview'
import type { CombatBuildMember } from '../domain/combat/runtime'
import type { Team } from '../domain/types'

export interface RotationPreviewRequest {
  team: Team
  members: CombatBuildMember[]
  rows: Array<{ action: Team['actions'][number]; attack?: { id: string; group: string } }>
}

export interface RotationPreviewResponse { value: StatefulPreview | undefined }

self.onmessage = (event: MessageEvent<RotationPreviewRequest>) => {
  const { team, members, rows } = event.data
  self.postMessage({ value: statefulPreview(team, members, rows) } satisfies RotationPreviewResponse)
}
