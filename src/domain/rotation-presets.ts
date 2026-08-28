import { createLocalId } from './id'
import type { RotationAction, ScenarioValue, Team } from './types'

export const ROTATION_PRESET_SCHEMA_VERSION = 1 as const

export interface RotationPresetAction {
  slot: number
  attackId: string
  timestamp: number
  duration?: number
  multiplier?: number
  inputs?: Record<string, ScenarioValue>
}

export interface RotationPresetDocument {
  schemaVersion: typeof ROTATION_PRESET_SCHEMA_VERSION
  id: string
  name: string
  description?: string
  duration: number
  characters: Array<{ slot: number; catalogId: string; name: string }>
  actions: RotationPresetAction[]
  source: 'bundled' | 'user'
  createdAt: number
}

export interface RotationPresetMember {
  slot: number
  buildId: string
  catalogId: string
  name: string
  attackIds: string[]
}

export interface RotationPresetPreview {
  actions: RotationAction[]
  warnings: string[]
  compatible: boolean
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseRotationPresetDocument(value: unknown): RotationPresetDocument {
  if (!value || typeof value !== 'object') throw new Error('Rotation preset must be a JSON object.')
  const candidate = value as Partial<RotationPresetDocument>
  if (candidate.schemaVersion !== ROTATION_PRESET_SCHEMA_VERSION) throw new Error(`Unsupported rotation preset version: ${String(candidate.schemaVersion)}.`)
  if (!candidate.id || !candidate.name || !finiteNumber(candidate.duration) || candidate.duration <= 0) throw new Error('Rotation preset identity or duration is invalid.')
  if (candidate.description !== undefined && typeof candidate.description !== 'string') throw new Error('Rotation preset description is invalid.')
  if (!Array.isArray(candidate.characters) || !Array.isArray(candidate.actions)) throw new Error('Rotation preset characters and actions are required.')
  if (!candidate.characters.every((entry) => Number.isInteger(entry?.slot) && entry.slot >= 0 && entry.slot < 3 && Boolean(entry.catalogId) && Boolean(entry.name))) throw new Error('Rotation preset contains an invalid character slot.')
  if (new Set(candidate.characters.map((entry) => entry.slot)).size !== candidate.characters.length) throw new Error('Rotation preset contains duplicate character slots.')
  const characterSlots = new Set(candidate.characters.map((entry) => entry.slot))
  for (const action of candidate.actions) {
    if (!Number.isInteger(action?.slot) || !characterSlots.has(action.slot) || !action.attackId || !finiteNumber(action.timestamp) || action.timestamp < 0 || action.timestamp > candidate.duration) throw new Error('Rotation preset contains an invalid action.')
    if (action.duration !== undefined && (!finiteNumber(action.duration) || action.duration <= 0 || action.timestamp + action.duration > candidate.duration)) throw new Error('Rotation preset contains an invalid action duration.')
    if (action.multiplier !== undefined && (!Number.isInteger(action.multiplier) || action.multiplier < 1 || action.multiplier > 99)) throw new Error('Rotation preset contains an invalid action multiplier.')
    if (action.inputs !== undefined && (!action.inputs || typeof action.inputs !== 'object' || Array.isArray(action.inputs) || !Object.values(action.inputs).every((input) => finiteNumber(input) || typeof input === 'string' || typeof input === 'boolean'))) throw new Error('Rotation preset contains invalid action inputs.')
  }
  return { ...candidate, source: candidate.source === 'bundled' ? 'bundled' : 'user' } as RotationPresetDocument
}

export function createRotationPreset(team: Team, members: RotationPresetMember[], name: string): RotationPresetDocument {
  const slotByBuild = new Map(members.map((member) => [member.buildId, member.slot]))
  return {
    schemaVersion: ROTATION_PRESET_SCHEMA_VERSION,
    id: createLocalId(),
    name: name.trim() || `${team.name} rotation`,
    duration: team.rotationDuration,
    characters: members.map(({ slot, catalogId, name: memberName }) => ({ slot, catalogId, name: memberName })),
    actions: team.actions.flatMap((action) => {
      const slot = slotByBuild.get(action.buildId)
      return slot === undefined ? [] : [{ slot, attackId: action.attackId, timestamp: action.timestamp, duration: action.duration, multiplier: action.multiplier, inputs: action.inputs }]
    }),
    source: 'user',
    createdAt: Date.now()
  }
}

export function previewRotationPreset(preset: RotationPresetDocument, members: RotationPresetMember[]): RotationPresetPreview {
  const warnings: string[] = []
  const memberBySlot = new Map(members.map((member) => [member.slot, member]))
  for (const expected of preset.characters) {
    const actual = memberBySlot.get(expected.slot)
    if (!actual) warnings.push(`Member ${expected.slot + 1} is empty; expected ${expected.name}.`)
    else if (actual.catalogId !== expected.catalogId) warnings.push(`Member ${expected.slot + 1} is ${actual.name}; preset expects ${expected.name}.`)
  }
  const actions = preset.actions.flatMap((action) => {
    const member = memberBySlot.get(action.slot)
    if (!member) return []
    if (!member.attackIds.includes(action.attackId)) {
      warnings.push(`${member.name} does not have attack ${action.attackId}; that action was skipped.`)
      return []
    }
    return [{
      id: createLocalId(),
      buildId: member.buildId,
      attackId: action.attackId,
      timestamp: Math.min(preset.duration, action.timestamp),
      duration: action.duration,
      multiplier: action.multiplier,
      inputs: action.inputs
    }]
  })
  return { actions, warnings: [...new Set(warnings)], compatible: warnings.length === 0 }
}
