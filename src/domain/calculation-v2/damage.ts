import type { DamageType, Element, FormulaResultMode } from '../types'
import { calcDamage, calcFixedDamage, calcHeal, calcShield, calcTuneBreak } from './upstream-calculator'
import type {
  CalculationAttackDefinition,
  CalculationEffectAccumulator,
  CalculationEnemyV2,
  CalculationResultV2,
  CalculationTraceV2
} from './types'

const floorGameValue = (value: number) => Math.floor(value + 1e-9)
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

function attackMatchesScope(attack: CalculationAttackDefinition, scope: string) {
  const candidates = [
    attack.type,
    attack.element,
    attack.subtype,
    attack.key,
    attack.name,
    attack.group,
    attack.type === 'skill' ? 'ResonanceSkill' : '',
    attack.type === 'liberation' ? 'ResonanceLiberation' : '',
    attack.type === 'intro' ? 'Intro' : '',
    attack.type === 'outro' ? 'Outro' : ''
  ].filter(Boolean).map((value) => normalized(String(value)))
  return scope.split(':').filter(Boolean).every((part) => {
    const target = normalized(part)
    return candidates.some((candidate) => candidate === target || candidate.includes(target) || target.includes(candidate))
  })
}

function scopedTotal(values: Record<string, number>, attack: CalculationAttackDefinition) {
  return Object.entries(values).reduce((total, [scope, value]) => total + (attackMatchesScope(attack, scope) ? value : 0), 0)
}

function scalingValue(accumulator: CalculationEffectAccumulator, attribute: CalculationAttackDefinition['attribute']) {
  if (attribute === 'hp') return accumulator.stats.hp
  if (attribute === 'defense') return accumulator.stats.def
  if (attribute === 'EnergyRegen') return accumulator.stats.energyRegen
  return accumulator.stats.atk
}

function attackTypeBonus(accumulator: CalculationEffectAccumulator, attack: CalculationAttackDefinition) {
  const type = attack.type as keyof CalculationEffectAccumulator['stats']['typeDamage']
  return accumulator.stats.typeDamage[type] ?? 0
}

function attackElementBonus(accumulator: CalculationEffectAccumulator, attack: CalculationAttackDefinition) {
  return attack.element ? accumulator.stats.elementalDamage[attack.element] : 0
}

function trace(
  mode: FormulaResultMode,
  value: number,
  attack: CalculationAttackDefinition,
  accumulator: CalculationEffectAccumulator,
  details: Record<string, unknown>
): CalculationTraceV2 {
  const detailRows = Object.entries(details).flatMap(([key, entry]) => typeof entry === 'number' || typeof entry === 'string' || typeof entry === 'boolean'
    ? [{ id: `detail:${key}`, label: key.replace(/([A-Z])/g, ' $1'), value: entry, operation: 'input', children: [] }]
    : [])
  const effectRows = accumulator.appliedEffects.map((effect, index) => ({
    id: `effect:${effect.effectId}:${index}`,
    label: effect.name,
    value: effect.value,
    operation: effect.modifier,
    source: `${effect.sourceKind}:${effect.sourceId}`,
    children: []
  }))
  return {
    id: `${attack.id}:${mode}`,
    label: `${attack.name} · ${mode}`,
    value,
    operation: attack.type,
    children: [
      { id: `${attack.id}:formula`, label: 'WutheringTools-compatible formula', value: attack.talents['10'] ?? attack.talents['1'] ?? '0%', operation: 'talent', children: detailRows },
      { id: `${attack.id}:effects`, label: 'Applied effects', value: effectRows.length, operation: 'effects', children: effectRows }
    ]
  }
}

function resultFromUpstream(
  attack: CalculationAttackDefinition,
  accumulator: CalculationEffectAccumulator,
  raw: {
    totalDamage?: number
    critDamage?: number
    avgDamage?: number
    healAmount?: number
    shieldAmount?: number
    instanceDamageEntries?: Array<{ percentage: string; damage: number; count: number }>
    totalDamageContext?: Record<string, unknown>
  },
  damageReduction = 0
): CalculationResultV2 {
  const reductionMultiplier = Math.max(0, 1 - damageReduction / 100)
  const baseRaw = raw.totalDamage ?? raw.healAmount ?? raw.shieldAmount ?? 0
  const normalRaw = baseRaw * reductionMultiplier
  const criticalRaw = (raw.critDamage ?? baseRaw) * reductionMultiplier
  const expectedRaw = (raw.avgDamage ?? baseRaw) * reductionMultiplier
  const normal = floorGameValue(normalRaw)
  const critical = floorGameValue(criticalRaw)
  const expected = floorGameValue(expectedRaw)
  const details = { ...(raw.totalDamageContext ?? {}), damageReduction }
  return {
    attackId: attack.id,
    normal,
    critical,
    expected,
    instances: (raw.instanceDamageEntries ?? []).map((entry) => ({
      percentage: entry.percentage,
      normal: floorGameValue(entry.damage * reductionMultiplier),
      count: entry.count
    })),
    trace: {
      normal: trace('normal', normal, attack, accumulator, details),
      critical: trace('critical', critical, attack, accumulator, details),
      expected: trace('expected', expected, attack, accumulator, details)
    },
    appliedEffects: accumulator.appliedEffects,
    warnings: [...new Set(accumulator.unhandledModifiers)].map((key) => `Unhandled calculation modifier: ${key}`)
  }
}

export interface CompactCalculationResultV2 {
  attackId: string
  normal: number
  critical: number
  expected: number
}

function compactResultFromUpstream(
  attack: CalculationAttackDefinition,
  raw: {
    totalDamage?: number
    critDamage?: number
    avgDamage?: number
    healAmount?: number
    shieldAmount?: number
  },
  damageReduction = 0
): CompactCalculationResultV2 {
  const reductionMultiplier = Math.max(0, 1 - damageReduction / 100)
  const baseRaw = raw.totalDamage ?? raw.healAmount ?? raw.shieldAmount ?? 0
  return {
    attackId: attack.id,
    normal: floorGameValue(baseRaw * reductionMultiplier),
    critical: floorGameValue((raw.critDamage ?? baseRaw) * reductionMultiplier),
    expected: floorGameValue((raw.avgDamage ?? baseRaw) * reductionMultiplier)
  }
}

export interface CalculateAttackV2Input {
  attack: CalculationAttackDefinition
  talentLevel: number
  characterLevel: number
  accumulator: CalculationEffectAccumulator
  enemy: CalculationEnemyV2
}

function calculateAttackV2Internal(input: CalculateAttackV2Input, compact: false): CalculationResultV2
function calculateAttackV2Internal(input: CalculateAttackV2Input, compact: true): CompactCalculationResultV2
function calculateAttackV2Internal(input: CalculateAttackV2Input, compact: boolean): CalculationResultV2 | CompactCalculationResultV2 {
  const { attack, accumulator, enemy } = input
  const adjustment = accumulator.attackAdjustments[attack.key] ?? accumulator.attackAdjustments[attack.id]
  const effectiveAttack = adjustment?.typeOverride
    ? { ...attack, type: damageTypeFromString(adjustment.typeOverride) }
    : attack
  const talent = adjustment?.replacementTalent
    ?? attack.talents[String(Math.max(1, Math.min(10, input.talentLevel)))]
    ?? attack.talents['1']
    ?? '0%'
  const scaling = scalingValue(accumulator, effectiveAttack.attribute)
  const specificBonus = scopedTotal(accumulator.specificDamageBonus, effectiveAttack)
  const totalBonus = accumulator.stats.damageBonus + attackTypeBonus(accumulator, effectiveAttack) + attackElementBonus(accumulator, effectiveAttack)
  const deepen = accumulator.amplification + scopedTotal(accumulator.specificDeepen, effectiveAttack)
  const defIgnore = enemy.defenseIgnore + accumulator.defenseIgnore + scopedTotal(accumulator.scopedDefenseIgnore, effectiveAttack)
  const defReduction = enemy.defenseReduction + accumulator.defenseReduction
  const resistanceIgnore = enemy.resistanceIgnore + accumulator.resistanceIgnore + scopedTotal(accumulator.scopedResistanceIgnore, effectiveAttack)
  const resistanceReduction = enemy.resistanceReduction + accumulator.resistanceReduction + scopedTotal(accumulator.scopedResistanceReduction, effectiveAttack)
  const specialMultiplier = enemy.specialMultiplier + accumulator.specialMultiplier + scopedTotal(accumulator.scopedSpecialMultiplier, effectiveAttack)
  const critRate = Math.max(0, Math.min(1, (accumulator.stats.critRate + scopedTotal(accumulator.scopedCritRate, effectiveAttack)) / 100))
  const critDamage = Math.max(1, (accumulator.stats.critDamage + scopedTotal(accumulator.scopedCritDamage, effectiveAttack)) / 100)
  const add = (adjustment?.additionalMotionValue ?? 0) / 100
  const multiply = (adjustment?.motionValueMultiplier ?? 0) / 100
  const specialMultiply = (adjustment?.specialMotionValueMultiplier ?? 0) / 100

  if (attack.type === 'healing') {
    const raw = calcHeal(
      talent, scaling, accumulator.stats.healingBonus / 100, specificBonus / 100,
      add, multiply, specialMultiply, attack.count
    )
    return compact ? compactResultFromUpstream(attack, raw) : resultFromUpstream(attack, accumulator, raw)
  }
  if (attack.type === 'shield') {
    const raw = calcShield(
      talent, scaling, accumulator.stats.shieldBonus / 100, specificBonus / 100,
      add, multiply, attack.count
    )
    return compact ? compactResultFromUpstream(attack, raw) : resultFromUpstream(attack, accumulator, raw)
  }
  if (attack.type === 'fixed') {
    const raw = calcFixedDamage(talent, attack.count)
    return compact ? compactResultFromUpstream(attack, raw, enemy.damageReduction) : resultFromUpstream(attack, accumulator, raw, enemy.damageReduction)
  }
  if (attack.type === 'tuneBreak') {
    const enemyClass = enemy.enemyClass === 'common' ? 'Common' : enemy.enemyClass === 'elite' ? 'Elite' : 'Overlord'
    const raw = calcTuneBreak(
      talent,
      String(input.characterLevel),
      enemy.level,
      enemy.resistance / 100,
      enemyClass,
      resistanceReduction / 100,
      defIgnore / 100,
      defReduction / 100,
      (accumulator.specificDamageBonus.tuneBreakBoost ?? 0) / 100,
      multiply,
      specialMultiplier / 100,
      totalBonus / 100,
      critRate,
      critDamage,
      attack.count,
      resistanceIgnore / 100
    )
    return compact ? compactResultFromUpstream(attack, raw, enemy.damageReduction) : resultFromUpstream(attack, accumulator, raw, enemy.damageReduction)
  }

  const raw = calcDamage(
    String(input.characterLevel),
    enemy.level,
    enemy.resistance / 100,
    talent,
    scaling,
    defIgnore / 100,
    totalBonus / 100,
    specificBonus / 100,
    0,
    deepen / 100,
    resistanceReduction / 100,
    critRate,
    critDamage,
    add,
    multiply,
    specialMultiply,
    attack.count,
    attack.key,
    0,
    0,
    specialMultiplier / 100,
    defReduction / 100,
    resistanceIgnore / 100
  )
  return compact ? compactResultFromUpstream(attack, raw, enemy.damageReduction) : resultFromUpstream(attack, accumulator, raw, enemy.damageReduction)
}

export function calculateAttackV2(input: CalculateAttackV2Input): CalculationResultV2 {
  return calculateAttackV2Internal(input, false)
}

export function calculateAttackV2Compact(input: CalculateAttackV2Input): CompactCalculationResultV2 {
  return calculateAttackV2Internal(input, true)
}

export function elementFromString(value: string | undefined): Element | undefined {
  const element = value?.toLowerCase()
  return element === 'spectro' || element === 'fusion' || element === 'glacio'
    || element === 'electro' || element === 'aero' || element === 'havoc'
    ? element
    : undefined
}

export function damageTypeFromString(value: string | undefined): CalculationAttackDefinition['type'] {
  const normalizedType = value?.toLowerCase()
  if (normalizedType === 'basic') return 'basic'
  if (normalizedType === 'heavy') return 'heavy'
  if (normalizedType === 'skill') return 'skill'
  if (normalizedType === 'liberation') return 'liberation'
  if (normalizedType === 'intro') return 'intro'
  if (normalizedType === 'outro') return 'outro'
  if (normalizedType === 'echo') return 'echo'
  if (normalizedType === 'healing') return 'healing'
  if (normalizedType === 'shield') return 'shield'
  if (normalizedType === 'tunebreak') return 'tuneBreak'
  if (normalizedType === 'fixed') return 'fixed'
  return 'utility'
}

export function damageTypeLabel(type: DamageType | CalculationAttackDefinition['type']) {
  if (type === 'skill') return 'Resonance Skill'
  if (type === 'liberation') return 'Resonance Liberation'
  if (type === 'intro') return 'Intro Skill'
  if (type === 'outro') return 'Outro Skill'
  if (type === 'tuneBreak') return 'Tune Break'
  return `${String(type).charAt(0).toUpperCase()}${String(type).slice(1)}`
}
