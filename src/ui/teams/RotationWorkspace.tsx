import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { formatDamage } from '../../domain/damage'
import { createLocalId } from '../../domain/id'
import { aggregateRotationCharts } from '../../domain/team-scenario/charts'
import type { Build, DamageType, RotationAction, Team } from '../../domain/types'
import { CalculatedValue, traceCalculationDetail } from '../CalculationDetails'
import { sumDetail } from '../calculation-detail-model'
import { Icon } from '../components'
import { teamBuffLabel, type TeamActionModel, type TeamAttackGroup, type TeamMemberModel, type TeamWorkspaceModel } from '../team-workspace-model'
import { RotationPresetControls } from './RotationPresetControls'
import { ELEMENT_COLORS, teamMemberName } from './team-ui'

const ROTATION_ATTACK_GROUPS: Array<{ id: TeamAttackGroup; label: string }> = [
  { id: 'basic', label: 'Basic' },
  { id: 'skill', label: 'Skill' },
  { id: 'forte', label: 'Forte Circuit' },
  { id: 'liberation', label: 'Liberation' },
  { id: 'intro', label: 'Intro' },
  { id: 'outro', label: 'Outro' },
  { id: 'echo', label: 'Echo Skill' },
  { id: 'tuneBreak', label: 'TuneBreak' }
]

const ROTATION_CHART_COLORS = ['#8de4d4', '#e4bb5e', '#e78674', '#9d87de', '#69b9d7', '#c7d0cd', '#72b98c', '#d28db3']
const DAMAGE_TYPE_ORDER: DamageType[] = ['basic', 'heavy', 'skill', 'liberation', 'intro', 'outro', 'echo', 'healing']
const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  basic: 'Basic', heavy: 'Heavy', skill: 'Skill', liberation: 'Liberation',
  intro: 'Intro', outro: 'Outro', echo: 'Echo', healing: 'Healing'
}
const SKILL_SOURCE_LABELS: Record<TeamAttackGroup, string> = {
  basic: 'Basic Attack', skill: 'Resonance Skill', forte: 'Forte Circuit', liberation: 'Resonance Liberation',
  intro: 'Intro Skill', outro: 'Outro Skill', echo: 'Echo Skill', tuneBreak: 'Tune Break'
}

const ROTATION_DEFAULT_CLIP_DURATION = 0.8
const ROTATION_MIN_CLIP_DURATION = 0.1
const ROTATION_SNAP = 0.1

function timelineClamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function timelineRound(value: number) {
  return Number(value.toFixed(2))
}

function compactDamage(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}m`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 100_000 ? 0 : 1))}k`
  return Math.floor(value).toLocaleString('en-US')
}

function damageChartMaximum(value: number) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const ceiling = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return ceiling * magnitude
}

function actionDuration(action: RotationAction, rotationDuration: number) {
  return timelineClamp(action.duration ?? ROTATION_DEFAULT_CLIP_DURATION, ROTATION_MIN_CLIP_DURATION, Math.max(ROTATION_MIN_CLIP_DURATION, rotationDuration - action.timestamp))
}

function actionMultiplier(action: RotationAction) {
  return Math.max(1, Math.min(99, Math.floor(action.multiplier ?? 1)))
}

function sameActions(left: RotationAction[], right: RotationAction[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

type TimelineGesture =
  | { kind: 'move' | 'trim-start' | 'trim-end'; pointerId: number; originX: number; actionId: string; selectedIds: string[]; original: RotationAction[]; preview: RotationAction[]; changed: boolean }
  | { kind: 'box'; pointerId: number; startTime: number; currentTime: number; startX: number; currentX: number; startY: number; currentY: number; initialIds: string[] }

interface TimelineQuickCreate { buildId: string; timestamp: number; attackId: string }

interface TimelineMenu { actionId: string; x: number; y: number }

export function RotationWorkspace({ model, updateTeam, focusBuildId }: { model: TeamWorkspaceModel; updateTeam: (patch: Partial<Team>) => Promise<void>; focusBuildId?: string }) {
  const forteGroupLabel = (group: TeamAttackGroup) => ROTATION_ATTACK_GROUPS.find((entry) => entry.id === group)?.label ?? group
  const damageSourceLabel = (type: DamageType) => type === 'basic' ? 'Basic DMG'
    : type === 'heavy' ? 'Heavy DMG'
      : type === 'skill' ? 'Skill DMG'
        : type === 'liberation' ? 'Liberation DMG'
          : type === 'intro' ? 'Intro DMG'
            : type === 'outro' ? 'Outro DMG'
              : type === 'echo' ? 'Echo DMG' : 'Healing'
  const firstMember = model.members.find((entry) => entry.build && entry.attacks.length)
  const [draftBuildId, setDraftBuildId] = useState(focusBuildId ?? firstMember?.build?.id ?? '')
  const draftMember = model.members.find((entry) => entry.build?.id === draftBuildId) ?? firstMember
  const [draftAttackId, setDraftAttackId] = useState(draftMember?.attacks[0]?.id ?? '')
  const [draftTimestamp, setDraftTimestamp] = useState(Math.min(model.team.rotationDuration, Math.ceil((model.team.actions.at(-1)?.timestamp ?? -1) + 1)))
  const [draftDuration, setDraftDuration] = useState(ROTATION_DEFAULT_CLIP_DURATION)
  const [analysisMode, setAnalysisMode] = useState<'character' | 'type' | 'source'>('character')
  const [timelineActions, setTimelineActions] = useState<RotationAction[]>(model.team.actions)
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([])
  const [timelineScale, setTimelineScale] = useState(56)
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [quickCreate, setQuickCreate] = useState<TimelineQuickCreate | null>(null)
  const [timelineMenu, setTimelineMenu] = useState<TimelineMenu | null>(null)
  const [boxSelection, setBoxSelection] = useState<{ startTime: number; currentTime: number; startY: number; currentY: number } | null>(null)
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const [cardDropTarget, setCardDropTarget] = useState<{ actionId: string; after: boolean } | null>(null)
  const timelineViewportRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<TimelineGesture | null>(null)
  const undoStackRef = useRef<RotationAction[][]>([])
  const redoStackRef = useRef<RotationAction[][]>([])
  const [clipboardActions, setClipboardActions] = useState<RotationAction[]>([])
  const resultMode = model.team.calculationV2?.resultMode ?? model.team.scenario?.resultMode ?? 'expected'
  useEffect(() => { setTimelineActions(model.team.actions) }, [model.team.actions])
  useEffect(() => {
    if (!focusBuildId || !model.members.some((entry) => entry.build?.id === focusBuildId)) return
    setDraftBuildId(focusBuildId)
  }, [focusBuildId, model.members])
  useEffect(() => {
    if (!draftMember?.attacks.some((attack) => attack.id === draftAttackId)) setDraftAttackId(draftMember?.attacks[0]?.id ?? '')
  }, [draftAttackId, draftMember])
  useEffect(() => {
    if (!isPlaying) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = (now - previous) / 1000
      previous = now
      setPlayhead((current) => {
        const next = current + elapsed
        if (next >= model.team.rotationDuration) {
          setIsPlaying(false)
          return model.team.rotationDuration
        }
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, model.team.rotationDuration])

  const commitActions = (next: RotationAction[], previous = timelineActions) => {
    if (sameActions(next, previous)) return
    undoStackRef.current.push(previous)
    if (undoStackRef.current.length > 80) undoStackRef.current.shift()
    redoStackRef.current = []
    setTimelineActions(next)
    void updateTeam({ actions: next })
  }
  const restoreActions = (next: RotationAction[]) => {
    setTimelineActions(next)
    setSelectedActionIds((current) => current.filter((id) => next.some((action) => action.id === id)))
    void updateTeam({ actions: next })
  }
  const undoTimeline = () => {
    const previous = undoStackRef.current.pop()
    if (!previous) return
    redoStackRef.current.push(timelineActions)
    restoreActions(previous)
  }
  const redoTimeline = () => {
    const next = redoStackRef.current.pop()
    if (!next) return
    undoStackRef.current.push(timelineActions)
    restoreActions(next)
  }
  const copySelected = (ids = selectedActionIds) => {
    setClipboardActions(timelineActions.filter((action) => ids.includes(action.id)).map((action) => ({ ...action })))
  }
  const pasteSelected = () => {
    if (!clipboardActions.length) return
    const firstTimestamp = Math.min(...clipboardActions.map((action) => action.timestamp))
    const pasted = clipboardActions.map((action) => {
      const duration = actionDuration(action, model.team.rotationDuration)
      const timestamp = timelineClamp(playhead + action.timestamp - firstTimestamp, 0, Math.max(0, model.team.rotationDuration - duration))
      return { ...action, id: createLocalId(), timestamp: timelineRound(timestamp), duration }
    })
    commitActions([...timelineActions, ...pasted])
    setSelectedActionIds(pasted.map((action) => action.id))
  }
  const deleteSelected = () => {
    if (!selectedActionIds.length) return
    commitActions(timelineActions.filter((action) => !selectedActionIds.includes(action.id)))
    setSelectedActionIds([])
  }
  const duplicateSelected = (ids = selectedActionIds) => {
    const source = timelineActions.filter((action) => ids.includes(action.id))
    if (!source.length) return
    const latestEnd = Math.max(...source.map((action) => action.timestamp + actionDuration(action, model.team.rotationDuration)))
    const shift = latestEnd + ROTATION_SNAP <= model.team.rotationDuration ? ROTATION_SNAP : -ROTATION_SNAP
    const duplicates = source.map((action) => {
      const duration = actionDuration(action, model.team.rotationDuration)
      return { ...action, id: createLocalId(), timestamp: timelineRound(timelineClamp(action.timestamp + shift, 0, Math.max(0, model.team.rotationDuration - duration))), duration }
    })
    commitActions([...timelineActions, ...duplicates])
    setSelectedActionIds(duplicates.map((action) => action.id))
  }
  const nudgeSelected = (direction: -1 | 1, free = false) => {
    if (!selectedActionIds.length) return
    const step = free ? 0.01 : ROTATION_SNAP
    const selected = timelineActions.filter((action) => selectedActionIds.includes(action.id))
    const minimum = Math.min(...selected.map((action) => action.timestamp))
    const maximum = Math.max(...selected.map((action) => action.timestamp + actionDuration(action, model.team.rotationDuration)))
    const delta = timelineClamp(direction * step, -minimum, model.team.rotationDuration - maximum)
    commitActions(timelineActions.map((action) => selectedActionIds.includes(action.id) ? { ...action, timestamp: timelineRound(action.timestamp + delta) } : action))
  }
  const updateAction = (id: string, patch: Partial<RotationAction>) => {
    const next = timelineActions.map((action) => action.id === id ? { ...action, ...patch } : action)
    commitActions(next)
  }
  const selectClip = (event: ReactPointerEvent, actionId: string) => {
    if (event.button !== 0) return
    event.stopPropagation()
    setTimelineMenu(null)
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    const alreadySelected = selectedActionIds.includes(actionId)
    const selectedIds = additive
      ? alreadySelected ? selectedActionIds.filter((id) => id !== actionId) : [...selectedActionIds, actionId]
      : alreadySelected ? selectedActionIds : [actionId]
    setSelectedActionIds(selectedIds)
    if (additive && alreadySelected) return
    const handle = (event.target as HTMLElement).dataset.timelineHandle
    const kind = handle === 'start' ? 'trim-start' as const : handle === 'end' ? 'trim-end' as const : 'move' as const
    const gestureIds = kind === 'move' ? (selectedIds.includes(actionId) ? selectedIds : [actionId]) : [actionId]
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    gestureRef.current = { kind, pointerId: event.pointerId, originX: event.clientX, actionId, selectedIds: gestureIds, original: timelineActions, preview: timelineActions, changed: false }
  }
  const beginBoxSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    const lanes = event.currentTarget.closest<HTMLElement>('.tw-sequencer-lanes')
    if (!lanes) return
    const time = timelineClamp((event.clientX - rect.left) / timelineScale, 0, model.team.rotationDuration)
    const lanesRect = lanes.getBoundingClientRect()
    const startY = event.clientY - lanesRect.top
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    const initialIds = additive ? selectedActionIds : []
    event.currentTarget.setPointerCapture(event.pointerId)
    if (!additive) setSelectedActionIds([])
    setPlayhead(timelineRound(time))
    setTimelineMenu(null)
    setBoxSelection({ startTime: time, currentTime: time, startY, currentY: startY })
    gestureRef.current = { kind: 'box', pointerId: event.pointerId, startTime: time, currentTime: time, startX: event.clientX, currentX: event.clientX, startY: event.clientY, currentY: event.clientY, initialIds }
  }
  const moveTimelineGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'box') {
      const lanes = event.currentTarget.querySelector<HTMLElement>('.tw-sequencer-lanes')
      const lane = event.currentTarget.querySelector<HTMLElement>('[data-timeline-lane]')
      if (!lanes || !lane) return
      const rect = lane.getBoundingClientRect()
      const lanesRect = lanes.getBoundingClientRect()
      const currentTime = timelineClamp((event.clientX - rect.left) / timelineScale, 0, model.team.rotationDuration)
      gesture.currentTime = currentTime
      gesture.currentX = event.clientX
      gesture.currentY = event.clientY
      setBoxSelection({ startTime: gesture.startTime, currentTime, startY: gesture.startY - lanesRect.top, currentY: event.clientY - lanesRect.top })
      const selectionRect = {
        left: Math.min(gesture.startX, gesture.currentX), right: Math.max(gesture.startX, gesture.currentX),
        top: Math.min(gesture.startY, gesture.currentY), bottom: Math.max(gesture.startY, gesture.currentY)
      }
      const intersecting = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-timeline-action-id]')].filter((clip) => {
        const clipRect = clip.getBoundingClientRect()
        return clipRect.right >= selectionRect.left && clipRect.left <= selectionRect.right && clipRect.bottom >= selectionRect.top && clipRect.top <= selectionRect.bottom
      }).map((clip) => clip.dataset.timelineActionId).filter((id): id is string => Boolean(id))
      setSelectedActionIds([...new Set([...gesture.initialIds, ...intersecting])])
      return
    }
    const rawDelta = (event.clientX - gesture.originX) / timelineScale
    const delta = event.altKey ? timelineRound(rawDelta) : timelineRound(Math.round(rawDelta / ROTATION_SNAP) * ROTATION_SNAP)
    const target = gesture.original.find((action) => action.id === gesture.actionId)
    if (!target) return
    let preview = gesture.original
    if (gesture.kind === 'move') {
      const selected = gesture.original.filter((action) => gesture.selectedIds.includes(action.id))
      const minimum = Math.min(...selected.map((action) => action.timestamp))
      const maximum = Math.max(...selected.map((action) => action.timestamp + actionDuration(action, model.team.rotationDuration)))
      const bounded = timelineClamp(delta, -minimum, model.team.rotationDuration - maximum)
      preview = gesture.original.map((action) => gesture.selectedIds.includes(action.id) ? { ...action, timestamp: timelineRound(action.timestamp + bounded) } : action)
    } else if (gesture.kind === 'trim-start') {
      const end = target.timestamp + actionDuration(target, model.team.rotationDuration)
      const timestamp = timelineClamp(target.timestamp + delta, 0, end - ROTATION_MIN_CLIP_DURATION)
      preview = gesture.original.map((action) => action.id === target.id ? { ...action, timestamp: timelineRound(timestamp), duration: timelineRound(end - timestamp) } : action)
    } else {
      const duration = timelineClamp(actionDuration(target, model.team.rotationDuration) + delta, ROTATION_MIN_CLIP_DURATION, model.team.rotationDuration - target.timestamp)
      preview = gesture.original.map((action) => action.id === target.id ? { ...action, duration: timelineRound(duration) } : action)
    }
    gesture.preview = preview
    gesture.changed = !sameActions(preview, gesture.original)
    setTimelineActions(preview)
  }
  const endTimelineGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    setBoxSelection(null)
    if (gesture.kind !== 'box' && gesture.changed) commitActions(gesture.preview, gesture.original)
  }
  const openTimelineMenu = (event: ReactMouseEvent, actionId: string) => {
    event.preventDefault()
    event.stopPropagation()
    if (!selectedActionIds.includes(actionId)) setSelectedActionIds([actionId])
    setTimelineMenu({ actionId, x: event.clientX, y: event.clientY })
  }
  const openQuickCreate = (event: ReactMouseEvent<HTMLDivElement>, member: TeamMemberModel & { build: Build }) => {
    if (event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    const timestamp = timelineRound(timelineClamp((event.clientX - rect.left) / timelineScale, 0, model.team.rotationDuration - ROTATION_MIN_CLIP_DURATION))
    setPlayhead(timestamp)
    setQuickCreate({ buildId: member.build.id, timestamp, attackId: member.attacks[0]?.id ?? '' })
  }
  const addQuickAction = () => {
    if (!quickCreate) return
    const member = model.members.find((entry) => entry.build?.id === quickCreate.buildId)
    const attack = member?.attacks.find((entry) => entry.id === quickCreate.attackId)
    if (!member?.build || !attack) return
    const next: RotationAction = { id: createLocalId(), timestamp: quickCreate.timestamp, duration: timelineClamp(ROTATION_DEFAULT_CLIP_DURATION, ROTATION_MIN_CLIP_DURATION, model.team.rotationDuration - quickCreate.timestamp), buildId: member.build.id, attackId: attack.id, formulaTargetId: member.catalog ? `${member.catalog.id}:${attack.id}` : undefined }
    commitActions([...timelineActions, next])
    setSelectedActionIds([next.id])
    setQuickCreate(null)
  }
  const fitTimeline = () => {
    const available = Math.max(320, (timelineViewportRef.current?.clientWidth ?? 900) - 144)
    setTimelineScale(timelineClamp(available / model.team.rotationDuration, 24, 160))
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, select, textarea, button, [contenteditable="true"]')) return
      const command = event.ctrlKey || event.metaKey
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redoTimeline(); else undoTimeline() }
      else if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); redoTimeline() }
      else if (command && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected() }
      else if (command && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelected() }
      else if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected() }
      else if (command && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelectedActionIds(timelineActions.map((action) => action.id)) }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected() }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); nudgeSelected(event.key === 'ArrowLeft' ? -1 : 1, event.altKey) }
      else if (event.key === ' ') { event.preventDefault(); if (playhead >= model.team.rotationDuration) setPlayhead(0); setIsPlaying((current) => !current) }
      else if (event.key === 'Escape') { setSelectedActionIds([]); setTimelineMenu(null); setQuickCreate(null) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clipboardActions, isPlaying, model.team.rotationDuration, playhead, selectedActionIds, timelineActions])
  const addAction = async () => {
    const attack = draftMember?.attacks.find((entry) => entry.id === draftAttackId) ?? draftMember?.attacks[0]
    if (!draftMember?.build || !attack) return
    const duration = timelineClamp(draftDuration, ROTATION_MIN_CLIP_DURATION, model.team.rotationDuration)
    const timestamp = timelineClamp(draftTimestamp, 0, Math.max(0, model.team.rotationDuration - duration))
    commitActions([...timelineActions, { id: createLocalId(), timestamp, duration, buildId: draftMember.build.id, attackId: attack.id, formulaTargetId: `${draftMember.catalog?.id}:${attack.id}` }])
    setDraftTimestamp(Math.min(model.team.rotationDuration, Number((draftTimestamp + 1).toFixed(1))))
  }
  const duplicateAction = (row: TeamActionModel) => duplicateSelected([row.action.id])
  const moveAction = (index: number, direction: -1 | 1) => {
    const other = model.actions[index + direction]
    const current = model.actions[index]
    if (!other || !current) return
    commitActions(timelineActions.map((action) => action.id === current.action.id ? { ...action, timestamp: other.action.timestamp } : action.id === other.action.id ? { ...action, timestamp: current.action.timestamp } : action))
  }
  const reorderActionCard = (sourceId: string, targetId: string, after: boolean) => {
    if (sourceId === targetId) return
    const ordered = [...timelineActions].sort((left, right) => left.timestamp - right.timestamp)
    const sourceIndex = ordered.findIndex((action) => action.id === sourceId)
    const targetIndex = ordered.findIndex((action) => action.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const timestamps = ordered.map((action) => action.timestamp)
    const [source] = ordered.splice(sourceIndex, 1)
    const adjustedTarget = ordered.findIndex((action) => action.id === targetId)
    ordered.splice(adjustedTarget + (after ? 1 : 0), 0, source)
    commitActions(ordered.map((action, index) => ({ ...action, timestamp: timestamps[index] })))
  }
  const chartAggregation = aggregateRotationCharts(model.actions.flatMap((row) => row.attack ? [{
    buildId:row.action.buildId, damageType:row.attack.type, skillSource:row.attack.group,
    normal:row.normal, critical:row.critical, expected:row.expected
  }] : []), resultMode)
  const rotationTotal = chartAggregation.total
  const members = model.members.filter((member): member is TeamMemberModel & { build: Build } => Boolean(member.build))
  const damageTypes = DAMAGE_TYPE_ORDER.filter((type) => (model.byType[type] ?? 0) > 0)
  const memberSegments = members.filter((member) => member.contribution > 0).map((member, index) => ({ label: teamMemberName(member), value: member.contribution, color: ROTATION_CHART_COLORS[index] }))
  const typeSegments = damageTypes.map((type, index) => ({ label: DAMAGE_TYPE_LABELS[type], value: model.byType[type] ?? 0, color: ROTATION_CHART_COLORS[index] }))
  const sourceSegments = ROTATION_ATTACK_GROUPS.flatMap((source, index) => {
    const value = chartAggregation.bySkillSource[source.id] ?? 0
    return value > 0 ? [{ label: SKILL_SOURCE_LABELS[source.id], value, color: ROTATION_CHART_COLORS[index % ROTATION_CHART_COLORS.length] }] : []
  })
  const segments = analysisMode === 'character' ? memberSegments : analysisMode === 'type' ? typeSegments : sourceSegments
  let chartCursor = 0
  const chartStops = segments.map((segment) => {
    const start = chartCursor
    chartCursor += rotationTotal > 0 ? segment.value / rotationTotal * 100 : 0
    return `${segment.color} ${start}% ${chartCursor}%`
  })
  const chartStyle = { '--tw-rotation-chart': rotationTotal > 0 && chartStops.length ? `conic-gradient(${chartStops.join(',')})` : '#151b1c' } as CSSProperties
  const activeRows = model.actions.filter((row) => row.action.timestamp <= playhead && playhead < row.action.timestamp + actionDuration(row.action, model.team.rotationDuration))
  const activeActionIds = new Set(activeRows.map((row) => row.action.id))
  const currentDamage = activeRows.reduce((total, row) => total + row[resultMode], 0)
  const activeEffectCount = activeRows.reduce((total, row) => total + row.activeBuffs.length + row.activePartyEffectsV2.length + row.activeSelfEffectsV2.length + row.activates.length + row.activatesSelfEffectsV2.length, 0)
  const damageSources = model.actions.flatMap((row) => {
    const memberIndex = members.findIndex((member) => member.build.id === row.action.buildId)
    if (memberIndex < 0) return []
    const duration = actionDuration(row.action, model.team.rotationDuration)
    const start = timelineClamp(row.action.timestamp, 0, model.team.rotationDuration)
    const end = timelineClamp(row.action.timestamp + duration, start, model.team.rotationDuration)
    if (end <= start) return []
    return [{ row, memberIndex, start, end, damage: row[resultMode] }]
  })
  const damageBoundaries = [...new Set([0, model.team.rotationDuration, ...damageSources.flatMap((source) => [source.start, source.end])])].sort((left, right) => left - right)
  const damageIntervals = damageBoundaries.slice(0, -1).flatMap((start, intervalIndex) => {
    const end = damageBoundaries[intervalIndex + 1]
    const activeSources = damageSources.filter((source) => source.start < end && source.end > start)
    let stackBottom = 0
    return members.flatMap((_member, memberIndex) => {
      const sources = activeSources.filter((source) => source.memberIndex === memberIndex)
      const damage = sources.reduce((total, source) => total + source.damage, 0)
      if (damage <= 0) return []
      const interval = { start, end, damage, stackBottom, memberIndex, actionIds: sources.map((source) => source.row.action.id), attackNames: sources.map((source) => source.row.attack?.name ?? 'Missing attack') }
      stackBottom += damage
      return [interval]
    })
  })
  const peakActiveDamage = Math.max(0, ...damageBoundaries.slice(0, -1).map((start, index) => {
    const end = damageBoundaries[index + 1]
    return damageSources.filter((source) => source.start < end && source.end > start).reduce((total, source) => total + source.damage, 0)
  }))
  const damageAxisMaximum = damageChartMaximum(peakActiveDamage)
  const damageAxisTicks = Array.from({ length: 4 }, (_, index) => damageAxisMaximum * (3 - index) / 3)
  const damageTimeTicks = Array.from({ length: 5 }, (_, index) => model.team.rotationDuration * index / 4)
  const rulerTicks = Array.from({ length: Math.floor(model.team.rotationDuration) + 1 }, (_, index) => index)
  return <section className="tw-panel tw-rotation"><header><div><span className="eyebrow">Calculation V2 mechanics</span><h2>Rotation workspace</h2><p>Edit timing in the full-width timeline, then refine mechanics and review calculated damage below.</p></div></header>
    <RotationPresetControls model={model} updateTeam={updateTeam} onApplied={() => { setSelectedActionIds([]); setPlayhead(0) }}/>
    <section className="tw-sequencer" aria-label="Interactive rotation timeline">
      <header className="tw-sequencer-toolbar">
        <div className="tw-transport" role="group" aria-label="Playback controls">
          <button type="button" onClick={() => { setIsPlaying(false); setPlayhead(0) }} title="Return to start">|◀</button>
          <button type="button" className={isPlaying ? 'is-active' : ''} onClick={() => { if (playhead >= model.team.rotationDuration) setPlayhead(0); setIsPlaying((current) => !current) }} aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
          <span><b>{playhead.toFixed(2)}s</b><small>/ {model.team.rotationDuration.toFixed(1)}s</small></span>
        </div>
        <div className="tw-playback-readout" aria-live="polite"><span><small>Now</small><b>{activeRows.length ? activeRows.map((row) => row.attack?.name ?? 'Missing attack').join(' + ') : 'Ready'}</b></span><span><small>Active effects</small><b>{activeEffectCount}</b></span><span><small>Current DMG</small><b>{formatDamage(currentDamage)}</b></span></div>
        <div className="tw-edit-controls" role="group" aria-label="Timeline editing controls">
          <button type="button" onClick={undoTimeline} disabled={!undoStackRef.current.length} title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" onClick={redoTimeline} disabled={!redoStackRef.current.length} title="Redo (Ctrl+Y)">Redo</button>
          <button type="button" onClick={() => copySelected()} disabled={!selectedActionIds.length} title="Copy selected clips (Ctrl+C)">Copy</button>
          <button type="button" onClick={pasteSelected} disabled={!clipboardActions.length} title="Paste at playhead (Ctrl+V)">Paste</button>
          <button type="button" onClick={() => duplicateSelected()} disabled={!selectedActionIds.length} title="Duplicate selected clips (Ctrl+D)">Duplicate</button>
          <button type="button" className="danger" onClick={deleteSelected} disabled={!selectedActionIds.length} title="Delete selected clips">Delete</button>
        </div>
        <div className="tw-zoom-controls" role="group" aria-label="Timeline zoom controls">
          <button type="button" onClick={() => setTimelineScale((current) => timelineClamp(current - 12, 24, 160))} aria-label="Zoom out">−</button>
          <button type="button" onClick={fitTimeline}>Fit</button>
          <button type="button" onClick={() => setTimelineScale((current) => timelineClamp(current + 12, 24, 160))} aria-label="Zoom in">+</button>
          <span>{Math.round(timelineScale)} px/s</span>
        </div>
      </header>
      <div className="tw-sequencer-viewport" ref={timelineViewportRef} onPointerMove={moveTimelineGesture} onPointerUp={endTimelineGesture} onPointerCancel={endTimelineGesture}>
        <div className="tw-sequencer-canvas" style={{ width: 128 + model.team.rotationDuration * timelineScale }}>
          <div className="tw-ruler-row"><span className="tw-ruler-corner">Tracks</span><div className="tw-ruler" style={{ width: model.team.rotationDuration * timelineScale }} onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setPlayhead(timelineRound(timelineClamp((event.clientX - rect.left) / timelineScale, 0, model.team.rotationDuration))); setIsPlaying(false) }}>{rulerTicks.map((tick) => <i style={{ left: tick * timelineScale }} key={tick}><b>{tick}s</b></i>)}</div></div>
          <div className="tw-playhead" style={{ left: 128 + playhead * timelineScale }} aria-hidden="true"><i/><span/></div>
          <div className="tw-sequencer-lanes">{members.map((member, memberIndex) => {
            const laneActions = timelineActions.filter((action) => action.buildId === member.build.id).sort((left, right) => left.timestamp - right.timestamp)
            const rowEnds: number[] = []
            const clips = laneActions.map((action) => {
              const duration = actionDuration(action, model.team.rotationDuration)
              let row = rowEnds.findIndex((end) => end <= action.timestamp)
              if (row < 0) { row = rowEnds.length; rowEnds.push(action.timestamp + duration) } else rowEnds[row] = action.timestamp + duration
              return { action, duration, row }
            })
            const laneHeight = Math.max(50, rowEnds.length * 34 + 12)
            const accent = member.catalog ? ELEMENT_COLORS[member.catalog.element] ?? ROTATION_CHART_COLORS[memberIndex] : ROTATION_CHART_COLORS[memberIndex]
            return <div className="tw-sequencer-lane" style={{ height: laneHeight, '--tw-lane-accent': accent } as CSSProperties} key={member.build.id}>
              <div className="tw-lane-label">{member.catalog?.iconSourceUrl && <img src={member.catalog.iconSourceUrl} alt=""/>}<span><b>{teamMemberName(member)}</b><small>{laneActions.length} {laneActions.length === 1 ? 'clip' : 'clips'}</small></span></div>
              <div className="tw-lane-stage" data-timeline-lane={member.build.id} style={{ width: model.team.rotationDuration * timelineScale, height: laneHeight }} onPointerDown={beginBoxSelection} onDoubleClick={(event) => openQuickCreate(event, member)}>
                {Array.from({ length: Math.floor(model.team.rotationDuration) + 1 }, (_, tick) => <i className="tw-grid-line" style={{ left: tick * timelineScale }} key={tick}/>) }
                {clips.map(({ action, duration, row }) => {
                  const attack = member.attacks.find((entry) => entry.id === action.attackId)
                  const selected = selectedActionIds.includes(action.id)
                  const active = activeActionIds.has(action.id)
                  return <article data-timeline-action-id={action.id} className={`tw-timeline-clip ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''}`} style={{ left: action.timestamp * timelineScale, top: 6 + row * 34, width: Math.max(18, duration * timelineScale) }} aria-label={`${attack?.name ?? 'Missing attack'}, ${action.timestamp.toFixed(1)} seconds, duration ${duration.toFixed(1)} seconds`} aria-selected={selected} key={action.id} onPointerDown={(event) => selectClip(event, action.id)} onContextMenu={(event) => openTimelineMenu(event, action.id)} onDoubleClick={(event) => { event.stopPropagation(); document.getElementById(`rotation-action-${action.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}>
                    <span className="tw-clip-handle start" data-timeline-handle="start" aria-hidden="true"/>
                    <span className="tw-clip-copy"><b>{attack?.name ?? 'Missing attack'}</b><small>{actionMultiplier(action) > 1 ? `×${actionMultiplier(action)} · ` : ''}{action.timestamp.toFixed(1)}–{(action.timestamp + duration).toFixed(1)}s</small></span>
                    <span className="tw-clip-handle end" data-timeline-handle="end" aria-hidden="true"/>
                  </article>
                })}
              </div>
            </div>
          })}{boxSelection && <span className="tw-selection-box" style={{ left: 128 + Math.min(boxSelection.startTime, boxSelection.currentTime) * timelineScale, top: Math.min(boxSelection.startY, boxSelection.currentY), width: Math.abs(boxSelection.currentTime - boxSelection.startTime) * timelineScale, height: Math.max(2, Math.abs(boxSelection.currentY - boxSelection.startY)) }}/>}</div>
        </div>
      </div>
      <footer className="tw-sequencer-help"><span>Double-click empty track space to add an action.</span><span>Drag clips horizontally · trim either edge · Alt bypasses 0.1s snapping · drag-select across character tracks</span></footer>
      {quickCreate && (() => { const member = model.members.find((entry) => entry.build?.id === quickCreate.buildId); return <div className="tw-quick-create" role="dialog" aria-label="Add timeline action"><span><b>Add at {quickCreate.timestamp.toFixed(1)}s</b><small>{member ? teamMemberName(member) : 'Character'}</small></span><select autoFocus value={quickCreate.attackId} onChange={(event) => setQuickCreate({ ...quickCreate, attackId: event.target.value })}>{ROTATION_ATTACK_GROUPS.map((group) => { const attacks = member?.attacks.filter((attack) => attack.group === group.id) ?? []; return attacks.length ? <optgroup label={group.label} key={group.id}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{attack.name}</option>)}</optgroup> : null })}</select><button type="button" className="primary" disabled={!quickCreate.attackId} onClick={addQuickAction}>Add clip</button><button type="button" onClick={() => setQuickCreate(null)}>Cancel</button></div> })()}
      {timelineMenu && <div className="tw-timeline-menu" style={{ left: timelineMenu.x, top: timelineMenu.y }} role="menu"><button type="button" onClick={() => { copySelected(selectedActionIds.includes(timelineMenu.actionId) ? selectedActionIds : [timelineMenu.actionId]); setTimelineMenu(null) }}>Copy selection</button><button type="button" onClick={() => { duplicateSelected(selectedActionIds.includes(timelineMenu.actionId) ? selectedActionIds : [timelineMenu.actionId]); setTimelineMenu(null) }}>Duplicate</button><button type="button" onClick={() => { const ids = selectedActionIds.includes(timelineMenu.actionId) ? selectedActionIds : [timelineMenu.actionId]; commitActions(timelineActions.filter((action) => !ids.includes(action.id))); setSelectedActionIds([]); setTimelineMenu(null) }}>Delete</button></div>}
    </section>
    <div className="tw-rotation-layout">
      <section className="tw-rotation-editor" aria-label="Rotation editor">
        <div className="tw-rotation-sequence-head"><span>Play order</span><b>{model.actions.length} {model.actions.length === 1 ? 'action' : 'actions'}</b></div>
        <div className="tw-rotation-timeline">{model.actions.map((row, index) => {
          const value = row[resultMode]
          const trace = row.tracesV2?.[resultMode] ?? row.traces?.[resultMode]
          const partySelections = row.member?.build ? model.team.calculationV2?.partyEffects[row.member.build.id] ?? {} : {}
          const selectedPartyEffects = row.activePartyEffectsV2.filter((effect) => effect.alwaysEnabled || partySelections[effect.id]?.enabled)
          const effectCount = selectedPartyEffects.length + row.activeSelfEffectsV2.length + row.activeBuffs.length + row.activates.length + row.activatesSelfEffectsV2.length
          const multiplier = actionMultiplier(row.action)
          const dragTarget = cardDropTarget?.actionId === row.action.id
          return <article id={`rotation-action-${row.action.id}`} draggable className={`tw-rotation-card ${row.warnings.length ? 'is-invalid' : ''} ${selectedActionIds.includes(row.action.id) ? 'is-selected' : ''} ${activeActionIds.has(row.action.id) ? 'is-playing' : ''} ${draggedCardId === row.action.id ? 'is-dragging' : ''} ${dragTarget ? cardDropTarget.after ? 'drop-after' : 'drop-before' : ''}`} key={row.action.id} onClick={() => setSelectedActionIds([row.action.id])} onDragStart={(event: ReactDragEvent<HTMLElement>) => { setDraggedCardId(row.action.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', row.action.id) }} onDragOver={(event) => { event.preventDefault(); if (draggedCardId === row.action.id) return; const rect = event.currentTarget.getBoundingClientRect(); setCardDropTarget({ actionId: row.action.id, after: event.clientY >= rect.top + rect.height / 2 }) }} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedCardId; const rect = event.currentTarget.getBoundingClientRect(); if (sourceId) reorderActionCard(sourceId, row.action.id, event.clientY >= rect.top + rect.height / 2); setDraggedCardId(null); setCardDropTarget(null) }} onDragEnd={() => { setDraggedCardId(null); setCardDropTarget(null) }}>
            <div className="tw-rotation-marker"><b>{index + 1}</b><span>{row.action.timestamp.toFixed(1)}s</span></div>
            <div className="tw-rotation-card-main">
              <div className="tw-rotation-action-summary"><div><small>{row.member ? teamMemberName(row.member) : 'Unassigned'}</small><strong>{row.attack?.name ?? 'Missing attack'}</strong><span className="tw-action-tags">{row.attack && <><em className="forte">{forteGroupLabel(row.attack.group)}</em><em className="damage">{damageSourceLabel(row.attack.type)}</em></>}</span></div><label className="tw-action-multiplier" title="Repeat this action without adding duplicate cards" onClick={(event) => event.stopPropagation()}><b>×</b><input aria-label={`Action ${index + 1} repeat multiplier`} type="number" min="1" max="99" step="1" value={multiplier} onChange={(event) => void updateAction(row.action.id, { multiplier: Math.max(1, Math.min(99, Math.round(Number(event.target.value) || 1))) })}/></label><CalculatedValue detail={multiplier > 1 ? sumDetail(`${row.attack?.name ?? 'Action'} · ${resultMode}`, value, [{ label: `One action × ${multiplier}`, value: value / multiplier }]) : trace ? traceCalculationDetail(trace, `${row.attack?.name ?? 'Action'} · ${resultMode}`) : sumDetail(`${resultMode} damage`, value, [{ label: 'Calculated action', value }])}><strong className="tw-rotation-result"><small>{resultMode === 'expected' ? 'Avg DMG' : resultMode === 'normal' ? 'Non-crit' : 'Crit DMG'}</small>{formatDamage(value)}</strong></CalculatedValue></div>
              <details className="tw-rotation-action-editor"><summary>Edit action and mechanics <span>{effectCount ? `${effectCount} active effects` : 'No additional effects'}</span></summary><div>
                <div className="tw-rotation-action-fields"><label><span>Character</span><select aria-label={`Action ${index + 1} character`} value={row.action.buildId} onChange={(event) => { const member = model.members.find((entry) => entry.build?.id === event.target.value); const attackId = member?.attacks[0]?.id ?? ''; void updateAction(row.action.id, { buildId: event.target.value, attackId, formulaTargetId: member?.catalog ? `${member.catalog.id}:${attackId}` : undefined }) }}>{model.members.flatMap((member) => member.build ? [<option value={member.build.id} key={member.build.id}>{teamMemberName(member)}</option>] : [])}</select></label><label><span>Attack</span><select aria-label={`Action ${index + 1} attack`} value={row.attack?.id ?? row.action.attackId} onChange={(event) => void updateAction(row.action.id, { attackId: event.target.value, formulaTargetId: row.member?.catalog ? `${row.member.catalog.id}:${event.target.value}` : undefined })}>{ROTATION_ATTACK_GROUPS.map((group) => { const attacks = row.member?.attacks.filter((attack) => attack.group === group.id) ?? []; return attacks.length ? <optgroup label={group.label} key={group.id}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{attack.name}</option>)}</optgroup> : null })}</select></label><label><span>Time</span><input aria-label={`Action ${index + 1} timestamp`} type="number" min="0" max={model.team.rotationDuration} step="0.1" value={row.action.timestamp} onChange={(event) => void updateAction(row.action.id, { timestamp: Number(event.target.value) })}/></label><label><span>Duration</span><input aria-label={`Action ${index + 1} duration`} type="number" min={ROTATION_MIN_CLIP_DURATION} max={Math.max(ROTATION_MIN_CLIP_DURATION, model.team.rotationDuration - row.action.timestamp)} step="0.1" value={actionDuration(row.action, model.team.rotationDuration)} onChange={(event) => void updateAction(row.action.id, { duration: Number(event.target.value) })}/></label></div>
                <div className="tw-rotation-mechanics"><span className="tw-buff-state"><b>{row.activeSelfEffectsV2.length ? 'Active Main Echo buffs' : row.activeBuffs.length ? 'Active authored buffs' : selectedPartyEffects.length ? 'Selected team conditions' : 'No additional effects'}</b>{selectedPartyEffects.map((effect) => <small key={effect.id}>Selected: {effect.name}</small>)}{row.activeSelfEffectsV2.map((effect) => <small key={effect.id}>Main Echo: {effect.name}{effect.duration ? ` · ${effect.duration}s window` : ''}</small>)}{row.activeBuffs.map((buff) => <small key={buff.id}>{teamBuffLabel(buff)}</small>)}{row.activatesSelfEffectsV2.map((effect) => <small className="activates" key={effect.id}>Activates Main Echo buff{effect.duration ? ` until ${(row.action.timestamp + effect.duration).toFixed(1)}s` : ''}</small>)}{row.activates.map((buff) => <small className="activates" key={buff.id}>Activates {buff.name} until {(row.action.timestamp + buff.duration).toFixed(1)}s</small>)}</span><span className="tw-rotation-level">{row.attack?.group === 'echo' ? `Rarity ${row.attack.skillLevel}` : `Lv. ${row.attack?.skillLevel ?? '—'}`}<small>{row.attack?.scalesWith.toUpperCase() ?? '—'} scaling</small></span></div>
                <div className="tw-action-breakdown"><div><span>Non-crit <b>{formatDamage(row.normal)}</b></span><span>Average <b>{formatDamage(row.expected)}</b></span><span>Critical <b>{formatDamage(row.critical)}</b></span><span>Multiplier <b>{row.attack?.multiplierLabel ?? 'Missing'}</b></span></div></div>
              </div></details>
              {row.warnings.length > 0 && <p className="tw-action-warning">{row.warnings.join(' ')}</p>}
            </div>
            <div className="tw-rotation-card-actions"><button type="button" title="Move earlier" aria-label={`Move action ${index + 1} earlier`} disabled={index === 0} onClick={() => void moveAction(index, -1)}>↑</button><button type="button" title="Move later" aria-label={`Move action ${index + 1} later`} disabled={index === model.actions.length - 1} onClick={() => void moveAction(index, 1)}>↓</button><button type="button" title="Duplicate" aria-label={`Duplicate action ${index + 1}`} onClick={() => void duplicateAction(row)}>⧉</button><button type="button" title="Remove" className="tw-remove" aria-label={`Remove action ${index + 1}`} onClick={() => commitActions(timelineActions.filter((action) => action.id !== row.action.id))}><Icon name="trash"/></button></div>
          </article>
        })}{!model.actions.length && <p className="tw-empty-state">Choose the first action below to begin the rotation and populate the analysis.</p>}</div>
        <div className="tw-rotation-composer">
          <label><span>Character</span><select value={draftMember?.build?.id ?? ''} onChange={(event) => setDraftBuildId(event.target.value)}>{model.members.flatMap((member) => member.build ? [<option value={member.build.id} key={member.build.id}>{teamMemberName(member)}</option>] : [])}</select></label>
          <label><span>Attack</span><select value={draftAttackId} onChange={(event) => setDraftAttackId(event.target.value)}>{ROTATION_ATTACK_GROUPS.map((group) => { const attacks = draftMember?.attacks.filter((attack) => attack.group === group.id) ?? []; return attacks.length ? <optgroup label={group.label} key={group.id}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{attack.name}</option>)}</optgroup> : null })}</select></label>
          <label><span>Time</span><input type="number" min="0" max={model.team.rotationDuration} step="0.1" value={draftTimestamp} onChange={(event) => setDraftTimestamp(Number(event.target.value))}/></label>
          <label><span>Duration</span><input type="number" min={ROTATION_MIN_CLIP_DURATION} max={model.team.rotationDuration} step="0.1" value={draftDuration} onChange={(event) => setDraftDuration(Number(event.target.value))}/></label>
          <button className="primary" onClick={() => void addAction()} disabled={!draftMember?.build || !draftAttackId}><Icon name="plus"/>Add</button>
        </div>
      </section>

      <aside className="tw-rotation-analysis" aria-label="Rotation analysis">
        <div className="tw-rotation-kpis"><div><span>{resultMode === 'expected' ? 'Average rotation' : resultMode === 'normal' ? 'Non-crit rotation' : 'Critical rotation'}</span><CalculatedValue detail={sumDetail('Rotation total', rotationTotal, model.actions.map((row) => ({ label: `${row.action.timestamp.toFixed(1)}s · ${row.attack?.name ?? 'Missing attack'}`, value: row[resultMode] })))}><strong>{formatDamage(rotationTotal)}</strong></CalculatedValue></div><div><span>DPS</span><strong>{formatDamage(rotationTotal / Math.max(1, model.team.rotationDuration))}</strong></div><div><span>Window</span><strong>{model.team.rotationDuration.toFixed(1)}s</strong></div></div>
        <section className="tw-analysis-card tw-damage-chart"><header><div><span className="eyebrow">Damage distribution</span><h3>{analysisMode === 'character' ? 'Team contribution' : analysisMode === 'type' ? 'Damage types' : 'Skill sources'}</h3></div><div className="tw-chart-toggle" role="group" aria-label="Chart grouping"><button type="button" aria-pressed={analysisMode === 'character'} onClick={() => setAnalysisMode('character')}>Character</button><button type="button" aria-pressed={analysisMode === 'type'} onClick={() => setAnalysisMode('type')}>Damage type</button><button type="button" aria-pressed={analysisMode === 'source'} onClick={() => setAnalysisMode('source')}>Skill source</button></div></header>
          <div className="tw-donut-layout"><div className="tw-donut" style={chartStyle} role="img" aria-label={rotationTotal ? `${analysisMode} damage distribution` : 'No calculated damage'}><div><strong>{formatDamage(rotationTotal)}</strong><span>Total damage</span></div></div><div className="tw-donut-legend">{segments.map((segment) => <div key={segment.label}><i style={{ background: segment.color }}/><span>{segment.label}</span><b>{percent(segment.value, rotationTotal)}</b><small>{formatDamage(segment.value)}</small></div>)}{!segments.length && <p>No calculated damage yet.</p>}</div></div>
        </section>
        <section className="tw-analysis-card tw-damage-matrix"><header><div><span className="eyebrow">Damage split</span><h3>Type by character</h3></div></header>
          {damageTypes.length && members.length ? <div className="tw-damage-table-scroll"><table><thead><tr><th>Type</th>{members.map((member) => <th key={member.build.id}>{teamMemberName(member)}</th>)}<th>Total</th></tr></thead><tbody>{damageTypes.map((type) => <tr key={type}><th>{DAMAGE_TYPE_LABELS[type]}</th>{members.map((member) => <td key={member.build.id}>{member.byType[type] ? formatDamage(member.byType[type] ?? 0) : '—'}</td>)}<td><b>{formatDamage(model.byType[type] ?? 0)}</b><small>{percent(model.byType[type] ?? 0, rotationTotal)}</small></td></tr>)}<tr className="tw-damage-total"><th>Total</th>{members.map((member) => <td key={member.build.id}><b>{formatDamage(member.contribution)}</b></td>)}<td><b>{formatDamage(rotationTotal)}</b></td></tr></tbody></table></div> : <p className="tw-analysis-empty">Damage rows will appear when the rotation contains calculated attacks.</p>}
        </section>
        <section className="tw-analysis-card tw-damage-over-time"><header><div><span className="eyebrow">Timeline analysis</span><h3>Damage over time</h3></div><b>Peak {compactDamage(peakActiveDamage)}</b></header>
          <div className="tw-damage-time-chart" role="group" aria-label={`Stacked action damage across the ${model.team.rotationDuration.toFixed(1)} second rotation`}>
            <div className="tw-damage-y-axis">{damageAxisTicks.map((tick, index) => <span style={{ top: `${index / (damageAxisTicks.length - 1) * 100}%` }} key={tick}>{compactDamage(tick)}</span>)}</div>
            <div className="tw-damage-plot">
              {damageAxisTicks.map((tick, index) => <i className="horizontal" style={{ top: `${index / (damageAxisTicks.length - 1) * 100}%` }} key={`y-${tick}`}/>)}
              {damageTimeTicks.map((tick, index) => <i className="vertical" style={{ left: `${index / (damageTimeTicks.length - 1) * 100}%` }} key={`x-${tick}`}/>)}
              {damageIntervals.map(({ start, end, damage, memberIndex, stackBottom, actionIds, attackNames }) => {
                const color = ROTATION_CHART_COLORS[Math.max(0, memberIndex) % ROTATION_CHART_COLORS.length]
                const left = model.team.rotationDuration > 0 ? start / model.team.rotationDuration * 100 : 0
                const width = model.team.rotationDuration > 0 ? (end - start) / model.team.rotationDuration * 100 : 0
                const height = Math.max(1, damage / damageAxisMaximum * 100)
                const bottom = stackBottom / damageAxisMaximum * 100
                const isActive = start <= playhead && playhead < end
                return <button type="button" className={`tw-damage-spike ${end <= playhead ? 'is-past' : ''} ${isActive ? 'is-active' : ''}`} style={{ left: `${left}%`, bottom: `${bottom}%`, width: `${width}%`, height: `${height}%`, '--tw-spike-color': color } as CSSProperties} title={`Character ${memberIndex + 1} · ${start.toFixed(1)}s–${end.toFixed(1)}s · ${attackNames.join(' + ')} · ${formatDamage(damage)} DMG`} aria-label={`Character ${memberIndex + 1}, ${attackNames.join(' and ')}, ${formatDamage(damage)} damage from ${start.toFixed(1)} to ${end.toFixed(1)} seconds`} key={`${start}:${end}:${memberIndex}`} onClick={() => { setPlayhead(start); setIsPlaying(false); setSelectedActionIds(actionIds) }}/>
              })}
              <span className="tw-damage-cursor" style={{ left: `${model.team.rotationDuration > 0 ? playhead / model.team.rotationDuration * 100 : 0}%` }}/>
            </div>
            <div className="tw-damage-x-axis">{damageTimeTicks.map((tick, index) => <span style={{ left: `${index / (damageTimeTicks.length - 1) * 100}%` }} key={tick}>{Number(tick.toFixed(1))}s</span>)}</div>
          </div>
          <div className="tw-damage-time-legend">{members.map((member, index) => <span key={member.build.id}><i style={{ background: ROTATION_CHART_COLORS[index % ROTATION_CHART_COLORS.length] }}/>{teamMemberName(member)}</span>)}<small>Height is total action damage; width is action duration; overlaps stack Character 1 upward.</small></div>
          <div className="tw-member-damage-charts" aria-label="Damage over time by character">{members.map((member, memberIndex) => {
            const sources = damageSources.filter((source) => source.memberIndex === memberIndex)
            const color = ROTATION_CHART_COLORS[memberIndex % ROTATION_CHART_COLORS.length]
            return <section className="tw-member-damage-chart" key={member.build.id}>
              <header><span><i style={{ background: color }}/><b>{teamMemberName(member)}</b></span><strong>{formatDamage(member.contribution)}</strong></header>
              <div className="tw-member-damage-plot" role="img" aria-label={`${teamMemberName(member)} damage across the shared rotation timeline`}>
                {damageTimeTicks.map((tick, index) => <i className="vertical" style={{ left: `${index / (damageTimeTicks.length - 1) * 100}%` }} key={`member-${member.build.id}-${tick}`}/>)}
                {sources.map(({ row, start, end, damage }) => {
                  const left = model.team.rotationDuration > 0 ? start / model.team.rotationDuration * 100 : 0
                  const width = model.team.rotationDuration > 0 ? (end - start) / model.team.rotationDuration * 100 : 0
                  const height = Math.max(2, damage / damageAxisMaximum * 100)
                  const isActive = start <= playhead && playhead < end
                  return <button type="button" className={`tw-damage-spike ${end <= playhead ? 'is-past' : ''} ${isActive ? 'is-active' : ''}`} style={{ left: `${left}%`, bottom: 0, width: `${width}%`, height: `${height}%`, '--tw-spike-color': color } as CSSProperties} title={`${row.attack?.name ?? 'Missing attack'} · ${formatDamage(damage)} DMG`} key={row.action.id} onClick={() => { setPlayhead(start); setIsPlaying(false); setSelectedActionIds([row.action.id]) }}/>
                })}
                <span className="tw-damage-cursor" style={{ left: `${model.team.rotationDuration > 0 ? playhead / model.team.rotationDuration * 100 : 0}%` }}/>
              </div>
            </section>
          })}</div>
          <p className="tw-chart-disclaimer">Action damage is spread across each clip duration because per-hit timestamps are not available.</p>
        </section>
      </aside>
    </div>
  </section>
}
