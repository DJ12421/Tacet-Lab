import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { characterCatalog, GAME_DATA_VERSION, sonataCatalog, statLabels } from '../game-data'
import { setBuildEchoIds } from '../storage/database'
import {
  loadLatestOptimizerRun,
  loadOptimizerProfile,
  optimizerContextFingerprint,
  optimizerInventoryFingerprint,
  optimizerProfileFingerprint,
  saveOptimizerProfile,
  saveOptimizerRun,
  updateOptimizerRunHighlights
} from '../storage/optimizer-profiles'
import type {
  Build,
  Echo,
  EnemyConfig,
  FormulaResultMode,
  OptimizerObjective,
  OptimizerPlotPoint,
  OptimizerProfile,
  OptimizerProgress,
  OptimizerRequest,
  OptimizerResult,
  OptimizerStatKey,
  OwnedCharacter,
  OwnedWeapon,
  TeamScenario
} from '../domain/types'
import { characterFormulaSheets, createBuildCalculationContext, FormulaCalculator, resolveRuntimeBuild } from '../domain/calculation'
import { calculateBuildAttackV2, enemyV2, type CalculationAttackDefinition, type CalculationEffectDefinition, type CalculationScenarioV2 } from '../domain/calculation-v2'
import { aggregateStats, formatDamage } from '../domain/damage'
import { createLocalId } from '../domain/id'
import { EchoMiniCard, EquippedCharacterLabel, formatStat, Icon, Panel } from './components'
import { CalculatedValue, traceCalculationDetail } from './CalculationDetails'
import { runtimeStatDetail } from './calculation-detail-model'
import { resolveCharacterShowcaseModel } from './character-showcase-model'
import { OptimizerDistributionChart } from './OptimizerDistributionChart'
import { OptimizerSetup } from './OptimizerSetup'

type WorkerMessage =
  | { type: 'ready'; requestId: string; total: number; workCount: number }
  | { type: 'progress'; requestId: string; workIndex: number; progress: OptimizerProgress }
  | { type: 'complete'; requestId: string; workIndex: number; results: OptimizerResult[]; plot: OptimizerPlotPoint[]; progress: OptimizerProgress; complete: boolean }
  | { type: 'error'; requestId: string; error: string }

type WorkerOutput = Extract<WorkerMessage, { type: 'complete' }>

const emptyProgress = (requestId = ''): OptimizerProgress => ({ requestId, total: 0, processed: 0, tested: 0, rejected: 0, skipped: 0, skippedCost: 0, skippedSonata: 0, skippedBounds: 0, elapsedMs: 0, testedPerSecond: 0 })
const buildKey = (echoIds: string[]) => echoIds.join(':')
const objectiveLabel = (objective: OptimizerObjective) => objective === 'expected' ? 'Average DMG' : objective === 'normal' ? 'Non-CRIT DMG' : objective === 'critical' ? 'CRIT DMG' : statLabels[objective]

function mergeProgress(requestId: string, states: OptimizerProgress[]) {
  return states.reduce<OptimizerProgress>((total, progress) => ({
    requestId,
    total: Math.min(Number.MAX_SAFE_INTEGER, total.total + progress.total),
    processed: Math.min(Number.MAX_SAFE_INTEGER, total.processed + progress.processed),
    tested: total.tested + progress.tested,
    rejected: total.rejected + progress.rejected,
    skipped: Math.min(Number.MAX_SAFE_INTEGER, total.skipped + progress.skipped),
    skippedCost: Math.min(Number.MAX_SAFE_INTEGER, (total.skippedCost ?? 0) + (progress.skippedCost ?? 0)),
    skippedSonata: Math.min(Number.MAX_SAFE_INTEGER, (total.skippedSonata ?? 0) + (progress.skippedSonata ?? 0)),
    skippedBounds: Math.min(Number.MAX_SAFE_INTEGER, (total.skippedBounds ?? 0) + (progress.skippedBounds ?? 0)),
    elapsedMs: Math.max(total.elapsedMs, progress.elapsedMs),
    testedPerSecond: total.testedPerSecond + progress.testedPerSecond
  }), emptyProgress(requestId))
}

function mergeOutputs(requestId: string, outputs: WorkerOutput[], limit: number) {
  const unique = new Map<string, OptimizerResult>()
  for (const output of outputs) for (const result of output.results) {
    const key = buildKey(result.echoIds)
    const previous = unique.get(key)
    if (!previous || result.score > previous.score) unique.set(key, result)
  }
  const complete = outputs.every((output) => output.complete)
  const progress = mergeProgress(requestId, outputs.map((output) => output.progress))
  const results = [...unique.values()].sort((left, right) => right.score - left.score || buildKey(left.echoIds).localeCompare(buildKey(right.echoIds))).slice(0, limit)
  for (const result of results) {
    result.complete = complete
    result.evaluations = progress.tested + progress.rejected
  }
  const plotMap = new Map<string, OptimizerPlotPoint>()
  for (const output of outputs) for (const point of output.plot) plotMap.set(buildKey(point.echoIds), point)
  const plot = [...plotMap.values()]
  const stride = Math.max(1, Math.ceil(plot.length / 2400))
  return { results, plot: plot.filter((_, index) => index % stride === 0), progress, complete }
}

type OptimizerViewProps = {
  echoes: Echo[]
  builds: Build[]
  characters: OwnedCharacter[]
  ownedWeapons: OwnedWeapon[]
  refresh: () => Promise<void>
  openScanner: () => void
  buildId: string
  teamBuildIds?: string[]
  initialEnemy?: EnemyConfig
  damageMode?: FormulaResultMode
  scenario?: TeamScenario
  calculationScenarioV2?: CalculationScenarioV2
  calculationAttacksV2?: CalculationAttackDefinition[]
  partyEffectsV2?: CalculationEffectDefinition[]
  roverGender?: 'male' | 'female'
}

export function OptimizerView({
  echoes, builds, characters, ownedWeapons, refresh, openScanner, buildId, teamBuildIds = [], initialEnemy,
  damageMode, scenario, calculationScenarioV2, calculationAttacksV2 = [], partyEffectsV2 = [], roverGender
}: OptimizerViewProps) {
  const objective: OptimizerObjective = damageMode ?? 'expected'
  const [attackId, setAttackId] = useState('')
  const [profile, setProfile] = useState<OptimizerProfile>(() => ({
    id: `optimizer-${buildId}`, buildId, levelLow: 0, levelHigh: 25, rarities: [1, 2, 3, 4, 5],
    mainStatsByCost: { '1': [], '3': [], '4': [] }, excludedEchoIds: [], equippedPolicy: 'current', teamBuildIds: [],
    mainEchoPolicy: 'current', allowedSonatas: [], sonataMode: 'any', allowNoSonata: true, requiredSonataEffects: [],
    minimumStats: {}, maximumStats: {}, resultLimit: 10, plotStat: 'atk', workerCount: 'auto', searchMode: 'exact',
    maxEvaluations: 5_000_000, allowPartial: false, updatedAt: 0
  }))
  const [profileReady, setProfileReady] = useState(false)
  const [results, setResults] = useState<OptimizerResult[]>([])
  const [plotPoints, setPlotPoints] = useState<OptimizerPlotPoint[]>([])
  const [progress, setProgress] = useState<OptimizerProgress>(emptyProgress())
  const [expandedResult, setExpandedResult] = useState<number | null>(0)
  const [selectedKey, setSelectedKey] = useState<string>()
  const [highlightedKeys, setHighlightedKeys] = useState<string[]>([])
  const [activeRunId, setActiveRunId] = useState<string>()
  const [generatedAt, setGeneratedAt] = useState<number>()
  const [runFingerprint, setRunFingerprint] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const workersRef = useRef<Worker[]>([])
  const requestIdRef = useRef('')
  const contextFingerprintRef = useRef('')
  const build = builds.find((item) => item.id === buildId) ?? builds[0]
  const runtime = useMemo(() => build ? resolveRuntimeBuild(build, characters, ownedWeapons) : undefined, [build, characters, ownedWeapons])
  const showcase = useMemo(() => build && runtime ? resolveCharacterShowcaseModel({ character: runtime.character, weapons: ownedWeapons, echoes, builds: [build] }) : undefined, [build, runtime, ownedWeapons, echoes])
  const bonusStatLines = showcase?.statBonusSources.filter((source) => !source.id.startsWith('sonata-')).flatMap((source) => source.lines) ?? []
  const resonator = runtime?.resonator
  const weapon = runtime?.runtimeWeapon
  const formulaSheet = characterFormulaSheets.find((sheet) => sheet.id === resonator?.id)
  const attack = resonator?.attacks.find((item) => item.id === attackId) ?? resonator?.attacks[0]
  const calculationAttackV2 = calculationAttacksV2.find((item) => item.id === attackId) ?? calculationAttacksV2[0]
  const formulaTarget = formulaSheet?.targets.find((target) => target.id === `${resonator?.id}:${attack?.id}`) ?? formulaSheet?.targets[0]
  const currentEchoes = useMemo(() => build?.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)) ?? [], [build, echoes])
  const currentStats = resonator && weapon ? aggregateStats(resonator, weapon, currentEchoes, calculationAttacksV2.length ? [] : bonusStatLines, !calculationAttacksV2.length) : undefined
  const targets = calculationAttacksV2.length
    ? calculationAttacksV2.map((item) => ({ id: item.id, label: item.name }))
    : resonator?.attacks.map((item) => ({ id: item.id, label: item.name })) ?? []
  const optimizerEnemy = (): EnemyConfig => ({
    ...(initialEnemy ?? {}),
    level: Math.min(200, Math.max(1, initialEnemy?.level ?? 100)),
    resistance: Math.min(100, Math.max(-100, initialEnemy?.resistance ?? 10)),
    damageReduction: initialEnemy?.damageReduction ?? 0
  })
  const currentDamage = useMemo(() => {
    if (!build || !runtime || !attack) return undefined
    const enemy = enemyV2(optimizerEnemy(), calculationScenarioV2)
    if (calculationAttackV2 && showcase) return calculateBuildAttackV2({
      build, character: runtime.character, characterCatalog: showcase.catalog, weapon: showcase.weapon?.owned,
      weaponCatalog: showcase.weapon?.catalog, showcase, scenario: calculationScenarioV2, partyEffects: partyEffectsV2, roverGender
    }, calculationAttackV2, enemy)
    if (!formulaTarget) return undefined
    const context = createBuildCalculationContext({ build, character: runtime.character, weapon: runtime.weapon, echoes: currentEchoes, enemy: optimizerEnemy(), scenario, targetId: formulaTarget.id })
    const calculator = new FormulaCalculator(context)
    return { normal: Number(calculator.evaluate(formulaTarget.normal).value), critical: Number(calculator.evaluate(formulaTarget.critical).value), expected: Number(calculator.evaluate(formulaTarget.expected).value) }
  }, [attack, build, calculationAttackV2, calculationScenarioV2, currentEchoes, formulaTarget, partyEffectsV2, roverGender, runtime, showcase])
  const currentScore = currentDamage && (objective === 'normal' || objective === 'critical' || objective === 'expected') ? currentDamage[objective] : currentStats?.[objective as OptimizerStatKey]
  const scalesWith = useMemo(() => {
    const labels = new Set<string>()
    const attribute = calculationAttackV2?.attribute
    labels.add(attribute === 'hp' ? 'HP' : attribute === 'defense' ? 'DEF' : attribute === 'EnergyRegen' ? 'Energy Regen' : 'ATK')
    if (objective === 'expected' || objective === 'critical') { labels.add('CRIT Rate'); labels.add('CRIT DMG') }
    if (calculationAttackV2?.element) labels.add(`${calculationAttackV2.element} DMG`)
    if (calculationAttackV2?.type && !['forte', 'utility', 'status', 'shield', 'fixed'].includes(calculationAttackV2.type)) labels.add(`${calculationAttackV2.type} DMG`)
    return [...labels]
  }, [calculationAttackV2, objective])
  const activeContextFingerprint = useMemo(() => optimizerContextFingerprint({
    objective,
    targetId: calculationAttackV2?.id ?? attack?.id ?? '',
    initialEnemy,
    scenario,
    calculationScenarioV2,
    roverGender,
    gameDataVersion: GAME_DATA_VERSION
  }), [attack?.id, calculationAttackV2?.id, calculationScenarioV2, initialEnemy, objective, roverGender, scenario])

  const terminateWorkers = () => { for (const worker of workersRef.current) worker.terminate(); workersRef.current = [] }
  const clearResults = () => { setResults([]); setPlotPoints([]); setSelectedKey(undefined); setHighlightedKeys([]); setActiveRunId(undefined); setExpandedResult(null); setGeneratedAt(undefined); setRunFingerprint('') }
  const updateProfile: Dispatch<SetStateAction<OptimizerProfile>> = (action) => {
    clearResults()
    setProfile(action)
  }

  useEffect(() => () => terminateWorkers(), [])
  useEffect(() => {
    const nextId = calculationScenarioV2?.selectedAttackByBuild[buildId] ?? calculationAttacksV2[0]?.id ?? resonator?.attacks[0]?.id ?? ''
    setAttackId(nextId)
    clearResults()
    setError('')
  }, [resonator?.id, calculationAttacksV2[0]?.id])
  useEffect(() => {
    let live = true
    setProfileReady(false)
    const fingerprint = optimizerInventoryFingerprint(echoes)
    Promise.all([loadOptimizerProfile(buildId), loadLatestOptimizerRun(buildId)]).then(([storedProfile, run]) => {
      if (!live) return
      const savedTarget = targets.some((target) => target.id === storedProfile.targetId) ? storedProfile.targetId : undefined
      const nextTarget = savedTarget ?? calculationScenarioV2?.selectedAttackByBuild[buildId] ?? targets[0]?.id ?? ''
      const nextProfile = { ...storedProfile, targetId: nextTarget || undefined, teamBuildIds: [...new Set(teamBuildIds)] }
      setProfile(nextProfile)
      const contextFingerprint = optimizerContextFingerprint({ objective, targetId: nextTarget, initialEnemy, scenario, calculationScenarioV2, roverGender, gameDataVersion: GAME_DATA_VERSION })
      contextFingerprintRef.current = contextFingerprint
      setAttackId(nextTarget)
      if (run && run.profileId === nextProfile.id && run.profileFingerprint === optimizerProfileFingerprint(nextProfile) && run.contextFingerprint === contextFingerprint && run.inventoryFingerprint === fingerprint && run.gameDataVersion === GAME_DATA_VERSION && run.results.every((result) => result.echoIds.every((id) => echoes.some((echo) => echo.id === id)))) {
        setResults(run.results)
        setPlotPoints(run.plot)
        setProgress(run.progress)
        setGeneratedAt(run.createdAt)
        setRunFingerprint(run.inventoryFingerprint)
        setActiveRunId(run.id)
        setHighlightedKeys(run.highlightedBuildKeys ?? [])
        setExpandedResult(run.results.length ? 0 : null)
      } else clearResults()
      setProfileReady(true)
    }).catch(() => { if (live) { setError('Saved optimizer settings could not be loaded.'); setProfileReady(true) } })
    return () => { live = false }
  }, [buildId])
  useEffect(() => {
    if (!profileReady || profile.buildId !== buildId) return
    const timer = window.setTimeout(() => { void saveOptimizerProfile(profile).catch(() => setError('Optimizer settings could not be saved locally.')) }, 250)
    return () => window.clearTimeout(timer)
  }, [buildId, profile, profileReady])
  useEffect(() => {
    if (!profileReady) return
    if (contextFingerprintRef.current && contextFingerprintRef.current !== activeContextFingerprint) clearResults()
    contextFingerprintRef.current = activeContextFingerprint
  }, [activeContextFingerprint, profileReady])
  useEffect(() => {
    if (!activeRunId) return
    const timer = window.setTimeout(() => { void updateOptimizerRunHighlights(activeRunId, highlightedKeys).catch(() => setError('Build comparisons could not be saved locally.')) }, 200)
    return () => window.clearTimeout(timer)
  }, [activeRunId, highlightedKeys])

  const cancel = () => {
    requestIdRef.current = ''
    terminateWorkers()
    setRunning(false)
    setMessage('Search cancelled. Configuration was preserved.')
  }

  const run = () => {
    if (!profileReady || !build || !resonator || !weapon || !attack || !runtime || !showcase) return
    if (profile.mainEchoPolicy === 'selected' && !profile.selectedMainEchoId) { setError('Choose the required main Echo before generating builds.'); return }
    terminateWorkers()
    clearResults()
    setError('')
    setMessage('')
    setRunning(true)
    const requestId = createLocalId()
    requestIdRef.current = requestId
    const fingerprint = optimizerInventoryFingerprint(echoes)
    const profileFingerprint = optimizerProfileFingerprint({ ...profile, teamBuildIds: [...new Set(teamBuildIds)] })
    const contextFingerprint = activeContextFingerprint
    const hardwareWorkers = Math.max(1, Math.min(8, (navigator.hardwareConcurrency ?? 4) - 1))
    const workerCount = Math.max(1, Math.min(16, profile.workerCount === 'auto' ? hardwareWorkers : profile.workerCount))
    const workerProgress = Array.from({ length: workerCount }, () => emptyProgress(requestId))
    const outputs: WorkerOutput[] = []
    const workerReservations = Array.from({ length: workerCount }, () => 0)
    let nextWork = 0
    let completedWork = 0
    let activeWorkers = 0
    let readyWorkers = 0
    let workCount = 0
    let failed = false
    let searchTotal = 0
    let availableBudget = profile.searchMode === 'fast' ? profile.maxEvaluations : Number.POSITIVE_INFINITY
    let broadcastThreshold: number | undefined
    const startedAt = performance.now()
    const enemy = optimizerEnemy()
    const baseContext = createBuildCalculationContext({ build, character: runtime.character, weapon: runtime.weapon, echoes: currentEchoes, enemy, scenario, targetId: formulaTarget?.id })
    const mode = objective === 'normal' || objective === 'critical' || objective === 'expected' ? objective : undefined
    const baseRequest: Omit<OptimizerRequest, 'partition'> = {
      requestId, echoes, resonator, weapon, attack, enemy, objective, minimumStats: profile.minimumStats,
      maximumStats: profile.maximumStats, limit: profile.resultLimit, maxEvaluations: profile.maxEvaluations,
      includeEquippedBy: build.id, currentMainEchoId: build.echoIds[0], bonusStatLines: calculationAttackV2 ? [] : bonusStatLines, profile: { ...profile, teamBuildIds: [...new Set(teamBuildIds)] },
      formula: !calculationAttackV2 && mode && formulaTarget ? { target: { id: formulaTarget.id, label: formulaTarget.label, kind: formulaTarget.kind, mode }, node: formulaTarget[mode], inputs: baseContext.inputs, entries: baseContext.entries } : undefined,
      calculationV2: calculationAttackV2 ? { build, character: runtime.character, characterCatalog: showcase.catalog, weapon: showcase.weapon?.owned, weaponCatalog: showcase.weapon?.catalog, attack: calculationAttackV2, scenario: calculationScenarioV2, partyEffects: partyEffectsV2, roverGender } : undefined
    }
    const mergedProgress = () => {
      const combined = mergeProgress(requestId, [...outputs.map((output) => output.progress), ...workerProgress])
      combined.total = searchTotal || combined.total
      combined.elapsedMs = performance.now() - startedAt
      combined.testedPerSecond = combined.elapsedMs > 0 ? combined.tested / (combined.elapsedMs / 1000) : 0
      return combined
    }
    const fail = (reason: string) => {
      if (failed || requestIdRef.current !== requestId) return
      failed = true
      terminateWorkers()
      setRunning(false)
      setError(reason)
    }
    const currentThreshold = () => {
      const current = mergeOutputs(requestId, outputs, profile.resultLimit)
      return current.results.length >= profile.resultLimit ? current.results[current.results.length - 1].score : undefined
    }
    const compactOutputs = () => {
      if (outputs.length < 64) return
      const compact = mergeOutputs(requestId, outputs, profile.resultLimit)
      outputs.splice(0, outputs.length, { type: 'complete', requestId, workIndex: -1, ...compact })
    }
    const dispatch = (worker: Worker, index: number) => {
      if (nextWork >= workCount || availableBudget <= 0) return false
      const workIndex = nextWork++
      let maxEvaluations: number | undefined
      if (profile.searchMode === 'fast') {
        const batchBudget = Math.max(2_000, Math.ceil(profile.maxEvaluations / Math.max(1, workerCount * 4)))
        maxEvaluations = Math.min(availableBudget, batchBudget)
        availableBudget -= maxEvaluations
        workerReservations[index] = maxEvaluations
      }
      workerProgress[index] = emptyProgress(requestId)
      activeWorkers += 1
      worker.postMessage({ type: 'run', requestId, workIndex, scoreThreshold: broadcastThreshold, maxEvaluations })
      return true
    }
    const finish = () => {
      terminateWorkers()
      requestIdRef.current = ''
      const merged = mergeOutputs(requestId, outputs, profile.resultLimit)
      merged.complete = merged.complete && completedWork === workCount
      for (const result of merged.results) result.complete = merged.complete
      merged.progress.total = searchTotal || merged.progress.total
      merged.progress.elapsedMs = performance.now() - startedAt
      merged.progress.testedPerSecond = merged.progress.elapsedMs > 0 ? merged.progress.tested / (merged.progress.elapsedMs / 1000) : 0
      const createdAt = Date.now()
      setResults(merged.results)
      setPlotPoints(merged.plot)
      setProgress(merged.progress)
      setExpandedResult(merged.results.length ? 0 : null)
      setSelectedKey(merged.results[0] ? buildKey(merged.results[0].echoIds) : undefined)
      setGeneratedAt(createdAt)
      setRunFingerprint(fingerprint)
      const runId = createLocalId()
      setActiveRunId(runId)
      setHighlightedKeys([])
      setRunning(false)
      if (!merged.results.length) setError('No legal loadout satisfies every active filter and build constraint.')
      else {
        const skippedPercent = merged.progress.total > 0 ? merged.progress.skipped / merged.progress.total * 100 : 0
        const performance = `${merged.progress.tested.toLocaleString('en-US')} evaluated, ${merged.progress.skipped.toLocaleString('en-US')} skipped (${skippedPercent.toFixed(1)}%) in ${(merged.progress.elapsedMs / 1000).toFixed(2)}s.`
        setMessage(`${merged.complete ? 'Exact branch-and-bound search complete.' : 'Fast search reached its evaluation cap; the best discovered builds are shown.'} ${performance}`)
      }
      void saveOptimizerRun({ id: runId, buildId: build.id, profileId: profile.id, requestId, createdAt, gameDataVersion: GAME_DATA_VERSION, inventoryFingerprint: fingerprint, profileFingerprint, contextFingerprint, results: merged.results, plot: merged.plot, complete: merged.complete, progress: merged.progress, highlightedBuildKeys: [] }).catch(() => setError('Results were generated, but the run could not be saved locally.'))
    }
    for (let index = 0; index < workerCount; index += 1) {
      const worker = new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), { type: 'module' })
      workersRef.current.push(worker)
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const data = event.data
        if (data.requestId !== requestId || requestIdRef.current !== requestId) return
        if (data.type === 'error') { fail(data.error || 'The optimizer worker stopped unexpectedly.'); return }
        if (data.type === 'ready') {
          if (!workCount) {
            workCount = data.workCount
            searchTotal = data.total
          } else if (workCount !== data.workCount || searchTotal !== data.total) {
            fail('Optimizer workers compiled different search plans.')
            return
          }
          readyWorkers += 1
          setProgress(mergedProgress())
          if (readyWorkers === workerCount) {
            if (!workCount) { finish(); return }
            workersRef.current.forEach((readyWorker, readyIndex) => dispatch(readyWorker, readyIndex))
          }
          return
        }
        if (data.type === 'progress') {
          workerProgress[index] = data.progress
          setProgress(mergedProgress())
          return
        }
        activeWorkers -= 1
        if (profile.searchMode === 'fast') {
          const used = data.progress.tested + data.progress.rejected
          availableBudget += Math.max(0, workerReservations[index] - used)
          workerReservations[index] = 0
        }
        outputs.push(data)
        compactOutputs()
        workerProgress[index] = emptyProgress(requestId)
        completedWork += 1
        const threshold = currentThreshold()
        if (threshold !== undefined && (broadcastThreshold === undefined || threshold > broadcastThreshold)) {
          broadcastThreshold = threshold
          workersRef.current.forEach((activeWorker) => activeWorker.postMessage({ type: 'threshold', requestId, scoreThreshold: threshold }))
        }
        setProgress(mergedProgress())
        if (dispatch(worker, index)) return
        if (activeWorkers === 0 && (nextWork >= workCount || availableBudget <= 0)) finish()
      }
      worker.onerror = () => fail('The optimizer worker stopped unexpectedly.')
      worker.postMessage({ type: 'init', request: baseRequest })
    }
  }

  const apply = async (result: OptimizerResult) => {
    if (!build) return
    if (runFingerprint && runFingerprint !== optimizerInventoryFingerprint(echoes)) { setError('Inventory assignments changed after this search. Generate builds again before equipping.'); return }
    const selected = result.echoIds.map((id) => echoes.find((echo) => echo.id === id))
    if (selected.some((echo) => !echo)) { setError('One or more Echoes in this result no longer exist.'); return }
    const borrowed = selected.filter((echo): echo is Echo => Boolean(echo?.equippedBy && echo.equippedBy !== build.id))
    if (borrowed.length) {
      const sources = [...new Set(borrowed.map((echo) => echo.equippedByName ?? builds.find((candidate) => candidate.id === echo.equippedBy)?.name ?? 'another build'))]
      if (!window.confirm(`Equip this result and move ${borrowed.length} Echo${borrowed.length === 1 ? '' : 'es'} from ${sources.join(', ')}?`)) return
    }
    try {
      await setBuildEchoIds(build.id, result.echoIds)
      await refresh()
      setMessage('Optimizer result equipped. Main Echo placement and borrowed assignments were applied atomically.')
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'The optimizer result could not be equipped.')
    }
  }

  const detailForResult = (result: OptimizerResult) => {
    const resultEchoes = result.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo))
    if (objective !== 'normal' && objective !== 'critical' && objective !== 'expected') return resonator && weapon
      ? runtimeStatDetail(resonator, weapon, resultEchoes, objective, result.score)
      : { title: String(objective), value: String(result.score), rows: [{ label: 'Optimizer result', value: String(result.score) }] }
    if (build && runtime && calculationAttackV2) {
      const candidateBuild = { ...build, echoIds: result.echoIds }
      const candidateShowcase = resolveCharacterShowcaseModel({ character: runtime.character, weapons: ownedWeapons, echoes: resultEchoes, builds: [candidateBuild] })
      const snapshot = candidateShowcase ? calculateBuildAttackV2({ build: candidateBuild, character: runtime.character, characterCatalog: candidateShowcase.catalog, weapon: candidateShowcase.weapon?.owned, weaponCatalog: candidateShowcase.weapon?.catalog, showcase: candidateShowcase, scenario: calculationScenarioV2, partyEffects: partyEffectsV2, roverGender }, calculationAttackV2, enemyV2(optimizerEnemy(), calculationScenarioV2)) : undefined
      if (snapshot) return traceCalculationDetail(snapshot.trace[objective], `${calculationAttackV2.name} · ${objective}`)
    }
    if (!build || !runtime || !formulaTarget) return { title: `${calculationAttackV2?.name ?? attack?.name ?? 'Formula target'} · ${objective}`, value: String(result.score), rows: [{ label: 'Optimizer result', value: String(result.score) }] }
    const snapshot = new FormulaCalculator(createBuildCalculationContext({ build, character: runtime.character, weapon: runtime.weapon, echoes: resultEchoes, enemy: optimizerEnemy(), scenario, targetId: formulaTarget.id })).evaluate(formulaTarget[objective])
    return traceCalculationDetail(snapshot.trace, `${formulaTarget.label} · ${objective}`)
  }

  const progressPercent = progress.total > 0 ? Math.min(100, progress.processed / progress.total * 100) : 0
  const comparisonPoints = highlightedKeys.flatMap((key) => {
    const resultIndex = results.findIndex((result) => buildKey(result.echoIds) === key)
    const result = resultIndex >= 0 ? results[resultIndex] : undefined
    const point = result ?? plotPoints.find((candidate) => buildKey(candidate.echoIds) === key)
    if (!point?.stats) return []
    return [{ key, echoIds: point.echoIds, score: 'score' in point ? point.score : point.y, stats: point.stats, rank: resultIndex >= 0 ? resultIndex + 1 : undefined }]
  })
  return <section className="tw-optimizer-workspace optimizer-v2-workspace">
    <header className="tw-optimizer-heading tw-panel"><div><span className="eyebrow">Build laboratory</span><h2>Echo optimizer</h2><p>Search every legal loadout against the active team state, compare trade-offs, and equip the exact main-Echo ordering you choose.</p></div><span className="optimizer-engine-badge"><Icon name="optimize"/>Calculation V2</span></header>
    {profileReady && build && runtime && showcase && <OptimizerSetup
      profile={profile} setProfile={updateProfile} echoes={echoes} currentEchoes={currentEchoes} buildId={build.id} buildName={build.name}
      characterName={showcase.catalog.name} portraitUrl={showcase.catalog.portraitSourceUrl || showcase.catalog.iconSourceUrl}
      weaponName={showcase.weapon?.catalog.name ?? 'No weapon equipped'} currentStats={currentStats} currentScore={currentScore}
      objectiveLabel={objectiveLabel(objective)} targetId={calculationAttackV2?.id ?? attack?.id ?? ''} targets={targets}
      onTargetChange={(id) => { setAttackId(id); updateProfile((current) => ({ ...current, targetId: id, updatedAt: Date.now() })) }} scalesWith={scalesWith} running={running} onRun={run} onCancel={cancel}
    />}
    {!profileReady && <Panel className="searching"><div className="orbit"><i/><i/><i/></div><h2>Loading optimizer profile</h2><p>Your saved filters and most recent compatible run stay on this device.</p></Panel>}
    {error && <div className="notice error">{error}</div>}
    {message && <div className="notice success">{message}</div>}
    {running && <Panel className="optimizer-progress-panel">
      <header><div><span className="eyebrow">Background search</span><h3>{profile.searchMode === 'exact' ? 'Testing the exact search space' : 'Testing the capped search space'}</h3></div><b>{progressPercent.toFixed(2)}%</b></header>
      <div className="optimizer-progress-track"><i style={{ width: `${progressPercent}%` }}/></div>
      <dl><div><dt>Processed</dt><dd>{progress.processed.toLocaleString('en-US')} / {progress.total.toLocaleString('en-US')}</dd></div><div><dt>Evaluated</dt><dd>{progress.tested.toLocaleString('en-US')}</dd></div><div><dt>Rejected</dt><dd>{progress.rejected.toLocaleString('en-US')}</dd></div><div><dt>Pruned total</dt><dd>{progress.skipped.toLocaleString('en-US')}</dd></div><div><dt>Cost skips</dt><dd>{(progress.skippedCost ?? 0).toLocaleString('en-US')}</dd></div><div><dt>Sonata skips</dt><dd>{(progress.skippedSonata ?? 0).toLocaleString('en-US')}</dd></div><div><dt>Bound skips</dt><dd>{(progress.skippedBounds ?? 0).toLocaleString('en-US')}</dd></div><div><dt>Rate</dt><dd>{Math.round(progress.testedPerSecond).toLocaleString('en-US')}/s</dd></div><div><dt>Elapsed</dt><dd>{(progress.elapsedMs / 1000).toFixed(1)}s</dd></div></dl>
    </Panel>}
    {!running && profileReady && !results.length && <Panel className="optimizer-empty"><div className="empty-glyph">⌁</div><h2>{echoes.length < 5 ? 'Your archive needs more Echoes' : 'Ready to generate builds'}</h2><p>{echoes.length < 5 ? 'Scan or enter enough pieces for a legal loadout, or enable partial builds.' : 'The current configuration is saved automatically. Generate when the filters and constraints are ready.'}</p>{echoes.length < 5 && <button className="secondary" onClick={openScanner}>Open scanner</button>}</Panel>}
    {!running && results.length > 0 && <>
      <OptimizerDistributionChart points={plotPoints} results={results} currentStats={currentStats} currentScore={currentScore} plotStat={profile.plotStat} onPlotStatChange={(plotStat) => setProfile((current) => ({ ...current, plotStat, updatedAt: Date.now() }))} selectedKey={selectedKey} highlightedKeys={highlightedKeys} onToggleHighlight={(key) => setHighlightedKeys((current) => current.includes(key) ? current.filter((entry) => entry !== key) : [...current.slice(-5), key])} onSelect={(key) => { setSelectedKey(key); const index = results.findIndex((result) => buildKey(result.echoIds) === key); if (index >= 0) setExpandedResult(index) }}/>
      {comparisonPoints.length > 0 && <Panel className="optimizer-comparison-tray"><header><div><span className="eyebrow">Pinned comparison</span><h3>{comparisonPoints.length} highlighted build{comparisonPoints.length === 1 ? '' : 's'}</h3></div><button className="secondary" onClick={() => setHighlightedKeys([])}>Clear comparison</button></header><div>{comparisonPoints.map((point) => <article className={selectedKey === point.key ? 'is-selected' : ''} key={point.key}><button className="optimizer-comparison-select" onClick={() => { setSelectedKey(point.key); if (point.rank) setExpandedResult(point.rank - 1) }}><span>{point.rank ? `Rank #${point.rank}` : 'Search sample'}</span><strong>{Math.round(point.score).toLocaleString('en-US')}</strong><small>{statLabels[profile.plotStat]} {formatStat(profile.plotStat, point.stats[profile.plotStat])}</small><small>{point.echoIds.map((id) => echoes.find((echo) => echo.id === id)?.name ?? 'Missing Echo').join(' · ')}</small></button><button className="optimizer-comparison-remove" aria-label="Remove build from comparison" onClick={() => setHighlightedKeys((current) => current.filter((key) => key !== point.key))}>×</button></article>)}</div></Panel>}
      <div className="optimizer-results-heading"><div><span>{results.length} ranked builds</span>{generatedAt && <small>Generated {new Date(generatedAt).toLocaleString()} · {progress.tested.toLocaleString('en-US')} evaluated</small>}</div><div><span className={`optimizer-mode-chip ${results[0]?.complete ? 'complete' : 'capped'}`}>{results[0]?.complete ? 'Exact result' : 'Best found'}</span><button className="secondary" onClick={clearResults}>Clear results</button></div></div>
      <div className="optimizer-build-list">{results.map((result, index) => {
        const resultEchoes = result.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo))
        const borrowedEchoes = resultEchoes.filter((echo) => echo.equippedBy && echo.equippedBy !== build?.id)
        const improvement = currentScore === undefined ? undefined : result.score - currentScore
        const improvementPercent = currentScore && improvement !== undefined ? improvement / currentScore * 100 : undefined
        const expanded = expandedResult === index
        const statKeys: OptimizerStatKey[] = ['hp', 'atk', 'def', 'critRate', 'critDamage', 'energyRegen', 'basicDamage', 'liberationDamage']
        const sonatas = [...resultEchoes.reduce((counts, echo) => counts.set(echo.sonata, (counts.get(echo.sonata) ?? 0) + 1), new Map<string, number>())].filter(([name, count]) => sonataCatalog.some((sonata) => sonata.name === name && sonata.effects.some((effect) => count >= effect.pieces)))
        return <Panel className={`optimizer-build-result ${expanded ? 'is-expanded' : ''} ${selectedKey === buildKey(result.echoIds) ? 'is-selected' : ''}`} key={buildKey(result.echoIds)}>
          <header><button className="optimizer-result-toggle" onClick={() => { setExpandedResult(expanded ? null : index); setSelectedKey(expanded ? undefined : buildKey(result.echoIds)) }} aria-expanded={expanded}><span className="optimizer-rank">#{index + 1}</span><span><b>{result.complete ? 'OPTIMAL BUILD' : 'BEST FOUND'}</b><small>{result.mainEchoId === result.echoIds[0] ? 'Main Echo verified' : 'Main Echo reordered'}</small></span><span className="optimizer-score"><small>{calculationAttackV2?.name ?? formulaTarget?.label ?? attack?.name ?? 'Target score'}</small><strong>{Math.round(result.score).toLocaleString('en-US')}</strong>{improvement !== undefined && <em className={improvement > 0 ? 'positive' : improvement < 0 ? 'negative' : ''}>{improvement > 0 ? '+' : ''}{formatDamage(improvement)}{improvementPercent !== undefined ? ` (${improvementPercent > 0 ? '+' : ''}${improvementPercent.toFixed(1)}%)` : ''}</em>}</span><span className="optimizer-score-modes"><i>Non-CRIT <b>{formatDamage(result.damage.normal)}</b></i><i>Average <b>{formatDamage(result.damage.expected)}</b></i><i>CRIT <b>{formatDamage(result.damage.critical)}</b></i></span><span className="optimizer-chevron">⌄</span></button><button className="primary" onClick={() => void apply(result)}>Equip build</button></header>
          <div className="optimizer-result-tags"><b>Main: {resultEchoes[0]?.name ?? 'Unavailable'}</b>{sonatas.map(([name, count]) => <span key={name}>{name} · {count}-pc</span>)}{borrowedEchoes.length > 0 && <em>{borrowedEchoes.length} borrowed</em>}</div>
          <div className="optimizer-echo-strip">{resultEchoes.map((echo, echoIndex) => { const ownerBuild = builds.find((candidate) => candidate.echoIds.includes(echo.id)); const ownerCharacter = characterCatalog.find((candidate) => candidate.id === ownerBuild?.resonatorId); const ownerName = ownerCharacter?.name ?? echo.equippedByName ?? ownerBuild?.name ?? (echo.equippedBy ? 'Equipped' : 'Inventory'); return <div className={echoIndex === 0 ? 'optimizer-main-echo' : ''} key={echo.id}>{echoIndex === 0 && <span>Main Echo</span>}<EchoMiniCard echo={echo} equipment={<EquippedCharacterLabel name={ownerName}/>} /></div> })}</div>
          {expanded && <div className="optimizer-result-details"><section><h3>Build statistics</h3><div className="optimizer-stat-table">{statKeys.map((key) => { const previous = currentStats?.[key] ?? result.stats[key]; const delta = result.stats[key] - previous; return <div key={key}><span>{statLabels[key]}</span>{resonator && weapon ? <CalculatedValue detail={runtimeStatDetail(resonator, weapon, resultEchoes, key, result.stats[key])}><b>{formatStat(key, result.stats[key])}</b></CalculatedValue> : <b>{formatStat(key, result.stats[key])}</b>}<small className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}>{delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${formatStat(key, delta)}`}</small></div> })}</div></section><section><h3>Target comparison</h3><div className="optimizer-damage-table"><div><span>Current score</span><b>{currentScore === undefined ? 'Unavailable' : formatDamage(currentScore)}</b></div><div><span>Optimized score</span><CalculatedValue detail={detailForResult(result)}><b>{Math.round(result.score).toLocaleString('en-US')}</b></CalculatedValue></div><div><span>Improvement</span><b className={improvement !== undefined && improvement > 0 ? 'positive' : improvement !== undefined && improvement < 0 ? 'negative' : ''}>{improvement === undefined ? 'Unavailable' : `${improvement > 0 ? '+' : ''}${formatDamage(improvement)}${improvementPercent !== undefined ? ` (${improvementPercent > 0 ? '+' : ''}${improvementPercent.toFixed(1)}%)` : ''}`}</b></div><div><span>Search guarantee</span><b>{result.complete ? 'Exact within active filters' : 'Capped search'}</b></div></div></section></div>}
        </Panel>
      })}</div>
    </>}
  </section>
}
