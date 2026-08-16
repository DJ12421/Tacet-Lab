import type { DiagnosticScanCandidate } from './types'
import { candidateToEcho } from './parser'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { db } from '../storage/database'
import { createLocalId } from '../domain/id'

const normalizedIdentity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const initializedBuildCards = new Set<string>()

export async function saveScannedCandidate(candidate: DiagnosticScanCandidate) {
  const characterName = candidate.buildCard?.character.value.trim() || candidate.fields.equippedBy.value.trim()
  const characterEntry = characterCatalog.find((entry) => entry.id === candidate.buildCard?.characterCatalogId)
    ?? characterCatalog.find((entry) => normalizedIdentity(entry.name) === normalizedIdentity(characterName))
  const weaponEntry = weaponCatalog.find((entry) => entry.id === candidate.buildCard?.weaponCatalogId)
    ?? weaponCatalog.find((entry) => normalizedIdentity(entry.name) === normalizedIdentity(candidate.buildCard?.weapon.value ?? ''))

  const initializeBuildCard = Boolean(candidate.buildCard && !initializedBuildCards.has(candidate.buildCard.id))
  const saved = await db.transaction('rw', [db.echoes, db.characters, db.weapons, db.equippedLoadouts], async () => {
    let ownedCharacter = characterEntry ? await db.characters.where('catalogId').equals(characterEntry.id).first() : undefined
    if (characterEntry && !ownedCharacter) {
      ownedCharacter = {
        id: createLocalId(), catalogId: characterEntry.id,
        level: candidate.buildCard?.characterLevel.value ?? 1,
        sequence: candidate.buildCard?.sequence.value ?? 0,
        skillLevels: candidate.buildCard?.skillLevels.map((field) => field.value) ?? [1, 1, 1, 1, 1],
        locked: false, favorite: false, createdAt: Date.now()
      }
      await db.characters.add(ownedCharacter)
    } else if (ownedCharacter && candidate.buildCard) {
      await db.characters.update(ownedCharacter.id, {
        level: candidate.buildCard.characterLevel.value,
        skillLevels: candidate.buildCard.skillLevels.map((field) => field.value)
      })
    }

    let ownedWeapon = weaponEntry && ownedCharacter
      ? (await db.weapons.where('catalogId').equals(weaponEntry.id).toArray()).find((weapon) => weapon.equippedBy === ownedCharacter.id)
        ?? (await db.weapons.where('catalogId').equals(weaponEntry.id).toArray()).find((weapon) => !weapon.equippedBy)
      : undefined
    if (weaponEntry && !ownedWeapon) {
      ownedWeapon = { id: createLocalId(), catalogId: weaponEntry.id, level: candidate.buildCard?.weaponLevel.value ?? 1, rank: 1, locked: false, equippedBy: ownedCharacter?.id, createdAt: Date.now() }
      if (ownedCharacter) await db.weapons.where('equippedBy').equals(ownedCharacter.id).modify({ equippedBy: undefined })
      await db.weapons.add(ownedWeapon)
    } else if (ownedWeapon && ownedCharacter && candidate.buildCard) {
      await db.weapons.where('equippedBy').equals(ownedCharacter.id).modify({ equippedBy: undefined })
      await db.weapons.update(ownedWeapon.id, { level: candidate.buildCard.weaponLevel.value, equippedBy: ownedCharacter.id })
    }

    let loadout = ownedCharacter ? await db.equippedLoadouts.where('characterId').equals(ownedCharacter.id).first() : undefined
    if (ownedCharacter && !loadout) {
      loadout = { id: `equipped:${ownedCharacter.id}`, characterId: ownedCharacter.id, weaponId: ownedWeapon?.id ?? '', echoIds: [], updatedAt: Date.now() }
      await db.equippedLoadouts.add(loadout)
    } else if (loadout && ownedWeapon) {
      if (ownedWeapon.equippedBy && ownedWeapon.equippedBy !== ownedCharacter?.id) {
        const previous = await db.equippedLoadouts.where('characterId').equals(ownedWeapon.equippedBy).first()
        if (previous?.weaponId === ownedWeapon.id) await db.equippedLoadouts.update(previous.id, { weaponId: '', updatedAt: Date.now() })
      }
      await db.equippedLoadouts.update(loadout.id, { weaponId: ownedWeapon.id, updatedAt: Date.now() })
      loadout = { ...loadout, weaponId: ownedWeapon.id }
    }
    if (loadout && ownedCharacter && initializeBuildCard) {
      await db.echoes.where('equippedBy').equals(ownedCharacter.id).modify({ equippedBy: undefined, equippedByName: undefined })
      await db.equippedLoadouts.update(loadout.id, { echoIds: [], updatedAt: Date.now() })
      loadout = { ...loadout, echoIds: [] }
    }

    const echo = candidateToEcho(candidate)
    const equippedEchoes = loadout?.echoIds.length ? await db.echoes.where('id').anyOf(loadout.echoIds).toArray() : []
    const assignedToBuild = Boolean(loadout && ownedCharacter && loadout.echoIds.length < 5 && equippedEchoes.reduce((sum, entry) => sum + entry.cost, 0) + echo.cost <= 12)
    echo.equippedByName = assignedToBuild || !loadout ? characterEntry?.name ?? (characterName || undefined) : undefined
    if (assignedToBuild && ownedCharacter) echo.equippedBy = ownedCharacter.id
    await db.echoes.add(echo)
    if (loadout && echo.equippedBy === ownedCharacter?.id) await db.equippedLoadouts.update(loadout.id, { echoIds: [...loadout.echoIds, echo.id], updatedAt: Date.now() })
    return echo
  })
  if (candidate.buildCard) initializedBuildCards.add(candidate.buildCard.id)
  return saved
}
