import { characterCatalog } from '../catalog'
import { echoCatalog } from '../echoes'
import { isFixedSkillValueName } from '../attack-values'
import { importedAbilityForName } from './imported-actions'
import { mechanicsRegistry } from './registry'
import type { EchoActionMechanics } from '../../domain/combat'

const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const comparableId = (value: string) => value.replaceAll('-', ':')

export function resolveRotationActionId(characterId: string, sourceId: string | null, label: string, mainEchoName?: string): string | undefined {
  const catalog = characterCatalog.find((entry) => entry.id === characterId)
  const echo = echoCatalog.find((entry) => key(entry.name) === key(mainEchoName ?? ''))
  const characterActions = Object.values(mechanicsRegistry.characters[characterId]?.actions ?? {})
  const echoActions: EchoActionMechanics[] = echo?.id ? Object.values(mechanicsRegistry.echoes?.[echo.id]?.actions ?? {}) : []
  const candidates = [
    ...(catalog?.attacks.filter((attack) => !isFixedSkillValueName(attack.name)) ?? []),
    ...characterActions,
    ...echoActions
  ]
  if (sourceId) {
    const direct = candidates.find((action) => action.id === sourceId)
      ?? candidates.find((action) => comparableId(action.id) === comparableId(sourceId))
    if (direct) return direct.id
  }

  const imported = importedAbilityForName(characterId, label)
  if (imported?.tacetActionId) {
    const match = candidates.find((action) => action.id === imported.tacetActionId)
    if (match) return match.id
  }

  if (echo && key(label) === key(`Echo: ${echo.name}`)) {
    const primary = echoActions.find((action) => action.id === `echo:${echo.id}:skill` || action.id === `echo:${echo.id}:skill:1`)
    if (primary) return primary.id
    if (echoActions.length === 1) return echoActions[0].id
    const damage = echoActions.filter((action) => action.kind === 'damage')
    if (damage.length === 1) return damage[0].id
  }

  const exact = candidates.filter((action) => 'name' in action && key(action.name) === key(label))
  if (exact.length === 1) return exact[0].id
  const unprefixed = label.replace(/^(?:Basic|Heavy|Forte|Skill|Liberation|Intro|Outro|Echo):\s*/i, '')
  const suffixKey = key(unprefixed)
  if (!suffixKey) return undefined
  const suffix = candidates.filter((action) => 'name' in action && key(action.name).endsWith(suffixKey))
  return suffix.length === 1 ? suffix[0].id : undefined
}
