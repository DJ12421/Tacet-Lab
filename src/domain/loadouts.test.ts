import { describe, expect, it } from 'vitest'
import { characterCatalog, echoCatalog, weaponCatalog } from '../game-data'
import type { Echo, OwnedCharacter } from './types'
import { createTheorycraftBuild, resolveLoadout, theorycraftRollValue, theorycraftWarnings } from './loadouts'

const ownedCharacter: OwnedCharacter = { id: 'character', catalogId: characterCatalog[0].id, level: 90, sequence: 0, locked: false, skillLevels: [10, 10, 10, 10, 10], createdAt: 1 }

describe('loadout resolution', () => {
  it('resolves theorycraft equipment ephemerally without creating inventory entities', () => {
    const build = createTheorycraftBuild(ownedCharacter)
    const compatibleWeapon = weaponCatalog.find((entry) => entry.type.toLowerCase() === characterCatalog[0].weaponType.toLowerCase())!
    const mainEcho = echoCatalog.find((entry) => entry.cost === 4)!
    build.weapon = { catalogId: compatibleWeapon.id, level: 90, rank: 5 }
    build.mainEchoName = mainEcho.name
    build.sonatas = [{ name: mainEcho.sonatas[0], pieces: 5 }]
    build.substats = { mode: 'values', values: { critRate: 21, critDamage: 42, atkPercent: 18 } }
    const collections = { characters: [ownedCharacter], weapons: [], echoes: [], builds: [], equippedLoadouts: [], theorycraftBuilds: [build] }

    const resolved = resolveLoadout({ type: 'theorycraft', theorycraftBuildId: build.id }, collections)

    expect(resolved.echoes).toHaveLength(5)
    expect(resolved.echoes[0].name).toBe(mainEcho.name)
    expect(resolved.weapon).toMatchObject({ catalogId: compatibleWeapon.id, level: 90, rank: 5 })
    expect(collections.echoes).toEqual([])
    expect(collections.weapons).toEqual([])
  })

  it('reports illegal cost, slot, Sonata, and roll-count configurations', () => {
    const build = createTheorycraftBuild(ownedCharacter)
    build.slots = build.slots.map((slot) => ({ ...slot, cost: 4 as Echo['cost'], level: 25 }))
    build.sonatas = []
    build.substats = { mode: 'rolls', quality: 'high', rolls: { critRate: 9 } }

    const warnings = theorycraftWarnings(build).join(' ')
    expect(warnings).toContain('12-cost')
    expect(warnings).toContain('0/5')
    expect(warnings).toContain('more Echoes')
  })

  it('converts low, mid, and high roll counts deterministically', () => {
    expect(theorycraftRollValue('critRate', 2, 'low')).toBe(12.6)
    expect(theorycraftRollValue('critRate', 2, 'high')).toBe(21)
    expect(theorycraftRollValue('critRate', 0, 'mid')).toBe(0)
  })
})
