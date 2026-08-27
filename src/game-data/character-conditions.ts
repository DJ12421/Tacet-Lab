import type { GeneratedCharacterCatalogEntry } from './catalog-types.generated'
import { mechanicsCatalog } from './mechanics'
import type { CalculationEffectDefinition, CalculationModifier } from '../domain/calculation-v2/types'

export type CharacterSkillCardKey = keyof GeneratedCharacterCatalogEntry['skillIcons'] | 'outroSkill'

export interface CharacterConditionModifier {
  modifier?: string
  modifierValue?: number | string | Array<number | string> | Record<string, number | string>
  modifySpecificTalents?: string[]
  modifierTalentKey?: string
  modifierValueTalentRef?: string
  maximumValue?: number
  modifierStep?: number
  overflowStep?: number
  overflowMin?: number
  overflowMax?: number
  modifierBasedOn?: string
  modifierTargetAttr?: string
  minStatValue?: number
}

export interface CharacterCondition {
  key: string
  legacyKey: string
  name: string
  description: string
  alwaysEnabled: boolean
  hasStacks: boolean
  minStacks: number
  maxStacks: number
  stance?: string
  appliesOnEveryStep?: number
  sequence: number
  modifiers: CharacterConditionModifier[]
}

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const legacyKeyPart = (value: string) => value.replace(/[^a-z0-9]+/gi, '')
const decimalValue = (value: number | string) => typeof value === 'number' ? value / 100 : value
const modifierForLegacySheet = (modifier: CalculationModifier): CharacterConditionModifier => ({
  modifier:modifier.modifier,
  modifierValue:typeof modifier.modifierValue === 'number' || typeof modifier.modifierValue === 'string'
    ? decimalValue(modifier.modifierValue)
    : Array.isArray(modifier.modifierValue)
      ? modifier.modifierValue.map(decimalValue)
      : modifier.modifierValue
        ? Object.fromEntries(Object.entries(modifier.modifierValue).map(([key, value]) => [key, decimalValue(value)]))
        : undefined,
  modifySpecificTalents:modifier.modifySpecificTalents,
  modifierTalentKey:modifier.modifierTalentKey,
  modifierValueTalentRef:modifier.modifierValueTalentRef,
  maximumValue:modifier.maximumValue === undefined ? undefined : modifier.maximumValue / 100,
  modifierStep:modifier.modifierStep === undefined ? undefined : modifier.modifierStep / 100,
  overflowStep:modifier.overflowStep,
  overflowMin:modifier.overflowMin,
  overflowMax:modifier.overflowMax,
  modifierBasedOn:modifier.modifierBasedOn,
  modifierTargetAttr:modifier.modifierTargetAttr,
  minStatValue:modifier.minStatValue
})

const conditionForEffect = (effect: CalculationEffectDefinition): CharacterCondition => ({
  key:normalized(effect.id),
  legacyKey:effect.sequence ? `SequenceNode${effect.sequence}${legacyKeyPart(effect.name)}` : legacyKeyPart(effect.name),
  name:effect.name,
  description:effect.description,
  alwaysEnabled:effect.alwaysEnabled,
  hasStacks:effect.hasStacks,
  minStacks:effect.minStacks,
  maxStacks:effect.maxStacks,
  stance:effect.stance,
  appliesOnEveryStep:effect.appliesOnEveryStep,
  sequence:effect.sequence ?? 0,
  modifiers:effect.modifiers.map(modifierForLegacySheet)
})

const conditionCatalogByKey = new Map(mechanicsCatalog.characters.map((character) => [
  normalized(character.name),
  [...character.effects, ...character.sequences]
    .filter((effect) => effect.scope === 'self')
    .map(conditionForEffect)
]))

export const characterConditionId = (condition: CharacterCondition) => `v2:${condition.key}`
export const legacyCharacterConditionId = (condition: CharacterCondition) => `wt:${condition.legacyKey}`
export const characterConditionStackId = (condition: CharacterCondition) => `${characterConditionId(condition)}:stacks`
export const characterConditionModeId = 'v2:mode'
export const legacyCharacterConditionModeId = 'wt:mode'

export function characterConditionCatalogKey(character: GeneratedCharacterCatalogEntry) {
  return character.name
}

export function characterConditions(character: GeneratedCharacterCatalogEntry): CharacterCondition[] {
  return conditionCatalogByKey.get(normalized(characterConditionCatalogKey(character))) ?? []
}

export function characterConditionModes(character: GeneratedCharacterCatalogEntry) {
  return [...new Set(characterConditions(character).flatMap((condition) => condition.stance ? [condition.stance] : []))]
}

export function characterConditionRequiresToggle(condition: CharacterCondition) {
  return !condition.alwaysEnabled
}

export function characterConditionInherentSkillIndex(condition: CharacterCondition, character: GeneratedCharacterCatalogEntry) {
  if (!/^inherent skill\b/i.test(condition.name)) return undefined
  const conditionName = normalized(condition.name.replace(/^inherent skill\s*:?\s*/i, ''))
  const index = character.skillTreeExtras.inherentSkills.findIndex((skill) => {
    const skillName = normalized(skill.name)
    return skillName.length > 3 && conditionName.includes(skillName)
  })
  return index >= 0 ? index : undefined
}

export function characterConditionCard(condition: CharacterCondition, character: GeneratedCharacterCatalogEntry): CharacterSkillCardKey {
  const conditionName = normalized(condition.name)
  const direct = Object.entries(character.skillIcons).find(([, skill]) => {
    const skillName = normalized(skill.name)
    return skillName.length > 3 && (conditionName.includes(skillName) || skillName.includes(conditionName))
  })
  if (direct) return direct[0] as keyof GeneratedCharacterCatalogEntry['skillIcons']
  const text = `${condition.key} ${condition.name} ${condition.description}`
  if (/\boutro\b/i.test(text)) return 'outroSkill'
  if (/\bintro\b/i.test(text)) return 'introSkill'
  if (/resonance liberation|\bliberation\b/i.test(text)) return 'resonanceLiberation'
  if (/forte circuit|\bforte\b/i.test(text)) return 'forteCircuit'
  if (/resonance skill|\bskill\b/i.test(text)) return 'resonanceSkill'
  if (/normal attack|basic attack|heavy attack|dodge counter|mid-air|plunging/i.test(text)) return 'normalAttack'
  return 'forteCircuit'
}

export function conditionTargetsAttack(condition: CharacterCondition, attackName: string) {
  const targets = condition.modifiers.flatMap((modifier) => modifier.modifySpecificTalents ?? [])
  if (!targets.length) return true
  const attack = normalized(attackName)
  return targets.some((target) => {
    const candidate = normalized(target)
    return candidate.length > 2 && (attack.includes(candidate) || candidate.includes(attack))
  })
}

export const characterConditionProvenance = mechanicsCatalog.provenance
