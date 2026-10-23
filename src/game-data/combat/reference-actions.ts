import type { ActionFormula, CharacterActionMechanics, DamageType, Element, ScalingStat } from '../../domain/combat'
import { generatedCharacterCatalog } from '../characters.generated'
import source from './reference-actions.generated.json'

const damageTypes: Record<string, DamageType> = {
  Basic:'basic', Heavy:'heavy', Skill:'skill', Liberation:'liberation',
  Intro:'intro', Outro:'outro'
}
const groups: Record<string, [string, number]> = {
  basic:['Normal Attack', 0], skill:['Resonance Skill', 1],
  forteCircuit:['Forte Circuit', 2], liberation:['Resonance Liberation', 3],
  intro:['Intro Skill', 4], outro:['Outro Skill', 4]
}
const scalingStats: Record<string, ScalingStat> = { attack:'atk', hp:'hp', defense:'def' }
const elements: Record<string, Element> = {
  Spectro:'spectro', Fusion:'fusion', Glacio:'glacio', Electro:'electro',
  Aero:'aero', Havoc:'havoc'
}
const characters = new Map(generatedCharacterCatalog.map(character => [character.id, character]))

export const referenceAdditionalActions: Readonly<Record<string, Readonly<Record<string, CharacterActionMechanics>>>> = Object.fromEntries(
  Object.entries(source).map(([characterId, rows]) => {
    const character = characters.get(characterId)
    if (!character) throw new Error(`Missing character for reference actions: ${characterId}`)
    return [characterId, Object.fromEntries(rows.map(row => {
      const id = `${characterId}:reference:${row.key}`
      const group = groups[row.group]
      const scaling = scalingStats[row.scaling]
      const damageType = damageTypes[row.type]
      if (!group || !scaling || !damageType) throw new Error(`Invalid reference action: ${id}`)
      const formulas = Object.fromEntries(Object.entries(row.formulas).map(([level, hits]): [string, ActionFormula] =>
        [level, { kind:'damage', scaling:{ [scaling]:1 }, hits, canCrit:true }]))
      const minimumSequence = /^S([1-6])\b/.exec(row.name)?.[1]
      const action: CharacterActionMechanics = {
        id, name:row.name, group:group[0], sourceId:`character:${characterId}:reference:${row.key}`,
        reviewFingerprint:`unverified:reference:${row.key}`, kind:'damage', damageType,
        element:elements[character.element] ?? 'none', tags:row.coordinated ? ['coordinated'] : [],
        skillLevelIndex:group[1], ...(minimumSequence ? { minimumSequence:Number(minimumSequence) } : {}), formulas
      }
      return [id, action]
    }))]
  })
)
