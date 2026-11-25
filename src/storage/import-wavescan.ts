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
echoNames.set('youngroseshroom', echoNames.get('babyroseshroom')!)
const sonataNames = new Map(sonataCatalog.map((sonata) => [key(sonata.name), sonata.name]))

export function isWavescanExport(value: unknown): value is Row {
  return isRow(value) && (value.format === 'WutheringToolsScan' || value.format === 'WaveScan')
}

export async function convertWavescanExport(value: Row, overwrite = false): Promise<{ document: AccountDocument; notices: string[] }> {
  if (value.version !== 1 || !Array.isArray(value.echoes) || !isRow(value.meta) ||
      typeof value.meta.scannedAt !== 'string' || Number.isNaN(Date.parse(value.meta.scannedAt))) {
    throw new Error('This WaveScan export is invalid or has an unsupported version.')
  }
  const scannedAt = value.meta.scannedAt
  const current = new Map<string, Echo>(overwrite ? [] : (await db.echoes.toArray()).map((echo) => [echo.id, echo]))
  const ids = new Set<string>()
  const notices: string[] = ['WaveScan equipment names are not applied to characters; assign imported Echoes in Tacet Lab after import.']
  let skipped = 0
  const echoes = value.echoes.flatMap((source, index): Echo[] => {
    const invalid = () => { throw new Error(`WaveScan Echo ${index + 1} has missing or unsupported details.`) }
    try {
    if (!isRow(source) || typeof source.scanId !== 'string' || !source.scanId || ids.has(source.scanId) ||
        typeof source.echo !== 'string' || typeof source.echoSet !== 'string' || typeof source.stat !== 'string' ||
        !Array.isArray(source.substats) || ![1, 3, 4].includes(source.cost as number) ||
        ![1, 2, 3, 4, 5].includes(source.rank as number) || !Number.isInteger(source.level as number) ||
        (source.level as number) < 0 || (source.level as number) > maxLevelByRarity[source.rank as Echo['rarity']] ||
        source.substats.length > maxSubStatsForLevel(source.level as number)) return invalid()
    const phantom = key(source.echo).startsWith('phantom')
    const catalog = echoNames.get(key(source.echo)) ?? (phantom ? echoNames.get(key(source.echo.slice(7))) : undefined)
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
    const id = `wavescan:${encodeURIComponent(scannedAt)}:${encodeURIComponent(source.scanId)}`
    const existing = current.get(id)
    const echo: Echo = {
      id, name: catalog.name, cost: catalog.cost, rarity: source.rank as Echo['rarity'], level: source.level as number,
      sonata, mainStat: { key: mainKey, value: 0 }, subStats,
      locked: existing?.locked ?? false, excluded: existing?.excluded ?? false,
      equippedBy: existing?.equippedBy, equippedByName: existing?.equippedByName,
      createdAt: existing?.createdAt ?? Date.now() + index, source: 'import'
    }
    echo.mainStat = normalizeEchoMainStat(echo)
    ids.add(source.scanId)
    if (phantom) notices.push(`WaveScan Echo ${index + 1}: Phantom ${catalog.name} was imported as ${catalog.name}.`)
    return [echo]
    } catch (error) {
      if (!(error instanceof Error) || error.message !== `WaveScan Echo ${index + 1} has missing or unsupported details.`) throw error
      skipped++
      notices.push(`WaveScan Echo ${index + 1}${isRow(source) && typeof source.scanId === 'string' ? ` (${source.scanId})` : ''} was skipped: ${isRow(source) && source.echoSet === null ? 'Sonata set is unconfirmed.' : 'Missing or unsupported details.'}`)
      return []
    }
  })
  if (skipped === value.echoes.length && skipped > 0) throw new Error('No WaveScan Echoes could be imported. Check the Echo details and try again.')
  if (skipped && overwrite) throw new Error('This WaveScan export contains skipped Echoes. Turn off overwrite and cleanup options to import the valid Echoes safely.')
  if (skipped) notices.unshift(`${skipped} of ${value.echoes.length} WaveScan Echoes were skipped. Review the details below before importing.`)
  return {
    document: { schemaVersion: 7, gameDataVersion: GAME_DATA_VERSION, exportedAt: scannedAt,
      echoes, characters: [], weapons: [], builds: [], equippedLoadouts: [], theorycraftBuilds: [], teams: [], settings: defaultSettings },
    notices
  }
}
