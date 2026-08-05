import Dexie, { type EntityTable } from 'dexie'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { defaultSettings, GAME_DATA_VERSION, statLabels } from '../game-data/core'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { effectiveSubStats, maxSubStatsForLevel, normalizeEchoMainStat } from '../game-data/echo-main-stats'
import type { AccountDocument, AppSettings, Build, Echo, OptimizerProfile, OptimizerRun, OwnedCharacter, OwnedWeapon, Team } from '../domain/types'
import { createLocalId } from '../domain/id'

type SettingsRow = AppSettings & { id: 'settings' }

class TacetDatabase extends Dexie {
  echoes!: EntityTable<Echo, 'id'>
  characters!: EntityTable<OwnedCharacter, 'id'>
  weapons!: EntityTable<OwnedWeapon, 'id'>
  builds!: EntityTable<Build, 'id'>
  teams!: EntityTable<Team, 'id'>
  optimizerProfiles!: EntityTable<OptimizerProfile, 'id'>
  optimizerRuns!: EntityTable<OptimizerRun, 'id'>
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
    this.version(5).stores({
      echoes: 'id, name, cost, sonata, locked, excluded, equippedBy, createdAt',
      characters: 'id, catalogId, level, sequence, locked, createdAt',
      weapons: 'id, catalogId, level, rank, locked, equippedBy, createdAt',
      builds: 'id, resonatorId, weaponId', teams: 'id', settings: 'id'
    })
    this.version(6).stores({
      echoes: 'id, name, cost, sonata, locked, excluded, equippedBy, createdAt',
      characters: 'id, catalogId, level, sequence, locked, createdAt',
      weapons: 'id, catalogId, level, rank, locked, equippedBy, createdAt',
      builds: 'id, resonatorId, weaponId', teams: 'id',
      optimizerProfiles: 'id, buildId, updatedAt',
      optimizerRuns: 'id, buildId, profileId, createdAt',
      settings: 'id'
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
    if (selected.reduce((total, echo) => total + echo.cost, 0) > 12) throw new Error('This loadout exceeds the 12-cost limit.')
    const selectedIds = new Set(echoIds)
    const otherBuilds = await db.builds.toArray()
    for (const otherBuild of otherBuilds) {
      if (otherBuild.id === buildId || !otherBuild.echoIds.some((id) => selectedIds.has(id))) continue
      await db.builds.update(otherBuild.id, { echoIds: otherBuild.echoIds.filter((id) => !selectedIds.has(id)) })
    }
    const characterName = characterCatalog.find((entry) => entry.id === build.resonatorId)?.name
    await db.echoes.where('equippedBy').equals(buildId).modify({ equippedBy: undefined, equippedByName: undefined })
    if (echoIds.length) await db.echoes.where('id').anyOf(echoIds).modify({ equippedBy: buildId, equippedByName: characterName })
    await db.builds.update(buildId, { echoIds })
  })
}

export async function switchBuildEcho(buildId: string, slot: number, nextEchoId?: string) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 4) throw new Error('The selected Echo slot is invalid.')
  await db.transaction('rw', [db.echoes, db.builds], async () => {
    const build = await db.builds.get(buildId)
    if (!build) throw new Error('The selected build no longer exists.')
    const oldEchoId = build.echoIds[slot]
    if (oldEchoId === nextEchoId) return

    const nextEcho = nextEchoId ? await db.echoes.get(nextEchoId) : undefined
    if (nextEchoId && !nextEcho) throw new Error('The selected Echo no longer exists.')
    if (nextEchoId && build.echoIds.some((id, index) => id === nextEchoId && index !== slot)) {
      throw new Error('That Echo is already equipped in another slot on this build.')
    }

    const allBuilds = await db.builds.toArray()
    const sourceBuild = nextEchoId
      ? allBuilds.find((candidate) => candidate.id !== buildId && candidate.echoIds.includes(nextEchoId))
      : undefined
    const nextBuildEchoIds = [...build.echoIds]
    if (nextEchoId) {
      if (slot < nextBuildEchoIds.length) nextBuildEchoIds[slot] = nextEchoId
      else nextBuildEchoIds.push(nextEchoId)
    } else if (oldEchoId) {
      nextBuildEchoIds.splice(slot, 1)
    }

    let nextSourceEchoIds: string[] | undefined
    if (sourceBuild && nextEchoId) {
      nextSourceEchoIds = [...sourceBuild.echoIds]
      const sourceSlot = nextSourceEchoIds.indexOf(nextEchoId)
      if (oldEchoId) nextSourceEchoIds[sourceSlot] = oldEchoId
      else nextSourceEchoIds.splice(sourceSlot, 1)
    }

    const echoById = new Map((await db.echoes.toArray()).map((echo) => [echo.id, echo]))
    const loadoutCost = (ids: string[]) => ids.reduce((total, id) => total + (echoById.get(id)?.cost ?? 0), 0)
    if (nextBuildEchoIds.length > 5 || loadoutCost(nextBuildEchoIds) > 12) {
      throw new Error('This switch would make the current build exceed the 12-cost limit.')
    }
    if (nextSourceEchoIds && (nextSourceEchoIds.length > 5 || loadoutCost(nextSourceEchoIds) > 12)) {
      throw new Error('This switch would make the other character exceed the 12-cost limit.')
    }

    const affectedBuilds = [{ ...build, echoIds: nextBuildEchoIds }]
    await db.builds.update(build.id, { echoIds: nextBuildEchoIds })
    if (sourceBuild && nextSourceEchoIds) {
      await db.builds.update(sourceBuild.id, { echoIds: nextSourceEchoIds })
      affectedBuilds.push({ ...sourceBuild, echoIds: nextSourceEchoIds })
    }

    const affectedBuildIds = affectedBuilds.map((candidate) => candidate.id)
    await db.echoes.where('equippedBy').anyOf(affectedBuildIds).modify({ equippedBy: undefined, equippedByName: undefined })
    for (const affectedBuild of affectedBuilds) {
      if (!affectedBuild.echoIds.length) continue
      const characterName = characterCatalog.find((entry) => entry.id === affectedBuild.resonatorId)?.name
      await db.echoes.where('id').anyOf(affectedBuild.echoIds).modify({ equippedBy: affectedBuild.id, equippedByName: characterName })
    }
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
    schemaVersion: 6,
    gameDataVersion: GAME_DATA_VERSION,
    exportedAt: new Date().toISOString(),
    echoes: (await db.echoes.toArray()).map((echo) => ({ ...echo, subStats: effectiveSubStats(echo) })),
    characters: await db.characters.toArray(),
    weapons: await db.weapons.toArray(),
    builds: await db.builds.toArray(),
    teams: await db.teams.toArray(),
    optimizerProfiles: await db.optimizerProfiles.toArray(),
    optimizerRuns: await db.optimizerRuns.toArray(),
    settings: await getSettings()
  }
}

export function validateAccount(value: unknown): value is AccountDocument {
  if (!isRecord(value) || ![1, 2, 3, 4, 5, 6].includes(Number(value.schemaVersion)) || typeof value.gameDataVersion !== 'string' || typeof value.exportedAt !== 'string') return false
  return Array.isArray(value.echoes) && value.echoes.every(isEcho)
    && (value.schemaVersion === 1 || (Array.isArray(value.characters) && value.characters.every(isOwnedCharacter)))
    && (value.schemaVersion === 1 || (Array.isArray(value.weapons) && value.weapons.every(isOwnedWeapon)))
    && Array.isArray(value.builds) && value.builds.every(isBuild)
    && Array.isArray(value.teams) && value.teams.every(isTeam)
    && (Number(value.schemaVersion) < 6 || (Array.isArray(value.optimizerProfiles) && value.optimizerProfiles.every(isOptimizerProfile)))
    && (Number(value.schemaVersion) < 6 || (Array.isArray(value.optimizerRuns) && value.optimizerRuns.every(isOptimizerRun)))
    && isSettings(value.settings)
}

export type AccountImportCollectionKey = 'echoes' | 'characters' | 'weapons' | 'builds' | 'teams' | 'optimizerProfiles' | 'optimizerRuns'

export interface AccountImportCollectionSummary {
  key: AccountImportCollectionKey
  label: string
  current: number
  incoming: number
  added: number
  updated: number
  duplicates: number
  result: number
}

export interface AccountImportPreview {
  schemaVersion: AccountDocument['schemaVersion']
  gameDataVersion: string
  exportedAt: string
  collections: AccountImportCollectionSummary[]
  added: number
  updated: number
  duplicates: number
}

type ImportEntity = Echo | OwnedCharacter | OwnedWeapon | Build | Team | OptimizerProfile | OptimizerRun
type ImportEntityWithId = ImportEntity & { id: string }
type ImportIdMaps = Record<AccountImportCollectionKey, Map<string, string>>
interface PlannedCollection<T extends ImportEntityWithId> {
  summary: AccountImportCollectionSummary
  records: T[]
}

const importCollectionLabels: Record<AccountImportCollectionKey, string> = {
  echoes: 'Echoes',
  characters: 'Characters',
  weapons: 'Weapons',
  builds: 'Builds',
  teams: 'Teams',
  optimizerProfiles: 'Optimizer profiles',
  optimizerRuns: 'Saved optimizer runs'
}

function canonicalImportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalImportValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => value[key] === undefined ? [] : [[key, canonicalImportValue(value[key])]]))
}

function importFingerprint(value: ImportEntityWithId, ignoredKeys: string[] = ['id']) {
  const filtered = Object.fromEntries(Object.entries(value).filter(([key]) => !ignoredKeys.includes(key)))
  return JSON.stringify(canonicalImportValue(filtered))
}

function resolveImportIds<T extends ImportEntityWithId>(
  current: T[],
  incoming: T[],
  identity: (record: T) => string
) {
  const ids = new Map<string, string>()
  const byId = new Map(current.map((record) => [record.id, record]))
  const byIdentity = new Map(current.map((record) => [identity(record), record.id]))
  for (const record of incoming) {
    const targetId = byId.has(record.id) ? record.id : byIdentity.get(identity(record)) ?? record.id
    ids.set(record.id, targetId)
    if (!byId.has(targetId)) {
      const targetRecord = { ...record, id: targetId }
      byId.set(targetId, targetRecord)
      byIdentity.set(identity(targetRecord), targetId)
    }
  }
  return ids
}

function planImportCollection<T extends ImportEntityWithId>(
  key: AccountImportCollectionKey,
  current: T[],
  incoming: T[],
  ids: Map<string, string>,
  remap: (record: T) => T,
  comparisonIgnoredKeys: string[] = ['id']
): PlannedCollection<T> {
  const working = new Map(current.map((record) => [record.id, record]))
  const records: T[] = []
  let added = 0
  let updated = 0
  let duplicates = 0

  for (const source of incoming) {
    const record = { ...remap(source), id: ids.get(source.id) ?? source.id }
    const existing = working.get(record.id)
    if (!existing) {
      added += 1
      records.push(record)
      working.set(record.id, record)
      continue
    }
    if (importFingerprint(existing, comparisonIgnoredKeys) === importFingerprint(record, comparisonIgnoredKeys)) {
      duplicates += 1
      continue
    }
    updated += 1
    records.push(record)
    working.set(record.id, record)
  }

  return {
    summary: { key, label: importCollectionLabels[key], current: current.length, incoming: incoming.length, added, updated, duplicates, result: current.length + added },
    records
  }
}

function remapOptionalId(map: Map<string, string>, id?: string) {
  return id ? map.get(id) ?? id : undefined
}

function remapTeam(team: Team, buildIds: Map<string, string>): Team {
  const remapBuildId = (id: string) => buildIds.get(id) ?? id
  const remapEffectSelections = (selections: Record<string, import('../domain/calculation-v2/types').CalculationEffectSelection>) => Object.fromEntries(
    Object.entries(selections).map(([id, selection]) => [id, { ...selection, recipientBuildId: remapOptionalId(buildIds, selection.recipientBuildId) }])
  )
  const scenario = team.scenario ? {
    ...team.scenario,
    memberConditions: Object.fromEntries(Object.entries(team.scenario.memberConditions).map(([id, value]) => [remapBuildId(id), value])),
    selectedTargetByBuild: Object.fromEntries(Object.entries(team.scenario.selectedTargetByBuild).map(([id, value]) => [remapBuildId(id), value])),
    compareBuildId: remapOptionalId(buildIds, team.scenario.compareBuildId)
  } : undefined
  const calculationV2 = team.calculationV2 ? {
    ...team.calculationV2,
    memberEffects: Object.fromEntries(Object.entries(team.calculationV2.memberEffects).map(([id, value]) => [remapBuildId(id), remapEffectSelections(value)])),
    partyEffects: Object.fromEntries(Object.entries(team.calculationV2.partyEffects).map(([id, value]) => [id, remapEffectSelections(value)])),
    selectedAttackByBuild: Object.fromEntries(Object.entries(team.calculationV2.selectedAttackByBuild).map(([id, value]) => [remapBuildId(id), value]))
  } : undefined
  return {
    ...team,
    buildIds: team.buildIds.map(remapBuildId),
    actions: team.actions.map((action) => ({ ...action, buildId: remapBuildId(action.buildId) })),
    buffs: team.buffs?.map((buff) => ({ ...buff, sourceBuildId: remapBuildId(buff.sourceBuildId) })),
    scenario,
    calculationV2
  }
}

async function createAccountImportPlan(document: AccountDocument) {
  const current = await exportAccount()
  const incomingEchoes = document.echoes.map((echo) => ({ ...echo, mainStat: normalizeEchoMainStat(echo), subStats: effectiveSubStats(echo), source: 'import' as const }))
  const incomingCharacters = document.characters ?? []
  const incomingWeapons = document.weapons ?? []
  const incomingBuilds = document.builds
  const incomingTeams = document.teams
  const incomingProfiles = document.optimizerProfiles ?? []
  const incomingRuns = document.optimizerRuns ?? []

  const maps = {} as ImportIdMaps
  maps.echoes = resolveImportIds(current.echoes, incomingEchoes, (echo) => importFingerprint(echo, ['id', 'source', 'equippedBy', 'equippedByName']))
  maps.characters = resolveImportIds(current.characters, incomingCharacters, (character) => character.catalogId)
  maps.weapons = resolveImportIds(current.weapons, incomingWeapons, (weapon) => importFingerprint(weapon, ['id', 'equippedBy']))

  const remapBuild = (build: Build): Build => ({
    ...build,
    weaponId: remapOptionalId(maps.weapons, build.weaponId) ?? '',
    echoIds: build.echoIds.map((id) => maps.echoes.get(id) ?? id)
  })
  maps.builds = resolveImportIds(current.builds, incomingBuilds.map(remapBuild), (build) => importFingerprint(build))
  const remappedTeams = incomingTeams.map((team) => remapTeam(team, maps.builds))
  maps.teams = resolveImportIds(current.teams, remappedTeams, (team) => importFingerprint(team))

  const remapProfile = (profile: OptimizerProfile): OptimizerProfile => ({
    ...profile,
    buildId: maps.builds.get(profile.buildId) ?? profile.buildId,
    teamBuildIds: profile.teamBuildIds.map((id) => maps.builds.get(id) ?? id),
    excludedEchoIds: profile.excludedEchoIds.map((id) => maps.echoes.get(id) ?? id),
    selectedMainEchoId: remapOptionalId(maps.echoes, profile.selectedMainEchoId)
  })
  const remappedProfiles = incomingProfiles.map(remapProfile)
  maps.optimizerProfiles = resolveImportIds(current.optimizerProfiles ?? [], remappedProfiles, (profile) => importFingerprint(profile))

  const remapRun = (run: OptimizerRun): OptimizerRun => ({
    ...run,
    buildId: maps.builds.get(run.buildId) ?? run.buildId,
    profileId: maps.optimizerProfiles.get(run.profileId) ?? run.profileId,
    results: run.results.map((result) => ({
      ...result,
      echoIds: result.echoIds.map((id) => maps.echoes.get(id) ?? id),
      mainEchoId: remapOptionalId(maps.echoes, result.mainEchoId)
    })),
    plot: run.plot.map((point) => ({
      ...point,
      echoIds: point.echoIds.map((id) => maps.echoes.get(id) ?? id),
      mainEchoId: maps.echoes.get(point.mainEchoId) ?? point.mainEchoId
    }))
  })
  const remappedRuns = incomingRuns.map(remapRun)
  maps.optimizerRuns = resolveImportIds(current.optimizerRuns ?? [], remappedRuns, (run) => importFingerprint(run))

  const echoes = planImportCollection('echoes', current.echoes, incomingEchoes, maps.echoes, (echo) => ({
    ...echo,
    equippedBy: remapOptionalId(maps.builds, echo.equippedBy)
  }), ['id', 'source'])
  const characters = planImportCollection('characters', current.characters, incomingCharacters, maps.characters, (character) => character)
  const weapons = planImportCollection('weapons', current.weapons, incomingWeapons, maps.weapons, (weapon) => ({
    ...weapon,
    equippedBy: remapOptionalId(maps.characters, weapon.equippedBy)
  }))
  const builds = planImportCollection('builds', current.builds, incomingBuilds, maps.builds, remapBuild)
  const teams = planImportCollection('teams', current.teams, incomingTeams, maps.teams, (team) => remapTeam(team, maps.builds))
  const optimizerProfiles = planImportCollection('optimizerProfiles', current.optimizerProfiles ?? [], incomingProfiles, maps.optimizerProfiles, remapProfile)
  const optimizerRuns = planImportCollection('optimizerRuns', current.optimizerRuns ?? [], incomingRuns, maps.optimizerRuns, remapRun)
  const collections = [echoes, characters, weapons, builds, teams, optimizerProfiles, optimizerRuns]
  const preview: AccountImportPreview = {
    schemaVersion: document.schemaVersion,
    gameDataVersion: document.gameDataVersion,
    exportedAt: document.exportedAt,
    collections: collections.map((collection) => collection.summary),
    added: collections.reduce((sum, collection) => sum + collection.summary.added, 0),
    updated: collections.reduce((sum, collection) => sum + collection.summary.updated, 0),
    duplicates: collections.reduce((sum, collection) => sum + collection.summary.duplicates, 0)
  }
  return { preview, echoes, characters, weapons, builds, teams, optimizerProfiles, optimizerRuns }
}

export async function previewAccountImport(document: AccountDocument): Promise<AccountImportPreview> {
  if (!validateAccount(document)) throw new Error('The account backup is invalid or unsupported.')
  return (await createAccountImportPlan(document)).preview
}

export async function importAccount(document: AccountDocument): Promise<AccountImportPreview> {
  if (!validateAccount(document)) throw new Error('The account backup is invalid or unsupported.')
  const plan = await createAccountImportPlan(document)
  await db.transaction('rw', [db.echoes, db.characters, db.weapons, db.builds, db.teams, db.optimizerProfiles, db.optimizerRuns], async () => {
    await db.echoes.bulkPut(plan.echoes.records)
    await db.characters.bulkPut(plan.characters.records)
    await db.weapons.bulkPut(plan.weapons.records)
    await db.builds.bulkPut(plan.builds.records)
    await db.teams.bulkPut(plan.teams.records)
    await db.optimizerProfiles.bulkPut(plan.optimizerProfiles.records)
    await db.optimizerRuns.bulkPut(plan.optimizerRuns.records)
  })
  return plan.preview
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
    && (value.calculationV2 === undefined || isCalculationScenarioV2(value.calculationV2))
}

function isOptimizerProfile(value: unknown) {
  if (!isRecord(value)) return false
  const validStats = (entry: unknown) => isRecord(entry) && Object.entries(entry).every(([key, amount]) => key in statLabels && isFiniteNumber(amount))
  const mainStatsByCost = value.mainStatsByCost
  return typeof value.id === 'string' && typeof value.buildId === 'string'
    && (value.targetId === undefined || typeof value.targetId === 'string')
    && isFiniteNumber(value.levelLow) && isFiniteNumber(value.levelHigh)
    && Array.isArray(value.rarities) && value.rarities.every((rarity) => [1, 2, 3, 4, 5].includes(Number(rarity)))
    && isRecord(mainStatsByCost) && ['1', '3', '4'].every((cost) => Array.isArray(mainStatsByCost[cost]) && (mainStatsByCost[cost] as unknown[]).every((key) => typeof key === 'string' && key in statLabels))
    && Array.isArray(value.excludedEchoIds) && value.excludedEchoIds.every((id) => typeof id === 'string')
    && ['current', 'team', 'all'].includes(String(value.equippedPolicy))
    && Array.isArray(value.teamBuildIds) && value.teamBuildIds.every((id) => typeof id === 'string')
    && ['current', 'any', 'selected'].includes(String(value.mainEchoPolicy))
    && (value.selectedMainEchoId === undefined || typeof value.selectedMainEchoId === 'string')
    && Array.isArray(value.allowedSonatas) && value.allowedSonatas.every((name) => typeof name === 'string')
    && ['any', 'highest', 'dual', 'custom'].includes(String(value.sonataMode))
    && typeof value.allowNoSonata === 'boolean'
    && Array.isArray(value.requiredSonataEffects) && value.requiredSonataEffects.every((entry) => isRecord(entry) && typeof entry.sonata === 'string' && isFiniteNumber(entry.pieces))
    && validStats(value.minimumStats) && validStats(value.maximumStats)
    && (value.minimumScore === undefined || isFiniteNumber(value.minimumScore))
    && (value.maximumScore === undefined || isFiniteNumber(value.maximumScore))
    && isFiniteNumber(value.resultLimit) && typeof value.plotStat === 'string' && value.plotStat in statLabels
    && (value.workerCount === 'auto' || isFiniteNumber(value.workerCount))
    && ['exact', 'fast'].includes(String(value.searchMode)) && isFiniteNumber(value.maxEvaluations)
    && typeof value.allowPartial === 'boolean' && isFiniteNumber(value.updatedAt)
}

function isOptimizerRun(value: unknown) {
  return isRecord(value) && typeof value.id === 'string' && typeof value.buildId === 'string'
    && typeof value.profileId === 'string' && typeof value.requestId === 'string'
    && isFiniteNumber(value.createdAt) && typeof value.gameDataVersion === 'string'
    && typeof value.inventoryFingerprint === 'string' && typeof value.profileFingerprint === 'string' && typeof value.contextFingerprint === 'string'
    && Array.isArray(value.results) && value.results.every(isOptimizerResult)
    && Array.isArray(value.plot) && value.plot.every(isOptimizerPlotPoint)
    && (value.highlightedBuildKeys === undefined || (Array.isArray(value.highlightedBuildKeys) && value.highlightedBuildKeys.every((key) => typeof key === 'string')))
    && typeof value.complete === 'boolean' && isOptimizerProgress(value.progress)
}

function isOptimizerResult(value: unknown) {
  return isRecord(value) && typeof value.requestId === 'string'
    && Array.isArray(value.echoIds) && value.echoIds.every((id) => typeof id === 'string')
    && (value.mainEchoId === undefined || typeof value.mainEchoId === 'string')
    && isFiniteNumber(value.score) && isRecord(value.stats) && Object.values(value.stats).every(isFiniteNumber)
    && isRecord(value.damage) && isFiniteNumber(value.damage.normal) && isFiniteNumber(value.damage.critical) && isFiniteNumber(value.damage.expected)
    && isFiniteNumber(value.damage.hits) && typeof value.damage.attackId === 'string'
}

function isOptimizerPlotPoint(value: unknown) {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
    && Array.isArray(value.echoIds) && value.echoIds.every((id) => typeof id === 'string')
    && typeof value.mainEchoId === 'string'
    && (value.stats === undefined || (isRecord(value.stats) && Object.values(value.stats).every(isFiniteNumber)))
}

function isOptimizerProgress(value: unknown) {
  return isRecord(value) && typeof value.requestId === 'string'
    && ['total', 'processed', 'tested', 'rejected', 'skipped', 'elapsedMs', 'testedPerSecond'].every((key) => isFiniteNumber(value[key]))
}

function isTeamScenario(value: unknown) {
  if (!isRecord(value) || !['normal', 'expected', 'critical'].includes(String(value.resultMode))) return false
  const validValue = (entry: unknown) => isFiniteNumber(entry) || typeof entry === 'string' || typeof entry === 'boolean'
  return isRecord(value.memberConditions) && Object.values(value.memberConditions).every((conditions) => isRecord(conditions) && Object.values(conditions).every(validValue))
    && isRecord(value.enemyConditions) && Object.values(value.enemyConditions).every(validValue)
    && isRecord(value.selectedTargetByBuild) && Object.values(value.selectedTargetByBuild).every((target) => typeof target === 'string')
    && (value.compareBuildId === undefined || typeof value.compareBuildId === 'string')
}

function isCalculationScenarioV2(value: unknown) {
  if (!isRecord(value) || value.version !== 2 || !['normal', 'expected', 'critical'].includes(String(value.resultMode))) return false
  const validSelection = (selection: unknown) => isRecord(selection)
    && typeof selection.enabled === 'boolean'
    && (selection.value === undefined || isFiniteNumber(selection.value) || typeof selection.value === 'string' || typeof selection.value === 'boolean')
    && (selection.stacks === undefined || isFiniteNumber(selection.stacks))
    && (selection.refinement === undefined || isFiniteNumber(selection.refinement))
    && (selection.recipientBuildId === undefined || typeof selection.recipientBuildId === 'string')
  const validEffectMap = (entry: unknown) => isRecord(entry)
    && Object.values(entry).every((selection) => validSelection(selection))
  return isRecord(value.memberEffects) && Object.values(value.memberEffects).every(validEffectMap)
    && isRecord(value.partyEffects) && Object.values(value.partyEffects).every(validEffectMap)
    && isRecord(value.enemyStatuses) && Object.values(value.enemyStatuses).every(isFiniteNumber)
    && isRecord(value.selectedAttackByBuild) && Object.values(value.selectedAttackByBuild).every((attackId) => typeof attackId === 'string')
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
