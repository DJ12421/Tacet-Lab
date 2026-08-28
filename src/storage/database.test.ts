import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TheorycraftBuild } from '../domain/types'
import { db, ensureSeedData, exportAccount, importAccount, previewAccountImport, requestPersistentStorage, validateAccount } from './database'

describe('local account persistence', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterAll(() => db.close())

  it('creates settings without seeding fabricated builds or teams', async () => {
    await ensureSeedData()
    await db.builds.clear()
    await ensureSeedData()
    expect(await db.builds.count()).toBe(0)
    expect(await db.teams.count()).toBe(0)
  })

  it('repairs main stats saved with the old nearest-rounding rule', async () => {
    await db.echoes.add({ id: 'old-rounded-main', name: 'Fusion Warrior', cost: 3, rarity: 5, level: 1, sonata: 'Molten Rift', mainStat: { key: 'fusionDamage', value: 7 }, subStats: [], locked: false, excluded: false, createdAt: 1, source: 'scan' })
    await ensureSeedData()
    expect((await db.echoes.get('old-rounded-main'))?.mainStat.value).toBe(6.9)
  })

  it('repairs theorycraft roll mode saved without a rolls map', async () => {
    await db.theorycraftBuilds.add({
      id: 'missing-rolls', name: 'Legacy theorycraft', description: '', characterId: 'character',
      weapon: { catalogId: 'weapon', level: 90, rank: 1 }, mainEchoName: '', slots: [], sonatas: [],
      substats: { mode: 'rolls', quality: 'mid' }, createdAt: 1, updatedAt: 1
    } as unknown as TheorycraftBuild)

    await ensureSeedData()

    expect((await db.theorycraftBuilds.get('missing-rolls'))?.substats).toEqual({ mode: 'rolls', quality: 'mid', rolls: {} })
  })

  it('round-trips a versioned account document atomically', async () => {
    await ensureSeedData()
    const exported = await exportAccount()
    expect(exported.schemaVersion).toBe(7)
    expect(exported.equippedLoadouts).toEqual([])
    expect(exported.theorycraftBuilds).toEqual([])
    expect(exported.optimizerProfiles).toEqual([])
    expect(exported.optimizerRuns).toEqual([])
    expect(validateAccount(exported)).toBe(true)
    await importAccount(exported)
    expect((await exportAccount()).builds).toHaveLength(0)
  })

  it('previews duplicates and appends imports without deleting current data or preferences', async () => {
    await ensureSeedData()
    const echo = (id: string, locked = false) => ({
      id, name: 'Fusion Drake', cost: 1 as const, rarity: 5 as const, level: 25, sonata: 'Windward Pilgrimage',
      mainStat: { key: 'atkPercent' as const, value: 18 }, subStats: [{ key: 'critRate' as const, value: 6.3 }],
      locked, excluded: false, createdAt: id.length, source: 'manual' as const
    })
    await db.echoes.bulkAdd([echo('duplicate'), echo('update'), echo('local-only')])
    const base = await exportAccount()
    const incoming = {
      ...base,
      echoes: [echo('duplicate'), echo('update', true), echo('new-echo')],
      settings: { ...base.settings, displayName: 'Imported name' }
    }

    const preview = await previewAccountImport(incoming)
    expect(preview.collections.find((entry) => entry.key === 'echoes')).toMatchObject({ added: 1, updated: 1, duplicates: 1, result: 4 })

    await importAccount(incoming)
    expect(await db.echoes.count()).toBe(4)
    expect(await db.echoes.get('local-only')).toBeDefined()
    expect((await db.echoes.get('update'))?.locked).toBe(true)
    expect((await exportAccount()).settings.displayName).not.toBe('Imported name')
  })

  it('accepts schema-2 teams and preserves calculation scenarios in the current schema', async () => {
    await ensureSeedData()
    const base = await exportAccount()
    const legacy = { ...base, schemaVersion: 2 as const, teams: [{ id: 'legacy', name: 'Legacy', buildIds: [], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 20, actions: [], buffs: [] }] }
    expect(validateAccount(legacy)).toBe(true)
    await importAccount(legacy)
    await db.teams.update('legacy', { scenario: { resultMode: 'critical', memberConditions: {}, enemyConditions: { staggered: true }, selectedTargetByBuild: {} } })
    const roundTrip = await exportAccount()
    expect(roundTrip.schemaVersion).toBe(7)
    expect(roundTrip.teams[0].scenario?.resultMode).toBe('critical')
  })

  it('rejects malformed nested records', () => {
    expect(validateAccount({ schemaVersion: 1, gameDataVersion: 'x', exportedAt: '', echoes: [{ id: 'broken' }], builds: [], teams: [], settings: {} })).toBe(false)
  })

  it('requests persistent browser storage when it is not already granted', async () => {
    const persisted = vi.fn().mockResolvedValue(false)
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: { persisted, persist } })

    await expect(requestPersistentStorage()).resolves.toBe(true)
    expect(persisted).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
