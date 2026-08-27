import type { DamageType, Element, FormulaResultMode, StatKey } from '../types'

export type CalculationSourceKind =
  | 'character'
  | 'inherent'
  | 'sequence'
  | 'weapon'
  | 'sonata'
  | 'echo'
  | 'party'
  | 'enemy'
  | 'custom'

export type CalculationEffectScope = 'self' | 'team' | 'next' | 'enemy'
export type CalculationValueUnit = 'decimal' | 'percent' | 'flat'
export type CalculationSelectionValue = boolean | number | string

export interface CalculationModifier {
  modifier?: string
  modifierValue?: number | string | Array<number | string> | Record<string, number | string>
  modifierByRefinement?: Record<string, number>
  modifierTalentKey?: string
  modifierValueTalentRef?: string
  modifySpecificTalents?: string[]
  maximumValue?: number
  perStackMaximumValue?: number
  modifierStep?: number
  maxSteps?: number
  overflowStep?: number
  overflowMin?: number
  overflowMax?: number
  modifierBasedOn?: string
  modifierTargetAttr?: string
  minStatValue?: number
  specificCharacters?: string[]
}

export interface CalculationEffectDefinition {
  id: string
  /** Stable catalog id retained when a team provider gets a runtime-unique effect id. */
  definitionId?: string
  key: string
  name: string
  description: string
  sourceKind: CalculationSourceKind
  /** Original equipment or character source when a runtime effect is exposed as a party output. */
  originSourceKind?: CalculationSourceKind
  sourceId: string
  /** Runtime provider identity. Generated catalog effects intentionally omit this. */
  sourceBuildId?: string
  scope: CalculationEffectScope
  valueUnit: CalculationValueUnit
  alwaysEnabled: boolean
  hasStacks: boolean
  minStacks: number
  maxStacks: number
  sequence?: number
  stance?: string
  appliesOnEveryStep?: number
  trigger?: string
  duration?: number
  stackingGroup?: string
  modifiers: CalculationModifier[]
}

export interface CalculationAttackDefinition {
  id: string
  key: string
  name: string
  group: string
  type: DamageType | 'forte' | 'tuneBreak' | 'status' | 'shield' | 'fixed' | 'utility'
  element?: Element
  attribute: 'attack' | 'hp' | 'defense' | 'EnergyRegen'
  talents: Record<string, string>
  count: number
  subtype?: string
  enabledBy?: string
  excludeTeamBuffs?: boolean
  excludeWeaponBuffs?: boolean
  excludeEchoes?: boolean
}

export interface CharacterCalculationMechanics {
  id: string
  key: string
  name: string
  attacks: CalculationAttackDefinition[]
  effects: CalculationEffectDefinition[]
  sequences: CalculationEffectDefinition[]
  stances: string[]
}

export interface WeaponCalculationMechanics {
  id: string
  key: string
  name: string
  type: string
  passiveName: string
  effects: CalculationEffectDefinition[]
}

export interface SonataCalculationMechanics {
  id: string
  key: string
  name: string
  pieces: number
  effects: CalculationEffectDefinition[]
}

export interface EchoCalculationMechanics {
  id: string
  key: string
  name: string
  description?: string
  cooldown?: number
  effects: CalculationEffectDefinition[]
  attacks: CalculationAttackDefinition[]
}

export interface CalculationCatalogV2 {
  provenance: {
    repository: string
    revision: string
    generatedAt: string
    importVersion: number
    reviewPolicy?: 'section-approved'
  }
  characters: CharacterCalculationMechanics[]
  weapons: WeaponCalculationMechanics[]
  sonatas: SonataCalculationMechanics[]
  echoes: EchoCalculationMechanics[]
  partyEffects: CalculationEffectDefinition[]
  knownModifierKinds: string[]
  coverage?: {
    characters: number
    weapons: number
    sonatas: number
    echoes: number
    sections?: Record<string, { approved: number; approvedEmpty: number }>
  }
}

export interface CalculationEffectSelection {
  enabled: boolean
  value?: CalculationSelectionValue
  stacks?: number
  refinement?: number
  recipientBuildId?: string
}

export interface CalculationStatsV2 {
  baseHp: number
  baseAtk: number
  baseDef: number
  hp: number
  atk: number
  def: number
  critRate: number
  critDamage: number
  energyRegen: number
  healingBonus: number
  shieldBonus: number
  damageBonus: number
  elementalDamage: Record<Element, number>
  typeDamage: Partial<Record<DamageType | 'forte' | 'coordinated', number>>
}

export interface CalculationEnemyV2 {
  level: number
  resistance: number
  damageReduction: number
  defenseIgnore: number
  defenseReduction: number
  resistanceIgnore: number
  resistanceReduction: number
  specialMultiplier: number
  enemyClass: 'common' | 'elite' | 'overlord'
  statusStacks: Partial<Record<'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'electroFlare' | 'electroRage' | 'glacioChafe' | 'havocBane' | 'strain', number>>
}

export interface AttackAdjustment {
  additionalMotionValue: number
  motionValueMultiplier: number
  specialMotionValueMultiplier: number
  replacementTalent?: string
  typeOverride?: string
  elementOverride?: Element
}

export interface CalculationEffectAccumulator {
  stats: CalculationStatsV2
  amplification: number
  specialMultiplier: number
  defenseIgnore: number
  defenseReduction: number
  resistanceIgnore: number
  resistanceReduction: number
  specificDamageBonus: Record<string, number>
  specificDeepen: Record<string, number>
  scopedCritRate: Record<string, number>
  scopedCritDamage: Record<string, number>
  scopedDefenseIgnore: Record<string, number>
  scopedResistanceIgnore: Record<string, number>
  scopedResistanceReduction: Record<string, number>
  scopedSpecialMultiplier: Record<string, number>
  attackAdjustments: Record<string, AttackAdjustment>
  enabledAttacks: Set<string>
  appendedAttacks: Set<string>
  appliedEffects: AppliedCalculationEffect[]
  unhandledModifiers: string[]
}

export type CalculationSourceStats = Record<string, CalculationStatsV2>

export interface AppliedCalculationEffect {
  effectId: string
  name: string
  sourceKind: CalculationSourceKind
  sourceId: string
  modifier: string
  value: number | string
  targets?: string[]
}

export interface CalculationTraceV2 {
  id: string
  label: string
  value: number | string | boolean
  operation?: string
  source?: string
  children: CalculationTraceV2[]
}

export interface CalculationResultV2 {
  attackId: string
  normal: number
  critical: number
  expected: number
  instances: Array<{ percentage: string; normal: number; count: number }>
  trace: Record<FormulaResultMode, CalculationTraceV2>
  appliedEffects: AppliedCalculationEffect[]
  warnings: string[]
}

export interface CalculationScenarioV2 {
  version: 2
  resultMode: FormulaResultMode
  memberEffects: Record<string, Record<string, CalculationEffectSelection>>
  partyEffects: Record<string, Record<string, CalculationEffectSelection>>
  enemyStatuses: CalculationEnemyV2['statusStacks']
  selectedAttackByBuild: Record<string, string>
}

export const emptyCalculationScenarioV2 = (): CalculationScenarioV2 => ({
  version: 2,
  resultMode: 'expected',
  memberEffects: {},
  partyEffects: {},
  enemyStatuses: {},
  selectedAttackByBuild: {}
})

export const calculationStatKeys: StatKey[] = [
  'hp', 'hpPercent', 'atk', 'atkPercent', 'def', 'defPercent', 'critRate', 'critDamage',
  'energyRegen', 'basicDamage', 'heavyDamage', 'skillDamage', 'liberationDamage',
  'spectroDamage', 'fusionDamage', 'glacioDamage', 'electroDamage', 'aeroDamage',
  'havocDamage', 'healingBonus'
]
