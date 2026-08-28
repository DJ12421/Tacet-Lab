import { describe, expect, it } from 'vitest'
import { createRotationPreset, parseRotationPresetDocument, previewRotationPreset } from './rotation-presets'
import type { Team } from './types'

const team: Team = { id: 'team', name: 'Test', buildIds: ['build'], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 20, actions: [{ id: 'action', timestamp: 1, buildId: 'build', attackId: 'attack' }] }
const members = [{ slot: 0, buildId: 'build', catalogId: 'character', name: 'Character', attackIds: ['attack'] }]

describe('rotation presets', () => {
  it('round-trips stable character and attack identities', () => {
    const preset = createRotationPreset(team, members, 'Preset')
    expect(parseRotationPresetDocument(JSON.parse(JSON.stringify(preset)))).toMatchObject({ schemaVersion: 1, name: 'Preset' })
    expect(previewRotationPreset(preset, members)).toMatchObject({ compatible: true, actions: [{ buildId: 'build', attackId: 'attack' }] })
  })

  it('warns and skips actions for an incompatible composition', () => {
    const preset = createRotationPreset(team, members, 'Preset')
    expect(previewRotationPreset(preset, [{ ...members[0], catalogId: 'other', name: 'Other', attackIds: [] }])).toMatchObject({ compatible: false, actions: [] })
  })

  it('rejects unknown schema versions', () => {
    expect(() => parseRotationPresetDocument({ schemaVersion: 2 })).toThrow('Unsupported rotation preset version')
  })

  it('rejects duplicate slots and actions outside the preset duration', () => {
    const preset = createRotationPreset(team, members, 'Preset')
    expect(() => parseRotationPresetDocument({ ...preset, characters:[...preset.characters, preset.characters[0]] })).toThrow('duplicate character slots')
    expect(() => parseRotationPresetDocument({ ...preset, actions:[{ ...preset.actions[0], timestamp:preset.duration + 1 }] })).toThrow('invalid action')
    expect(() => parseRotationPresetDocument({ ...preset, actions:[{ ...preset.actions[0], timestamp:preset.duration - 0.5, duration:1 }] })).toThrow('invalid action duration')
    expect(() => parseRotationPresetDocument({ ...preset, actions:[{ ...preset.actions[0], inputs:{ stacks:null } }] })).toThrow('invalid action inputs')
  })
})
