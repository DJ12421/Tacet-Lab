import type { Echo, EquippedLoadout, OwnedCharacter, OwnedWeapon } from '../domain/types'
import { createLocalId } from '../domain/id'
import { duplicateSubstatKeys } from '../domain/echo-substats'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { db } from '../storage/database'
import { candidateErrors, candidateToEcho } from './parser'
import type { DiagnosticScanCandidate } from './types'

const normalizedIdentity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

export interface ScanSaveProgress {
  completed: number
  total: number
  phase: 'preparing' | 'writing'
}

function candidateCharacter(candidate: DiagnosticScanCandidate) {
  const name = candidate.buildCard?.character.value.trim() || candidate.fields.equippedBy.value.trim()
  const entry = characterCatalog.find((item) => item.id === candidate.buildCard?.characterCatalogId)
    ?? characterCatalog.find((item) => normalizedIdentity(item.name) === normalizedIdentity(name))
  return { entry, name }
}

function candidateWeapon(candidate: DiagnosticScanCandidate) {
  return weaponCatalog.find((item) => item.id === candidate.buildCard?.weaponCatalogId)
    ?? weaponCatalog.find((item) => normalizedIdentity(item.name) === normalizedIdentity(candidate.buildCard?.weapon.value ?? ''))
}

export async function saveScannedCandidates(
  candidates: DiagnosticScanCandidate[],
  onProgress?: (progress: ScanSaveProgress) => void
) {
  if (!candidates.length) return []
  for (const candidate of candidates) {
    const errors = candidateErrors(candidate)
    if (errors.length) throw new Error(errors.join(' '))
    if (duplicateSubstatKeys(candidate.fields.subStats.map((field) => field.value)).length) throw new Error('Each substat type can only appear once.')
  }

  const groups = new Map<string, DiagnosticScanCandidate[]>()
  for (const candidate of candidates) {
    const key = candidate.buildCard ? `card:${candidate.buildCard.id}` : `candidate:${candidate.id}`
    groups.set(key, [...(groups.get(key) ?? []), candidate])
  }

  return db.transaction('rw', [db.echoes, db.characters, db.weapons, db.equippedLoadouts], async () => {
    const saved: Echo[] = []
    const pendingEchoes: Echo[] = []
    const pendingEchoesById = new Map<string, Echo>()
    let completed = 0

    for (const group of groups.values()) {
      const first = group[0]
      const { entry: characterEntry, name: characterName } = candidateCharacter(first)
      const weaponEntry = candidateWeapon(first)
      let ownedCharacter: OwnedCharacter | undefined = characterEntry
        ? await db.characters.where('catalogId').equals(characterEntry.id).first()
        : undefined

      if (characterEntry && !ownedCharacter) {
        ownedCharacter = {
          id: createLocalId(), catalogId: characterEntry.id,
          level: first.buildCard?.characterLevel.value ?? 1,
          sequence: first.buildCard?.sequence.value ?? 0,
          skillLevels: first.buildCard?.skillLevels.map((field) => field.value) ?? [1, 1, 1, 1, 1],
          locked: false, favorite: false, createdAt: Date.now()
        }
        await db.characters.add(ownedCharacter)
      } else if (ownedCharacter && first.buildCard) {
        const patch: Partial<OwnedCharacter> = {
          level: first.buildCard.characterLevel.value,
          sequence: first.buildCard.sequence.value,
          skillLevels: first.buildCard.skillLevels.map((field) => field.value)
        }
        await db.characters.update(ownedCharacter.id, patch)
        ownedCharacter = { ...ownedCharacter, ...patch }
      }

      let ownedWeapon: OwnedWeapon | undefined
      if (weaponEntry) {
        const copies = await db.weapons.where('catalogId').equals(weaponEntry.id).toArray()
        ownedWeapon = copies.find((weapon) => weapon.equippedBy === ownedCharacter?.id) ?? copies.find((weapon) => !weapon.equippedBy)
      }
      if (weaponEntry && !ownedWeapon) {
        ownedWeapon = {
          id: createLocalId(), catalogId: weaponEntry.id,
          level: first.buildCard?.weaponLevel.value ?? 1,
          rank: first.buildCard?.weaponRank.value ?? 1,
          locked: Boolean(first.buildCard), equippedBy: ownedCharacter?.id, createdAt: Date.now()
        }
        if (ownedCharacter) await db.weapons.where('equippedBy').equals(ownedCharacter.id).modify({ equippedBy: undefined })
        await db.weapons.add(ownedWeapon)
      } else if (ownedWeapon && ownedCharacter && first.buildCard) {
        if (ownedWeapon.equippedBy && ownedWeapon.equippedBy !== ownedCharacter.id) {
          const previous = await db.equippedLoadouts.where('characterId').equals(ownedWeapon.equippedBy).first()
          if (previous?.weaponId === ownedWeapon.id) await db.equippedLoadouts.update(previous.id, { weaponId: '', updatedAt: Date.now() })
        }
        await db.weapons.where('equippedBy').equals(ownedCharacter.id).modify({ equippedBy: undefined })
        const patch: Partial<OwnedWeapon> = {
          level: first.buildCard.weaponLevel.value,
          rank: first.buildCard.weaponRank.value,
          locked: true,
          equippedBy: ownedCharacter.id
        }
        await db.weapons.update(ownedWeapon.id, patch)
        ownedWeapon = { ...ownedWeapon, ...patch }
      }

      let loadout: EquippedLoadout | undefined = ownedCharacter
        ? await db.equippedLoadouts.where('characterId').equals(ownedCharacter.id).first()
        : undefined
      if (ownedCharacter && !loadout) {
        loadout = { id: `equipped:${ownedCharacter.id}`, characterId: ownedCharacter.id, weaponId: ownedWeapon?.id ?? '', echoIds: [], updatedAt: Date.now() }
        await db.equippedLoadouts.add(loadout)
      } else if (loadout && ownedWeapon) {
        loadout = { ...loadout, weaponId: ownedWeapon.id, updatedAt: Date.now() }
        await db.equippedLoadouts.put(loadout)
      }

      if (loadout && ownedCharacter && first.buildCard && group.length > 1) {
        await db.echoes.where('equippedBy').equals(ownedCharacter.id).modify({ equippedBy: undefined, equippedByName: undefined })
        loadout = { ...loadout, echoIds: [], updatedAt: Date.now() }
      }

      const storedAssigned = loadout && (!first.buildCard || group.length === 1) ? await db.echoes.bulkGet(loadout.echoIds) : []
      const existingAssigned = loadout
        ? storedAssigned.map((echo, index) => echo ?? pendingEchoesById.get(loadout.echoIds[index])).filter((echo): echo is Echo => Boolean(echo))
        : []
      const assigned: Echo[] = [...existingAssigned]
      const newlyAssigned: Echo[] = []
      const groupEchoes: Echo[] = []
      for (const candidate of group) {
        const echo = candidateToEcho(candidate)
        if (candidate.buildCard) { echo.locked = true; echo.excluded = false }
        const cost = assigned.reduce((sum, item) => sum + item.cost, 0)
        const canAssign = Boolean(loadout && ownedCharacter && assigned.length < 5 && cost + echo.cost <= 12)
        echo.equippedByName = canAssign || !loadout ? characterEntry?.name ?? (characterName || undefined) : undefined
        if (canAssign && ownedCharacter) { echo.equippedBy = ownedCharacter.id; assigned.push(echo); newlyAssigned.push(echo) }
        groupEchoes.push(echo)
        saved.push(echo)
        completed += 1
        onProgress?.({ completed, total: candidates.length, phase: 'preparing' })
      }

      pendingEchoes.push(...groupEchoes)
      groupEchoes.forEach((echo) => pendingEchoesById.set(echo.id, echo))
      if (loadout) {
        const previousIds = first.buildCard && group.length > 1 ? [] : loadout.echoIds
        loadout = { ...loadout, echoIds: [...previousIds, ...newlyAssigned.map((echo) => echo.id)].slice(0, 5), updatedAt: Date.now() }
        await db.equippedLoadouts.put(loadout)
      }
    }

    onProgress?.({ completed: candidates.length, total: candidates.length, phase: 'writing' })
    await db.echoes.bulkAdd(pendingEchoes)
    return saved
  })
}

export async function saveScannedCandidate(candidate: DiagnosticScanCandidate) {
  return (await saveScannedCandidates([candidate]))[0]
}
