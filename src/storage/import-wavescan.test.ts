import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { characterCatalog, echoCatalog } from '../game-data'
import { db, importAccount, previewAccountImport } from './database'
import { convertWavescanExport, isWavescanExport } from './import-wavescan'

describe('WaveScan import', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterAll(() => db.close())

  it('maps a scan to an Echo and reimports without duplicating or clearing local ownership', async () => {
    const catalog = echoCatalog.find((echo) => echo.cost === 4 && echo.sonatas.length)!
    const source = { format: 'WutheringToolsScan', version: 1, meta: { scannedAt: '2026-10-11T21:54:21.518Z' }, echoes: [{
      scanId: 'scan-echo-1', echo: catalog.name.replace(/[^a-z0-9]/gi, ''),
      echoSet: catalog.sonatas[0].replace(/[^a-z0-9]/gi, ''), cost: 4, rank: 5, level: 25,
      stat: 'CritDMG', substats: [{ type: 'CritRate', value: 7.5 }, { type: 'ATK_FLAT', value: 50 }],
      equippedBy: 'Hsin'
    }] }
    const echoId = 'wavescan:2026-10-11T21%3A54%3A21.518Z:scan-echo-1'
    expect(isWavescanExport(source)).toBe(true)
    const first = await convertWavescanExport(source)
    expect(first.document.echoes[0]).toMatchObject({ name: catalog.name, sonata: catalog.sonatas[0],
      mainStat: { key: 'critDamage', value: 44 }, subStats: [{ key: 'critRate', value: 7.5 }, { key: 'atk', value: 50 }] })
    expect(first.document.echoes[0].equippedBy).toBeUndefined()
    await importAccount(first.document)
    await db.characters.add({ id: 'local-character', catalogId: characterCatalog[0].id, level: 90,
      sequence: 0, skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: Date.now() })
    await db.equippedLoadouts.add({ id: 'equipped:local-character', characterId: 'local-character', weaponId: '',
      echoIds: [echoId], updatedAt: Date.now() })
    await db.echoes.update(echoId, { locked: true, equippedBy: 'local-character' })
    const repeated = await convertWavescanExport(source)
    expect((await previewAccountImport(repeated.document)).duplicates).toBe(1)
    await importAccount(repeated.document)
    expect(await db.echoes.count()).toBe(1)
    expect(await db.echoes.get(echoId)).toMatchObject({ locked: true, equippedBy: 'local-character' })

    const replacement = await convertWavescanExport(source, true)
    expect(replacement.document.echoes[0]).toMatchObject({ locked: false, equippedBy: undefined })
  })

  it('rejects an export when no Echo can be imported', async () => {
    const source = { format: 'WutheringToolsScan', version: 1, meta: { scannedAt: '2026-10-11T21:54:21.518Z' },
      echoes: [{ scanId: '1', echo: 'unknown', echoSet: 'unknown', cost: 4, rank: 5, level: 25,
        stat: 'CritDMG', substats: [{ type: 'UnknownStat', value: 10 }] }] }
    await expect(convertWavescanExport(source)).rejects.toThrow('No WaveScan Echoes could be imported.')
  })

  it('imports a phantom Echo and skips an unconfirmed set without losing the valid row', async () => {
    const catalog = echoCatalog.find((echo) => echo.name === 'Fallacy of No Return')!
    const valid = { scanId: 'phantom', echo: 'PhantomFallacyOfNoReturn', echoSet: catalog.sonatas[0],
      cost: 4, rank: 5, level: 25, stat: 'CritDMG', substats: [] }
    const source = { format: 'WaveScan', version: 1, meta: { scannedAt: '2026-10-11T21:54:21.518Z' },
      echoes: [{ ...valid, scanId: 'unknown-set', echoSet: null }, valid] }
    expect(isWavescanExport(source)).toBe(true)
    const result = await convertWavescanExport(source)
    expect(result.document.echoes).toHaveLength(1)
    expect(result.document.echoes[0]).toMatchObject({ name: catalog.name, sonata: catalog.sonatas[0] })
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.stringContaining('1 of 2 WaveScan Echoes were skipped'),
      expect.stringContaining('Echo 1 (unknown-set) was skipped: Sonata set is unconfirmed.'),
      expect.stringContaining('Phantom Fallacy of No Return was imported as Fallacy of No Return.')
    ]))
    await expect(convertWavescanExport(source, true)).rejects.toThrow('Turn off overwrite and cleanup options')
  })

  it('accepts the older Young Roseshroom export name', async () => {
    const catalog = echoCatalog.find((echo) => echo.name === 'Baby Roseshroom')!
    const source = { format: 'WutheringToolsScan', version: 1, meta: { scannedAt: '2026-10-11T21:54:21.518Z' },
      echoes: [{ scanId: 'young', echo: 'YoungRoseshroom', echoSet: catalog.sonatas[0],
        cost: catalog.cost, rank: 5, level: 25, stat: 'ATK', substats: [] }] }
    expect((await convertWavescanExport(source)).document.echoes[0].name).toBe('Baby Roseshroom')
  })
})
