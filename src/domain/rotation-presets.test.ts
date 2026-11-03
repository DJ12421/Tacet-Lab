import { describe, expect, it } from 'vitest'
import { createRotationPreset, parseRotationPresetDocument, previewRotationPreset } from './rotation-presets'
import type { Team } from './types'

const team: Team = { id: 'team', name: 'Test', buildIds: ['build'], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 20, actions: [{ id: 'action', timestamp: 1, buildId: 'build', attackId: 'attack' }] }
const members = [{ slot: 0, buildId: 'build', catalogId: 'character', name: 'Character', attackIds: ['attack'] }]

describe('rotation presets', () => {
  it('round-trips stable character and attack identities', () => {
    const preset = createRotationPreset(team, members, 'Preset')
    expect(parseRotationPresetDocument(JSON.parse(JSON.stringify(preset)))).toMatchObject({ schemaVersion: 2, name: 'Preset' })
    expect(previewRotationPreset(preset, members)).toMatchObject({ compatible: true, actions: [{ buildId: 'build', attackId: 'attack' }] })
  })

  it('warns and skips actions for an incompatible composition', () => {
    const preset = createRotationPreset(team, members, 'Preset')
    expect(previewRotationPreset(preset, [{ ...members[0], catalogId: 'other', name: 'Other', attackIds: [] }])).toMatchObject({ compatible: false, actions: [] })
  })

  it('rejects unknown schema versions', () => {
    expect(() => parseRotationPresetDocument({ schemaVersion: 3 })).toThrow('Unsupported rotation preset version')
  })

  it('reads old presets and preserves cancel and swap timing in new ones', () => {
    const old = { ...createRotationPreset(team, members, 'Old'), schemaVersion: 1 }
    expect(parseRotationPresetDocument(old).schemaVersion).toBe(1)
    const timed = createRotationPreset({ ...team, actions: [{ ...team.actions[0], cancel: 'normal', cancelFrame: 8, swapFrame: 12 }] }, members, 'Timed')
    const parsed = parseRotationPresetDocument(JSON.parse(JSON.stringify(timed)))
    expect(previewRotationPreset(parsed, members).actions[0]).toMatchObject({ cancel: 'normal', cancelFrame: 8, swapFrame: 12 })
    expect(() => parseRotationPresetDocument({ ...timed, actions: [{ ...timed.actions[0], cancelFrame: 8, cancel: undefined }] })).toThrow('invalid cancel or swap timing')
  })

  it('rejects duplicate slots and actions outside the preset duration', () => {
    const preset = createRotationPreset(team, members, 'Preset')
    expect(() => parseRotationPresetDocument({ ...preset, characters:[...preset.characters, preset.characters[0]] })).toThrow('duplicate character slots')
    expect(() => parseRotationPresetDocument({ ...preset, actions:[{ ...preset.actions[0], timestamp:preset.duration + 1 }] })).toThrow('invalid action')
    expect(() => parseRotationPresetDocument({ ...preset, actions:[{ ...preset.actions[0], timestamp:preset.duration - 0.5, duration:1 }] })).toThrow('invalid action duration')
    expect(() => parseRotationPresetDocument({ ...preset, actions:[{ ...preset.actions[0], inputs:{ stacks:null } }] })).toThrow('invalid action inputs')
  })
})
