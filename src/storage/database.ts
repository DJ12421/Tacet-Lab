import Dexie, { type EntityTable } from 'dexie'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { defaultSettings, GAME_DATA_VERSION, statLabels } from '../game-data/core'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { effectiveSubStats, maxSubStatsForLevel, normalizeEchoMainStat } from '../game-data/echo-main-stats'
import type { AccountDocument, AppSettings, Build, Echo, OwnedCharacter, OwnedWeapon, Team } from '../domain/types'
import { createLocalId } from '../domain/id'

type SettingsRow = AppSettings & { id: 'settings' }

class TacetDatabase extends Dexie {
  echoes!: EntityTable<Echo, 'id'>
  characters!: EntityTable<OwnedCharacter, 'id'>
  weapons!: EntityTable<OwnedWeapon, 'id'>
  builds!: EntityTable<Build, 'id'>
  teams!: EntityTable<Team, 'id'>
  settings!: EntityTable<SettingsRow, 'id'>

  constructor() {
    super('tacet-lab')
    this.version(1).stores({
      echoes: 'id, name, cost, sonata, locked, excluded, equippedBy, createdAt',
      builds: 'id, resonatorId, weaponId',
      teams: 'id',
      settings: 'id'
    })
    this.version(2).stores({
      echoes: 'id, name, cost, sonata, locked, excluded, equippedBy, createdAt',
      characters: 'id, catalogId, level, sequence, locked, createdAt',
      weapons: 'id, catalogId, level, rank, locked, equippedBy, createdAt',
      builds: 'id, resonatorId, weaponId', teams: 'id', settings: 'id'
    })
    this.version(3).stores({
      echoes: 'id, name, cost, sonata, locked, excluded, equippedBy, createdAt',
      characters: 'id, catalogId, level, sequence, locked, createdAt',
      weapons: 'id, catalogId, level, rank, locked, equippedBy, createdAt',
      builds: 'id, resonatorId, weaponId', teams: 'id', settings: 'id'
    })
    this.version(4).stores({
      echoes: 'id, name, cost, sonata, locked, excluded, equippedBy, createdAt',
      characters: 'id, catalogId, level, sequence, locked, createdAt',
      weapons: 'id, catalogId, level, rank, locked, equippedBy, createdAt',
      builds: 'id, resonatorId, weaponId', teams: 'id', settings: 'id'
    })
  }
}

export const db = new TacetDatabase()

const normalizedIdentity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
let namedEchoAssignmentsRepaired = false

export async function setBuildEchoIds(buildId: string, requestedIds: string[]) {
  const echoIds = [...new Set(requestedIds)]
  if (echoIds.length > 5) throw new Error('A build can equip at most five Echoes.')
  await db.transaction('rw', [db.echoes, db.builds], async () => {
    const build = await db.builds.get(buildId)
    if (!build) throw new Error('The selected build no longer exists.')
    const selected = echoIds.length ? await db.echoes.where('id').anyOf(echoIds).toArray() : []
    if (selected.length !== echoIds.length) throw new Error('One or more selected Echoes no longer exist.')
    if (selected.some((echo) => echo.equippedBy && echo.equippedBy !== buildId)) throw new Error('One or more selected Echoes belong to another build.')
    if (selected.reduce((total, echo) => total + echo.cost, 0) > 12) throw new Error('This loadout exceeds the 12-cost limit.')
    const characterName = characterCatalog.find((entry) => entry.id === build.resonatorId)?.name
    await db.echoes.where('equippedBy').equals(buildId).modify({ equippedBy: undefined, equippedByName: undefined })
    if (echoIds.length) await db.echoes.where('id').anyOf(echoIds).modify({ equippedBy: buildId, equippedByName: characterName })
    await db.builds.update(buildId, { echoIds })
  })
}

export async function repairEchoAssignmentConsistency() {
  await db.transaction('rw', [db.echoes, db.builds], async () => {
    const [echoes, builds] = await Promise.all([db.echoes.toArray(), db.builds.toArray()])
    const echoById = new Map(echoes.map((echo) => [echo.id, echo]))
    const claimedBy = new Map<string, string>()
    for (const build of builds) {
      const echoIds = [...new Set(build.echoIds)].filter((id) => echoById.has(id) && !claimedBy.has(id)).slice(0, 5)
      echoIds.forEach((id) => claimedBy.set(id, build.id))
      if (echoIds.length !== build.echoIds.length || echoIds.some((id, index) => id !== build.echoIds[index])) await db.builds.update(build.id, { echoIds })
    }
    const buildById = new Map(builds.map((build) => [build.id, build]))
    for (const echo of echoes) {
      const buildId = claimedBy.get(echo.id)
      if (!buildId) {
        if (echo.equippedBy) await db.echoes.update(echo.id, { equippedBy: undefined, equippedByName: undefined })
        continue
      }
      const characterName = characterCatalog.find((entry) => entry.id === buildById.get(buildId)?.resonatorId)?.name
      if (echo.equippedBy !== buildId || echo.equippedByName !== characterName) await db.echoes.update(echo.id, { equippedBy: buildId, equippedByName: characterName })
    }
  })
}

export async function setOwnedWeaponOwner(weaponId: string, characterId?: string) {
  await db.transaction('rw', [db.weapons, db.characters, db.builds], async () => {
    const weapon = await db.weapons.get(weaponId)
    if (!weapon) throw new Error('The selected weapon no longer exists.')
    await db.builds.where('weaponId').equals(weaponId).modify({ weaponId: '' })
    if (!characterId) {
      await db.weapons.update(weaponId, { equippedBy: undefined })
      return
    }
    const character = await db.characters.get(characterId)
    if (!character) throw new Error('The selected character no longer exists.')
    const characterEntry = characterCatalog.find((entry) => entry.id === character.catalogId)
    const weaponEntry = weaponCatalog.find((entry) => entry.id === weapon.catalogId)
    if (!characterEntry || !weaponEntry || characterEntry.weaponType.toLowerCase() !== weaponEntry.type.toLowerCase()) throw new Error('That weapon type is incompatible with this character.')
    await db.weapons.where('equippedBy').equals(characterId).modify({ equippedBy: undefined })
    await db.weapons.update(weaponId, { equippedBy: characterId })
    const build = await db.builds.where('resonatorId').equals(character.catalogId).first()
    if (build) await db.builds.update(build.id, { weaponId })
    else await db.builds.add({ id: createLocalId(), name: `${characterEntry.name} build`, resonatorId: character.catalogId, weaponId, echoIds: [], level: character.level, skillLevel: character.skillLevels?.[1] ?? 1 })
  })
}

export async function repairWeaponAssignmentConsistency() {
  await db.transaction('rw', [db.weapons, db.characters, db.builds], async () => {
    const [weapons, characters, builds] = await Promise.all([db.weapons.toArray(), db.characters.toArray(), db.builds.toArray()])
    const weaponById = new Map(weapons.map((weapon) => [weapon.id, weapon]))
    const characterByCatalogId = new Map(characters.map((character) => [character.catalogId, character]))
    const claimedBy = new Map<string, string>()
    for (const build of builds) {
      if (!build.weaponId) continue
      const character = characterByCatalogId.get(build.resonatorId)
      if (!character || !weaponById.has(build.weaponId) || claimedBy.has(build.weaponId)) {
        await db.builds.update(build.id, { weaponId: '' })
        continue
      }
      claimedBy.set(build.weaponId, character.id)
    }
    for (const weapon of weapons) {
      const characterId = claimedBy.get(weapon.id)
      if (weapon.equippedBy !== characterId) await db.weapons.update(weapon.id, { equippedBy: characterId })
    }
  })
}

export async function repairNamedEchoAssignments() {
  if (namedEchoAssignmentsRepaired) return
  await db.transaction('rw', [db.echoes, db.characters, db.builds], async () => {
    const [echoes, characters, builds] = await Promise.all([db.echoes.toArray(), db.characters.toArray(), db.builds.toArray()])
    for (const character of characters) {
      const catalog = characterCatalog.find((entry) => entry.id === character.catalogId)
      if (!catalog) continue
      const unlinked = echoes.filter((echo) => !echo.equippedBy && normalizedIdentity(echo.equippedByName ?? '') === normalizedIdentity(catalog.name))
      if (!unlinked.length) continue
      let build = builds.find((entry) => entry.resonatorId === character.catalogId)
      if (!build) {
        build = {
          id: createLocalId(), name: `${catalog.name} build`, resonatorId: character.catalogId, weaponId: '', echoIds: [],
          level: character.level, skillLevel: character.skillLevels?.[1] ?? 1
        }
        await db.builds.add(build)
        builds.push(build)
      }
      const availableSlots = Math.max(0, 5 - build.echoIds.length)
      const additions = unlinked.sort((left, right) => right.createdAt - left.createdAt).slice(0, availableSlots).sort((left, right) => left.createdAt - right.createdAt)
      if (!additions.length) continue
      const echoIds = [...build.echoIds, ...additions.map((echo) => echo.id)]
      await db.builds.update(build.id, { echoIds })
      await Promise.all(additions.map((echo) => db.echoes.update(echo.id, { equippedBy: build!.id })))
      build.echoIds = echoIds
    }
  })
  namedEchoAssignmentsRepaired = true
}

export async function requestPersistentStorage(): Promise<boolean | undefined> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return undefined
  if (navigator.storage.persisted && await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

export async function ensureSeedData() {
  await db.transaction('rw', [db.settings, db.echoes], async () => {
    if (!(await db.settings.get('settings'))) await db.settings.put({ id: 'settings', ...structuredClone(defaultSettings) })
    await db.echoes.toCollection().modify((echo) => { echo.mainStat = normalizeEchoMainStat(echo); echo.subStats = effectiveSubStats(echo) })
  })
}

export async function getSettings(): Promise<AppSettings> {
  const row = await db.settings.get('settings')
  if (!row) return structuredClone(defaultSettings)
  const { id: _, ...settings } = row
  return { ...structuredClone(defaultSettings), ...settings }
}

export async function saveSettings(settings: AppSettings) {
  await db.settings.put({ id: 'settings', ...settings })
}

export async function exportAccount(): Promise<AccountDocument> {
  return {
    schemaVersion: 4,
    gameDataVersion: GAME_DATA_VERSION,
    exportedAt: new Date().toISOString(),
    echoes: (await db.echoes.toArray()).map((echo) => ({ ...echo, subStats: effectiveSubStats(echo) })),
    characters: await db.characters.toArray(),
    weapons: await db.weapons.toArray(),
    builds: await db.builds.toArray(),
    teams: await db.teams.toArray(),
    settings: await getSettings()
  }
}

export function validateAccount(value: unknown): value is AccountDocument {
  if (!isRecord(value) || ![1, 2, 3, 4].includes(Number(value.schemaVersion)) || typeof value.gameDataVersion !== 'string' || typeof value.exportedAt !== 'string') return false
  return Array.isArray(value.echoes) && value.echoes.every(isEcho)
    && (value.schemaVersion === 1 || (Array.isArray(value.characters) && value.characters.every(isOwnedCharacter)))
    && (value.schemaVersion === 1 || (Array.isArray(value.weapons) && value.weapons.every(isOwnedWeapon)))
    && Array.isArray(value.builds) && value.builds.every(isBuild)
    && Array.isArray(value.teams) && value.teams.every(isTeam)
    && isSettings(value.settings)
}

export async function importAccount(document: AccountDocument) {
  if (!validateAccount(document)) throw new Error('The account backup is invalid or unsupported.')
  await db.transaction('rw', [db.echoes, db.characters, db.weapons, db.builds, db.teams, db.settings], async () => {
    await Promise.all([db.echoes.clear(), db.characters.clear(), db.weapons.clear(), db.builds.clear(), db.teams.clear(), db.settings.clear()])
    await db.echoes.bulkPut(document.echoes.map((echo) => ({ ...echo, mainStat: normalizeEchoMainStat(echo), subStats: effectiveSubStats(echo), source: 'import' })))
    await db.characters.bulkPut(document.characters ?? [])
    await db.weapons.bulkPut(document.weapons ?? [])
    await db.builds.bulkPut(document.builds)
    await db.teams.bulkPut(document.teams)
    await saveSettings(document.settings)
  })
}

function isOwnedCharacter(value: unknown) {
  return isRecord(value) && typeof value.id === 'string' && typeof value.catalogId === 'string'
    && isFiniteNumber(value.level) && value.level >= 1 && value.level <= 90
    && isFiniteNumber(value.sequence) && value.sequence >= 0 && value.sequence <= 6
    && typeof value.locked === 'boolean'
    && (value.favorite === undefined || typeof value.favorite === 'boolean')
    && (value.skillLevels === undefined || (Array.isArray(value.skillLevels) && value.skillLevels.length === 5 && value.skillLevels.every((level) => isFiniteNumber(level) && level >= 1 && level <= 10)))
    && (value.enabledSkillTreeBonusIds === undefined || (Array.isArray(value.enabledSkillTreeBonusIds) && value.enabledSkillTreeBonusIds.every((id) => typeof id === 'string') && new Set(value.enabledSkillTreeBonusIds).size === value.enabledSkillTreeBonusIds.length))
    && isFiniteNumber(value.createdAt)
}

function isOwnedWeapon(value: unknown) {
  return isRecord(value) && typeof value.id === 'string' && typeof value.catalogId === 'string'
    && isFiniteNumber(value.level) && value.level >= 1 && value.level <= 90
    && isFiniteNumber(value.rank) && value.rank >= 1 && value.rank <= 5
    && typeof value.locked === 'boolean' && (value.equippedBy === undefined || typeof value.equippedBy === 'string')
    && isFiniteNumber(value.createdAt)
}

export async function clearAccount() {
  await db.delete()
  await db.open()
  await ensureSeedData()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStatLine(value: unknown) {
  return isRecord(value) && typeof value.key === 'string' && value.key in statLabels && isFiniteNumber(value.value)
}

function isEcho(value: unknown) {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && typeof value.name === 'string'
    && [1, 3, 4].includes(Number(value.cost)) && [1, 2, 3, 4, 5].includes(Number(value.rarity))
    && isFiniteNumber(value.level) && value.level >= 0 && value.level <= 25
    && typeof value.sonata === 'string' && isStatLine(value.mainStat)
    && Array.isArray(value.subStats) && value.subStats.length <= maxSubStatsForLevel(value.level) && value.subStats.every(isStatLine)
    && typeof value.locked === 'boolean' && typeof value.excluded === 'boolean'
    && (value.equippedBy === undefined || typeof value.equippedBy === 'string')
    && (value.equippedByName === undefined || typeof value.equippedByName === 'string')
    && isFiniteNumber(value.createdAt) && ['scan', 'screenshot', 'manual', 'import'].includes(String(value.source))
}

function isBuild(value: unknown) {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
    && typeof value.resonatorId === 'string' && typeof value.weaponId === 'string'
    && Array.isArray(value.echoIds) && value.echoIds.length <= 5 && value.echoIds.every((id) => typeof id === 'string')
    && new Set(value.echoIds).size === value.echoIds.length
    && isFiniteNumber(value.level) && value.level >= 1 && value.level <= 90
    && isFiniteNumber(value.skillLevel) && value.skillLevel >= 1 && value.skillLevel <= 10
}

function isTeam(value: unknown) {
  if (!isRecord(value) || !isRecord(value.enemy)) return false
  return typeof value.id === 'string' && typeof value.name === 'string'
    && Array.isArray(value.buildIds) && value.buildIds.length <= 3 && value.buildIds.every((id) => typeof id === 'string')
    && new Set(value.buildIds).size === value.buildIds.length
    && isFiniteNumber(value.rotationDuration) && value.rotationDuration > 0
    && isFiniteNumber(value.enemy.level) && value.enemy.level >= 1
    && isFiniteNumber(value.enemy.resistance) && value.enemy.resistance >= -100 && value.enemy.resistance <= 100
    && isFiniteNumber(value.enemy.damageReduction) && value.enemy.damageReduction >= 0 && value.enemy.damageReduction <= 100
    && Array.isArray(value.actions) && value.actions.every((action) => isRecord(action) && typeof action.id === 'string'
      && typeof action.buildId === 'string' && typeof action.attackId === 'string' && isFiniteNumber(action.timestamp)
      && (action.formulaTargetId === undefined || typeof action.formulaTargetId === 'string')
      && (action.inputs === undefined || (isRecord(action.inputs) && Object.values(action.inputs).every((input) => isFiniteNumber(input) || typeof input === 'string' || typeof input === 'boolean'))))
    && (value.buffs === undefined || (Array.isArray(value.buffs) && value.buffs.every((buff) => isRecord(buff)
      && typeof buff.id === 'string' && typeof buff.sourceBuildId === 'string' && typeof buff.triggerAttackId === 'string'
      && ['self', 'next', 'team'].includes(String(buff.target))
      && typeof buff.stat === 'string' && (buff.stat === 'amplify' || buff.stat in statLabels)
      && typeof buff.stackingGroup === 'string' && isFiniteNumber(buff.duration) && buff.duration >= 0 && isFiniteNumber(buff.value))))
    && (value.scenario === undefined || isTeamScenario(value.scenario))
}

function isTeamScenario(value: unknown) {
  if (!isRecord(value) || !['normal', 'expected', 'critical'].includes(String(value.resultMode))) return false
  const validValue = (entry: unknown) => isFiniteNumber(entry) || typeof entry === 'string' || typeof entry === 'boolean'
  return isRecord(value.memberConditions) && Object.values(value.memberConditions).every((conditions) => isRecord(conditions) && Object.values(conditions).every(validValue))
    && isRecord(value.enemyConditions) && Object.values(value.enemyConditions).every(validValue)
    && isRecord(value.selectedTargetByBuild) && Object.values(value.selectedTargetByBuild).every((target) => typeof target === 'string')
    && (value.compareBuildId === undefined || typeof value.compareBuildId === 'string')
}

function isSettings(value: unknown) {
  return isRecord(value) && typeof value.displayName === 'string' && typeof value.privacyMode === 'boolean'
    && ['signal', 'tacet', 'plain'].includes(String(value.background))
    && (value.roverGender === undefined || ['male', 'female'].includes(String(value.roverGender)))
    && isFiniteNumber(value.scanIntervalMs) && value.scanIntervalMs >= 250 && value.scanIntervalMs <= 10_000
    && isRecord(value.scoreWeights) && Object.values(value.scoreWeights).every((weights) => isRecord(weights)
      && Object.entries(weights).every(([key, weight]) => key in statLabels && isFiniteNumber(weight)))
    && (value.characterSubstatWeights === undefined || (isRecord(value.characterSubstatWeights)
      && Object.values(value.characterSubstatWeights).every((weights) => isRecord(weights)
        && Object.entries(weights).every(([key, weight]) => key in statLabels && isFiniteNumber(weight) && weight >= 0 && weight <= 4))))
}
