import source from './imported-buffs.generated.json'

interface ImportedBuff {
  id: number
  name: string
  effect: string
  duration: string
  conditionText: string
  tagKind: string
  tagLabel: string
}

const buffs = source as unknown as Record<string, { team:ImportedBuff[]; personal:ImportedBuff[] }>

export function importedCharacterBuffs(characterId: string) {
  const character = buffs[characterId]
  return character ? [
    ...character.team.map((buff) => ({ ...buff, scope:'team' as const })),
    ...character.personal.map((buff) => ({ ...buff, scope:'personal' as const }))
  ].filter((buff) => ['kit','seq','talent'].includes(buff.tagKind)) : []
}
