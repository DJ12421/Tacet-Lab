import { aggregateStats, calculateDamage } from './damage'
import { FormulaCalculator } from './calculation/engine'
import { echoStatLines } from '../game-data/echo-main-stats'
import type { Echo, OptimizerRequest, OptimizerResult, StatKey } from './types'

const PERCENT_STATS = new Set<StatKey>(['critRate', 'critDamage', 'atkPercent', 'hpPercent', 'defPercent', 'energyRegen', 'basicDamage', 'heavyDamage', 'skillDamage', 'liberationDamage', 'spectroDamage', 'fusionDamage', 'glacioDamage', 'electroDamage', 'aeroDamage', 'havocDamage', 'healingBonus'])

function lineScore(echo: Echo, objective: OptimizerRequest['objective']) {
  const lines = echoStatLines(echo)
  if (objective !== 'expected' && objective !== 'normal' && objective !== 'critical') {
    const related: Partial<Record<OptimizerRequest['objective'], StatKey[]>> = {
      hp: ['hp', 'hpPercent'], atk: ['atk', 'atkPercent'], def: ['def', 'defPercent']
    }
    const keys = related[objective] ?? [objective as StatKey]
    return lines.filter((line) => keys.includes(line.key)).reduce((sum, line) => sum + line.value, 0)
  }
  return lines.reduce((score, line) => {
    if (line.key === 'critRate') return score + line.value * 2
    if (line.key === 'critDamage') return score + line.value
    if (line.key === 'atkPercent') return score + line.value * 1.1
    if (line.key.endsWith('Damage')) return score + line.value
    return score + (PERCENT_STATS.has(line.key) ? line.value * 0.15 : line.value * 0.005)
  }, 0)
}

function meetsMinimums(stats: OptimizerResult['stats'], minimums: OptimizerRequest['minimumStats']) {
  return Object.entries(minimums).every(([key, value]) => stats[key as keyof typeof stats] >= (value ?? 0))
}

function meetsMaximums(stats: OptimizerResult['stats'], maximums: OptimizerRequest['maximumStats'] = {}) {
  return Object.entries(maximums).every(([key, value]) => stats[key as keyof typeof stats] <= (value ?? Number.POSITIVE_INFINITY))
}

function resultScore(result: Omit<OptimizerResult, 'score'>, objective: OptimizerRequest['objective']) {
  if (objective === 'expected' || objective === 'normal' || objective === 'critical') return result.damage[objective]
  return result.stats[objective]
}

export function optimizeBuilds(
  request: OptimizerRequest,
  maxEvaluations = request.maxEvaluations ?? 300_000,
  evaluateDamage?: (echoes: Echo[], stats: OptimizerResult['stats']) => OptimizerResult['damage'] | undefined
): OptimizerResult[] {
  if (!request.requestId || request.limit < 1 || request.limit > 100 || maxEvaluations < 1) return []
  const seenIds = new Set<string>()
  const usable = request.echoes.filter((echo) => {
    if (echo.excluded || (echo.equippedBy && echo.equippedBy !== request.includeEquippedBy) || seenIds.has(echo.id)) return false
    seenIds.add(echo.id)
    return true
  })
  const locked = usable.filter((echo) => echo.locked)
  if (locked.length > 5 || locked.reduce((sum, echo) => sum + echo.cost, 0) > 12) return []
  if (request.requiredSonata && locked.some((echo) => echo.sonata !== request.requiredSonata)) return []

  const ranked = usable
    .filter((echo) => !echo.locked)
    .filter((echo) => !request.requiredSonata || echo.sonata === request.requiredSonata)
    .sort((a, b) => lineScore(b, request.objective) - lineScore(a, request.objective) || a.id.localeCompare(b.id))
  const candidates = [1, 3, 4].flatMap((cost) => ranked.filter((echo) => echo.cost === cost))
  const results: OptimizerResult[] = []
  let visitedNodes = 0

  function visit(index: number, selected: Echo[], cost: number) {
    visitedNodes += 1
    if (visitedNodes > maxEvaluations) return
    if (selected.length === 5) {
      const stats = aggregateStats(request.resonator, request.weapon, selected, request.bonusStatLines, !request.calculationV2)
      if (!meetsMinimums(stats, request.minimumStats) || !meetsMaximums(stats, request.maximumStats)) return
      const damage = evaluateDamage?.(selected, stats) ?? calculateDamage(stats, request.attack, request.enemy)
      const partial = { requestId: request.requestId, echoIds: selected.map((echo) => echo.id), stats, damage }
      const score = request.formula && !evaluateDamage
        ? Number(new FormulaCalculator({ stats: { ...stats }, inputs: request.formula.inputs, entries: request.formula.entries }).evaluate(request.formula.node).value)
        : resultScore(partial, request.objective)
      if (!Number.isFinite(score)) return
      const result: OptimizerResult = { ...partial, score, targetId: request.formula?.target.id }
      results.push(result)
      results.sort((a, b) => b.score - a.score || a.echoIds.join(':').localeCompare(b.echoIds.join(':')))
      if (results.length > request.limit) results.length = request.limit
      return
    }
    if (index >= candidates.length || selected.length + candidates.length - index < 5) return
    for (let next = index; next < candidates.length; next += 1) {
      const echo = candidates[next]
      if (cost + echo.cost > 12) continue
      visit(next + 1, [...selected, echo], cost + echo.cost)
      if (visitedNodes > maxEvaluations) break
    }
  }

  visit(0, locked, locked.reduce((sum, echo) => sum + echo.cost, 0))
  const complete = visitedNodes <= maxEvaluations
  for (const result of results) { result.complete = complete; result.evaluations = visitedNodes }
  return results
}
