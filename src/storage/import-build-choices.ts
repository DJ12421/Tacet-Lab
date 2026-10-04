import { buildEquipmentIdentity, echoStatIdentity } from '../domain/echo-identity'
import type { AccountDocument, Build, EquippedLoadout } from '../domain/types'
import { characterSummaries } from '../game-data'
import { exportAccount } from './database'

export async function prepareNativeBuildChoices(document: AccountDocument, addAsNewBuild: Record<string, boolean> = {}) {
  const current = await exportAccount()
  const choices: Array<{ catalogId: string; name: string; existing: boolean; addAsNewBuild: boolean }> = []
  const builds: Build[] = [...document.builds]
  const loadouts: EquippedLoadout[] = []
  const usedIds = new Set([...current.builds, ...builds].map((build) => build.id))
  const echoIds = new Map<string, string>()
  const weaponIds = new Map<string, string>()

  const copyId = (id: string, used: Set<string>) => {
    let number = 2
    while (used.has(`${id}:import:${number}`)) number++
    const copy = `${id}:import:${number}`
    used.add(copy)
    return copy
  }
  const usedEchoIds = new Set([...current.echoes, ...document.echoes].map((echo) => echo.id))
  const usedWeaponIds = new Set([...current.weapons, ...document.weapons].map((weapon) => weapon.id))

  for (const incoming of document.equippedLoadouts ?? []) {
    const sourceCharacter = document.characters?.find((character) => character.id === incoming.characterId)
    const character = current.characters?.find((entry) => entry.catalogId === sourceCharacter?.catalogId)
    const equipped = current.equippedLoadouts?.find((entry) => entry.characterId === character?.id)
    if (!sourceCharacter || !character || !equipped) { loadouts.push(incoming); continue }

    const incomingIdentity = buildEquipmentIdentity(incoming.weaponId, incoming.echoIds, document.weapons ?? [], document.echoes)
    const equippedIdentity = buildEquipmentIdentity(equipped.weaponId, equipped.echoIds, current.weapons ?? [], current.echoes)
    if (incomingIdentity === equippedIdentity) continue

    const catalogId = character.catalogId
    const saveNew = addAsNewBuild[catalogId] ?? true
    choices.push({ catalogId, name: characterSummaries.find((entry) => entry.id === catalogId)?.name ?? 'Character', existing: true, addAsNewBuild: saveNew })
    if (!saveNew) { loadouts.push(incoming); continue }
    for (const id of incoming.echoIds) {
      const source = document.echoes.find((echo) => echo.id === id)
      const owned = current.echoes.find((echo) => echo.id === id)
      if (source && owned && echoStatIdentity(source) !== echoStatIdentity(owned) && !echoIds.has(id)) echoIds.set(id, copyId(id, usedEchoIds))
    }
    const sourceWeapon = document.weapons.find((weapon) => weapon.id === incoming.weaponId)
    const ownedWeapon = current.weapons.find((weapon) => weapon.id === incoming.weaponId)
    if (sourceWeapon && ownedWeapon && sourceWeapon.catalogId !== ownedWeapon.catalogId && !weaponIds.has(incoming.weaponId)) {
      weaponIds.set(incoming.weaponId, copyId(incoming.weaponId, usedWeaponIds))
    }
    if (current.builds.some((build) => (build.characterId === character.id || build.resonatorId === catalogId)
      && buildEquipmentIdentity(build.weaponId, build.echoIds, current.weapons ?? [], current.echoes) === incomingIdentity)
      || builds.some((build) => (build.characterId === sourceCharacter.id || build.resonatorId === catalogId)
      && buildEquipmentIdentity(build.weaponId, build.echoIds, document.weapons ?? [], document.echoes) === incomingIdentity)) continue

    let number = 2
    while (usedIds.has(`tacet-lab:imported-build:${catalogId}:${number}`)
      || [...current.builds, ...builds].some((build) => (build.characterId === character.id || build.resonatorId === catalogId) && build.name === `Build ${number}`)) number++
    const id = `tacet-lab:imported-build:${catalogId}:${number}`
    usedIds.add(id)
    const now = Date.now()
    builds.push({ id, name: `Build ${number}`, description: '', characterId: sourceCharacter.id, resonatorId: catalogId,
      weaponId: incoming.weaponId, echoIds: [...incoming.echoIds], level: sourceCharacter.level,
      skillLevel: sourceCharacter.skillLevels?.[1] ?? 1, createdAt: now, updatedAt: now, source: 'manual' })
  }

  const remapEchoes = (ids: string[]) => ids.map((id) => echoIds.get(id) ?? id)
  return { document: { ...document,
    echoes: document.echoes.map((echo) => echoIds.has(echo.id) ? { ...echo, id: echoIds.get(echo.id)! } : echo),
    weapons: document.weapons.map((weapon) => weaponIds.has(weapon.id) ? { ...weapon, id: weaponIds.get(weapon.id)! } : weapon),
    builds: builds.map((build) => ({ ...build, weaponId: weaponIds.get(build.weaponId) ?? build.weaponId, echoIds: remapEchoes(build.echoIds) })),
    equippedLoadouts: loadouts.map((loadout) => ({ ...loadout, weaponId: weaponIds.get(loadout.weaponId) ?? loadout.weaponId, echoIds: remapEchoes(loadout.echoIds) }))
  }, choices }
}
