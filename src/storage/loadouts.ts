import { createLocalId } from '../domain/id'
import type { Build, Echo, EquippedLoadout, LoadoutSourceRef, OwnedCharacter, OwnedWeapon, TheorycraftBuild } from '../domain/types'
import { createTheorycraftBuild } from '../domain/loadouts'
import { characterCatalog, echoCatalog, weaponCatalog } from '../game-data'
import { db } from './database'

function defaultWeaponFor(character: OwnedCharacter) {
  const characterEntry = characterCatalog.find((entry) => entry.id === character.catalogId)
  const weaponEntry = weaponCatalog.find((entry) => entry.rarity === 1
    && entry.name.startsWith('Training ')
    && entry.type.toLowerCase() === characterEntry?.weaponType.toLowerCase())
  if (!characterEntry || !weaponEntry) throw new Error('A matching Training weapon could not be found for this character.')
  return weaponEntry
}

export async function createOwnedCharacterWithDefaultWeapon(catalogId: string): Promise<OwnedCharacter> {
  const now = Date.now()
  const character: OwnedCharacter = {
    id: createLocalId(), catalogId, level: 1, sequence: 0, locked: false, favorite: false,
    skillLevels: [1, 1, 1, 1, 1], createdAt: now
  }
  const weaponEntry = defaultWeaponFor(character)
  const weapon: OwnedWeapon = {
    id: createLocalId(), catalogId: weaponEntry.id, level: 1, rank: 1, locked: false,
    equippedBy: character.id, createdAt: now
  }
  await db.transaction('rw', [db.characters, db.weapons, db.equippedLoadouts], async () => {
    await db.characters.add(character)
    await db.weapons.add(weapon)
    await db.equippedLoadouts.add({ id: `equipped:${character.id}`, characterId: character.id, weaponId: weapon.id, echoIds: [], updatedAt: now })
  })
  return character
}

export async function ensureEquippedLoadout(character: OwnedCharacter): Promise<EquippedLoadout> {
  return db.transaction('rw', [db.weapons, db.builds, db.equippedLoadouts], async () => {
    const existing = await db.equippedLoadouts.where('characterId').equals(character.id).first()
    const existingWeapon = existing?.weaponId ? await db.weapons.get(existing.weaponId) : undefined
    if (existing && existingWeapon) return existing
    const legacy = await db.builds.where('resonatorId').equals(character.catalogId).first()
    const legacyWeapon = legacy?.weaponId ? await db.weapons.get(legacy.weaponId) : undefined
    if (legacyWeapon && !legacyWeapon.equippedBy) {
      await db.weapons.update(legacyWeapon.id, { equippedBy: character.id })
      const restored = { id: existing?.id ?? `equipped:${character.id}`, characterId: character.id, weaponId: legacyWeapon.id, echoIds: [...(existing?.echoIds ?? legacy?.echoIds ?? [])], updatedAt: Date.now() }
      await db.equippedLoadouts.put(restored)
      return restored
    }
    const now = Date.now()
    const weaponEntry = defaultWeaponFor(character)
    const weapon: OwnedWeapon = { id: createLocalId(), catalogId: weaponEntry.id, level: 1, rank: 1, locked: false, equippedBy: character.id, createdAt: now }
    const created: EquippedLoadout = {
      id: existing?.id ?? `equipped:${character.id}`, characterId: character.id, weaponId: weapon.id,
      echoIds: [...(existing?.echoIds ?? legacy?.echoIds ?? [])], updatedAt: now
    }
    await db.weapons.add(weapon)
    await db.equippedLoadouts.put(created)
    return created
  })
}

export async function ensureAllEquippedLoadouts() {
  const characters = await db.characters.toArray()
  for (const character of characters) await ensureEquippedLoadout(character)
}

function validateEchoSelection(echoes: Echo[]) {
  if (echoes.length > 5) throw new Error('A loadout can equip at most five Echoes.')
  if (new Set(echoes.map((entry) => entry.id)).size !== echoes.length) throw new Error('A loadout cannot equip the same Echo twice.')
  if (echoes.reduce((sum, entry) => sum + entry.cost, 0) > 12) throw new Error('This loadout exceeds the 12-cost limit.')
}

export async function setEquippedEchoIds(characterId: string, requestedIds: string[]) {
  const echoIds = [...new Set(requestedIds)]
  await db.transaction('rw', [db.characters, db.echoes, db.equippedLoadouts], async () => {
    const character = await db.characters.get(characterId)
    if (!character) throw new Error('The selected character no longer exists.')
    const selected = echoIds.length ? await db.echoes.where('id').anyOf(echoIds).toArray() : []
    if (selected.length !== echoIds.length) throw new Error('One or more selected Echoes no longer exist.')
    validateEchoSelection(selected)
    const allLoadouts = await db.equippedLoadouts.toArray()
    for (const loadout of allLoadouts) {
      if (loadout.characterId === characterId || !loadout.echoIds.some((id) => echoIds.includes(id))) continue
      await db.equippedLoadouts.update(loadout.id, { echoIds: loadout.echoIds.filter((id) => !echoIds.includes(id)), updatedAt: Date.now() })
    }
    await db.echoes.where('equippedBy').equals(characterId).modify({ equippedBy: undefined, equippedByName: undefined })
    if (echoIds.length) await db.echoes.where('id').anyOf(echoIds).modify({ equippedBy: characterId, equippedByName: characterCatalog.find((entry) => entry.id === character.catalogId)?.name })
    const current = await db.equippedLoadouts.where('characterId').equals(character.id).first()
    if (current) await db.equippedLoadouts.update(current.id, { echoIds, updatedAt: Date.now() })
    else await db.equippedLoadouts.add({ id: `equipped:${character.id}`, characterId: character.id, weaponId: '', echoIds, updatedAt: Date.now() })
  })
}

export async function setEquippedWeapon(characterId: string, weaponId: string) {
  await db.transaction('rw', [db.characters, db.weapons, db.equippedLoadouts], async () => {
    const character = await db.characters.get(characterId)
    if (!character) throw new Error('The selected character no longer exists.')
    const weapon = weaponId ? await db.weapons.get(weaponId) : undefined
    const characterEntry = characterCatalog.find((entry) => entry.id === character.catalogId)
    const weaponEntry = weaponCatalog.find((entry) => entry.id === weapon?.catalogId)
    if (weapon && (!characterEntry || !weaponEntry || characterEntry.weaponType.toLowerCase() !== weaponEntry.type.toLowerCase())) throw new Error('That weapon type is incompatible with this character.')
    const allLoadouts = await db.equippedLoadouts.toArray()
    for (const loadout of allLoadouts) if (weaponId && loadout.characterId !== characterId && loadout.weaponId === weaponId) await db.equippedLoadouts.update(loadout.id, { weaponId: '', updatedAt: Date.now() })
    await db.weapons.where('equippedBy').equals(characterId).modify({ equippedBy: undefined })
    if (weapon) {
      if (weapon.equippedBy && weapon.equippedBy !== characterId) {
        const other = allLoadouts.find((entry) => entry.characterId === weapon.equippedBy)
        if (other) await db.equippedLoadouts.update(other.id, { weaponId: '', updatedAt: Date.now() })
      }
      await db.weapons.update(weapon.id, { equippedBy: characterId })
    }
    const current = await db.equippedLoadouts.where('characterId').equals(character.id).first()
    if (current) await db.equippedLoadouts.update(current.id, { weaponId, updatedAt: Date.now() })
    else await db.equippedLoadouts.add({ id: `equipped:${character.id}`, characterId: character.id, weaponId, echoIds: [], updatedAt: Date.now() })
  })
}

export async function saveEquippedBuild(characterId: string, name?: string) {
  const character = await db.characters.get(characterId)
  if (!character) throw new Error('The selected character no longer exists.')
  const loadout = await ensureEquippedLoadout(character)
  const now = Date.now()
  const build: Build = {
    id: createLocalId(), name: name?.trim() || `${characterCatalog.find((entry) => entry.id === character.catalogId)?.name ?? 'Character'} build`,
    description: '', characterId, resonatorId: character.catalogId, weaponId: loadout.weaponId, echoIds: [...loadout.echoIds],
    level: character.level, skillLevel: character.skillLevels?.[1] ?? 1, createdAt: now, updatedAt: now, source: 'equipped'
  }
  await db.builds.add(build)
  return build
}

export async function equipSavedBuild(buildId: string) {
  const build = await db.builds.get(buildId)
  if (!build) throw new Error('The selected saved build no longer exists.')
  const character = build.characterId ? await db.characters.get(build.characterId) : await db.characters.where('catalogId').equals(build.resonatorId).first()
  if (!character) throw new Error('The saved build character no longer exists.')
  await db.transaction('rw', [db.characters, db.echoes, db.weapons, db.equippedLoadouts], async () => {
    const selected = build.echoIds.length ? await db.echoes.where('id').anyOf(build.echoIds).toArray() : []
    if (selected.length !== build.echoIds.length) throw new Error('Replace or remove missing Echo references before equipping this build.')
    validateEchoSelection(selected)
    const weapon = build.weaponId ? await db.weapons.get(build.weaponId) : undefined
    if (build.weaponId && !weapon) throw new Error('Replace the missing weapon reference before equipping this build.')
    const characterEntry = characterCatalog.find((entry) => entry.id === character.catalogId)
    const weaponEntry = weaponCatalog.find((entry) => entry.id === weapon?.catalogId)
    if (weapon && (!characterEntry || !weaponEntry || characterEntry.weaponType.toLowerCase() !== weaponEntry.type.toLowerCase())) throw new Error('The saved weapon is incompatible with this character.')
    const loadouts = await db.equippedLoadouts.toArray()
    for (const loadout of loadouts) {
      if (loadout.characterId === character.id) continue
      const echoIds = loadout.echoIds.filter((id) => !build.echoIds.includes(id))
      const weaponId = build.weaponId && loadout.weaponId === build.weaponId ? '' : loadout.weaponId
      if (echoIds.length !== loadout.echoIds.length || weaponId !== loadout.weaponId) await db.equippedLoadouts.update(loadout.id, { echoIds, weaponId, updatedAt: Date.now() })
    }
    await db.echoes.where('equippedBy').equals(character.id).modify({ equippedBy: undefined, equippedByName: undefined })
    if (build.echoIds.length) await db.echoes.where('id').anyOf(build.echoIds).modify({ equippedBy: character.id, equippedByName: characterEntry?.name })
    await db.weapons.where('equippedBy').equals(character.id).modify({ equippedBy: undefined })
    if (weapon) await db.weapons.update(weapon.id, { equippedBy: character.id })
    const current = loadouts.find((entry) => entry.characterId === character.id)
    const next: EquippedLoadout = { id: current?.id ?? `equipped:${character.id}`, characterId: character.id, weaponId: weapon?.id ?? '', echoIds: [...build.echoIds], updatedAt: Date.now() }
    await db.equippedLoadouts.put(next)
  })
}

export async function equipmentConflicts(buildId: string) {
  const build = await db.builds.get(buildId)
  if (!build) return []
  const character = build.characterId ? await db.characters.get(build.characterId) : undefined
  const names = new Set<string>()
  const echoes = await db.echoes.where('id').anyOf(build.echoIds).toArray()
  for (const echo of echoes) if (echo.equippedBy && echo.equippedBy !== character?.id) names.add(echo.equippedByName ?? 'another character')
  const weapon = await db.weapons.get(build.weaponId)
  if (weapon?.equippedBy && weapon.equippedBy !== character?.id) {
    const owner = await db.characters.get(weapon.equippedBy)
    names.add(characterCatalog.find((entry) => entry.id === owner?.catalogId)?.name ?? 'another character')
  }
  return [...names]
}

export async function duplicateSavedBuild(buildId: string) {
  const build = await db.builds.get(buildId)
  if (!build) throw new Error('The selected saved build no longer exists.')
  const now = Date.now()
  const copy = { ...structuredClone(build), id: createLocalId(), name: `${build.name} copy`, createdAt: now, updatedAt: now }
  await db.builds.add(copy)
  return copy
}

export async function theorycraftFromBuild(source: LoadoutSourceRef, name?: string) {
  const characterId = source.type === 'equipped' ? source.characterId : source.type === 'saved' ? (await db.builds.get(source.buildId))?.characterId : undefined
  if (source.type === 'theorycraft') {
    const existing = await db.theorycraftBuilds.get(source.theorycraftBuildId)
    if (!existing) throw new Error('The theorycraft build no longer exists.')
    const now = Date.now()
    const copy = { ...structuredClone(existing), id: createLocalId(), name: name || `${existing.name} copy`, createdAt: now, updatedAt: now }
    await db.theorycraftBuilds.add(copy)
    return copy
  }
  const character = characterId ? await db.characters.get(characterId) : source.type === 'saved' ? await db.characters.where('catalogId').equals((await db.builds.get(source.buildId))?.resonatorId ?? '').first() : undefined
  if (!character) throw new Error('The loadout character no longer exists.')
  const loadout = source.type === 'equipped' ? await ensureEquippedLoadout(character) : await db.builds.get(source.buildId)
  if (!loadout) throw new Error('The source loadout no longer exists.')
  const echoes = (await Promise.all(loadout.echoIds.map((id) => db.echoes.get(id)))).filter((entry): entry is Echo => Boolean(entry))
  const weapon = await db.weapons.get(loadout.weaponId)
  const theorycraft = createTheorycraftBuild(character, name || `${source.type === 'equipped' ? 'Equipped' : (loadout as Build).name} theorycraft`)
  theorycraft.id = createLocalId()
  theorycraft.source = { type: source.type, id: source.type === 'saved' ? source.buildId : undefined }
  if (weapon) theorycraft.weapon = { catalogId: weapon.catalogId, level: weapon.level, rank: weapon.rank }
  if (echoes[0]) theorycraft.mainEchoName = echoes[0].name
  const sourceSlots = echoes.map((echo) => ({ cost: echo.cost, rarity: echo.rarity, level: echo.level, mainStatKey: echo.mainStat.key }))
  theorycraft.slots = [...sourceSlots, ...theorycraft.slots.slice(sourceSlots.length)].slice(0, 5)
  const counts = new Map<string, number>()
  echoes.forEach((echo) => counts.set(echo.sonata, (counts.get(echo.sonata) ?? 0) + 1))
  theorycraft.sonatas = [...counts].map(([sonataName, pieces]) => ({ name: sonataName, pieces }))
  theorycraft.substats = { mode: 'slots', slots: Array.from({ length: 5 }, (_, index) => echoes[index]?.subStats.map((line) => ({ ...line })) ?? []) }
  theorycraft.updatedAt = Date.now()
  await db.theorycraftBuilds.add(theorycraft)
  return theorycraft
}

export function mainEchoCompatibility(theorycraft: TheorycraftBuild) {
  const main = echoCatalog.find((entry) => entry.name === theorycraft.mainEchoName)
  return !main || theorycraft.sonatas.some((entry) => entry.pieces > 0 && main.sonatas.includes(entry.name))
}
