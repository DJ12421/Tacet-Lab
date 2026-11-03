import type { AccountDocument, Echo, StatKey, StatLine } from '../domain/types'
import { echoCatalog, sonataCatalog } from '../game-data'
import { defaultSettings, GAME_DATA_VERSION } from '../game-data/core'
import { isMainStatAllowed, maxLevelByRarity, maxSubStatsForLevel, normalizeEchoMainStat } from '../game-data/echo-main-stats'
import { db } from './database'

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const statKeys: Record<string, StatKey> = {
  hp: 'hpPercent', atk: 'atkPercent', def: 'defPercent', hpflat: 'hp', atkflat: 'atk', defflat: 'def',
  critrate: 'critRate', critdmg: 'critDamage', energyregen: 'energyRegen',
  basicattackdmgbonus: 'basicDamage', heavyattackdmgbonus: 'heavyDamage',
  resonanceskilldmgbonus: 'skillDamage', resonanceliberationdmgbonus: 'liberationDamage',
  spectro: 'spectroDamage', fusion: 'fusionDamage', glacio: 'glacioDamage',
  electro: 'electroDamage', aero: 'aeroDamage', havoc: 'havocDamage', healingbonus: 'healingBonus'
}
const echoNames = new Map(echoCatalog.map((echo) => [key(echo.name), echo]))
const sonataNames = new Map(sonataCatalog.map((sonata) => [key(sonata.name), sonata.name]))

export function isWavescanExport(value: unknown): value is Row {
  return isRow(value) && value.format === 'WutheringToolsScan'
}

export async function convertWavescanExport(value: Row): Promise<{ document: AccountDocument; notices: string[] }> {
  if (value.version !== 1 || !Array.isArray(value.echoes) || !isRow(value.meta) ||
      typeof value.meta.scannedAt !== 'string' || Number.isNaN(Date.parse(value.meta.scannedAt))) {
    throw new Error('This WaveScan export is invalid or has an unsupported version.')
  }
  const current = new Map((await db.echoes.toArray()).map((echo) => [echo.id, echo]))
  const ids = new Set<string>()
  const echoes = value.echoes.map((source, index): Echo => {
    const invalid = () => { throw new Error(`WaveScan Echo ${index + 1} has missing or unsupported details.`) }
    if (!isRow(source) || typeof source.scanId !== 'string' || !source.scanId || ids.has(source.scanId) ||
        typeof source.echo !== 'string' || typeof source.echoSet !== 'string' || typeof source.stat !== 'string' ||
        !Array.isArray(source.substats) || ![1, 3, 4].includes(source.cost as number) ||
        ![1, 2, 3, 4, 5].includes(source.rank as number) || !Number.isInteger(source.level as number) ||
        (source.level as number) < 0 || (source.level as number) > maxLevelByRarity[source.rank as Echo['rarity']] ||
        source.substats.length > maxSubStatsForLevel(source.level as number)) return invalid()
    ids.add(source.scanId)
    const catalog = echoNames.get(key(source.echo))
    const sonata = sonataNames.get(key(source.echoSet))
    const mainKey = statKeys[key(source.stat)]
    if (!catalog || !sonata || !mainKey || catalog.cost !== source.cost ||
        !catalog.sonatas.includes(sonata) || !isMainStatAllowed(catalog.cost, mainKey)) return invalid()
    const subStats: StatLine[] = source.substats.map((line) => {
      if (!isRow(line) || typeof line.type !== 'string' || typeof line.value !== 'number' ||
          !Number.isFinite(line.value) || line.value <= 0) return invalid()
      const statKey = statKeys[key(line.type)]
      if (!statKey) return invalid()
      return { key: statKey, value: line.value }
    })
    if (new Set(subStats.map((line) => line.key)).size !== subStats.length) return invalid()
    const id = `wavescan:${encodeURIComponent(value.meta.scannedAt as string)}:${encodeURIComponent(source.scanId)}`
    const existing = current.get(id)
    const echo: Echo = {
      id, name: catalog.name, cost: catalog.cost, rarity: source.rank as Echo['rarity'], level: source.level as number,
      sonata, mainStat: { key: mainKey, value: 0 }, subStats,
      locked: existing?.locked ?? false, excluded: existing?.excluded ?? false,
      equippedBy: existing?.equippedBy, equippedByName: existing?.equippedByName,
      createdAt: existing?.createdAt ?? Date.now() + index, source: 'import'
    }
    echo.mainStat = normalizeEchoMainStat(echo)
    return echo
  })
  return {
    document: { schemaVersion: 7, gameDataVersion: GAME_DATA_VERSION, exportedAt: value.meta.scannedAt as string,
      echoes, characters: [], weapons: [], builds: [], equippedLoadouts: [], theorycraftBuilds: [], teams: [], settings: defaultSettings },
    notices: ['WaveScan equipment names are not applied to characters; assign imported Echoes in Tacet Lab after merging.']
  }
}
