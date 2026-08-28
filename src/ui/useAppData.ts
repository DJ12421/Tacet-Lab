import { useEffect, useState } from 'react'
import { db, ensureSeedData, getSettings, removeRedundantImportedBuilds, repairEchoAssignmentConsistency, repairNamedEchoAssignments, repairWeaponAssignmentConsistency, requestPersistentStorage } from '../storage/database'
import type { AppSettings, Build, Echo, EquippedLoadout, OwnedCharacter, OwnedWeapon, Team, TheorycraftBuild } from '../domain/types'
import { defaultSettings } from '../game-data/core'
import { ensureAllEquippedLoadouts } from '../storage/loadouts'

type RefreshScope = 'all' | 'echoes' | 'echoes-builds'

export function useAppData() {
  const [echoes, setEchoes] = useState<Echo[]>([])
  const [characters, setCharacters] = useState<OwnedCharacter[]>([])
  const [weapons, setWeapons] = useState<OwnedWeapon[]>([])
  const [builds, setBuilds] = useState<Build[]>([])
  const [equippedLoadouts, setEquippedLoadouts] = useState<EquippedLoadout[]>([])
  const [theorycraftBuilds, setTheorycraftBuilds] = useState<TheorycraftBuild[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  const refresh = async (scope: RefreshScope = 'all') => {
    if (scope === 'echoes') {
      setEchoes(await db.echoes.orderBy('createdAt').reverse().toArray())
      return
    }
    if (scope === 'echoes-builds') {
      const [nextEchoes, nextBuilds, nextEquippedLoadouts, nextTheorycraftBuilds] = await Promise.all([db.echoes.orderBy('createdAt').reverse().toArray(), db.builds.toArray(), db.equippedLoadouts.toArray(), db.theorycraftBuilds.toArray()])
      setEchoes(nextEchoes)
      setBuilds(nextBuilds)
      setEquippedLoadouts(nextEquippedLoadouts)
      setTheorycraftBuilds(nextTheorycraftBuilds)
      return
    }
    const [nextEchoes, nextCharacters, nextWeapons, nextBuilds, nextEquippedLoadouts, nextTheorycraftBuilds, nextTeams, nextSettings] = await Promise.all([
      db.echoes.orderBy('createdAt').reverse().toArray(), db.characters.orderBy('createdAt').reverse().toArray(), db.weapons.orderBy('createdAt').reverse().toArray(), db.builds.toArray(), db.equippedLoadouts.toArray(), db.theorycraftBuilds.toArray(), db.teams.toArray(), getSettings()
    ])
    setEchoes(nextEchoes)
    setCharacters(nextCharacters)
    setWeapons(nextWeapons)
    setBuilds(nextBuilds)
    setEquippedLoadouts(nextEquippedLoadouts)
    setTheorycraftBuilds(nextTheorycraftBuilds)
    setTeams(nextTeams)
    setSettings(nextSettings)
  }

  useEffect(() => {
    void requestPersistentStorage().catch(() => undefined)
    ensureSeedData().then(async () => {
      await ensureAllEquippedLoadouts()
      await removeRedundantImportedBuilds()
      await repairNamedEchoAssignments()
      await repairEchoAssignmentConsistency()
      await repairWeaponAssignmentConsistency()
      await ensureAllEquippedLoadouts()
      await refresh()
    }).catch((caught) => setError(caught instanceof Error ? caught.message : 'The local archive could not be opened.')).finally(() => setReady(true))
  }, [])

  return { echoes, characters, weapons, builds, equippedLoadouts, theorycraftBuilds, teams, settings, ready, error, refresh }
}
