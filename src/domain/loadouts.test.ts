import { describe, expect, it } from 'vitest'
import { characterCatalog, echoCatalog, weaponCatalog } from '../game-data'
import type { Echo, OwnedCharacter } from './types'
import { changedTheorycraftAxes, createTheorycraftBuild, resolveLoadout, theorycraftRollValue, theorycraftWarnings } from './loadouts'

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

  it('preserves exact per-Echo theorycraft substats', () => {
    const build = createTheorycraftBuild(ownedCharacter)
    build.substats = { mode: 'slots', slots: [[{ key: 'critRate', value: 10.5 }], [{ key: 'critDamage', value: 21 }], [], [], []] }
    const collections = { characters: [ownedCharacter], weapons: [], echoes: [], builds: [], equippedLoadouts: [], theorycraftBuilds: [build] }

    const resolved = resolveLoadout({ type: 'theorycraft', theorycraftBuildId: build.id }, collections)

    expect(resolved.echoes[0].subStats).toEqual([{ key: 'critRate', value: 10.5 }])
    expect(resolved.echoes[1].subStats).toEqual([{ key: 'critDamage', value: 21 }])
  })

  it('reports illegal cost, slot, Sonata, and roll-count configurations', () => {
    const build = createTheorycraftBuild(ownedCharacter)
    build.slots = build.slots.map((slot) => ({ ...slot, cost: 4 as Echo['cost'], level: 25 }))
    build.sonatas = []
    build.substats = { mode: 'rolls', quality: 'high', rolls: { critRate: 9 } }

    const warnings = theorycraftWarnings(build).join(' ')
    expect(warnings).toContain('20/12')
    expect(warnings).toContain('0/5')
    expect(warnings).toContain('more Echoes')
  })

  it('converts low, mid, and high roll counts deterministically', () => {
    expect(theorycraftRollValue('critRate', 2, 'low')).toBe(12.6)
    expect(theorycraftRollValue('critRate', 2, 'high')).toBe(21)
    expect(theorycraftRollValue('critRate', 0, 'mid')).toBe(0)
  })

  it('keeps exact legal substats on their individual Echo slots', () => {
    const build = createTheorycraftBuild(ownedCharacter)
    build.substats = { mode:'slots', slots:[[{ key:'atk', value:30 },{ key:'critDamage', value:12.6 }], [], [], [], []] }
    const collections = { characters:[ownedCharacter], weapons:[], echoes:[], builds:[], equippedLoadouts:[], theorycraftBuilds:[build] }
    expect(theorycraftWarnings(build)).toEqual([])
    expect(resolveLoadout({ type:'theorycraft', theorycraftBuildId:build.id }, collections).echoes[0].subStats).toEqual(build.substats.slots[0])
    build.substats.slots[0].push({ key:'atk', value:40 })
    expect(theorycraftWarnings(build).join(' ')).toContain('duplicate ATK')
  })

  it('identifies a single changed equipment axis for what-if comparisons', () => {
    const build = createTheorycraftBuild(ownedCharacter)
    const resolved = resolveLoadout({ type:'theorycraft', theorycraftBuildId:build.id }, { characters:[ownedCharacter], weapons:[], echoes:[], builds:[], equippedLoadouts:[], theorycraftBuilds:[build] })
    expect(changedTheorycraftAxes(build, resolved)).toEqual([])
    build.weapon.rank = 2
    expect(changedTheorycraftAxes(build, resolved)).toEqual(['weapon'])
    build.slots[1].mainStatKey = 'hpPercent'
    expect(changedTheorycraftAxes(build, resolved)).toEqual(['weapon', 'mainStats'])
  })
})
