export type ResultMode = 'normal' | 'critical' | 'expected'
export type ResultKind = 'damage' | 'healing' | 'shield' | 'utility'
export type Element = 'spectro' | 'fusion' | 'glacio' | 'electro' | 'aero' | 'havoc' | 'physical' | 'none'
export type DamageType = 'basic' | 'heavy' | 'skill' | 'liberation' | 'intro' | 'outro' | 'echo' | 'status' | 'tune-break'
export type ActionTag = 'coordinated' | 'forte' | 'normal-chain' | 'dodge-counter' | 'mid-air' | 'plunge' | 'off-field' | 'summon' | 'glacio-chafe' | 'aero-erosion' | 'spectro-frazzle' | 'electro-flare' | 'fusion-burst' | 'havoc-bane'
export type ScalingStat = 'atk' | 'hp' | 'def' | 'energyRegen'
export type DamageBonusStat = 'basicDamage' | 'heavyDamage' | 'skillDamage' | 'liberationDamage' | 'introDamage' | 'outroDamage' | 'echoDamage' | 'tuneBreakDamage' | 'spectroDamage' | 'fusionDamage' | 'glacioDamage' | 'electroDamage' | 'aeroDamage' | 'havocDamage' | 'physicalDamage'
export type Stat = ScalingStat | 'critRate' | 'critDamage' | 'healingBonus' | 'shieldBonus' | DamageBonusStat
export type MechanicInputValue = boolean | number | string

export interface StatValue {
  stat: Stat
  value: number
  mode: 'flat' | 'percent'
}

export interface BaseStats {
  hp: number
  atk: number
  def: number
  critRate: number
  critDamage: number
  energyRegen: number
}

export interface AggregatedStats extends BaseStats {
  baseHp: number
  baseAtk: number
  baseDef: number
  healingBonus: number
  shieldBonus: number
  basicDamage: number
  heavyDamage: number
  skillDamage: number
  liberationDamage: number
  introDamage: number
  outroDamage: number
  echoDamage: number
  tuneBreakDamage: number
  spectroDamage: number
  fusionDamage: number
  glacioDamage: number
  electroDamage: number
  aeroDamage: number
  havocDamage: number
  physicalDamage: number
}

export interface LevelStats extends BaseStats {
  level: number
}

export interface WeaponLevelStats {
  level: number
  atk: number
  stats?: readonly StatValue[]
}

export interface DamageFormula {
  kind: 'damage'
  scaling: Readonly<Partial<Record<ScalingStat, number>>>
  hits: readonly number[]
  flatHits?: readonly number[]
  canCrit: boolean
  damageBonuses?: readonly number[]
  amplifications?: readonly number[]
  vulnerabilities?: readonly number[]
  finalDamageBonuses?: readonly number[]
}

export interface FixedDamageFormula {
  kind: 'fixed-damage'
  hits: readonly number[]
}

/** Base Tune Break uses a Cost-dependent level value rather than ATK scaling. */
export interface TuneBreakFormula {
  kind: 'tune-break'
}

export type NegativeStatus = 'spectro-frazzle' | 'aero-erosion' | 'fusion-burst' | 'electro-flare' | 'glacio-chafe'

export interface NegativeStatusFormula {
  kind: 'negative-status'
  status: NegativeStatus
}

export interface SupportFormula {
  kind: 'healing' | 'shield'
  scaling: Readonly<Partial<Record<ScalingStat, number>>>
  motionValue: number
  flatValue: number
  bonuses?: readonly number[]
}

export interface UnsupportedFormula {
  kind: 'unsupported'
  family: string
}

export type ActionFormula = DamageFormula | FixedDamageFormula | TuneBreakFormula | NegativeStatusFormula | SupportFormula | UnsupportedFormula

export interface EffectFilter {
  actionIds?: readonly string[]
  damageTypes?: readonly DamageType[]
  elements?: readonly Element[]
  tags?: readonly ActionTag[]
}

export interface EffectActivationRequirement {
  input: string
  minimum?: number
}

export type EffectActivation = (
  | { kind: 'always' }
  | { kind: 'toggle'; input: string }
  | { kind: 'stacks'; input: string; minimum: number; maximum: number }
  | { kind: 'value'; input: string; minimum: number; maximum: number }
  | { kind: 'conditional-value'; toggleInput: string; source: 'provider' | 'recipient'; stat: ConditionStat; minimum: number; maximum: number }
  | { kind: 'all'; inputs: readonly string[] }
) & { requires?: readonly EffectActivationRequirement[]; suppressedBy?: readonly string[] }

export type ConditionStat = 'tuneBreakBoost' | 'offTuneBuildupRate' | 'energyRegen'

export type EffectOperation = (
  | { kind: 'add-flat-stat'; stat: Stat; value: number }
  | { kind: 'add-percent-stat'; stat: 'hp' | 'atk' | 'def'; value: number }
  | { kind: 'add-damage-bonus'; value: number }
  | { kind: 'increase-motion-value'; value: number }
  | { kind: 'amplify-damage'; value: number }
  | { kind: 'add-vulnerability'; value: number }
  | { kind: 'add-final-damage'; value: number }
  | { kind: 'reduce-damage-taken'; value: number }
  | { kind: 'reduce-defense'; value: number }
  | { kind: 'ignore-defense'; value: number }
  | { kind: 'reduce-resistance'; value: number }
  | { kind: 'ignore-resistance'; value: number }
  | { kind: 'override-crit'; mode: 'never' | 'always' }
) & { filter?: EffectFilter; stacking?: 'once' | 'per-stack'; recipient?: 'self' | 'next' | 'team'; minimumActivation?: number; maximumValue?: number }

export interface TriggeredActionMechanics {
  id: string
  name: string
  kind: ResultKind
  recipient?: 'self' | 'team'
  damageType?: DamageType
  element?: Element
  scaling?: ScalingStat
  expression?: string
  referenceActionId?: string
  referenceMultiplier?: number
  count: number
  critMode?: 'normal' | 'never' | 'always'
  cooldownSeconds?: number
  maximumTriggers?: number
}

export interface ActionUseAdjustment {
  actionId: string
  additionalUses: number
}

export interface EffectMechanics {
  id: string
  name?: string
  description?: string
  sourceId: string
  reviewFingerprint: string
  /** Legacy fallback; new reviewed effects place the recipient on each operation. */
  recipient?: 'self' | 'next' | 'team'
  activation: EffectActivation
  operations: readonly EffectOperation[]
  triggeredActions?: readonly TriggeredActionMechanics[]
  actionUseAdjustments?: readonly ActionUseAdjustment[]
  filter?: EffectFilter
  exclusiveGroup?: string
  minimumSequence?: number
  minimumRank?: number
  maximumRank?: number
  minimumPieces?: number
}

export interface ActionMechanics {
  id: string
  sourceId: string
  reviewFingerprint: string
  kind: ResultKind
  recipient?: 'self' | 'team'
  damageType?: DamageType
  element?: Element
  tags?: readonly ActionTag[]
  formula: ActionFormula
  cooldownSeconds?: number
}

export interface CharacterActionMechanics extends Omit<ActionMechanics, 'formula'> {
  name: string
  group: string
  skillLevelIndex: number
  formulas: Readonly<Record<number, ActionFormula>>
}

export interface EchoActionMechanics extends Omit<ActionMechanics, 'formula' | 'cooldownSeconds'> {
  name: string
  description: string
  formulas: Readonly<Record<number, ActionFormula>>
}

export interface CharacterMechanics {
  id: string
  sourceId: string
  reviewFingerprint: string
  levelStats: readonly LevelStats[]
  actions: Readonly<Record<string, CharacterActionMechanics | ActionMechanics>>
  effects?: readonly EffectMechanics[]
}

export interface WeaponMechanics {
  id: string
  sourceId: string
  reviewFingerprint: string
  levelStats: readonly WeaponLevelStats[]
  stats?: readonly StatValue[]
  effects?: readonly EffectMechanics[]
}

export interface EchoMechanics {
  id: string
  name: string
  description: string
  sourceId: string
  reviewFingerprint: string
  cooldownSeconds?: number
  actions: Readonly<Record<string, EchoActionMechanics>>
  effects: readonly EffectMechanics[]
}

export interface SonataMechanics {
  id: string
  sourceId: string
  reviewFingerprint: string
  effects: readonly EffectMechanics[]
}

export interface ReviewedEffectSource {
  id: string
  sourceId: string
  reviewFingerprint: string
  effects: readonly EffectMechanics[]
}

export interface ReviewedCharacterSource extends ReviewedEffectSource {
  actions: Readonly<Record<string, CharacterActionMechanics>>
}

export interface ReviewedMechanicsCatalog {
  dataVersion: string
  characters: Readonly<Record<string, ReviewedCharacterSource>>
  weapons: Readonly<Record<string, ReviewedEffectSource>>
  echoes: Readonly<Record<string, EchoMechanics>>
  sonatas: Readonly<Record<string, SonataMechanics>>
}

export interface MechanicsRegistry {
  dataVersion: string
  characters: Readonly<Record<string, CharacterMechanics>>
  weapons: Readonly<Record<string, WeaponMechanics>>
  echoes?: Readonly<Record<string, EchoMechanics>>
  sonatas?: Readonly<Record<string, SonataMechanics>>
}

export interface EchoInput {
  instanceId: string
  catalogId: string
  rarity: number
  level: number
  sonataId: string
  mainStat: StatValue
  substats: readonly StatValue[]
}

export interface CombatMember {
  memberId: string
  character: {
    id: string
    level: number
    sequence: number
    skillLevels: readonly number[]
  }
  weapon: {
    id: string
    level: number
    rank: number
  }
  echoes: readonly EchoInput[]
  /** Percent-point values used by mechanics that scale from a specific member. */
  conditionStats?: Readonly<Partial<Record<ConditionStat, number>>>
  mainEchoId?: string
}

export interface EnemyInput {
  level: number
  cost?: 1 | 3 | 4
  statusStacks?: Readonly<Partial<Record<NegativeStatus, number>>>
  electroRageStacks?: number
  havocBaneStacks?: number
  strainStacks?: number
  resistance: Readonly<Partial<Record<Element, number>>>
  damageReduction: number
  defenseReduction?: number
  defenseIgnore?: number
  resistanceReduction?: number
  resistanceIgnore?: number
}

export interface CombatSetup {
  dataVersion: string
  members: readonly CombatMember[]
  enemy: EnemyInput
  selections: Readonly<Record<string, MechanicInputValue>>
  disabledEffectIdsByMember?: Readonly<Record<string, readonly string[]>>
  memberBonuses?: Readonly<Record<string, {
    statLines?: readonly StatValue[]
    damageBonuses?: readonly number[]
    amplifications?: readonly number[]
    specialMultipliers?: readonly number[]
    contributions?: {
      statLines?: readonly { label: string; value: StatValue }[]
      damageBonuses?: readonly { label: string; value: number }[]
      amplifications?: readonly { label: string; value: number }[]
      specialMultipliers?: readonly { label: string; value: number }[]
    }
  }>>
}

export interface ActionRequest {
  setup: CombatSetup
  actorId: string
  actionId: string
  resultMode: ResultMode
  inputs?: Readonly<Record<string, MechanicInputValue>>
  trace?: boolean
}

export interface RotationCommand {
  id: string
  actorId: string
  actionId: string
  timestamp: number
  duration?: number
  repetitions?: number
  inputs?: Readonly<Record<string, MechanicInputValue>>
}

export interface RotationRequest {
  setup: CombatSetup
  duration: number
  actions: readonly RotationCommand[]
  resultMode: ResultMode
  trace?: boolean
}

export type CalculationDiagnosticCode =
  | 'invalid-input'
  | 'missing-mechanic'
  | 'unsupported-mechanic'
  | 'stale-data'
  | 'invalid-rotation'
  | 'unverified-data'

export interface CalculationDiagnostic {
  code: CalculationDiagnosticCode
  message: string
  sourceId?: string
  actorId?: string
  actionId?: string
}

export type CalculationOutcome<T> =
  | { ok: true; value: T; warnings: readonly CalculationDiagnostic[] }
  | { ok: false; errors: readonly CalculationDiagnostic[]; warnings: readonly CalculationDiagnostic[] }

export interface DamageValues {
  normal: number
  critical: number
  expected: number
}

export interface CalculationTrace {
  stage: string
  value?: number | string
  children: readonly CalculationTrace[]
}

export interface ActionResult {
  actionId: string
  actorId: string
  kind: ResultKind
  recipient?: 'self' | 'team'
  damageType?: DamageType
  stats: AggregatedStats
  hits: readonly number[]
  totals: DamageValues
  selected: number
  appliedEffects: readonly string[]
  triggeredActions: readonly TriggeredActionResult[]
  actionUseAdjustments: readonly ActionUseAdjustment[]
  trace?: CalculationTrace
}

export interface TriggeredActionResult {
  id: string
  name: string
  kind: ResultKind
  damageType?: DamageType
  totals: DamageValues
  selected: number
}

export interface RotationActionResult {
  commandId: string
  actorId: string
  actionId: string
  timestamp: number
  selected: number
}

export interface RotationResult {
  total: number
  dps: number
  actions: readonly RotationActionResult[]
  byActor: Readonly<Record<string, number>>
  byDamageType: Readonly<Partial<Record<DamageType, number>>>
  trace?: CalculationTrace
}

export interface Calculator {
  calculateAction(request: ActionRequest): CalculationOutcome<ActionResult>
  calculateRotation(request: RotationRequest): CalculationOutcome<RotationResult>
}
