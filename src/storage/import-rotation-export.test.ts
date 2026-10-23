import { describe, expect, it } from 'vitest'
import type { AccountDocument } from '../domain/types'
import { defaultSettings } from '../game-data'
import { validateAccount } from './database'
import { convertRotationExport, isRotationExport } from './import-rotation-export'

const empty: AccountDocument = {
  schemaVersion: 7, gameDataVersion: 'test', exportedAt: '2026-10-21T00:00:00.000Z',
  echoes: [], characters: [], weapons: [], builds: [], equippedLoadouts: [], theorycraftBuilds: [], teams: [], settings: defaultSettings
}
const source = {
  schemaVersion: 1, source: { site: 'wuwalab', rotationId: 554, segment: 'loop' }, name: 'Sample', duration: 2,
  characters: [{ slot: 0, catalogId: '1110', name: 'Suisui', sequence: 0, weapon: { name: "Firstlight's Herald", rank: 1 },
    echoes: Array.from({ length: 5 }, (_, index) => ({
      cost: index === 0 ? 4 : index < 3 ? 3 : 1, name: index === 0 ? 'Fallacy of No Return' : null,
      sonata: 'Rejuvenating Glow', main: { label: index === 0 ? 'HP%' : 'ATK%', value: '33.0%' },
      subs: [{ label: 'Crit. Rate', value: '7.5%' }]
    })) }],
  actions: [
    { slot: 0, attackName: 'Basic: Zephyr 1', attackId: '1110-1-0', timestamp: 0 },
    { slot: 0, attackName: 'Liberation: Song of Thoroughfare', attackId: null, timestamp: 1 }
  ]
}

describe('rotation export import', () => {
  it('builds a valid team and theorycraft gear while retaining unmapped action names', () => {
    expect(isRotationExport(source)).toBe(true)
    const { document, notices } = convertRotationExport(source, empty)
    expect(validateAccount(document)).toBe(true)
    expect(document.echoes).toHaveLength(0)
    expect(document.theorycraftBuilds?.[0].slots).toHaveLength(5)
    expect(document.teams[0].actions.map((action) => action.label)).toEqual(source.actions.map((action) => action.attackName))
    expect(notices.some((notice) => notice.includes('Liberation: Song of Thoroughfare'))).toBe(true)
  })

  it('reuses an unchanged import and leaves a later team edit intact', () => {
    const first = convertRotationExport(source, empty).document
    const current = { ...empty, characters: first.characters, theorycraftBuilds: first.theorycraftBuilds, teams: first.teams }
    expect(convertRotationExport(source, current).document.teams[0].id).toBe(first.teams[0].id)
    const previousDescription = { ...current, theorycraftBuilds: first.theorycraftBuilds!.map((build) => ({ ...build, description: 'Previous weapon description' })) }
    expect(convertRotationExport(source, previousDescription).document.theorycraftBuilds?.[0].id).toBe(first.theorycraftBuilds?.[0].id)
    const edited = { ...current, teams: [{ ...current.teams[0], name: 'My edited team' }] }
    expect(convertRotationExport(source, edited).document.teams[0].id).not.toBe(first.teams[0].id)
  })
})
