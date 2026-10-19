import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { DiagnosticScanCandidate } from './types'
import { characterCatalog, weaponCatalog } from '../game-data'
import { db } from '../storage/database'
import { saveScannedCandidate, saveScannedCandidates } from './persistence'

const character = characterCatalog.find((entry) => entry.name === 'Changli') ?? characterCatalog[0]
const weapon = weaponCatalog.find((entry) => entry.name === 'Blazing Brilliance') ?? weaponCatalog[0]

function candidate(id: string): DiagnosticScanCandidate {
  return {
    id, createdAt: 1, imageDataUrl: '', fingerprint: id, source: 'screenshot',
    fields: {
      name: { value: 'Inferno Rider', confidence: 1 }, cost: { value: 4, confidence: 1 }, rarity: { value: 5, confidence: 1 }, level: { value: 25, confidence: 1 },
      sonata: { value: 'Molten Rift', confidence: 1 }, mainStat: { value: { key: 'critRate', value: 22 }, confidence: 1 }, subStats: [],
      equippedBy: { value: character.name, confidence: 1 }, locked: { value: false, confidence: 1 }, excluded: { value: false, confidence: 1 }
    },
    buildCard: {
      id: 'card', character: { value: character.name, confidence: 1 }, characterCatalogId: character.id, characterLevel: { value: 90, confidence: 1 },
      sequence: { value: 2, confidence: 1 }, skillLevels: [10, 10, 6, 10, 10].map((value) => ({ value, confidence: 1 })),
      weapon: { value: weapon.name, confidence: 1 }, weaponCatalogId: weapon.id, weaponLevel: { value: 90, confidence: 1 }, weaponRank: { value: 2, confidence: 1 }, sourceImageDataUrl: ''
    }
  }
}

describe('scanner inventory ownership', () => {
  beforeEach(async () => { db.close(); await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('adds build-card ownership once while saving every reviewed Echo', async () => {
    const progress: number[] = []
    await saveScannedCandidates([candidate('first'), candidate('second')], (state) => progress.push(state.completed))

    expect(await db.echoes.count()).toBe(2)
    expect(await db.characters.count()).toBe(1)
    expect(await db.weapons.count()).toBe(1)
    expect(await db.characters.toCollection().first()).toMatchObject({ catalogId: character.id, level: 90, sequence: 2, skillLevels: [10, 10, 6, 10, 10] })
    expect(await db.weapons.toCollection().first()).toMatchObject({ catalogId: weapon.id, level: 90, rank: 2, locked: true })
    expect((await db.echoes.toArray()).every((echo) => echo.locked)).toBe(true)
    expect((await db.equippedLoadouts.toCollection().first())?.echoIds).toHaveLength(2)
    expect(progress.at(-1)).toBe(2)
  })

  it('keeps two scanned cards as separate builds and equips the later card', async () => {
    const first = [candidate('first-1'), candidate('first-2')]
    const second = [candidate('second-1'), candidate('second-2')]
    second.forEach((scan) => { scan.buildCard!.id = 'card-2'; scan.fields.mainStat.value = { key: 'critDamage', value: 44 } })

    await saveScannedCandidates([...first, ...second])

    const builds = (await db.builds.toArray()).sort((left, right) => left.name.localeCompare(right.name))
    const loadout = await db.equippedLoadouts.toCollection().first()
    expect(builds.map((build) => build.name)).toEqual(['Build 1', 'Build 2'])
    expect(builds[0].echoIds).toHaveLength(2)
    expect(builds[1].echoIds).toEqual(loadout?.echoIds)
    expect(builds[0].echoIds).not.toEqual(builds[1].echoIds)
    expect((await db.echoes.bulkGet(builds[0].echoIds)).every((echo) => !echo?.equippedBy)).toBe(true)
    expect(await db.echoes.count()).toBe(4)
  })

  it('preserves an existing equipped build and its weapon stats when scanning another card', async () => {
    await saveScannedCandidates([candidate('first-1'), candidate('first-2')])
    const firstBuild = await db.builds.toCollection().first()
    const next = [candidate('second-1'), candidate('second-2')]
    next.forEach((scan) => { scan.buildCard!.id = 'card-2'; scan.buildCard!.weaponRank.value = 3 })

    await saveScannedCandidates(next)

    const builds = (await db.builds.toArray()).sort((left, right) => left.name.localeCompare(right.name))
    expect(builds.map((build) => build.name)).toEqual(['Build 1', 'Build 2'])
    expect(builds[0].echoIds).toEqual(firstBuild?.echoIds)
    expect((await db.weapons.get(builds[0].weaponId))?.rank).toBe(2)
    expect((await db.weapons.get(builds[1].weaponId))?.rank).toBe(3)
    expect((await db.equippedLoadouts.toCollection().first())?.echoIds).toEqual(builds[1].echoIds)
  })

  it('saves a previously unsaved equipped setup as Build 1', async () => {
    await saveScannedCandidates([candidate('first-1'), candidate('first-2')])
    const previous = await db.equippedLoadouts.toCollection().first()
    await db.builds.clear()
    const next = [candidate('second-1'), candidate('second-2')]
    next.forEach((scan) => { scan.buildCard!.id = 'card-2' })

    await saveScannedCandidates(next)

    const builds = (await db.builds.toArray()).sort((left, right) => left.name.localeCompare(right.name))
    expect(builds.map((build) => build.name)).toEqual(['Build 1', 'Build 2'])
    expect(builds[0].echoIds).toEqual(previous?.echoIds)
    expect((await db.equippedLoadouts.toCollection().first())?.echoIds).toEqual(builds[1].echoIds)
  })

  it('adds the catalog character from a normal equipped Echo scan', async () => {
    const scan = candidate('normal'); delete scan.buildCard
    await saveScannedCandidate(scan)
    expect(await db.characters.toCollection().first()).toMatchObject({ catalogId: character.id, level: 1, sequence: 0 })
    expect(await db.weapons.count()).toBe(0)
  })
})
