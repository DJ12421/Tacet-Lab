import type { AccountDocument, Build, Echo, EquippedLoadout, LoadoutSourceRef, OwnedCharacter, OwnedWeapon, RotationAction, StatKey, StatLine, Team, TeamMember } from '../domain/types'
import { buildEquipmentIdentity, echoStatIdentity } from '../domain/echo-identity'
import { characterCatalog, characterSummaries, echoCatalog, sonataCatalog, weaponSummaries } from '../game-data'
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
const roverTypes = new Map([...new Set(characterSummaries.filter((character) => character.name.startsWith('Rover: ')).map((character) => key(character.name)))].map((name) => [name, characterSummaries.filter((character) => key(character.name) === name)] as const))
const roverTypeKey = (name: string) => key(name).replace(/(?:male|female)$/, '')

function sourceGearScore(character: RecordValue) {
  const activeBuild = Array.isArray(character.builds) ? character.builds.find((build) => record(build) && build.id === character.activeBuildId) : undefined
  const slots = Array.isArray(character.echoes) ? character.echoes : record(character.echoes) ? Object.values(character.echoes) : []
  const buildSlots = record(activeBuild) ? activeBuild.echoes : undefined
  const echoes = slots.some((echo) => record(echo) && typeof echo.echo === 'string') ? slots
    : Array.isArray(buildSlots) ? buildSlots : record(buildSlots) ? Object.values(buildSlots) : []
  return 2 * echoes.filter((echo) => record(echo) && typeof echo.echo === 'string'
    && typeof echo.stat === 'string' && Boolean(statKeys[key(echo.stat)])
    && [1, 2, 3, 4, 5].some((index) => typeof echo[`echoSubStatsType${index}`] === 'string'
      && Boolean(statKeys[key(echo[`echoSubStatsType${index}`] as string)]))).length
    + Number(Boolean(character.weapon || (record(activeBuild) && activeBuild.weapon)))
}

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
  const importedEchoesByStats = new Map<string, Echo>()
  const echoes: Echo[] = []
  const characters: OwnedCharacter[] = []
  const weapons: OwnedWeapon[] = []
  const builds: Build[] = []
  const equippedLoadouts: EquippedLoadout[] = []
  const teams: Team[] = []
  const choices: WutheringToolsCharacterChoice[] = []
  const notices: string[] = []
  const createdAt = Date.now()
  const characterIds = new Map<string, string>()
  const characterCatalogIds = new Map<string, string>()
  const activeRefs = new Map<string, LoadoutSourceRef>()
  const buildRefs = new Map<string, LoadoutSourceRef>()
  const preferredRoverSources = new Map<string, { name: string; score: number }>()
  for (const [name, character] of Object.entries(characterData.characters)) {
    const roverType = roverTypeKey(name)
    if (!roverTypes.has(roverType) || !record(character)) continue
    const score = sourceGearScore(character)
    if (score > (preferredRoverSources.get(roverType)?.score ?? -1)) preferredRoverSources.set(roverType, { name, score })
  }
  for (const [characterName, character] of Object.entries(characterData.characters)) {
    if (!record(character)) continue
    const roverType = roverTypeKey(characterName)
    const roverVariants = roverTypes.get(roverType)
    if (roverVariants && preferredRoverSources.get(roverType)?.name !== characterName) continue
    const sourceGender = key(characterName).endsWith('female') ? 'female' : key(characterName).endsWith('male') ? 'male' : undefined
    const existingRover = roverVariants && (ownedCharacters.find((entry) => roverVariants.some((candidate) => candidate.id === entry.catalogId && candidate.gender === sourceGender))
      ?? ownedCharacters.find((entry) => roverVariants.some((candidate) => candidate.id === entry.catalogId)))
    const catalogCharacter = roverVariants
      ? roverVariants.find((candidate) => candidate.id === existingRover?.catalogId) ?? roverVariants.find((candidate) => candidate.gender === sourceGender) ?? roverVariants.find((candidate) => candidate.gender === 'male') ?? roverVariants[0]
      : characterNames.get(key(characterName))
    if (!catalogCharacter) { notices.push(`${characterName}: skipped because this character is missing from Tacet Lab's catalog.`); continue }
    const sourceBuilds = Array.isArray(character.builds) ? character.builds.filter(record) : []
    const activeBuild = sourceBuilds.find((build) => build.id === character.activeBuildId) ?? sourceBuilds[0]
    const ownedCharacter = existingRover ?? ownedCharacters.find((entry) => entry.catalogId === catalogCharacter.id)
    const catalogId = ownedCharacter?.catalogId ?? catalogCharacter.id
    const characterId = ownedCharacter?.id ?? `wuthering-tools:character:${catalogId}`
    const sourceKey = key(characterName)
    characterIds.set(sourceKey, characterId)
    characterCatalogIds.set(sourceKey, catalogId)
    if (roverVariants) { characterIds.set(roverType, characterId); characterCatalogIds.set(roverType, catalogId) }
    const currentLoadout = currentLoadouts.find((entry) => entry.characterId === characterId)
    const variants = [{ source: character, build: activeBuild, active: true },
      ...sourceBuilds.filter((build) => build !== activeBuild).map((build) => ({ source: build, build, active: false }))]
    for (const [variantIndex, variant] of variants.entries()) {
    const slots: unknown[] = Array.isArray(variant.source.echoes) ? variant.source.echoes : record(variant.source.echoes) ? Object.values(variant.source.echoes) : []
    const buildSlots = variant.active && record(activeBuild) ? activeBuild.echoes : undefined
    const sourceSlots: unknown[] = slots.some((slot) => record(slot) && typeof slot.echo === 'string') ? slots
      : Array.isArray(buildSlots) ? buildSlots : record(buildSlots) ? Object.values(buildSlots) : []
    if (sourceSlots.length > 5 || sourceSlots.reduce<number>((sum, slot) => sum + (record(slot) && typeof slot.echo === 'string' && typeof slot.type === 'number' ? slot.type : 0), 0) > 12) {
      notices.push(`${characterName}: skipped because this build exceeds five Echoes or 12 Echo cost.`)
      continue
    }
    const weaponName = typeof variant.source.weapon === 'string' ? variant.source.weapon : variant.active && record(activeBuild) && typeof activeBuild.weapon === 'string' ? activeBuild.weapon : ''
    const namedWeapon = weaponNames.get(key(weaponName))
    const catalogWeapon = namedWeapon && key(namedWeapon.type) === key(catalogCharacter.weaponType) ? namedWeapon
      : weaponSummaries.find((weapon) => weapon.rarity === 1 && weapon.name.startsWith('Training ') && key(weapon.type) === key(catalogCharacter.weaponType))
    if (!catalogWeapon) { notices.push(`${characterName}: skipped because no compatible weapon exists in Tacet Lab's catalog.`); continue }
    const hasExportedGear = sourceSlots.some((slot) => record(slot) && typeof slot.echo === 'string') || Boolean(namedWeapon && namedWeapon.id === catalogWeapon.id)
    if (!hasExportedGear && ownedCharacter) {
      if (variant.active) notices.push(`${characterName}: already owned; no gear in the export, so existing data is unchanged.`)
      if (variant.active) activeRefs.set(sourceKey, { type: 'equipped', characterId })
      continue
    }
    if (!hasExportedGear && !variant.active) continue
    const hasCurrentBuild = Boolean(variant.active && hasExportedGear && ownedCharacter && (currentLoadout || currentBuilds.some((build) => build.characterId === characterId || build.resonatorId === catalogId)))
    const saveSecondBuild = !variant.active || (hasCurrentBuild && (addAsNewBuild[catalogId] ?? true))
    if (variant.active) choices.push({ catalogId, name: catalogCharacter.name, existing: hasCurrentBuild, addAsNewBuild: saveSecondBuild })
    const now = createdAt + choices.length + variantIndex
    if (!ownedCharacter && !characters.some((entry) => entry.id === characterId)) characters.push({
      id: characterId, catalogId, level: 90, sequence: 0, locked: false,
      skillLevels: [10, 10, 10, 10, 10], createdAt: now
    })
    const importedWeaponId = `wuthering-tools:weapon:${catalogId}:${catalogWeapon.id}`
    const existingWeapon = [...ownedWeapons, ...weapons].find((weapon) => weapon.id === importedWeaponId && weapon.catalogId === catalogWeapon.id)
      ?? [...ownedWeapons, ...weapons].find((weapon) => weapon.catalogId === catalogWeapon.id && (weapon.equippedBy === characterId || !weapon.equippedBy))
    const weaponId = existingWeapon?.id ?? importedWeaponId
    if (!existingWeapon) weapons.push({
      id: weaponId, catalogId: catalogWeapon.id, level: 90, rank: 1, locked: false,
      equippedBy: saveSecondBuild ? undefined : characterId, createdAt: now
    })
    const echoIds: string[] = []
    const echoStart = echoes.length
    const characterEchoes = new Map<string, Echo>()
    const savedEchoIds = new Set(currentBuilds.filter((build) => build.characterId === characterId || build.resonatorId === catalogId).flatMap((build) => build.echoIds))
    for (const echo of ownedEchoes) {
      if (echo.equippedBy === characterId || currentLoadout?.echoIds.includes(echo.id) || savedEchoIds.has(echo.id)) {
        const identity = echoStatIdentity(echo)
        if (!characterEchoes.has(identity)) characterEchoes.set(identity, echo)
      }
    }
    for (const [slot, source] of sourceSlots.entries()) {
      if (!record(source) || typeof source.echo !== 'string') continue
      const catalogEcho = echoNames.get(key(source.echo))
      const sonata = typeof source.echoSet === 'string' ? sonataNames.get(key(source.echoSet)) : undefined
      const mainKey = typeof source.stat === 'string' ? statKeys[key(source.stat)] : undefined
      const cost = source.type
      const rarity = source.rank
      if (!catalogEcho || !sonata || !mainKey || ![1, 3, 4].includes(Number(cost)) || ![1, 2, 3, 4, 5].includes(Number(rarity))
        || catalogEcho.cost !== cost || !catalogEcho.sonatas.includes(sonata) || !isMainStatAllowed(cost as Echo['cost'], mainKey)) {
        continue
      }
      const subStats: StatLine[] = []
      let invalid = false
      for (let index = 1; index <= 5; index++) {
        const type = source[`echoSubStatsType${index}`]
        const amount = source[`echoSubStatsValue${index}`]
        if ((type == null || (typeof type === 'string' && key(type) === 'none')) && (amount == null || amount === 0)) continue
        const statKey = typeof type === 'string' ? statKeys[key(type)] : undefined
        if (!statKey || typeof amount !== 'number' || !Number.isFinite(amount) || subStats.some((stat) => stat.key === statKey)) { invalid = true; break }
        subStats.push({ key: statKey, value: amount })
      }
      if (invalid || !subStats.length) continue
      if (subStats.length * 5 > maxLevelByRarity[rarity as Echo['rarity']]) {
        continue
      }
      const level = subStats.length * 5
      const id = `wuthering-tools:${encodeURIComponent(characterName)}:${variant.active ? '' : `${encodeURIComponent(String(variant.build?.id ?? variantIndex))}:`}${slot}`
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
      const identity = echoStatIdentity(echo)
      const matchingEcho = characterEchoes.get(identity) ?? importedEchoesByStats.get(identity)
      if (saveSecondBuild && existing && !matchingEcho && echoStatIdentity(existing) !== identity) {
        let number = 2
        while (currentEchoes.has(`${id}:${number}`) || echoes.some((entry) => entry.id === `${id}:${number}`)) number++
        echo.id = `${id}:${number}`
      }
      const chosenEcho = matchingEcho ?? echo
      if (!echoes.some((entry) => entry.id === chosenEcho.id)) echoes.push(matchingEcho ? { ...matchingEcho, source: 'import' } : echo)
      if (!matchingEcho) characterEchoes.set(identity, echo)
      importedEchoesByStats.set(identity, chosenEcho)
      const chosenId = chosenEcho.id
      if (!echoIds.includes(chosenId)) echoIds.push(chosenId)
    }
    if (!echoIds.length && ownedCharacter && currentLoadout && variant.active) echoIds.push(...currentLoadout.echoIds)
    const incomingEquipment = buildEquipmentIdentity(weaponId, echoIds, [...ownedWeapons, ...weapons], [...ownedEchoes, ...echoes])
    const sameEquipment = currentLoadout && buildEquipmentIdentity(currentLoadout.weaponId, currentLoadout.echoIds, ownedWeapons, ownedEchoes)
      === incomingEquipment
    const matchingSavedBuild = currentBuilds.find((build) => (build.characterId === characterId || build.resonatorId === catalogId)
      && buildEquipmentIdentity(build.weaponId, build.echoIds, ownedWeapons, ownedEchoes) === incomingEquipment)
    const matchingImportedBuild = builds.find((build) => build.characterId === characterId
      && buildEquipmentIdentity(build.weaponId, build.echoIds, [...ownedWeapons, ...weapons], [...ownedEchoes, ...echoes]) === incomingEquipment)
    const samePendingEquipment = equippedLoadouts.some((loadout) => loadout.characterId === characterId
      && buildEquipmentIdentity(loadout.weaponId, loadout.echoIds, [...ownedWeapons, ...weapons], [...ownedEchoes, ...echoes]) === incomingEquipment)
    if ((ownedCharacter && (sameEquipment || matchingSavedBuild)) || matchingImportedBuild || samePendingEquipment) {
      const ref: LoadoutSourceRef = sameEquipment || samePendingEquipment ? { type: 'equipped', characterId } : { type: 'saved', buildId: (matchingSavedBuild ?? matchingImportedBuild)!.id }
      if (variant.active) { choices.pop(); activeRefs.set(sourceKey, ref) }
      if (typeof variant.build?.id === 'string') buildRefs.set(`${sourceKey}:${variant.build.id}`, ref)
      if (!existingWeapon) weapons.pop()
      echoes.splice(echoStart)
      continue
    }
    if (!hasExportedGear) {
      equippedLoadouts.push({ id: `equipped:${characterId}`, characterId, weaponId, echoIds: [], updatedAt: now })
      activeRefs.set(sourceKey, { type: 'equipped', characterId })
    } else if (saveSecondBuild) {
      const id = `wuthering-tools:build:${catalogId}${variant.active ? '' : `:${encodeURIComponent(String(variant.build?.id ?? variantIndex))}`}`
      const existingBuild = currentBuilds.find((build) => build.id === id)
      const usedNames = new Set(currentBuilds.filter((build) => build.characterId === characterId || build.resonatorId === catalogId).map((build) => build.name))
      let number = 2
      while (!existingBuild && usedNames.has(`Build ${number}`)) number++
      builds.push({
        id, name: existingBuild?.name ?? (!variant.active && typeof variant.build?.name === 'string' && variant.build.name.trim() ? variant.build.name.trim() : `Build ${number}`), description: existingBuild?.description ?? '',
        characterId, resonatorId: catalogId, weaponId, echoIds,
        // This is an explicitly saved snapshot, so the legacy imported-build cleanup must retain it.
        level: ownedCharacter?.level ?? 90, skillLevel: ownedCharacter?.skillLevels?.[1] ?? 10,
        createdAt: existingBuild?.createdAt ?? now, updatedAt: existingBuild?.updatedAt ?? now, source: 'manual'
      })
      const ref: LoadoutSourceRef = { type: 'saved', buildId: id }
      if (variant.active) activeRefs.set(sourceKey, ref)
      if (typeof variant.build?.id === 'string') buildRefs.set(`${sourceKey}:${variant.build.id}`, ref)
    } else {
      const sameLoadout = currentLoadout && currentLoadout.weaponId === weaponId && currentLoadout.echoIds.length === echoIds.length
        && currentLoadout.echoIds.every((id, index) => id === echoIds[index])
      equippedLoadouts.push({ id: currentLoadout?.id ?? `equipped:${characterId}`, characterId, weaponId, echoIds, updatedAt: sameLoadout ? currentLoadout.updatedAt : now })
      const ref: LoadoutSourceRef = { type: 'equipped', characterId }
      if (variant.active) activeRefs.set(sourceKey, ref)
      if (typeof variant.build?.id === 'string') buildRefs.set(`${sourceKey}:${variant.build.id}`, ref)
    }
    }
  }
  let rotationData: unknown
  if (typeof data.teamRotations === 'string') {
    try { rotationData = JSON.parse(data.teamRotations) } catch { notices.push('Team rotations could not be read from this export.') }
  } else rotationData = data.teamRotations
  if (record(rotationData) && Array.isArray(rotationData.teams)) {
    for (const [teamIndex, sourceTeam] of rotationData.teams.entries()) {
      if (!record(sourceTeam) || !Array.isArray(sourceTeam.characterIds)) continue
      const sourceNames = sourceTeam.characterIds.slice(0, 3)
      if (!sourceNames.some((name) => typeof name === 'string' && name.trim())) continue
      const teamId = `wuthering-tools:team:${typeof sourceTeam.id === 'string' ? encodeURIComponent(sourceTeam.id) : teamIndex}`
      const members: TeamMember[] = []
      const memberBySlot = new Map<number, TeamMember>()
      for (const [slot, name] of sourceNames.entries()) {
        if (typeof name !== 'string' || !name.trim()) continue
        const sourceKey = key(name)
        const characterId = characterIds.get(sourceKey) ?? characterIds.get(roverTypeKey(name))
        if (!characterId || ![...ownedCharacters, ...characters].some((entry) => entry.id === characterId)) {
          notices.push(`${String(sourceTeam.name ?? `Team ${teamIndex + 1}`)}: ${name} could not be matched and was omitted.`)
          continue
        }
        const sourceBuildId = Array.isArray(sourceTeam.buildIds) ? sourceTeam.buildIds[slot] : undefined
        const loadoutSource = typeof sourceBuildId === 'string' ? buildRefs.get(`${sourceKey}:${sourceBuildId}`) ?? buildRefs.get(`${roverTypeKey(name)}:${sourceBuildId}`) : undefined
        const member: TeamMember = { memberId: `${teamId}:member:${slot}`, characterId, loadoutSource: loadoutSource ?? activeRefs.get(sourceKey) ?? activeRefs.get(roverTypeKey(name)) ?? { type: 'equipped', characterId } }
        members.push(member)
        memberBySlot.set(slot, member)
      }
      if (!members.length) continue
      const durationValue = Number(sourceTeam.duration)
      const rotationDuration = Number.isFinite(durationValue) && durationValue > 0 ? Math.min(durationValue, 600) : 25
      const sourceActions = Array.isArray(sourceTeam.actions) ? sourceTeam.actions.filter(record) : []
      const orderedActions = [...sourceActions].sort((left, right) => Number(left.order) - Number(right.order))
      const actions: RotationAction[] = []
      for (const [index, action] of orderedActions.entries()) {
        const member = memberBySlot.get(Number(action.slot))
        const name = sourceNames[Number(action.slot)]
        const catalogId = typeof name === 'string' ? characterCatalogIds.get(key(name)) ?? characterCatalogIds.get(roverTypeKey(name)) : undefined
        const catalog = characterCatalog.find((entry) => entry.id === catalogId)
        const actionKey = typeof action.key === 'string' ? key(action.key) : ''
        const exactMatches = actionKey && catalog ? catalog.attacks.filter((attack) => key(attack.name).endsWith(actionKey)) : []
        const matches = exactMatches.length ? exactMatches : actionKey && catalog
          ? catalog.attacks.filter((attack) => key(attack.name).includes(actionKey.replace(/dmg$/, ''))) : []
        if (!member || matches.length !== 1 || action.isDisabled === true) continue
        const count = Number(action.count)
        actions.push({ id: `${teamId}:action:${typeof action.id === 'string' ? encodeURIComponent(action.id) : index}`,
          buildId: member.memberId, attackId: matches[0].id, timestamp: Number((index * rotationDuration / Math.max(1, orderedActions.length)).toFixed(2)),
          ...(Number.isInteger(count) && count > 1 && count <= 99 ? { multiplier: count } : {}) })
      }
      const enemy: RecordValue = record(sourceTeam.enemyConfig) ? sourceTeam.enemyConfig : {}
      const level = Number(enemy.enemyLevel)
      const resistance = Number(enemy.enemyResist)
      const stacks = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
      const teamName = typeof sourceTeam.name === 'string' && sourceTeam.name.trim() ? sourceTeam.name.trim() : `Team ${teamIndex + 1}`
      teams.push({ id: teamId, name: teamName,
        members, buildIds: members.map((member) => member.memberId),
        enemy: { level: Number.isFinite(level) && level >= 1 ? level : 90, resistance: Number.isFinite(resistance) ? Math.max(-100, Math.min(100, Math.abs(resistance) <= 1 ? resistance * 100 : resistance)) : 10, damageReduction: 0,
          statusStacks: { 'spectro-frazzle': stacks(enemy.spectroFrazzleStacks), 'aero-erosion': stacks(enemy.aeroErosionStacks),
            'fusion-burst': stacks(enemy.fusionBurstStacks), 'electro-flare': stacks(enemy.electroFlareStacks), 'glacio-chafe': stacks(enemy.glacioChafeStacks) },
          electroRageStacks: stacks(enemy.electroRageStacks), havocBaneStacks: stacks(enemy.havocBaneStacks), strainStacks: stacks(enemy.strainStacks) },
        rotationDuration, actions, buffs: [] })
      const unmatchedActions = orderedActions.filter((action) => action.isDisabled !== true).length - actions.length
      if (unmatchedActions) notices.push(`${teamName}: ${unmatchedActions} rotation actions could not be matched and were omitted.`)
      if (orderedActions.length) notices.push(`${teamName}: action timing was estimated from order; review the rotation after import. Action buffs and statuses were not imported.`)
    }
  }
  notices.unshift(characters.length || weapons.length || echoes.length || builds.length || equippedLoadouts.length || teams.length
    ? 'New characters and weapons default to level 90, skills 10, S0, and R1. Existing progression is preserved. Missing weapons use a matching 1-star Training weapon. Echo levels are inferred from substats; character buffs and other calculator settings are not imported.'
    : 'No character, build, or team data was found; no account data will change.')
  const document: AccountDocument = {
    schemaVersion: 7, gameDataVersion: GAME_DATA_VERSION, exportedAt: new Date().toISOString(),
    echoes, characters, weapons, builds, equippedLoadouts, theorycraftBuilds: [], teams, settings: defaultSettings
  }
  return { document, notices, choices }
}
