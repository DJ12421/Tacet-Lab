/// <reference lib="webworker" />
import { createOptimizerWorkPlan, optimizeOptimizerWorkUnit, type OptimizerWorkPlan } from '../domain/optimizer'
import type { AggregatedStats, DamageResult, Echo, OptimizerRequest } from '../domain/types'
import {
  calculatePreparedBuildAttackV2,
  enemyV2,
  prepareBuildAttackV2,
  type PreparedBuildAttackV2
} from '../domain/calculation-v2'

type InitCommand = { type: 'init'; request: OptimizerRequest }
type RunCommand = { type: 'run'; requestId: string; workIndex: number; scoreThreshold?: number; maxEvaluations?: number }
type ThresholdCommand = { type: 'threshold'; requestId: string; scoreThreshold?: number }
type OptimizerWorkerCommand = InitCommand | RunCommand | ThresholdCommand

let plan: OptimizerWorkPlan | undefined
let globalScoreThreshold: number | undefined
const preparedEvaluators = new Map<string, PreparedBuildAttackV2 | null>()
const preparedBoundSafety = new WeakMap<PreparedBuildAttackV2, boolean>()

const SAFE_SONATA_BOUND_MODIFIERS = new Set([
  'Aero', 'AllElementAttributeBonus', 'ATK', 'ATK:AdditionalBase', 'BasicAttackDMGBonus',
  'CoordinatedDMGBonus', 'CritDMG', 'CritRate', 'CritRate:Echo', 'CritRate:Heavy',
  'EchoDMGBonus', 'Electro', 'EnableAttack', 'EnergyRegen', 'ForteBased:Liberation:Basic',
  'Fusion', 'Glacio', 'Havoc', 'HealingBonus', 'HeavyAttackDMGBonus', 'HP',
  'OutroSkillDMGBonus', 'ResonanceLiberationDMGBonus', 'ResonanceSkillDMGBonus',
  'Spectro', 'tuneBreakBoost'
])

function nonNegative(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(nonNegative)
  if (value && typeof value === 'object') return Object.values(value).every(nonNegative)
  if (typeof value === 'number') return value >= 0
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) && parsed >= 0
  }
  return true
}

function hasSafeSonataUpperBound(prepared: PreparedBuildAttackV2) {
  const cached = preparedBoundSafety.get(prepared)
  if (cached !== undefined) return cached
  const safe = prepared.effects.filter((effect) => effect.sourceKind === 'sonata').every((effect) =>
    effect.modifiers.every((modifier) => SAFE_SONATA_BOUND_MODIFIERS.has(modifier.modifier ?? '')
      && (modifier.modifier === 'EnableAttack' || nonNegative([
        modifier.modifierValue,
        modifier.modifierByRefinement,
        modifier.maximumValue,
        modifier.modifierStep,
        modifier.overflowStep,
        modifier.overflowMin,
        modifier.overflowMax,
        modifier.minStatValue
      ])))
  )
  preparedBoundSafety.set(prepared, safe)
  return safe
}

function damageEvaluator(request: OptimizerRequest) {
  const config = request.calculationV2
  if (!config) return undefined
  const enemy = enemyV2(request.enemy, config.scenario)
  const evaluatePrepared = (echoes: Echo[], stats: AggregatedStats, sonatas: Array<{ name: string; count: number }>, prefix = '', requireSafeBound = false): DamageResult | undefined => {
    const key = `${prefix}${echoes[0]?.id ?? ''}|${sonatas.map((entry) => `${entry.name}:${entry.count}`).join('|')}`
    let prepared = preparedEvaluators.get(key)
    if (prepared === undefined) {
      prepared = prepareBuildAttackV2({
        build: { ...config.build, echoIds: echoes.map((echo) => echo.id) },
        character: config.character,
        characterCatalog: config.characterCatalog,
        weapon: config.weapon,
        weaponCatalog: config.weaponCatalog,
        scenario: config.scenario,
        partyEffects: config.partyEffects,
        roverGender: config.roverGender,
        showcase: { equipmentStats: stats, sonatas, echoSlots: echoes }
      }, config.attack, enemy) ?? null
      preparedEvaluators.set(key, prepared)
    }
    if (!prepared) return undefined
    // Exact mode may only prune with a proven monotone Sonata relaxation. A
    // future generated modifier falls back to no damage bound automatically.
    if (requireSafeBound && !hasSafeSonataUpperBound(prepared)) return undefined
    const result = calculatePreparedBuildAttackV2(prepared, stats)
    return { ...result, hits: config.attack.count }
  }
  const evaluate = (echoes: Echo[], stats: AggregatedStats): DamageResult | undefined => {
    const sonataCounts = new Map<string, number>()
    for (const echo of echoes) sonataCounts.set(echo.sonata, (sonataCounts.get(echo.sonata) ?? 0) + 1)
    const sonatas = [...sonataCounts].sort(([left], [right]) => left.localeCompare(right)).map(([name, count]) => ({ name, count }))
    return evaluatePrepared(echoes, stats, sonatas)
  }
  evaluate.upperBound = (selected: Echo[], candidates: Echo[], start: number, amount: number, stats: AggregatedStats) => {
    const counts = new Map<string, number>()
    const available = new Map<string, number>()
    for (const echo of selected) counts.set(echo.sonata, (counts.get(echo.sonata) ?? 0) + 1)
    for (let index = start; index < candidates.length; index += 1) {
      const sonata = candidates[index].sonata
      available.set(sonata, (available.get(sonata) ?? 0) + 1)
    }
    for (const [sonata, count] of available) counts.set(sonata, (counts.get(sonata) ?? 0) + Math.min(amount, count))
    const sonatas = [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([name, count]) => ({ name, count }))
    return evaluatePrepared(selected, stats, sonatas, 'upper:', true)
  }
  return evaluate
}

self.onmessage = (event: MessageEvent<OptimizerWorkerCommand>) => {
  const command = event.data
  try {
    if (command.type === 'init') {
      plan = createOptimizerWorkPlan(command.request)
      globalScoreThreshold = command.request.scoreThreshold
      preparedEvaluators.clear()
      self.postMessage({ type: 'ready', requestId: command.request.requestId, total: plan.total, workCount: plan.work.length })
      return
    }
    if (!plan || plan.request.requestId !== command.requestId) return
    if (command.type === 'threshold') {
      globalScoreThreshold = command.scoreThreshold
      return
    }
    const scoreThreshold = Math.max(globalScoreThreshold ?? Number.NEGATIVE_INFINITY, command.scoreThreshold ?? Number.NEGATIVE_INFINITY)
    const output = optimizeOptimizerWorkUnit(
      plan,
      command.workIndex,
      {
        scoreThreshold: Number.isFinite(scoreThreshold) ? scoreThreshold : undefined,
        maxEvaluations: command.maxEvaluations
      },
      damageEvaluator(plan.request),
      (progress) => self.postMessage({ type: 'progress', requestId: command.requestId, workIndex: command.workIndex, progress })
    )
    self.postMessage({ type: 'complete', requestId: command.requestId, workIndex: command.workIndex, ...output })
  } catch (error) {
    const requestId = command.type === 'init' ? command.request.requestId : command.requestId
    self.postMessage({ type: 'error', requestId, error: error instanceof Error ? error.message : 'Optimizer failed.' })
  }
}
