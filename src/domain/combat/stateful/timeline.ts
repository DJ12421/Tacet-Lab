import { run, type Result } from './engine/evaluate.js'
import { setTracing } from './engine/context.js'
import { ctx } from './engine/runtime.js'
import { waitFor, type Action } from './engine/rotation.js'
import { State } from './engine/state.js'
import { SWAP_DELAY } from './engine/stats.js'

export interface ScheduledCast {
  id: string
  member: number
  action: Action
  timestamp: number
}

export interface TimelineResult {
  rows: Result[]
  hits: ReadonlyArray<{ at: number; member: string; avg: number; normal: number; critical: number }>
  durationFrames: number
}

export class TimelineError extends Error {
  constructor(readonly castId: string, message: string) { super(message) }
}

export function toFrame(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Timeline timestamps must be finite and non-negative.')
  return Math.round(seconds * 60)
}

export function runTimeline(state: State, casts: readonly ScheduledCast[], duration: number): TimelineResult {
  const end = toFrame(duration)
  const rows: Result[] = []
  let last = -1
  const tracing = ctx.tracing
  setTracing(true)
  try {
    for (const cast of casts) {
      const at = toFrame(cast.timestamp)
      if (at < last || at > end) throw new TimelineError(cast.id, 'Cast is outside the ordered rotation.')
      if (!state.slots[cast.member]) throw new TimelineError(cast.id, 'Cast references an unassigned member.')
      const available = Math.max(state.real, state.playsTo)
      const swap = state.presser >= 0 && state.presser !== cast.member && !state.swapPaid ? SWAP_DELAY : 0
      if (at < available + swap) throw new TimelineError(cast.id, `Cast overlaps an animation or swap until frame ${available + swap}.`)
      if (at > available + swap) rows.push(...run(state, [waitFor(at - available - swap, cast.id)]))
      state.active = cast.member
      const resolved = run(state, [cast.action])
      rows.push(...resolved)
      const actual = state.actionVariants.get(cast.action) ?? cast.action
      const own = resolved.find((row) => row.action === actual && !row.queued)
      if (!own || own.realStarts !== at) throw new TimelineError(cast.id, `Cast resolved at frame ${own?.realStarts ?? 'unknown'} instead of frame ${at}.`)
      if (Math.max(state.real, state.playsTo) > end) throw new TimelineError(cast.id, 'Cast animation extends past the rotation duration.')
      last = at
    }
    rows.push(...run(state, [], true, end))
    return {
      rows,
      hits: state.hits.map(({ at, member, avg, normal, critical }) => ({ at, member, avg, normal, critical })),
      durationFrames: end
    }
  } finally { setTracing(tracing) }
}
