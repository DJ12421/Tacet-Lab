import { aggregateStats, applyBuffEffects, defenseMultiplier, floorGameValue, resistanceMultiplier } from '../damage'
import type { AttackDefinition, BuffEffect, Build, Echo, EnemyConfig, OwnedCharacter, OwnedWeapon, Resonator, TeamScenario, Weapon } from '../types'
import {
  baseTuneBreakBoost, characterConditionId, characterConditionInherentSkillIndex, characterConditionModes, characterConditionRequiresToggle, characterConditions, characterCatalog,
  isFixedSkillValueName, weaponCatalog, weaponPassiveConditions, type CharacterConditionModifier
} from '../../game-data'
import { defaultEnabledSkillTreeBonusIds, inherentSkillBonusId, resolveCharacterShowcaseModel, weaponSecondaryStat } from '../../ui/character-showcase-model'
import type { CalculationContext, FormulaEntry, FormulaScalar } from './engine'

export interface BuildCalculationInput {
  build: Build
  character: OwnedCharacter
  weapon: OwnedWeapon
  echoes: Echo[]
  enemy: EnemyConfig
  scenario?: TeamScenario
  buffs?: BuffEffect[]
  actionInputs?: Record<string, FormulaScalar>
  targetId?: string
}

const numericInput = (value: FormulaScalar | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const normalizedTarget = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

function modifierTargetsAttack(modifier: CharacterConditionModifier, attackName: string) {
  if (!modifier.modifySpecificTalents?.length) return true
  const attack = normalizedTarget(attackName)
  return modifier.modifySpecificTalents.some((target) => {
    const candidate = normalizedTarget(target)
    return candidate.length > 2 && (attack.includes(candidate) || candidate.includes(attack))
  })
}

function numericModifierValue(modifier: CharacterConditionModifier, character: OwnedCharacter) {
  if (typeof modifier.modifierValue === 'number') return modifier.modifierValue
  if (!modifier.modifierValue || Array.isArray(modifier.modifierValue) || typeof modifier.modifierValue !== 'object') return 0
  const levelIndex = modifier.modifierValueTalentRef === 'basic' ? 0
    : modifier.modifierValueTalentRef === 'skill' ? 1
      : modifier.modifierValueTalentRef === 'forte' ? 2
        : modifier.modifierValueTalentRef === 'liberation' ? 3 : 4
  const level = character.skillLevels?.[levelIndex] ?? 1
  return Number(modifier.modifierValue[String(level)] ?? 0)
}

export function resolveRuntimeBuild(build: Build, characters: OwnedCharacter[], weapons: OwnedWeapon[]): { character: OwnedCharacter; weapon: OwnedWeapon; resonator: Resonator; runtimeWeapon: Weapon } | undefined {
  const ownedCharacter = characters.find((entry) => entry.catalogId === build.resonatorId)
  const ownedWeapon = weapons.find((entry) => entry.id === build.weaponId)
  const character = characterCatalog.find((entry) => entry.id === ownedCharacter?.catalogId)
  const weapon = weaponCatalog.find((entry) => entry.id === ownedWeapon?.catalogId)
  if (!ownedCharacter || !ownedWeapon || !character || !weapon || !character.levelStats.length || !weapon.levelStats.length) return undefined
  const characterStats = character.levelStats.reduce((nearest, row) => Math.abs(row.level - ownedCharacter.level) < Math.abs(nearest.level - ownedCharacter.level) ? row : nearest)
  const weaponStats = weapon.levelStats.reduce((nearest, row) => Math.abs(row.level - ownedWeapon.level) < Math.abs(nearest.level - ownedWeapon.level) ? row : nearest)
  const element = character.element.toLowerCase() as Resonator['element']
  const attacks: AttackDefinition[] = character.attacks.filter((attack) => !isFixedSkillValueName(attack.name)).map((attack) => {
    const level = Math.max(1, Math.min(attack.multipliers.length, ownedCharacter.skillLevels?.[attack.skillLevelIndex] ?? build.skillLevel ?? 1))
    return { id: attack.id, name: attack.name, type: attack.type, element, multiplier: attack.multipliers[level - 1] ?? attack.multipliers[0] ?? 0, hits: 1, scalesWith: attack.scalesWith }
  })
  return {
    character: ownedCharacter,
    weapon: ownedWeapon,
    resonator: { id: character.id, name: character.name, element, role: character.role, accent: '', baseStats: { hp: characterStats.hp, atk: characterStats.atk, def: characterStats.def, critRate: character.baseStats.critRate, critDamage: character.baseStats.critDamage }, attacks },
    runtimeWeapon: { id: ownedWeapon.id, name: weapon.name, type: weapon.type.toLowerCase() as Weapon['type'], baseAtk: weaponStats.baseAtk, stat: weaponSecondaryStat(weapon, weaponStats.secondaryStatValue) }
  }
}

export function createBuildCalculationContext(input: BuildCalculationInput): CalculationContext {
  const character = characterCatalog.find((entry) => entry.id === input.character.catalogId)
  const weapon = weaponCatalog.find((entry) => entry.id === input.weapon.catalogId)
  if (!character || !weapon) throw new Error('Character or weapon catalog data is unavailable.')
  const characterStats = character.levelStats.reduce((nearest, row) => Math.abs(row.level - input.character.level) < Math.abs(nearest.level - input.character.level) ? row : nearest)
  const weaponStats = weapon.levelStats.reduce((nearest, row) => Math.abs(row.level - input.weapon.level) < Math.abs(nearest.level - input.weapon.level) ? row : nearest)
  const runtimeCharacter = {
    id: character.id, name: character.name, element: character.element.toLowerCase() as 'spectro' | 'fusion' | 'glacio' | 'electro' | 'aero' | 'havoc', role: character.role, accent: '',
    baseStats: { hp: characterStats.hp, atk: characterStats.atk, def: characterStats.def, critRate: character.baseStats.critRate, critDamage: character.baseStats.critDamage }, attacks: []
  }
  const runtimeWeapon = { id: input.weapon.id, name: weapon.name, type: weapon.type.toLowerCase() as 'broadblade' | 'sword' | 'pistols' | 'gauntlets' | 'rectifier', baseAtk: weaponStats.baseAtk, stat: weaponSecondaryStat(weapon, weaponStats.secondaryStatValue) }
  const showcase = resolveCharacterShowcaseModel({
    character: input.character,
    catalog: character,
    weapons: [input.weapon],
    echoes: input.echoes,
    builds: [input.build],
    // Sequence modifiers are applied below from the generated condition data.
    // Excluding the showcase's parsed sequence stats prevents every always-on
    // Sequence stat from being counted once here and a second time below.
    includeSequenceBonuses: false
  })
  const baseStats = showcase?.finalStats ?? aggregateStats(runtimeCharacter, runtimeWeapon, input.echoes)
  const buffed = applyBuffEffects(baseStats, input.buffs ?? [])
  const stats = { ...buffed.stats }
  const memberConditions = input.scenario?.memberConditions[input.build.id] ?? {}
  const entries: FormulaEntry[] = []
  const conditions: Record<string, FormulaScalar> = {
    ...memberConditions,
    ...input.scenario?.enemyConditions,
    ...input.actionInputs
  }
  let conditionAmplification = 0
  let conditionSpecialMultiplier = 0
  let conditionBonusDamage = 0
  let conditionMotionValueMultiplier = 0
  let conditionAdditionalMotionValue = 0
  let conditionDefenseIgnore = 0
  let conditionDefenseReduction = 0
  let conditionResistanceIgnore = 0
  let conditionResistanceReduction = 0
  let conditionTuneBreakBoost = 0
  const targetAttackId = input.targetId?.startsWith(`${character.id}:`) ? input.targetId.slice(character.id.length + 1) : undefined
  const targetAttack = character.attacks.find((attack) => attack.id === targetAttackId)
  const targetAttackReference = targetAttack ? `${targetAttack.id} ${targetAttack.name}` : ''
  const enabledSkillTreeNodes = new Set(input.character.enabledSkillTreeBonusIds ?? defaultEnabledSkillTreeBonusIds(character))
  const selectedMode = String(memberConditions['wt:mode'] ?? characterConditionModes(character)[0] ?? '')
  if (targetAttack) for (const condition of characterConditions(character)) {
    if (condition.sequence && input.character.sequence < condition.sequence) continue
    if (condition.stance && condition.stance !== selectedMode) continue
    const inherentSkillIndex = characterConditionInherentSkillIndex(condition, character)
    if (inherentSkillIndex !== undefined && !enabledSkillTreeNodes.has(inherentSkillBonusId(inherentSkillIndex))) continue
    const raw = memberConditions[characterConditionId(condition)]
    const sequenceAlwaysOn = condition.sequence > 0 && !characterConditionRequiresToggle(condition)
    let factor = sequenceAlwaysOn ? 1 : condition.hasStacks ? numericInput(raw) : raw === true ? 1 : 0
    if (condition.appliesOnEveryStep) factor = Math.floor(factor / condition.appliesOnEveryStep)
    if (!(factor > 0)) continue
    for (const modifier of condition.modifiers) {
      if (!modifierTargetsAttack(modifier, targetAttackReference)) continue
      let value = numericModifierValue(modifier, input.character) * factor
      if (modifier.maximumValue !== undefined) value = Math.min(value, modifier.maximumValue)
      const key = modifier.modifier ?? ''
      if (key === 'ATK') stats.atk += stats.baseAtk * value
      else if (key === 'HP') stats.hp += stats.baseHp * value
      else if (key === 'DEF') stats.def += stats.baseDef * value
      else if (key.startsWith('ATK_FLAT')) stats.atk += value
      else if (key === 'CritRate' || key === 'CritRate:AdditionalBase') stats.critRate += value * 100
      else if (key === 'CritDMG' || key === 'CritDMG:AdditionalBase') stats.critDamage += value * 100
      else if (key === 'EnergyRegen') stats.energyRegen += value * 100
      else if (key === 'HealingBonus') stats.healingBonus += value * 100
      else if (key === character.element) {
        const elementDamage = `${character.element.toLowerCase()}Damage` as 'spectroDamage' | 'fusionDamage' | 'glacioDamage' | 'electroDamage' | 'aeroDamage' | 'havocDamage'
        stats[elementDamage] += value * 100
      }
      else if (key === 'BasicAttackDMGBonus' && targetAttack.type === 'basic') conditionBonusDamage += value * 100
      else if (key === 'HeavyAttackDMGBonus' && targetAttack.type === 'heavy') conditionBonusDamage += value * 100
      else if (key === 'ResonanceSkillDMGBonus' && targetAttack.type === 'skill') conditionBonusDamage += value * 100
      else if (key === 'ResonanceLiberationDMGBonus' && targetAttack.type === 'liberation') conditionBonusDamage += value * 100
      else if (key === 'IntroSkillDMGBonus' && targetAttack.type === 'intro') conditionBonusDamage += value * 100
      else if (key === 'OutroSkillDMGBonus' && targetAttack.type === 'outro') conditionBonusDamage += value * 100
      else if (key === 'DMGBonus') conditionBonusDamage += value * 100
      else if (key === 'DMGDeepen') conditionAmplification += value * 100
      else if (key === 'specialMultiplier') conditionSpecialMultiplier += value * 100
      else if (key === 'talentModifierMultiply') conditionMotionValueMultiplier += value * 100
      else if (!key && modifier.modifySpecificTalents?.length) {
        // Wuthering Tools leaves targeted DMG/healing increases untyped, while
        // actual motion-value changes are explicitly talentModifierMultiply.
        if (targetAttack.type === 'healing') conditionMotionValueMultiplier += value * 100
        else conditionBonusDamage += value * 100
      }
      else if (key === 'Talent' && modifier.modifierTalentKey && modifierTargetsAttack({ ...modifier, modifySpecificTalents: [modifier.modifierTalentKey] }, targetAttackReference)) conditionAdditionalMotionValue += value * 100
      else if (key === 'DEFIgnore' || key === `DEFIgnore:${character.element}`) conditionDefenseIgnore += value * 100
      else if (key === 'DefReduction') conditionDefenseReduction += value * 100
      else if (key === `ResistIgnore:${character.element}`) conditionResistanceIgnore += value * 100
      else if (key === `ResistShred:${character.element}`) conditionResistanceReduction += value * 100
    }
  }
  for (const condition of characterConditions(character)) {
    if (condition.sequence && input.character.sequence < condition.sequence) continue
    if (condition.stance && condition.stance !== selectedMode) continue
    const inherentSkillIndex = characterConditionInherentSkillIndex(condition, character)
    if (inherentSkillIndex !== undefined && !enabledSkillTreeNodes.has(inherentSkillBonusId(inherentSkillIndex))) continue
    const raw = memberConditions[characterConditionId(condition)]
    const sequenceAlwaysOn = condition.sequence > 0 && !characterConditionRequiresToggle(condition)
    let factor = sequenceAlwaysOn ? 1 : condition.hasStacks ? numericInput(raw) : raw === true ? 1 : 0
    if (condition.appliesOnEveryStep) factor = Math.floor(factor / condition.appliesOnEveryStep)
    if (!(factor > 0)) continue
    for (const modifier of condition.modifiers) {
      if (modifier.modifier === 'tuneBreakBoost') conditionTuneBreakBoost += numericModifierValue(modifier, input.character) * factor * 100
    }
  }
  if (targetAttack) for (const condition of weaponPassiveConditions(weapon, input.weapon.rank)) {
    const raw = memberConditions[condition.id]
    const factor = condition.alwaysOn ? 1 : condition.type === 'stack' ? numericInput(raw) : raw === true ? 1 : 0
    if (!(factor > 0)) continue
    for (const effect of condition.effects) {
      if (effect.attackType && effect.attackType !== targetAttack.type) continue
      const value = effect.value * factor
      if (effect.stat === 'atkPercent') stats.atk += stats.baseAtk * value / 100
      else if (effect.stat === 'hpPercent') stats.hp += stats.baseHp * value / 100
      else if (effect.stat === 'defPercent') stats.def += stats.baseDef * value / 100
      else if (effect.stat === 'critRate') stats.critRate += value
      else if (effect.stat === 'critDamage') stats.critDamage += value
      else if (effect.stat === 'energyRegen') stats.energyRegen += value
      else if (effect.stat === 'elementDamage') {
        const elementDamage = `${character.element.toLowerCase()}Damage` as 'spectroDamage' | 'fusionDamage' | 'glacioDamage' | 'electroDamage' | 'aeroDamage' | 'havocDamage'
        stats[elementDamage] += value
      } else if (
        (effect.stat === 'basicDamage' && targetAttack.type === 'basic')
        || (effect.stat === 'heavyDamage' && targetAttack.type === 'heavy')
        || (effect.stat === 'skillDamage' && targetAttack.type === 'skill')
        || (effect.stat === 'liberationDamage' && targetAttack.type === 'liberation')
      ) conditionBonusDamage += value
      else if (effect.stat === 'amplification') conditionAmplification += value
      else if (effect.stat === 'defenseIgnore') conditionDefenseIgnore += value
    }
  }
  stats.hp = floorGameValue(stats.hp)
  stats.atk = floorGameValue(stats.atk)
  stats.def = floorGameValue(stats.def)
  const defenseIgnore = (input.enemy.defenseIgnore ?? 0) + numericInput(conditions.defenseIgnore) + conditionDefenseIgnore
  const defenseReduction = (input.enemy.defenseReduction ?? 0) + numericInput(conditions.defenseReduction) + conditionDefenseReduction
  const resistanceIgnore = (input.enemy.resistanceIgnore ?? 0) + numericInput(conditions.resistanceIgnore) + conditionResistanceIgnore
  const resistanceReduction = (input.enemy.resistanceReduction ?? 0) + numericInput(conditions.resistanceReduction) + conditionResistanceReduction
  const inputs: Record<string, FormulaScalar> = {
    ...conditions,
    effectiveCritRate: stats.critRate,
    amplification: buffed.amplify + numericInput(conditions.amplification) + conditionAmplification,
    specialMultiplier: (input.enemy.specialMultiplier ?? 0) + numericInput(conditions.specialMultiplier) + conditionSpecialMultiplier,
    bonusDamage: numericInput(conditions.bonusDamage) + conditionBonusDamage,
    motionValueMultiplier: numericInput(conditions.motionValueMultiplier) + conditionMotionValueMultiplier,
    additionalMotionValue: numericInput(conditions.additionalMotionValue) + conditionAdditionalMotionValue,
    defenseMultiplier: defenseMultiplier(input.character.level, input.enemy.level, defenseIgnore, defenseReduction),
    resistanceMultiplier: resistanceMultiplier(input.enemy.resistance, resistanceReduction, resistanceIgnore),
    damageReduction: input.enemy.damageReduction,
    characterLevel: input.character.level,
    tuneBreakBoost: baseTuneBreakBoost(character) + conditionTuneBreakBoost,
    defenseIgnore,
    defenseReduction,
    resistanceIgnore,
    resistanceReduction
  }
  input.character.skillLevels?.forEach((level, index) => { inputs[`skillLevel:${index}`] = level })
  return { stats: { ...stats }, inputs, entries }
}
