import { estimateFormulaRange, evaluateFormulaValue, type FormulaRange } from './calculation/engine'
import { calculateDamage, emptyStats, floorGameValue } from './damage'
import { echoStatLines } from '../game-data/echo-main-stats'
import { sonataCatalog } from '../game-data'
import type {
  Echo,
  OptimizerPlotPoint,
  OptimizerProgress,
  OptimizerRequest,
  OptimizerResult,
  OptimizerStatKey,
  StatKey
} from './types'

interface DamageEvaluator {
  (echoes: Echo[], stats: OptimizerResult['stats']): OptimizerResult['damage'] | undefined
  upperBound?: (
    selected: Echo[],
    candidates: Echo[],
    start: number,
    amount: number,
    stats: OptimizerResult['stats']
  ) => OptimizerResult['damage'] | undefined
}
type ProgressListener = (progress: OptimizerProgress) => void

type EchoStatVector = Partial<Record<StatKey, number>>

interface CompiledOptimizerData {
  vectors: Map<string, EchoStatVector>
  orderScores: Map<string, number>
  bonus: EchoStatVector
  base: { hp: number; atk: number; def: number }
  boundsCache: Map<Echo[], CandidateSelectionBounds>
}

interface CandidateSelectionBounds {
  costs: number[][]
  stats: Map<StatKey, { min: number[][]; max: number[][] }>
}

export interface OptimizerPartitionOutput {
  results: OptimizerResult[]
  plot: OptimizerPlotPoint[]
  progress: OptimizerProgress
  complete: boolean
}

const PERCENT_STATS = new Set<StatKey>(['critRate', 'critDamage', 'atkPercent', 'hpPercent', 'defPercent', 'energyRegen', 'basicDamage', 'heavyDamage', 'skillDamage', 'liberationDamage', 'spectroDamage', 'fusionDamage', 'glacioDamage', 'electroDamage', 'aeroDamage', 'havocDamage', 'healingBonus'])
const MAX_SAFE_COUNT = Number.MAX_SAFE_INTEGER

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

function compileOptimizerData(request: OptimizerRequest, echoes: Echo[]): CompiledOptimizerData {
  const vectors = new Map<string, EchoStatVector>()
  const orderScores = new Map<string, number>()
  for (const echo of echoes) {
    const vector: EchoStatVector = {}
    for (const line of echoStatLines(echo)) vector[line.key] = (vector[line.key] ?? 0) + line.value
    vectors.set(echo.id, vector)
    orderScores.set(echo.id, lineScore(echo, request.objective))
  }
  const bonus: EchoStatVector = {}
  for (const line of request.bonusStatLines ?? []) bonus[line.key] = (bonus[line.key] ?? 0) + line.value
  if (request.weapon.stat) bonus[request.weapon.stat.key] = (bonus[request.weapon.stat.key] ?? 0) + request.weapon.stat.value
  return {
    vectors,
    orderScores,
    bonus,
    boundsCache: new Map(),
    base: {
      hp: floorGameValue(request.resonator.baseStats.hp),
      atk: floorGameValue(request.resonator.baseStats.atk) + floorGameValue(request.weapon.baseAtk),
      def: floorGameValue(request.resonator.baseStats.def)
    }
  }
}

function aggregateCompiledStats(
  request: OptimizerRequest,
  echoes: Echo[],
  data: CompiledOptimizerData,
  includeLegacySonatas = true,
  accumulated?: EchoStatVector
) {
  const stats = emptyStats()
  const percent = { hp: 0, atk: 0, def: 0 }
  const flat = { hp: 0, atk: 0, def: 0 }
  stats.baseHp = data.base.hp
  stats.baseAtk = data.base.atk
  stats.baseDef = data.base.def
  stats.critRate = request.resonator.baseStats.critRate
  stats.critDamage = request.resonator.baseStats.critDamage

  const addVector = (vector: EchoStatVector | undefined) => {
    if (!vector) return
    for (const [key, value] of Object.entries(vector) as Array<[StatKey, number]>) {
      if (key === 'hpPercent') percent.hp += value
      else if (key === 'atkPercent') percent.atk += value
      else if (key === 'defPercent') percent.def += value
      else if (key === 'hp' || key === 'atk' || key === 'def') flat[key] += value
      else if (key in stats) stats[key as keyof typeof stats] += value
    }
  }
  addVector(data.bonus)
  if (accumulated) addVector(accumulated)
  else for (const echo of echoes) addVector(data.vectors.get(echo.id))

  if (includeLegacySonatas) {
    const sonatas = new Map<string, number>()
    for (const echo of echoes) sonatas.set(echo.sonata, (sonatas.get(echo.sonata) ?? 0) + 1)
    if ((sonatas.get('Celestial Light') ?? 0) >= 5) stats.spectroDamage += 30
    if ((sonatas.get('Molten Rift') ?? 0) >= 5) stats.fusionDamage += 30
    if ((sonatas.get('Freezing Frost') ?? 0) >= 5) stats.glacioDamage += 30
    if ((sonatas.get('Lingering Tunes') ?? 0) >= 5) percent.atk += 20
    if ((sonatas.get('Rejuvenating Glow') ?? 0) >= 5) stats.healingBonus += 10
  }
  stats.hp = floorGameValue(data.base.hp * (1 + percent.hp / 100) + flat.hp)
  stats.atk = floorGameValue(data.base.atk * (1 + percent.atk / 100) + flat.atk)
  stats.def = floorGameValue(data.base.def * (1 + percent.def / 100) + flat.def)
  return stats
}

function accumulateEchoVector(target: EchoStatVector, echo: Echo, data: CompiledOptimizerData, direction: 1 | -1) {
  const vector = data.vectors.get(echo.id)
  if (!vector) return
  for (const [key, value] of Object.entries(vector) as Array<[StatKey, number]>) target[key] = (target[key] ?? 0) + value * direction
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

function choose(count: number, amount: number) {
  if (amount < 0 || amount > count) return 0
  const k = Math.min(amount, count - amount)
  let result = 1
  for (let index = 1; index <= k; index += 1) {
    result = result * (count - k + index) / index
    if (result >= MAX_SAFE_COUNT) return MAX_SAFE_COUNT
  }
  return Math.round(result)
}

function safeAdd(left: number, right: number) {
  return Math.min(MAX_SAFE_COUNT, left + right)
}

export function echoMatchesOptimizerProfile(echo: Echo, profile: OptimizerRequest['profile'], includeEquippedBy?: string) {
  if (echo.excluded) return false
  if (!profile) return !echo.equippedBy || echo.equippedBy === includeEquippedBy
  if (profile.excludedEchoIds.includes(echo.id)) return false
  if (echo.level < profile.levelLow || echo.level > profile.levelHigh) return false
  if (!profile.rarities.includes(echo.rarity)) return false
  if (!(profile.mainStatsByCost[String(echo.cost) as '1' | '3' | '4'] ?? []).includes(echo.mainStat.key)) return false
  if (!echo.equippedBy || echo.equippedBy === includeEquippedBy) return true
  if (profile.equippedPolicy === 'all') return true
  return profile.equippedPolicy === 'team' && profile.teamBuildIds.includes(echo.equippedBy)
}

function eligibleEchoes(request: OptimizerRequest) {
  const profile = request.profile
  const seenIds = new Set<string>()
  return request.echoes.filter((echo) => {
    if (seenIds.has(echo.id)) return false
    seenIds.add(echo.id)
    return echoMatchesOptimizerProfile(echo, profile, request.includeEquippedBy)
  })
}

function dominates(left: Echo, right: Echo, data: CompiledOptimizerData) {
  const a = data.vectors.get(left.id) ?? {}
  const b = data.vectors.get(right.id) ?? {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as StatKey[])
  let strictlyBetter = false
  for (const key of keys) {
    const av = a[key] ?? 0
    const bv = b[key] ?? 0
    if (av < bv) return false
    if (av > bv) strictlyBetter = true
  }
  return strictlyBetter || left.id.localeCompare(right.id) > 0
}

function pruneDominatedEchoes(echoes: Echo[], request: OptimizerRequest, protectedIds: Set<string>, data: CompiledOptimizerData) {
  // With a fixed main Echo, secondary Echoes in the same cost/Sonata group
  // contribute only non-negative equipment stats. Retaining topN + four
  // dominators keeps enough distinct pieces for every five-slot result.
  // Arbitrary-main, declarative formula and upper-bound searches stay unpruned.
  if (!request.profile || request.profile.mainEchoPolicy === 'any' || request.formula
    || Object.keys(request.maximumStats ?? {}).length || request.profile.maximumScore !== undefined) return echoes
  const threshold = request.limit + 4
  const groups = new Map<string, Echo[]>()
  for (const echo of echoes) {
    const key = `${echo.cost}:${echo.sonata}`
    groups.set(key, [...(groups.get(key) ?? []), echo])
  }
  return echoes.filter((echo) => {
    if (protectedIds.has(echo.id)) return true
    let dominators = 0
    for (const other of groups.get(`${echo.cost}:${echo.sonata}`) ?? []) {
      if (other.id !== echo.id && dominates(other, echo, data) && ++dominators >= threshold) return false
    }
    return true
  })
}

function activeSonataEffects(echoes: Echo[]) {
  const counts = new Map<string, number>()
  for (const echo of echoes) counts.set(echo.sonata, (counts.get(echo.sonata) ?? 0) + 1)
  return sonataCatalog.flatMap((sonata) => {
    const count = counts.get(sonata.name) ?? 0
    return sonata.effects.filter((effect) => count >= effect.pieces).map((effect) => ({ sonata: sonata.name, pieces: effect.pieces }))
  })
}

function matchesSonataRules(echoes: Echo[], request: OptimizerRequest) {
  if (request.requiredSonata && echoes.some((echo) => echo.sonata !== request.requiredSonata)) return false
  const profile = request.profile
  if (!profile) return true
  const active = activeSonataEffects(echoes)
  const allowed = new Set(profile.allowedSonatas)
  if (active.some((effect) => !allowed.has(effect.sonata))) return false
  if (!active.length && !profile.allowNoSonata) return false
  if (profile.sonataMode === 'any') return true
  if (profile.sonataMode === 'dual') return new Set(active.map((effect) => effect.sonata)).size >= 2
  if (profile.sonataMode === 'highest') {
    return active.some((effect) => {
      const sonata = sonataCatalog.find((entry) => entry.name === effect.sonata)
      return effect.pieces === Math.max(0, ...(sonata?.effects.map((entry) => entry.pieces) ?? []))
    })
  }
  return profile.requiredSonataEffects.every((required) => active.some((effect) => effect.sonata === required.sonata && effect.pieces >= required.pieces))
}

function sonataBranchCanQualify(selected: Echo[], candidates: Echo[], start: number, amount: number, request: OptimizerRequest) {
  if (request.requiredSonata) {
    if (selected.some((echo) => echo.sonata !== request.requiredSonata)) return false
    let available = 0
    for (let index = start; index < candidates.length; index += 1) if (candidates[index].sonata === request.requiredSonata) available += 1
    if (available < amount) return false
  }
  const profile = request.profile
  if (!profile) return true
  const selectedCounts = new Map<string, number>()
  const availableCounts = new Map<string, number>()
  for (const echo of selected) selectedCounts.set(echo.sonata, (selectedCounts.get(echo.sonata) ?? 0) + 1)
  for (let index = start; index < candidates.length; index += 1) {
    const sonata = candidates[index].sonata
    availableCounts.set(sonata, (availableCounts.get(sonata) ?? 0) + 1)
  }
  const allowed = new Set(profile.allowedSonatas)
  const canReach = (name: string, pieces: number) => (selectedCounts.get(name) ?? 0) + Math.min(amount, availableCounts.get(name) ?? 0) >= pieces
  for (const sonata of sonataCatalog) {
    if (allowed.has(sonata.name)) continue
    const count = selectedCounts.get(sonata.name) ?? 0
    if (sonata.effects.some((effect) => count >= effect.pieces)) return false
  }
  if (profile.requiredSonataEffects.some((required) => !canReach(required.sonata, required.pieces))) return false
  const reachable = sonataCatalog.filter((sonata) => allowed.has(sonata.name) && sonata.effects.some((effect) => canReach(sonata.name, effect.pieces)))
  if (!profile.allowNoSonata && !reachable.length) return false
  if (profile.sonataMode === 'dual' && reachable.length < 2) return false
  if (profile.sonataMode === 'highest' && !reachable.some((sonata) => {
    const highest = Math.max(0, ...sonata.effects.map((effect) => effect.pieces))
    return canReach(sonata.name, highest)
  })) return false
  return true
}

function mainCandidates(echoes: Echo[], request: OptimizerRequest) {
  const profile = request.profile
  const currentMainId = request.currentMainEchoId
  const policy = profile?.mainEchoPolicy ?? 'any'
  const selectedId = policy === 'current' ? currentMainId : policy === 'selected' ? profile?.selectedMainEchoId : undefined
  const candidates = selectedId ? echoes.filter((echo) => echo.id === selectedId) : echoes
  return candidates
}

function candidateOrder(a: Echo, b: Echo, data: CompiledOptimizerData) {
  return (data.orderScores.get(b.id) ?? 0) - (data.orderScores.get(a.id) ?? 0) || a.id.localeCompare(b.id)
}

type SearchTask = {
  main: Echo
  selected: Echo[]
  candidates: Echo[]
  start: number
  choose: number
  total: number
}

export interface OptimizerWorkPlan {
  request: OptimizerRequest
  data: CompiledOptimizerData
  work: SearchTask[]
  total: number
}

function createTasks(request: OptimizerRequest, usable: Echo[], data: CompiledOptimizerData) {
  const partition = request.partition ?? { index: 0, count: 1 }
  const targets = request.profile?.allowPartial ? [1, 2, 3, 4, 5] : [5]
  const tasks: SearchTask[] = []
  let total = 0
  let ordinal = 0
  for (const main of mainCandidates(usable, request).sort((a, b) => candidateOrder(a, b, data))) {
    const mandatory = [main]
    const mandatoryIds = new Set([main.id])
    const candidates = usable.filter((echo) => !mandatoryIds.has(echo.id)).sort((a, b) => candidateOrder(a, b, data))
    for (const target of targets) {
      const needed = target - mandatory.length
      if (needed < 0 || needed > candidates.length) continue
      if (needed === 0) {
        if (ordinal++ % partition.count === partition.index) {
          tasks.push({ main, selected: mandatory, candidates, start: 0, choose: 0, total: 1 })
          total = safeAdd(total, 1)
        }
        continue
      }
      for (let first = 0; first <= candidates.length - needed; first += 1) {
        const taskTotal = choose(candidates.length - first - 1, needed - 1)
        if (ordinal++ % partition.count !== partition.index) continue
        tasks.push({ main, selected: [...mandatory, candidates[first]], candidates, start: first + 1, choose: needed - 1, total: taskTotal })
        total = safeAdd(total, taskTotal)
      }
    }
  }
  return { tasks, total }
}

function resultKey(result: OptimizerResult) {
  return result.echoIds.join(':')
}

function insertResult(results: OptimizerResult[], result: OptimizerResult, limit: number) {
  const key = resultKey(result)
  if (results.some((entry) => resultKey(entry) === key)) return
  if (results.length === limit) {
    const last = results[results.length - 1]
    if (last.score > result.score || (last.score === result.score && resultKey(last).localeCompare(key) <= 0)) return
  }
  let low = 0
  let high = results.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const compare = results[middle].score === result.score
      ? resultKey(results[middle]).localeCompare(key)
      : result.score - results[middle].score
    if (compare < 0) low = middle + 1
    else high = middle
  }
  results.splice(low, 0, result)
  if (results.length > limit) results.pop()
}

type StatEnvelope = { min: OptimizerResult['stats']; max: OptimizerResult['stats'] }

function candidateContribution(echo: Echo, key: StatKey, data: CompiledOptimizerData) {
  return data.vectors.get(echo.id)?.[key] ?? 0
}

function selectionTable(candidates: Echo[], value: (echo: Echo) => number, highest: boolean) {
  const unreachable = highest ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  const table = Array.from({ length: candidates.length + 1 }, () => Array<number>(6).fill(unreachable))
  table[candidates.length][0] = 0
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    table[index][0] = 0
    const contribution = value(candidates[index])
    for (let amount = 1; amount <= 5; amount += 1) {
      const without = table[index + 1][amount]
      const previous = table[index + 1][amount - 1]
      const withCurrent = Number.isFinite(previous) ? contribution + previous : unreachable
      table[index][amount] = highest ? Math.max(without, withCurrent) : Math.min(without, withCurrent)
    }
  }
  return table
}

function candidateBounds(candidates: Echo[], data: CompiledOptimizerData) {
  const cached = data.boundsCache.get(candidates)
  if (cached) {
    data.boundsCache.delete(candidates)
    data.boundsCache.set(candidates, cached)
    return cached
  }
  if (data.boundsCache.size >= 4) data.boundsCache.delete(data.boundsCache.keys().next().value!)
  const bounds: CandidateSelectionBounds = {
    costs: selectionTable(candidates, (echo) => echo.cost, false),
    stats: new Map()
  }
  data.boundsCache.set(candidates, bounds)
  return bounds
}

function extremeContribution(candidates: Echo[], start: number, amount: number, key: StatKey, highest: boolean, data: CompiledOptimizerData) {
  const bounds = candidateBounds(candidates, data)
  let stat = bounds.stats.get(key)
  if (!stat) {
    stat = {
      min: selectionTable(candidates, (echo) => candidateContribution(echo, key, data), false),
      max: selectionTable(candidates, (echo) => candidateContribution(echo, key, data), true)
    }
    bounds.stats.set(key, stat)
  }
  return (highest ? stat.max : stat.min)[start]?.[amount] ?? 0
}

/**
 * Conservative per-stat bounds for all completions of a partial loadout.
 * Each stat is optimized independently, so the envelope can overestimate a
 * real build but can never discard one that might satisfy the request.
 */
function statEnvelope(request: OptimizerRequest, selected: Echo[], candidates: Echo[], start: number, amount: number, data: CompiledOptimizerData): StatEnvelope {
  const base = aggregateCompiledStats(request, selected, data, false)
  const min = { ...base }
  const max = { ...base }
  const keys = Object.keys(base).filter((key) => !key.startsWith('base')) as OptimizerStatKey[]
  const minPercent: Record<'hp' | 'atk' | 'def', number> = { hp: 0, atk: 0, def: 0 }
  const maxPercent: Record<'hp' | 'atk' | 'def', number> = { hp: 0, atk: 0, def: 0 }
  const minFlat: Record<'hp' | 'atk' | 'def', number> = { hp: 0, atk: 0, def: 0 }
  const maxFlat: Record<'hp' | 'atk' | 'def', number> = { hp: 0, atk: 0, def: 0 }
  for (const stat of ['hp', 'atk', 'def'] as const) {
    minPercent[stat] = extremeContribution(candidates, start, amount, `${stat}Percent` as StatKey, false, data)
    maxPercent[stat] = extremeContribution(candidates, start, amount, `${stat}Percent` as StatKey, true, data)
    minFlat[stat] = extremeContribution(candidates, start, amount, stat, false, data)
    maxFlat[stat] = extremeContribution(candidates, start, amount, stat, true, data)
    const baseValue = base[`base${stat[0].toUpperCase()}${stat.slice(1)}` as 'baseHp' | 'baseAtk' | 'baseDef']
    min[stat] = Math.floor(base[stat] + baseValue * minPercent[stat] / 100 + minFlat[stat] - 1)
    max[stat] = Math.ceil(base[stat] + baseValue * maxPercent[stat] / 100 + maxFlat[stat] + 1)
  }
  for (const key of keys) {
    if (key === 'hp' || key === 'atk' || key === 'def') continue
    min[key] = base[key] + extremeContribution(candidates, start, amount, key, false, data)
    max[key] = base[key] + extremeContribution(candidates, start, amount, key, true, data)
  }
  // Legacy Sonata bonuses are non-negative. Include every possible bonus in
  // the upper envelope; the intentionally loose bound remains exactness-safe.
  max.atk += Math.ceil(max.baseAtk * 0.2)
  max.spectroDamage += 30
  max.fusionDamage += 30
  max.glacioDamage += 30
  max.healingBonus += 10
  return { min, max }
}

function scoreEnvelope(
  request: OptimizerRequest,
  envelope: StatEnvelope,
  evaluateDamage?: DamageEvaluator,
  branch?: { selected: Echo[]; candidates: Echo[]; start: number; amount: number }
): FormulaRange {
  if (request.formula) {
    const statRanges = Object.fromEntries(Object.keys(envelope.min).map((key) => [key, {
      min: envelope.min[key as keyof typeof envelope.min],
      max: envelope.max[key as keyof typeof envelope.max],
      monotonic: true
    }]))
    return estimateFormulaRange(request.formula.node, {
      stats: { ...envelope.min },
      inputs: request.formula.inputs,
      entries: request.formula.entries
    }, {}, statRanges)
  }
  if (request.objective === 'normal' || request.objective === 'critical' || request.objective === 'expected') {
    return {
      min: calculateDamage(envelope.min, request.attack, request.enemy)[request.objective],
      max: calculateDamage(envelope.max, request.attack, request.enemy)[request.objective],
      monotonic: true
    }
  }
  return { min: envelope.min[request.objective], max: envelope.max[request.objective], monotonic: true }
}

function branchCannotQualify(
  request: OptimizerRequest,
  selected: Echo[],
  candidates: Echo[],
  start: number,
  amount: number,
  localResults: OptimizerResult[],
  data: CompiledOptimizerData,
  evaluateDamage?: DamageEvaluator
) {
  const profile = request.profile
  const localThreshold = localResults.length >= request.limit ? localResults[localResults.length - 1].score : Number.NEGATIVE_INFINITY
  const globalThreshold = request.scoreThreshold ?? Number.NEGATIVE_INFINITY
  const hasStatConstraints = Object.keys(request.minimumStats).length > 0 || Object.keys(request.maximumStats ?? {}).length > 0
  const hasScoreBounds = profile?.minimumScore !== undefined || profile?.maximumScore !== undefined
    || Number.isFinite(localThreshold) || Number.isFinite(globalThreshold)
  if (!hasStatConstraints && !hasScoreBounds) return false
  const envelope = statEnvelope(request, selected, candidates, start, amount, data)
  if (Object.entries(request.minimumStats).some(([key, value]) => envelope.max[key as OptimizerStatKey] < (value ?? Number.NEGATIVE_INFINITY))) return true
  if (Object.entries(request.maximumStats ?? {}).some(([key, value]) => envelope.min[key as OptimizerStatKey] > (value ?? Number.POSITIVE_INFINITY))) return true
  if (!hasScoreBounds) return false
  const score = scoreEnvelope(request, envelope, evaluateDamage, { selected, candidates, start, amount })
  if (profile?.minimumScore !== undefined && score.max < profile.minimumScore) return true
  if (profile?.maximumScore !== undefined && score.min > profile.maximumScore) return true
  return Number.isFinite(score.max) && score.max < Math.max(localThreshold, globalThreshold)
}

const DEFAULT_WORK_COMBINATIONS = 75_000

function splitSearchTask(task: SearchTask, maximum: number, output: SearchTask[]) {
  if (task.total <= maximum || task.choose <= 1) {
    output.push(task)
    return
  }
  for (let index = task.start; index <= task.candidates.length - task.choose; index += 1) {
    const total = choose(task.candidates.length - index - 1, task.choose - 1)
    splitSearchTask({
      ...task,
      selected: [...task.selected, task.candidates[index]],
      start: index + 1,
      choose: task.choose - 1,
      total
    }, maximum, output)
  }
}

export function createOptimizerWorkPlan(request: OptimizerRequest, maximumWorkCombinations = DEFAULT_WORK_COMBINATIONS): OptimizerWorkPlan {
  const unpartitioned = { ...request, partition: undefined }
  let usable = eligibleEchoes(unpartitioned)
  const data = compileOptimizerData(unpartitioned, usable)
  const protectedIds = new Set([request.currentMainEchoId, request.profile?.selectedMainEchoId].filter((id): id is string => Boolean(id)))
  usable = pruneDominatedEchoes(usable, unpartitioned, protectedIds, data)
  const created = createTasks(unpartitioned, usable, data)
  const work: SearchTask[] = []
  for (const task of created.tasks) splitSearchTask(task, Math.max(1, maximumWorkCombinations), work)
  return { request: unpartitioned, data, work, total: created.total }
}

export function estimateOptimizerSearchSpace(request: OptimizerRequest) {
  return createOptimizerWorkPlan(request).total
}

function runOptimizerTasks(
  request: OptimizerRequest,
  data: CompiledOptimizerData,
  tasks: SearchTask[],
  evaluateDamage?: DamageEvaluator,
  onProgress?: ProgressListener
): OptimizerPartitionOutput {
  const startedAt = performance.now()
  const emptyProgress = (): OptimizerProgress => ({
    requestId: request.requestId,
    total: 0,
    processed: 0,
    tested: 0,
    rejected: 0,
    skipped: 0,
    skippedCost: 0,
    skippedSonata: 0,
    skippedBounds: 0,
    elapsedMs: performance.now() - startedAt,
    testedPerSecond: 0
  })
  if (!request.requestId || request.limit < 1 || request.limit > 100) return { results: [], plot: [], progress: emptyProgress(), complete: true }

  const total = tasks.reduce((sum, task) => safeAdd(sum, task.total), 0)
  const progress: OptimizerProgress = { ...emptyProgress(), total }
  const results: OptimizerResult[] = []
  const plot: OptimizerPlotPoint[] = []
  const sampleEvery = Math.max(1, Math.floor(total / 32))
  const profile = request.profile
  const legacyLimit = profile ? Number.POSITIVE_INFINITY : request.maxEvaluations ?? Number.POSITIVE_INFINITY
  const fastLimit = profile?.searchMode === 'fast' ? Math.max(1, profile.maxEvaluations) : legacyLimit
  let capped = false
  let lastProgressAt = startedAt

  const emitProgress = (force = false) => {
    const now = performance.now()
    if (!force && now - lastProgressAt < 75) return
    progress.elapsedMs = now - startedAt
    progress.testedPerSecond = progress.elapsedMs > 0 ? progress.tested / (progress.elapsedMs / 1000) : 0
    lastProgressAt = now
    onProgress?.({ ...progress })
  }

  const reject = () => { progress.rejected += 1; progress.processed += 1 }
  const evaluate = (selected: Echo[], main: Echo, accumulated: EchoStatVector) => {
    if (progress.tested + progress.rejected >= fastLimit) { capped = true; return }
    const secondary = selected.filter((echo) => echo.id !== main.id).sort((left, right) => right.cost - left.cost || left.id.localeCompare(right.id))
    const ordered = [main, ...secondary]
    if (!request.profile?.allowPartial && ordered.length !== 5) { reject(); return }
    if (ordered.reduce((sum, echo) => sum + echo.cost, 0) > 12 || !matchesSonataRules(ordered, request)) { reject(); return }
    const stats = aggregateCompiledStats(request, ordered, data, true, accumulated)
    if (!meetsMinimums(stats, request.minimumStats) || !meetsMaximums(stats, request.maximumStats)) { reject(); return }
    const damage = evaluateDamage?.(ordered, stats) ?? calculateDamage(stats, request.attack, request.enemy)
    const partial = { requestId: request.requestId, echoIds: ordered.map((echo) => echo.id), mainEchoId: main.id, stats, damage }
    const score = request.formula && !evaluateDamage
      ? Number(evaluateFormulaValue(request.formula.node, { stats: { ...stats }, inputs: request.formula.inputs, entries: request.formula.entries }))
      : resultScore(partial, request.objective)
    if (!Number.isFinite(score) || (profile?.minimumScore !== undefined && score < profile.minimumScore) || (profile?.maximumScore !== undefined && score > profile.maximumScore)) { reject(); return }
    progress.tested += 1
    progress.processed += 1
    const plotValue = stats[profile?.plotStat ?? 'atk']
    const result: OptimizerResult = { ...partial, score, plot: plotValue, targetId: request.formula?.target.id }
    insertResult(results, result, request.limit)
    if (progress.tested % sampleEvery === 0 && plot.length < 48) plot.push({ x: plotValue, y: score, echoIds: result.echoIds, mainEchoId: main.id, stats })
  }

  const cheapestCost = (candidates: Echo[], start: number, amount: number) => candidateBounds(candidates, data).costs[start]?.[amount] ?? Number.POSITIVE_INFINITY
  const visit = (task: SearchTask, start: number, amount: number, selected: Echo[], cost: number, accumulated: EchoStatVector) => {
    if (capped) return
    if (progress.tested + progress.rejected >= fastLimit) { capped = true; return }
    if (amount === 0) { evaluate(selected, task.main, accumulated); emitProgress(); return }
    const remaining = task.candidates.length - start
    if (remaining < amount) return
    if (cost > 12 || cost + cheapestCost(task.candidates, start, amount) > 12) {
      const skipped = choose(remaining, amount)
      progress.skipped = safeAdd(progress.skipped, skipped)
      progress.skippedCost = safeAdd(progress.skippedCost ?? 0, skipped)
      progress.processed = safeAdd(progress.processed, skipped)
      emitProgress()
      return
    }
    if (!sonataBranchCanQualify(selected, task.candidates, start, amount, request)) {
      const skipped = choose(remaining, amount)
      progress.skipped = safeAdd(progress.skipped, skipped)
      progress.skippedSonata = safeAdd(progress.skippedSonata ?? 0, skipped)
      progress.processed = safeAdd(progress.processed, skipped)
      emitProgress()
      return
    }
    // Candidate suffix envelopes are compiled once and reused across work
    // units, so even shallow branches are cheap to reject.
    if (branchCannotQualify(request, selected, task.candidates, start, amount, results, data, evaluateDamage)) {
      const skipped = choose(remaining, amount)
      progress.skipped = safeAdd(progress.skipped, skipped)
      progress.skippedBounds = safeAdd(progress.skippedBounds ?? 0, skipped)
      progress.processed = safeAdd(progress.processed, skipped)
      emitProgress()
      return
    }
    for (let index = start; index <= task.candidates.length - amount; index += 1) {
      const echo = task.candidates[index]
      selected.push(echo)
      accumulateEchoVector(accumulated, echo, data, 1)
      visit(task, index + 1, amount - 1, selected, cost + echo.cost, accumulated)
      accumulateEchoVector(accumulated, echo, data, -1)
      selected.pop()
      if (capped) return
    }
  }

  for (const task of tasks) {
    if (capped) break
    const accumulated: EchoStatVector = {}
    for (const echo of task.selected) accumulateEchoVector(accumulated, echo, data, 1)
    visit(task, task.start, task.choose, task.selected, task.selected.reduce((sum, echo) => sum + echo.cost, 0), accumulated)
  }

  progress.elapsedMs = performance.now() - startedAt
  progress.testedPerSecond = progress.elapsedMs > 0 ? progress.tested / (progress.elapsedMs / 1000) : 0
  const complete = !capped && progress.processed >= progress.total
  for (const result of results) {
    result.complete = complete
    result.evaluations = progress.tested + progress.rejected
  }
  const known = new Set(plot.map((point) => point.echoIds.join(':')))
  for (const result of results) {
    if (!known.has(result.echoIds.join(':'))) plot.push({ x: result.plot ?? result.stats.atk, y: result.score, echoIds: result.echoIds, mainEchoId: result.mainEchoId ?? result.echoIds[0], stats: result.stats })
  }
  emitProgress(true)
  return { results, plot, progress: { ...progress }, complete }
}

export function optimizeOptimizerWorkUnit(
  plan: OptimizerWorkPlan,
  workIndex: number,
  options: { scoreThreshold?: number; maxEvaluations?: number } = {},
  evaluateDamage?: DamageEvaluator,
  onProgress?: ProgressListener
): OptimizerPartitionOutput {
  const task = plan.work[workIndex]
  if (!task) {
    const progress: OptimizerProgress = { requestId: plan.request.requestId, total: 0, processed: 0, tested: 0, rejected: 0, skipped: 0, skippedCost: 0, skippedSonata: 0, skippedBounds: 0, elapsedMs: 0, testedPerSecond: 0 }
    return { results: [], plot: [], progress, complete: true }
  }
  const profile = plan.request.profile
  const request = {
    ...plan.request,
    scoreThreshold: options.scoreThreshold ?? plan.request.scoreThreshold,
    profile: profile && options.maxEvaluations !== undefined ? { ...profile, maxEvaluations: options.maxEvaluations } : profile
  }
  return runOptimizerTasks(request, plan.data, [task], evaluateDamage, onProgress)
}

export function optimizeBuildPartition(
  request: OptimizerRequest,
  evaluateDamage?: DamageEvaluator,
  onProgress?: ProgressListener
): OptimizerPartitionOutput {
  const plan = createOptimizerWorkPlan(request)
  const partition = request.partition ?? { index: 0, count: 1 }
  const tasks = plan.work.filter((_, index) => index % partition.count === partition.index)
  const profile = plan.request.profile
  const partitionedRequest = profile?.searchMode === 'fast'
    ? { ...plan.request, profile: { ...profile, maxEvaluations: Math.max(1, Math.ceil(profile.maxEvaluations / partition.count)) } }
    : plan.request
  return runOptimizerTasks(partitionedRequest, plan.data, tasks, evaluateDamage, onProgress)
}

export function optimizeBuilds(
  request: OptimizerRequest,
  maxEvaluations = request.maxEvaluations ?? 300_000,
  evaluateDamage?: DamageEvaluator
): OptimizerResult[] {
  return optimizeBuildPartition({ ...request, maxEvaluations }, evaluateDamage).results
}
