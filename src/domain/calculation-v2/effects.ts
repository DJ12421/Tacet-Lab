import type {
  AttackAdjustment,
  CalculationEffectAccumulator,
  CalculationEffectDefinition,
  CalculationEffectSelection,
  CalculationModifier,
  CalculationSourceStats,
  CalculationStatsV2,
  CalculationValueUnit
} from './types'

const elements = ['glacio', 'fusion', 'electro', 'aero', 'spectro', 'havoc'] as const
const typeAliases: Record<string, keyof CalculationStatsV2['typeDamage']> = {
  BasicAttackDMGBonus: 'basic',
  HeavyAttackDMGBonus: 'heavy',
  ResonanceSkillDMGBonus: 'skill',
  ResonanceLiberationDMGBonus: 'liberation',
  IntroSkillDMGBonus: 'intro',
  OutroSkillDMGBonus: 'outro',
  EchoDMGBonus: 'echo',
  CoordinatedDMGBonus: 'coordinated'
}

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

function adjustment(accumulator: CalculationEffectAccumulator, target: string): AttackAdjustment {
  return accumulator.attackAdjustments[target] ??= {
    additionalMotionValue: 0,
    motionValueMultiplier: 0,
    specialMotionValueMultiplier: 0
  }
}

function resolveRawValue(modifier: CalculationModifier, selection: CalculationEffectSelection, skillLevels: Record<string, number>) {
  if (modifier.modifierByRefinement) {
    const rank = Math.max(1, Math.min(5, selection.refinement ?? 1))
    return modifier.modifierByRefinement[String(rank)] ?? 0
  }
  if (typeof modifier.modifierValue === 'number' || typeof modifier.modifierValue === 'string') return modifier.modifierValue
  if (Array.isArray(modifier.modifierValue)) return modifier.modifierValue[0] ?? 0
  if (modifier.modifierValue && typeof modifier.modifierValue === 'object') {
    const level = skillLevels[modifier.modifierValueTalentRef ?? ''] ?? 1
    return modifier.modifierValue[String(level)] ?? 0
  }
  return 0
}

function numericValue(value: number | string, unit: CalculationValueUnit, modifier = '') {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return 0
  if (/^(?:ATK|HP|DEF)_FLAT/.test(modifier)) return parsed
  return unit === 'decimal' ? parsed * 100 : parsed
}

function selectionFactor(effect: CalculationEffectDefinition, selection: CalculationEffectSelection) {
  if (!selection.enabled && !effect.alwaysEnabled) return 0
  if (!effect.hasStacks) return 1
  const stacks = Math.max(effect.minStacks, Math.min(effect.maxStacks, selection.stacks ?? Number(selection.value ?? effect.minStacks)))
  return effect.appliesOnEveryStep ? Math.floor(stacks / effect.appliesOnEveryStep) : stacks
}

/** Resolve a provider-stat-scaled modifier in its catalog unit before display/application conversion. */
export function resolveSourceScaledModifierValue(
  effect: CalculationEffectDefinition,
  modifier: CalculationModifier,
  selection: CalculationEffectSelection,
  sourceStats: CalculationSourceStats,
  fallbackStats?: CalculationStatsV2,
  skillLevels: Record<string, number> = {}
) {
  if (!modifier.modifierBasedOn || !modifier.modifierStep) return undefined
  const dependencyStats = (effect.sourceBuildId ? sourceStats[effect.sourceBuildId] : undefined) ?? fallbackStats
  if (!dependencyStats) return undefined
  const ratioDependency = modifier.modifierBasedOn === 'EnergyRegen' || modifier.modifierBasedOn === 'CritRate'
  const dependency = modifier.modifierBasedOn === 'EnergyRegen' ? dependencyStats.energyRegen / 100
    : modifier.modifierBasedOn === 'CritRate' ? dependencyStats.critRate / 100
      : modifier.modifierBasedOn === 'HP' ? dependencyStats.hp
        : modifier.modifierBasedOn === 'ATK' ? dependencyStats.atk
          : modifier.modifierBasedOn === 'DEF' ? dependencyStats.def
            : undefined
  if (dependency === undefined) return undefined
  const dependencyScale = ratioDependency ? 100 : 1
  const additionalAmount = dependency * dependencyScale - (modifier.minStatValue ?? 0) * dependencyScale
  const steps = Math.min(modifier.maxSteps ?? Number.POSITIVE_INFINITY, Math.max(0, Math.floor(additionalAmount / modifier.modifierStep)))
  const raw = resolveRawValue(modifier, selection, skillLevels)
  const rawValue = typeof raw === 'number' ? raw : Number.parseFloat(raw)
  if (!Number.isFinite(rawValue)) return 0
  const valuePerStack = Math.min(modifier.perStackMaximumValue ?? Number.POSITIVE_INFINITY, steps * rawValue)
  return Math.min(modifier.maximumValue ?? Number.POSITIVE_INFINITY, Math.max(0, valuePerStack * selectionFactor(effect, selection)))
}

function stackingMagnitude(effect: CalculationEffectDefinition, selection: CalculationEffectSelection, skillLevels: Record<string, number>) {
  const factor = selectionFactor(effect, selection)
  return effect.modifiers.reduce((total, modifier) => {
    const raw = modifier.maximumValue ?? resolveRawValue(modifier, selection, skillLevels)
    const numeric = typeof raw === 'number' ? raw : Number.parseFloat(raw)
    return total + (Number.isFinite(numeric) ? Math.abs(numeric * factor) : 0)
  }, 0)
}

function strongestStackingEffects(
  effects: CalculationEffectDefinition[],
  selections: Record<string, CalculationEffectSelection>,
  skillLevels: Record<string, number>
) {
  const ungrouped: CalculationEffectDefinition[] = []
  const grouped = new Map<string, { effect: CalculationEffectDefinition; magnitude: number }>()
  for (const effect of effects) {
    if (!effect.stackingGroup) { ungrouped.push(effect); continue }
    const selection = selections[effect.id] ?? { enabled: effect.alwaysEnabled }
    if (!(selectionFactor(effect, selection) > 0)) continue
    const magnitude = stackingMagnitude(effect, selection, skillLevels)
    const current = grouped.get(effect.stackingGroup)
    if (!current || magnitude > current.magnitude || (magnitude === current.magnitude && effect.id.localeCompare(current.effect.id) < 0)) {
      grouped.set(effect.stackingGroup, { effect, magnitude })
    }
  }
  return [...ungrouped, ...[...grouped.values()].map((entry) => entry.effect)]
}

function targetsAttack(modifier: CalculationModifier, attackKey: string, attackName: string) {
  if (!modifier.modifySpecificTalents?.length) return true
  const attack = `${normalized(attackKey)} ${normalized(attackName)}`
  return modifier.modifySpecificTalents.some((target) => {
    const candidate = normalized(target)
    return candidate.length > 2 && attack.includes(candidate)
  })
}

function addTypeBonus(accumulator: CalculationEffectAccumulator, key: keyof CalculationStatsV2['typeDamage'], value: number) {
  accumulator.stats.typeDamage[key] = (accumulator.stats.typeDamage[key] ?? 0) + value
}

function applyModifier(
  accumulator: CalculationEffectAccumulator,
  effect: CalculationEffectDefinition,
  modifier: CalculationModifier,
  value: number,
  attackKey: string,
  attackName: string,
  resolvedRawValue?: number | string
) {
  const key = modifier.modifier ?? ''
  const targetNames = modifier.modifySpecificTalents ?? (modifier.modifierTalentKey ? [modifier.modifierTalentKey] : [])
  const record = (recorded: number | string = value) => accumulator.appliedEffects.push({
    effectId: effect.id,
    name: effect.name,
    sourceKind: effect.sourceKind,
    sourceId: effect.sourceId,
    modifier: key || 'specificDamage',
    value: recorded,
    targets: targetNames.length ? targetNames : undefined
  })

  if (!targetsAttack(modifier, attackKey, attackName)) return

  if (key === 'ATK') accumulator.stats.atk += accumulator.stats.baseAtk * value / 100
  else if (key === 'HP') accumulator.stats.hp += accumulator.stats.baseHp * value / 100
  else if (key === 'DEF') accumulator.stats.def += accumulator.stats.baseDef * value / 100
  else if (key === 'ATK_FLAT') accumulator.stats.atk += value
  else if (key === 'HP_FLAT') accumulator.stats.hp += value
  else if (key === 'DEF_FLAT') accumulator.stats.def += value
  else if (key === 'ATK:AdditionalBase') accumulator.stats.baseAtk += accumulator.stats.baseAtk * value / 100
  else if (key.startsWith('ATK_FLAT') && key.endsWith(':AdditionalBase')) accumulator.stats.baseAtk += value
  else if (key === 'CritRate' || key === 'CritRate:AdditionalBase') accumulator.stats.critRate += value
  else if (key === 'CritDMG' || key === 'CritDMG:AdditionalBase') accumulator.stats.critDamage += value
  else if (key === 'EnergyRegen') accumulator.stats.energyRegen += value
  else if (key === 'HealingBonus') accumulator.stats.healingBonus += value
  else if (key === 'ShieldBonus') accumulator.stats.shieldBonus += value
  else if (key === 'DMGBonus' || key === 'DMGBonus:AdditionalBase') accumulator.stats.damageBonus += value
  else if (typeAliases[key]) addTypeBonus(accumulator, typeAliases[key], value)
  else if (key === 'AllElementAttributeBonus') for (const element of elements) accumulator.stats.elementalDamage[element] += value
  else if (key === 'AllAttributeBonus') {
    for (const element of elements) accumulator.stats.elementalDamage[element] += value
    for (const type of ['basic', 'heavy', 'skill', 'liberation', 'intro', 'outro', 'echo'] as const) addTypeBonus(accumulator, type, value)
  } else if (elements.some((element) => element.toLowerCase() === key.toLowerCase())) {
    const element = elements.find((candidate) => candidate.toLowerCase() === key.toLowerCase())!
    accumulator.stats.elementalDamage[element] += value
  } else if (key === 'DMGDeepen') accumulator.amplification += value
  else if (key.startsWith('DMGDeepen:')) accumulator.specificDeepen[key.slice('DMGDeepen:'.length)] = (accumulator.specificDeepen[key.slice('DMGDeepen:'.length)] ?? 0) + value
  else if (key === 'specialMultiplier') accumulator.specialMultiplier += value
  else if (key.startsWith('specialMultiplier:')) accumulator.scopedSpecialMultiplier[key.slice('specialMultiplier:'.length)] = (accumulator.scopedSpecialMultiplier[key.slice('specialMultiplier:'.length)] ?? 0) + value
  else if (key === 'DEFIgnore') accumulator.defenseIgnore += value
  else if (key.startsWith('DEFIgnore:')) accumulator.scopedDefenseIgnore[key.slice('DEFIgnore:'.length)] = (accumulator.scopedDefenseIgnore[key.slice('DEFIgnore:'.length)] ?? 0) + value
  else if (key === 'DefReduction') accumulator.defenseReduction += value
  else if (key.startsWith('ResistIgnore:')) accumulator.scopedResistanceIgnore[key.slice('ResistIgnore:'.length)] = (accumulator.scopedResistanceIgnore[key.slice('ResistIgnore:'.length)] ?? 0) + value
  else if (key.startsWith('ResistShred:')) accumulator.scopedResistanceReduction[key.slice('ResistShred:'.length)] = (accumulator.scopedResistanceReduction[key.slice('ResistShred:'.length)] ?? 0) + value
  else if (key === 'Talent') for (const target of targetNames) adjustment(accumulator, target).additionalMotionValue += value
  else if (key === 'talentModifierMultiply') for (const target of targetNames) adjustment(accumulator, target).motionValueMultiplier += value
  else if (key === 'talentModifierSpecialMultiply') for (const target of targetNames) adjustment(accumulator, target).specialMotionValueMultiplier += value
  else if (key === 'talentModifierMultiplyAdd') for (const target of targetNames) adjustment(accumulator, target).motionValueMultiplier += value
  else if (key === 'talentModifierMultiplySetValue') for (const target of targetNames) adjustment(accumulator, target).motionValueMultiplier = value
  else if (key === 'talentReplace') for (const target of targetNames) adjustment(accumulator, target).replacementTalent = String(resolvedRawValue ?? modifier.modifierValue ?? '')
  else if (key === 'talentTypeOverride') for (const target of targetNames) adjustment(accumulator, target).typeOverride = String(modifier.modifierValue ?? '')
  else if (key === 'EnableAttack') accumulator.enabledAttacks.add(String(modifier.modifierValue ?? modifier.modifierTalentKey ?? ''))
  else if (key === 'AppendAnotherTalent') accumulator.appendedAttacks.add(String(modifier.modifierValue ?? modifier.modifierTalentKey ?? ''))
  else if (key.startsWith('CritRate:')) accumulator.scopedCritRate[key.slice('CritRate:'.length)] = (accumulator.scopedCritRate[key.slice('CritRate:'.length)] ?? 0) + value
  else if (key.startsWith('CritDMG:')) accumulator.scopedCritDamage[key.slice('CritDMG:'.length)] = (accumulator.scopedCritDamage[key.slice('CritDMG:'.length)] ?? 0) + value
  else if (key === 'EchoDMGBonus:AdditionalBase') addTypeBonus(accumulator, 'echo', value)
  else if (key === 'CounterAttackDMGBonus') accumulator.specificDamageBonus.CounterAttack = (accumulator.specificDamageBonus.CounterAttack ?? 0) + value
  else if (key === 'ForteBased:Liberation:Basic') addTypeBonus(accumulator, 'basic', value)
  else if (key === 'tuneBreakBoost') accumulator.specificDamageBonus.tuneBreakBoost = (accumulator.specificDamageBonus.tuneBreakBoost ?? 0) + value
  else if (key === 'MultiplySelfBuff') {
    record(value)
    return
  } else if (key === 'CritOverflow') {
    // Applied after the first stat pass by the V2 context because these depend
    // on already-computed stats or another selected effect.
    accumulator.specificDamageBonus[key] = (accumulator.specificDamageBonus[key] ?? 0) + value
  } else if (!key && targetNames.length) {
    for (const target of targetNames) accumulator.specificDamageBonus[target] = (accumulator.specificDamageBonus[target] ?? 0) + value
  } else {
    accumulator.unhandledModifiers.push(key || '(empty)')
    return
  }
  record()
}

export function applyCalculationEffects(
  accumulator: CalculationEffectAccumulator,
  effects: CalculationEffectDefinition[],
  selections: Record<string, CalculationEffectSelection>,
  attack: { key: string; name: string; group?: string },
  skillLevels: Record<string, number>,
  sequence: number,
  stance?: string,
  sourceStats: CalculationSourceStats = {}
) {
  const attackSkillKey = attack.group === 'Basic Attack' ? 'basic'
    : attack.group === 'Resonance Skill' ? 'skill'
      : attack.group === 'Forte Circuit' ? 'forte'
        : attack.group === 'Resonance Liberation' ? 'liberation'
          : attack.group === 'Intro Skill' ? 'intro' : ''
  const resolvedSkillLevels = { ...skillLevels, '': skillLevels[attackSkillKey] ?? 1 }
  const resolvedEffects = strongestStackingEffects(effects, selections, resolvedSkillLevels)
  const selfBuffMultipliers = new Map<string, number>()
  for (const effect of resolvedEffects) {
    if (effect.sequence && sequence < effect.sequence) continue
    if (effect.stance && effect.stance !== stance) continue
    const selection = selections[effect.id] ?? { enabled: effect.alwaysEnabled }
    const factor = selectionFactor(effect, selection)
    if (!(factor > 0)) continue
    for (const modifier of effect.modifiers.filter((entry) => entry.modifier === 'MultiplySelfBuff')) {
      const raw = resolveRawValue(modifier, selection, resolvedSkillLevels)
      const multiplier = (typeof raw === 'number' ? raw : Number.parseFloat(raw)) * factor
      for (const target of modifier.modifySpecificTalents ?? []) {
        if (Number.isFinite(multiplier)) selfBuffMultipliers.set(target, (selfBuffMultipliers.get(target) ?? 1) * multiplier)
      }
    }
  }
  for (const effect of resolvedEffects) {
    if (effect.sequence && sequence < effect.sequence) continue
    if (effect.stance && effect.stance !== stance) continue
    const selection = selections[effect.id] ?? { enabled: effect.alwaysEnabled }
    const factor = selectionFactor(effect, selection)
    if (!(factor > 0)) continue
    for (const modifier of effect.modifiers) {
      const raw = resolveRawValue(modifier, selection, resolvedSkillLevels)
      const modifierKey = modifier.modifier ?? ''
      if (modifier.modifierBasedOn && modifier.modifierStep) {
        const computed = resolveSourceScaledModifierValue(effect, modifier, selection, sourceStats, accumulator.stats, resolvedSkillLevels) ?? 0
        const targetModifier = modifier.modifierTargetAttr ?? modifierKey.replace(/:AdditionalBase$/, '')
        applyModifier(accumulator, effect, { ...modifier, modifier: targetModifier }, numericValue(computed, effect.valueUnit, targetModifier), attack.key, attack.name)
        continue
      }
      if (modifierKey === 'CritOverflow') {
        const critRate = accumulator.stats.critRate / 100
        const minimum = modifier.overflowMin ?? 1
        const step = modifier.overflowStep ?? 0.01
        const maximum = modifier.overflowMax ?? Number.POSITIVE_INFINITY
        const rawValue = typeof raw === 'number' ? raw : Number.parseFloat(raw)
        const bonus = Math.min(maximum, Math.floor(Math.max(0, critRate - minimum) / step) * (Number.isFinite(rawValue) ? rawValue : 0) * factor)
        applyModifier(accumulator, effect, { ...modifier, modifier: 'CritDMG' }, numericValue(bonus, effect.valueUnit, 'CritDMG'), attack.key, attack.name)
        continue
      }
      if (modifierKey === 'MultiplySelfBuff') {
        const multiplier = (typeof raw === 'number' ? raw : Number.parseFloat(raw)) * factor
        applyModifier(accumulator, effect, modifier, Number.isFinite(multiplier) ? multiplier : 0, attack.key, attack.name)
        continue
      }
      const selfBuffMultiplier = modifierKey === 'MultiplySelfBuff'
        ? 1
        : (modifier.modifySpecificTalents ?? []).reduce((product, target) => product * (selfBuffMultipliers.get(target) ?? 1), 1)
      const numeric = numericValue(raw, effect.valueUnit, modifierKey) * selfBuffMultiplier
      let value = numeric * factor
      if (modifier.maximumValue !== undefined) {
        const maximum = numericValue(modifier.maximumValue, effect.valueUnit, modifierKey)
        value = Math.min(value, maximum)
      }
      applyModifier(accumulator, effect, modifier, value, attack.key, attack.name, raw)
    }
  }
  accumulator.stats.hp = Math.floor(accumulator.stats.hp + 1e-9)
  accumulator.stats.atk = Math.floor(accumulator.stats.atk + 1e-9)
  accumulator.stats.def = Math.floor(accumulator.stats.def + 1e-9)
  return accumulator
}

export function createEffectAccumulator(stats: CalculationStatsV2): CalculationEffectAccumulator {
  return {
    stats: {
      ...stats,
      elementalDamage: { ...stats.elementalDamage },
      typeDamage: { ...stats.typeDamage }
    },
    amplification: 0,
    specialMultiplier: 0,
    defenseIgnore: 0,
    defenseReduction: 0,
    resistanceIgnore: 0,
    resistanceReduction: 0,
    specificDamageBonus: {},
    specificDeepen: {},
    scopedCritRate: {},
    scopedCritDamage: {},
    scopedDefenseIgnore: {},
    scopedResistanceIgnore: {},
    scopedResistanceReduction: {},
    scopedSpecialMultiplier: {},
    attackAdjustments: {},
    enabledAttacks: new Set(),
    appendedAttacks: new Set(),
    appliedEffects: [],
    unhandledModifiers: []
  }
}
