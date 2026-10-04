import type { Echo, OwnedWeapon } from './types'

export function echoStatIdentity(echo: Echo): string {
  return JSON.stringify([
    echo.name, echo.sonata, echo.cost, echo.rarity, echo.level,
    echo.mainStat.key, echo.mainStat.value,
    [...echo.subStats].sort((left, right) => left.key.localeCompare(right.key)).map(({ key, value }) => [key, value])
  ])
}

export function buildEquipmentIdentity(weaponId: string, echoIds: string[], weapons: OwnedWeapon[], echoes: Echo[]): string {
  const weapon = weapons.find((entry) => entry.id === weaponId)
  const echoById = new Map(echoes.map((echo) => [echo.id, echo]))
  return JSON.stringify([
    weapon?.catalogId ?? weaponId,
    echoIds.map((id) => echoById.has(id) ? echoStatIdentity(echoById.get(id)!) : `missing:${id}`)
  ])
}
