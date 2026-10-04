import type { AccountDocument, Build, Echo, EquippedLoadout, OwnedCharacter, OwnedWeapon, StatKey, StatLine } from '../domain/types'
import { characterSummaries, echoCatalog, sonataCatalog, weaponSummaries } from '../game-data'
import { defaultSettings, GAME_DATA_VERSION } from '../game-data/core'
import { isMainStatAllowed, maxLevelByRarity, normalizeEchoMainStat } from '../game-data/echo-main-stats'
import { db } from './database'

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
const characterNames = new Map(characterSummaries.map((character) => [key(character.name), character]))
const weaponNames = new Map(weaponSummaries.map((weapon) => [key(weapon.name), weapon]))
const roverSpectro = characterSummaries.find((character) => character.name === 'Rover: Spectro' && character.gender === 'male')

export interface WutheringToolsCharacterChoice {
  catalogId: string
  name: string
  existing: boolean
  addAsNewBuild: boolean
}

export function isWutheringToolsExport(value: unknown): value is RecordValue {
  return record(value) && record(value.meta) && value.meta.source === 'WutheringTools'
}

export async function convertWutheringToolsExport(value: RecordValue, addAsNewBuild: Record<string, boolean> = {}): Promise<{ document: AccountDocument; notices: string[]; choices: WutheringToolsCharacterChoice[] }> {
  const meta = value.meta
  if (!record(meta) || String(meta.version) !== '9') throw new Error(`Wuthering Tools version ${String(record(meta) ? meta.version : 'missing')} is not supported yet.`)
  const data = value.data
  if (!record(data) || typeof data.character !== 'string') throw new Error('This Wuthering Tools export has no character data.')
  let characterData: unknown
  try { characterData = JSON.parse(data.character) } catch { throw new Error('The character data inside this Wuthering Tools export is invalid JSON.') }
  if (!record(characterData) || !record(characterData.characters)) throw new Error('This Wuthering Tools export has no character list.')

  const [ownedCharacters, ownedWeapons, currentBuilds, currentLoadouts, ownedEchoes] = await Promise.all([
    db.characters.toArray(), db.weapons.toArray(), db.builds.toArray(), db.equippedLoadouts.toArray(), db.echoes.toArray()
  ])
  const currentEchoes = new Map(ownedEchoes.map((echo) => [echo.id, echo]))
  const echoes: Echo[] = []
  const characters: OwnedCharacter[] = []
  const weapons: OwnedWeapon[] = []
  const builds: Build[] = []
  const equippedLoadouts: EquippedLoadout[] = []
  const choices: WutheringToolsCharacterChoice[] = []
  const notices: string[] = []
  const createdAt = Date.now()
  for (const [characterName, character] of Object.entries(characterData.characters)) {
    if (!record(character)) continue
    const isRoverSpectro = /^roverspectro(?:male|female)?$/.test(key(characterName))
    const catalogCharacter = isRoverSpectro ? roverSpectro : characterNames.get(key(characterName))
    if (!catalogCharacter) { notices.push(`${characterName}: skipped because this character is missing from Tacet Lab's catalog.`); continue }
    const activeBuild = Array.isArray(character.builds) ? character.builds.find((build) => record(build) && build.id === character.activeBuildId) : undefined
    const slots: unknown[] = Array.isArray(character.echoes) ? character.echoes : record(character.echoes) ? Object.values(character.echoes) : []
    const buildSlots = record(activeBuild) ? activeBuild.echoes : undefined
    const sourceSlots: unknown[] = slots.some((slot) => record(slot) && typeof slot.echo === 'string') ? slots
      : Array.isArray(buildSlots) ? buildSlots : record(buildSlots) ? Object.values(buildSlots) : []
    if (sourceSlots.length > 5 || sourceSlots.reduce<number>((sum, slot) => sum + (record(slot) && typeof slot.echo === 'string' && typeof slot.type === 'number' ? slot.type : 0), 0) > 12) {
      notices.push(`${characterName}: skipped because this build exceeds five Echoes or 12 Echo cost.`)
      continue
    }
    const weaponName = typeof character.weapon === 'string' ? character.weapon : record(activeBuild) && typeof activeBuild.weapon === 'string' ? activeBuild.weapon : ''
    const namedWeapon = weaponNames.get(key(weaponName))
    const catalogWeapon = namedWeapon && key(namedWeapon.type) === key(catalogCharacter.weaponType) ? namedWeapon
      : weaponSummaries.find((weapon) => weapon.rarity === 1 && weapon.name.startsWith('Training ') && key(weapon.type) === key(catalogCharacter.weaponType))
    if (!catalogWeapon) { notices.push(`${characterName}: skipped because no compatible weapon exists in Tacet Lab's catalog.`); continue }
    const ownedCharacter = ownedCharacters.find((entry) => entry.catalogId === catalogCharacter.id || (isRoverSpectro && characterSummaries.some((candidate) => candidate.id === entry.catalogId && candidate.name === 'Rover: Spectro')))
    const catalogId = ownedCharacter?.catalogId ?? catalogCharacter.id
    const characterId = ownedCharacter?.id ?? `wuthering-tools:character:${catalogId}`
    const currentLoadout = currentLoadouts.find((entry) => entry.characterId === characterId)
    const hasExportedGear = sourceSlots.some((slot) => record(slot) && typeof slot.echo === 'string') || Boolean(namedWeapon && namedWeapon.id === catalogWeapon.id)
    if (!hasExportedGear && ownedCharacter) {
      notices.push(`${characterName}: already owned; no gear in the export, so existing data is unchanged.`)
      continue
    }
    const hasCurrentBuild = Boolean(hasExportedGear && ownedCharacter && (currentLoadout || currentBuilds.some((build) => build.characterId === characterId || build.resonatorId === catalogId)))
    const saveSecondBuild = hasCurrentBuild && (addAsNewBuild[catalogId] ?? true)
    choices.push({ catalogId, name: catalogCharacter.name, existing: hasCurrentBuild, addAsNewBuild: saveSecondBuild })
    const now = createdAt + choices.length
    if (!ownedCharacter) characters.push({
      id: characterId, catalogId, level: 90, sequence: 0, locked: false,
      skillLevels: [10, 10, 10, 10, 10], createdAt: now
    })
    const importedWeaponId = `wuthering-tools:weapon:${catalogId}:${catalogWeapon.id}`
    const existingWeapon = ownedWeapons.find((weapon) => weapon.id === importedWeaponId && weapon.catalogId === catalogWeapon.id)
      ?? ownedWeapons.find((weapon) => weapon.catalogId === catalogWeapon.id && (weapon.equippedBy === characterId || !weapon.equippedBy))
    const weaponId = existingWeapon?.id ?? importedWeaponId
    if (!existingWeapon) weapons.push({
      id: weaponId, catalogId: catalogWeapon.id, level: 90, rank: 1, locked: false,
      equippedBy: saveSecondBuild ? undefined : characterId, createdAt: now
    })
    const echoIds: string[] = []
    const unmatchedEchoSlots: number[] = []
    for (const [slot, source] of sourceSlots.entries()) {
      if (!record(source) || typeof source.echo !== 'string') continue
      const context = `${characterName}, Echo ${slot + 1}`
      const catalogEcho = echoNames.get(key(source.echo))
      const sonata = typeof source.echoSet === 'string' ? sonataNames.get(key(source.echoSet)) : undefined
      const mainKey = typeof source.stat === 'string' ? statKeys[key(source.stat)] : undefined
      const cost = source.type
      const rarity = source.rank
      if (!catalogEcho || !sonata || !mainKey || ![1, 3, 4].includes(Number(cost)) || ![1, 2, 3, 4, 5].includes(Number(rarity))
        || catalogEcho.cost !== cost || !catalogEcho.sonatas.includes(sonata) || !isMainStatAllowed(cost as Echo['cost'], mainKey)) {
        unmatchedEchoSlots.push(slot + 1)
        continue
      }
      const subStats: StatLine[] = []
      let invalid = false
      for (let index = 1; index <= 5; index++) {
        const type = source[`echoSubStatsType${index}`]
        const amount = source[`echoSubStatsValue${index}`]
        if (type == null && amount == null) continue
        const statKey = typeof type === 'string' ? statKeys[key(type)] : undefined
        if (!statKey || typeof amount !== 'number' || !Number.isFinite(amount) || subStats.some((stat) => stat.key === statKey)) { invalid = true; break }
        subStats.push({ key: statKey, value: amount })
      }
      if (invalid) { notices.push(`${context}: skipped because a substat is unknown, invalid, or repeated.`); continue }
      if (subStats.length * 5 > maxLevelByRarity[rarity as Echo['rarity']]) {
        notices.push(`${context}: skipped because its substat count exceeds its rarity's maximum level.`)
        continue
      }
      const level = subStats.length * 5
      if (level < 25) notices.push(`${context}: level was not exported; set to the minimum level implied by its ${subStats.length} substats (+${level}).`)
      const id = `wuthering-tools:${encodeURIComponent(characterName)}:${slot}`
      const existing = currentEchoes.get(id)
      const echo: Echo = {
        id, name: catalogEcho.name, cost: cost as Echo['cost'], rarity: rarity as Echo['rarity'], level,
        sonata, mainStat: { key: mainKey, value: 0 }, subStats,
        locked: existing?.locked ?? false, excluded: existing?.excluded ?? false,
        equippedBy: existing?.equippedBy, equippedByName: existing?.equippedByName,
        createdAt: existing?.createdAt ?? createdAt + echoes.length,
        source: 'import'
      }
      echo.mainStat = normalizeEchoMainStat(echo)
      echoes.push(echo)
      echoIds.push(id)
    }
    if (unmatchedEchoSlots.length) notices.push(`${characterName}: Echo ${unmatchedEchoSlots.length === 1 ? 'slot' : 'slots'} ${unmatchedEchoSlots.join(', ')} could not be matched and ${unmatchedEchoSlots.length === 1 ? 'was' : 'were'} skipped.`)
    if (!hasExportedGear) {
      equippedLoadouts.push({ id: `equipped:${characterId}`, characterId, weaponId, echoIds: [], updatedAt: now })
    } else if (saveSecondBuild) {
      const id = `wuthering-tools:build:${catalogId}`
      const existingBuild = currentBuilds.find((build) => build.id === id)
      const usedNames = new Set(currentBuilds.filter((build) => build.characterId === characterId || build.resonatorId === catalogId).map((build) => build.name))
      let number = 2
      while (!existingBuild && usedNames.has(`Build ${number}`)) number++
      builds.push({
        id, name: existingBuild?.name ?? `Build ${number}`, description: existingBuild?.description ?? '',
        characterId, resonatorId: catalogId, weaponId, echoIds,
        // This is an explicitly saved snapshot, so the legacy imported-build cleanup must retain it.
        level: ownedCharacter?.level ?? 90, skillLevel: ownedCharacter?.skillLevels?.[1] ?? 10,
        createdAt: existingBuild?.createdAt ?? now, updatedAt: existingBuild?.updatedAt ?? now, source: 'manual'
      })
    } else {
      const sameLoadout = currentLoadout && currentLoadout.weaponId === weaponId && currentLoadout.echoIds.length === echoIds.length
        && currentLoadout.echoIds.every((id, index) => id === echoIds[index])
      equippedLoadouts.push({ id: currentLoadout?.id ?? `equipped:${characterId}`, characterId, weaponId, echoIds, updatedAt: sameLoadout ? currentLoadout.updatedAt : now })
    }
  }
  notices.unshift(choices.length
    ? 'New characters and weapons default to level 90, skills 10, S0, and R1. Existing progression is preserved. Missing weapons use a matching 1-star Training weapon. Echo levels are inferred from substats; buffs and calculator settings are not imported.'
    : 'No new character or build data was found; no account data will change.')
  const document: AccountDocument = {
    schemaVersion: 7, gameDataVersion: GAME_DATA_VERSION, exportedAt: new Date().toISOString(),
    echoes, characters, weapons, builds, equippedLoadouts, theorycraftBuilds: [], teams: [], settings: defaultSettings
  }
  return { document, notices, choices }
}
