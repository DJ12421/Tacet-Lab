export type StatKey = 'hp' | 'hpPercent' | 'atk' | 'atkPercent' | 'def' | 'defPercent' | 'critRate' | 'critDamage' | 'energyRegen' | 'basicDamage' | 'heavyDamage' | 'skillDamage' | 'liberationDamage' | 'spectroDamage' | 'fusionDamage' | 'glacioDamage' | 'electroDamage' | 'aeroDamage' | 'havocDamage' | 'healingBonus'
export type DamageType = 'basic' | 'heavy' | 'skill' | 'liberation' | 'intro' | 'outro' | 'echo' | 'healing'
export type Element = 'spectro' | 'fusion' | 'glacio' | 'electro' | 'aero' | 'havoc'
export interface StatLine { key: StatKey; value: number }
export interface Echo { id: string; name: string; cost: 1 | 3 | 4; rarity: 1 | 2 | 3 | 4 | 5; level: number; sonata: string; mainStat: StatLine; subStats: StatLine[]; locked: boolean; excluded: boolean; /** Owned-character ID for actual equipment. Legacy backups may contain a build ID and are migrated on open/import. */ equippedBy?: string; equippedByName?: string; createdAt: number; source: 'scan' | 'screenshot' | 'manual' | 'import' }
export interface AttackDefinition { id: string; name: string; type: DamageType; element: Element; multiplier: number; hits: number; scalesWith: 'atk' | 'hp' | 'def' }
export interface Resonator { id: string; name: string; element: Element; role: string; accent: string; baseStats: Pick<AggregatedStats, 'hp' | 'atk' | 'def' | 'critRate' | 'critDamage'>; attacks: AttackDefinition[] }
export interface Weapon { id: string; name: string; type: 'broadblade' | 'sword' | 'pistols' | 'gauntlets' | 'rectifier'; baseAtk: number; stat?: StatLine }
export interface OwnedCharacter { id: string; catalogId: string; level: number; sequence: number; locked: boolean; favorite?: boolean; skillLevels?: number[]; enabledSkillTreeBonusIds?: string[]; createdAt: number }
export interface OwnedWeapon { id: string; catalogId: string; level: number; rank: number; locked: boolean; equippedBy?: string; createdAt: number }
export interface Build { id: string; name: string; description?: string; characterId?: string; resonatorId: string; weaponId: string; echoIds: string[]; level: number; skillLevel: number; createdAt?: number; updatedAt?: number; source?: 'manual' | 'equipped' | 'optimizer' | 'import' }
export interface EquippedLoadout { id: string; characterId: string; weaponId: string; echoIds: string[]; updatedAt: number }
export type LoadoutSourceRef =
  | { type: 'equipped'; characterId: string }
  | { type: 'saved'; buildId: string }
  | { type: 'theorycraft'; theorycraftBuildId: string }
export interface TeamMember { memberId: string; characterId: string; loadoutSource: LoadoutSourceRef; compareSource?: LoadoutSourceRef }
export interface TheorycraftEchoSlot { cost: Echo['cost']; rarity: Echo['rarity']; level: number; mainStatKey: StatKey }
export interface TheorycraftSonata { name: string; pieces: number }
export type TheorycraftSubstats =
  | { mode: 'slots'; slots: Array<Array<{ key: StatKey; value: number }>> }
  | { mode: 'values'; values: Partial<Record<StatKey, number>> }
  | { mode: 'rolls'; quality: 'low' | 'mid' | 'high'; rolls: Partial<Record<StatKey, number>> }
export interface TheorycraftBuild {
  id: string
  name: string
  description: string
  characterId: string
  weapon: { catalogId: string; level: number; rank: number }
  mainEchoName: string
  slots: TheorycraftEchoSlot[]
  sonatas: TheorycraftSonata[]
  substats: TheorycraftSubstats
  createdAt: number
  updatedAt: number
  source?: { type: 'equipped' | 'saved' | 'optimizer'; id?: string }
}
export interface Team { id: string; name: string; /** Stable member IDs in schema v7; legacy backups contain saved-build IDs and are migrated. */ buildIds: string[]; members?: TeamMember[]; enemy: EnemyConfig; rotationDuration: number; actions: RotationAction[]; rotationPresets?: import('./rotation-presets').RotationPresetDocument[]; buffs?: BuffEffect[]; scenario?: TeamScenario; calculationV2?: import('./calculation-v2/types').CalculationScenarioV2 }
export type ScenarioValue = number | string | boolean
export type FormulaResultMode = 'normal' | 'expected' | 'critical'
export interface TeamScenario {
  resultMode: FormulaResultMode
  memberConditions: Record<string, Record<string, ScenarioValue>>
  enemyConditions: Record<string, ScenarioValue>
  selectedTargetByBuild: Record<string, string>
  compareBuildId?: string
}
export interface RotationAction { id: string; timestamp: number; duration?: number; multiplier?: number; buildId: string; attackId: string; formulaTargetId?: string; inputs?: Record<string, ScenarioValue> }
export interface BuffEffect { id: string; name: string; sourceBuildId: string; target: 'self' | 'next' | 'team'; triggerAttackId: string; duration: number; stat: StatKey | 'amplify'; value: number; stackingGroup: string }
export interface EnemyConfig {
  level: number
  resistance: number
  damageReduction: number
  defenseIgnore?: number
  defenseReduction?: number
  resistanceIgnore?: number
  resistanceReduction?: number
  specialMultiplier?: number
}
export interface AggregatedStats { baseHp: number; baseAtk: number; baseDef: number; hp: number; atk: number; def: number; critRate: number; critDamage: number; energyRegen: number; basicDamage: number; heavyDamage: number; skillDamage: number; liberationDamage: number; spectroDamage: number; fusionDamage: number; glacioDamage: number; electroDamage: number; aeroDamage: number; havocDamage: number; healingBonus: number }
export interface DamageResult { normal: number; critical: number; expected: number; hits: number; attackId: string }
export interface RotationResult { total: number; dps: number; actions: Array<DamageResult & { timestamp: number; buildId: string }>; byBuild: Record<string, number>; byType: Partial<Record<DamageType, number>> }
export interface ScanField<T> { value: T; confidence: number; raw?: string }
export interface BuildCardDetails { id: string; character: ScanField<string>; characterCatalogId?: string; characterLevel: ScanField<number>; sequence: ScanField<number>; skillLevels: ScanField<number>[]; weapon: ScanField<string>; weaponCatalogId?: string; weaponLevel: ScanField<number>; sourceImageDataUrl: string }
export interface ScanCandidate { id: string; createdAt: number; imageDataUrl: string; fingerprint: string; fields: { name: ScanField<string>; cost: ScanField<1 | 3 | 4>; rarity: ScanField<1 | 2 | 3 | 4 | 5>; level: ScanField<number>; sonata: ScanField<string>; mainStat: ScanField<StatLine>; subStats: ScanField<StatLine>[]; equippedBy: ScanField<string>; locked: ScanField<boolean>; excluded: ScanField<boolean> }; source: 'screen' | 'screenshot' | 'video' | 'manual'; duplicateOf?: string; buildCard?: BuildCardDetails }
export type OptimizerStatKey = Exclude<keyof AggregatedStats, 'baseHp' | 'baseAtk' | 'baseDef'>
export type OptimizerObjective = 'expected' | 'normal' | 'critical' | OptimizerStatKey
export interface OptimizationTarget { id: string; label: string; kind: 'damage' | 'healing' | 'shield' | 'stat' | 'rotation'; mode: FormulaResultMode }
export interface OptimizerFormulaConfig {
  target: OptimizationTarget
  node: import('./calculation/engine').FormulaNode
  inputs: Record<string, ScenarioValue>
  entries: import('./calculation/engine').FormulaEntry[]
}
export interface OptimizerCalculationV2Config {
  build: Build
  character: OwnedCharacter
  characterCatalog: import('../game-data').CharacterCatalogEntry
  weapon?: OwnedWeapon
  weaponCatalog?: import('../game-data').WeaponCatalogEntry
  attack: import('./calculation-v2/types').CalculationAttackDefinition
  scenario?: import('./calculation-v2/types').CalculationScenarioV2
  partyEffects?: import('./calculation-v2/types').CalculationEffectDefinition[]
  sourceStats?: import('./calculation-v2/types').CalculationSourceStats
  roverGender?: 'male' | 'female'
}
export type OptimizerEquippedPolicy = 'current' | 'team' | 'all'
export type OptimizerMainEchoPolicy = 'current' | 'any' | 'selected'
export type OptimizerSearchMode = 'exact' | 'fast'
export type OptimizerSonataMode = 'any' | 'highest' | 'dual' | 'custom'
export interface OptimizerSonataRequirement { sonata: string; pieces: number }
export interface OptimizerProfile {
  id: string
  buildId: string
  targetId?: string
  levelLow: number
  levelHigh: number
  rarities: Echo['rarity'][]
  mainStatsByCost: Record<'1' | '3' | '4', StatKey[]>
  excludedEchoIds: string[]
  equippedPolicy: OptimizerEquippedPolicy
  teamBuildIds: string[]
  mainEchoPolicy: OptimizerMainEchoPolicy
  selectedMainEchoId?: string
  allowedSonatas: string[]
  sonataMode: OptimizerSonataMode
  allowNoSonata: boolean
  requiredSonataEffects: OptimizerSonataRequirement[]
  minimumStats: Partial<Record<OptimizerStatKey, number>>
  maximumStats: Partial<Record<OptimizerStatKey, number>>
  minimumScore?: number
  maximumScore?: number
  resultLimit: number
  plotStat: OptimizerStatKey
  workerCount: number | 'auto'
  searchMode: OptimizerSearchMode
  maxEvaluations: number
  allowPartial: boolean
  updatedAt: number
}
export interface OptimizerProgress {
  requestId: string
  total: number
  processed: number
  tested: number
  rejected: number
  skipped: number
  skippedCost?: number
  skippedSonata?: number
  skippedBounds?: number
  elapsedMs: number
  testedPerSecond: number
}
export interface OptimizerPlotPoint { x: number; y: number; echoIds: string[]; mainEchoId: string; stats?: AggregatedStats }
export interface OptimizerRequest {
  requestId: string
  echoes: Echo[]
  resonator: Resonator
  weapon: Weapon
  attack: AttackDefinition
  enemy: EnemyConfig
  objective: OptimizerObjective
  minimumStats: Partial<Record<OptimizerStatKey, number>>
  maximumStats?: Partial<Record<OptimizerStatKey, number>>
  requiredSonata?: string
  limit: number
  maxEvaluations?: number
  includeEquippedBy?: string
  currentMainEchoId?: string
  bonusStatLines?: StatLine[]
  formula?: OptimizerFormulaConfig
  calculationV2?: OptimizerCalculationV2Config
  profile?: OptimizerProfile
  partition?: { index: number; count: number }
  /** Global top-N cutoff supplied by the coordinator. Branches must beat it. */
  scoreThreshold?: number
}
export interface OptimizerResult {
  requestId: string
  echoIds: string[]
  mainEchoId?: string
  score: number
  plot?: number
  stats: AggregatedStats
  damage: DamageResult
  complete?: boolean
  evaluations?: number
  targetId?: string
}
export interface OptimizerRun {
  id: string
  buildId: string
  profileId: string
  requestId: string
  createdAt: number
  gameDataVersion: string
  inventoryFingerprint: string
  profileFingerprint: string
  contextFingerprint: string
  results: OptimizerResult[]
  plot: OptimizerPlotPoint[]
  complete: boolean
  progress: OptimizerProgress
  highlightedBuildKeys?: string[]
}
export interface AccountDocument { schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7; gameDataVersion: string; exportedAt: string; echoes: Echo[]; characters: OwnedCharacter[]; weapons: OwnedWeapon[]; builds: Build[]; equippedLoadouts?: EquippedLoadout[]; theorycraftBuilds?: TheorycraftBuild[]; teams: Team[]; optimizerProfiles?: OptimizerProfile[]; optimizerRuns?: OptimizerRun[]; settings: AppSettings }
export interface AppSettings { displayName: string; uid: string; privacyMode: boolean; background: 'signal' | 'tacet' | 'plain'; scanIntervalMs: number; roverGender: 'male' | 'female'; scoreWeights: Record<string, Partial<Record<StatKey, number>>>; characterSubstatWeights: Record<string, Partial<Record<StatKey, number>>>; characterEnergyRegenMinimums: Record<string, number> }
export type AppView = 'dashboard' | 'archive' | 'scanner' | 'echoes' | 'weapons' | 'characters' | 'teams' | 'legal'
