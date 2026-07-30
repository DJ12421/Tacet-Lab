import { useEffect, useMemo, useRef, useState } from 'react'
import { statLabels } from '../game-data'
import { setBuildEchoIds } from '../storage/database'
import type { Build, Echo, EnemyConfig, FormulaResultMode, OptimizerObjective, OptimizerResult, OptimizerStatKey, OwnedCharacter, OwnedWeapon, TeamScenario } from '../domain/types'
import { characterFormulaSheets, createBuildCalculationContext, FormulaCalculator, resolveRuntimeBuild } from '../domain/calculation'
import { calculateBuildAttackV2, enemyV2, type CalculationAttackDefinition, type CalculationEffectDefinition, type CalculationScenarioV2 } from '../domain/calculation-v2'
import { aggregateStats, formatDamage } from '../domain/damage'
import { createLocalId } from '../domain/id'
import { EchoMiniCard, formatStat, Icon, Panel } from './components'
import { CalculatedValue, traceCalculationDetail } from './CalculationDetails'
import { runtimeStatDetail } from './calculation-detail-model'
import { resolveCharacterShowcaseModel } from './character-showcase-model'

type WorkerResponse = { requestId: string; results?: OptimizerResult[]; error?: string }

export function OptimizerView({ echoes, builds, characters, ownedWeapons, refresh, openScanner, buildId, initialEnemy, damageMode, scenario, calculationScenarioV2, calculationAttacksV2 = [], partyEffectsV2 = [], roverGender }: { echoes: Echo[]; builds: Build[]; characters: OwnedCharacter[]; ownedWeapons: OwnedWeapon[]; refresh: () => Promise<void>; openScanner: () => void; buildId: string; initialEnemy?: EnemyConfig; damageMode?: FormulaResultMode; scenario?: TeamScenario; calculationScenarioV2?: CalculationScenarioV2; calculationAttacksV2?: CalculationAttackDefinition[]; partyEffectsV2?: CalculationEffectDefinition[]; roverGender?: 'male' | 'female' }) {
  const objective: OptimizerObjective = damageMode ?? 'expected'
  const [attackId, setAttackId] = useState('')
  const [results, setResults] = useState<OptimizerResult[]>([])
  const [expandedResult, setExpandedResult] = useState<number | null>(0)
  const [generatedAt, setGeneratedAt] = useState<number>()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const workerRef = useRef<Worker | null>(null)
  const build = builds.find((item) => item.id === buildId) ?? builds[0]
  const runtime = useMemo(() => build ? resolveRuntimeBuild(build, characters, ownedWeapons) : undefined, [build, characters, ownedWeapons])
  const showcase = useMemo(() => build && runtime ? resolveCharacterShowcaseModel({
    character: runtime.character,
    weapons: ownedWeapons,
    echoes,
    builds: [build]
  }) : undefined, [build, runtime, ownedWeapons, echoes])
  const bonusStatLines = showcase?.statBonusSources
    .filter((source) => !source.id.startsWith('sonata-'))
    .flatMap((source) => source.lines) ?? []
  const optimizerEnemy = (): EnemyConfig => ({
    ...(initialEnemy ?? {}),
    level: Math.min(200, Math.max(1, initialEnemy?.level ?? 100)),
    resistance: Math.min(100, Math.max(-100, initialEnemy?.resistance ?? 10)),
    damageReduction: initialEnemy?.damageReduction ?? 0
  })
  const resonator = runtime?.resonator
  const weapon = runtime?.runtimeWeapon
  const formulaSheet = characterFormulaSheets.find((sheet) => sheet.id === resonator?.id)
  const attack = resonator?.attacks.find((item) => item.id === attackId) ?? resonator?.attacks[0]
  const calculationAttackV2 = calculationAttacksV2.find((item) => item.id === attackId) ?? calculationAttacksV2[0]
  const formulaTarget = formulaSheet?.targets.find((target) => target.id === `${resonator?.id}:${attack?.id}`) ?? formulaSheet?.targets[0]
  const currentEchoes = build?.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)) ?? []
  const currentStats = resonator && weapon
    ? aggregateStats(resonator, weapon, currentEchoes, calculationAttacksV2.length ? [] : bonusStatLines, !calculationAttacksV2.length)
    : undefined
  const detailForResult = (result: OptimizerResult) => {
    const resultEchoes = result.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo))
    if (objective !== 'normal' && objective !== 'critical' && objective !== 'expected') return resonator && weapon
      ? runtimeStatDetail(resonator, weapon, resultEchoes, objective, result.score)
      : { title: String(objective), value: String(result.score), rows: [{ label: 'Optimizer result', value: String(result.score) }] }
    if (build && runtime && calculationAttackV2) {
      const candidateBuild = { ...build, echoIds: result.echoIds }
      const candidateShowcase = resolveCharacterShowcaseModel({ character: runtime.character, weapons: ownedWeapons, echoes: resultEchoes, builds: [candidateBuild] })
      const snapshot = candidateShowcase ? calculateBuildAttackV2({
        build: candidateBuild,
        character: runtime.character,
        characterCatalog: candidateShowcase.catalog,
        weapon: candidateShowcase.weapon?.owned,
        weaponCatalog: candidateShowcase.weapon?.catalog,
        showcase: candidateShowcase,
        scenario: calculationScenarioV2,
        partyEffects: partyEffectsV2,
        roverGender
      }, calculationAttackV2, enemyV2(optimizerEnemy(), calculationScenarioV2)) : undefined
      if (snapshot) return traceCalculationDetail(snapshot.trace[objective], `${calculationAttackV2.name} · ${objective}`)
    }
    if (!build || !runtime || !formulaTarget) return { title: `${calculationAttackV2?.name ?? attack?.name ?? 'Formula target'} · ${objective}`, value: String(result.score), rows: [{ label: 'Optimizer result', value: String(result.score) }] }
    const enemy = optimizerEnemy()
    const snapshot = new FormulaCalculator(createBuildCalculationContext({ build, character: runtime.character, weapon: runtime.weapon, echoes: resultEchoes, enemy, scenario, targetId: formulaTarget.id })).evaluate(formulaTarget[objective])
    return traceCalculationDetail(snapshot.trace, `${formulaTarget.label} · ${objective}`)
  }

  useEffect(() => () => workerRef.current?.terminate(), [])
  useEffect(() => { setAttackId(calculationAttacksV2[0]?.id ?? resonator?.attacks[0]?.id ?? ''); setResults([]); setError('') }, [resonator?.id, calculationAttacksV2[0]?.id])
  useEffect(() => {
    if (!damageMode) return
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
    setResults([])
    setError('')
  }, [damageMode])

  const cancel = () => { workerRef.current?.terminate(); workerRef.current = null; setRunning(false) }
  const run = () => {
    if (!build || !resonator || !weapon || !attack || !runtime) return
    if (echoes.filter((echo) => !echo.excluded && (!echo.equippedBy || echo.equippedBy === build.id)).length < 5) { setError('At least five available Echoes are required.'); return }
    cancel(); setResults([]); setError(''); setMessage(''); setRunning(true)
    const requestId = createLocalId()
    const worker = new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.requestId !== requestId) return
      if (event.data.error) setError(event.data.error)
      const nextResults = event.data.results ?? []
      if (!event.data.error && !nextResults.length) setError('No legal loadout was found with the current cost, lock, and equipment rules.')
      setResults(nextResults); setExpandedResult(nextResults.length ? 0 : null); setGeneratedAt(Date.now()); setRunning(false); worker.terminate(); workerRef.current = null
    }
    worker.onerror = () => { setError('The optimizer worker stopped unexpectedly.'); setRunning(false); worker.terminate(); workerRef.current = null }
    const enemy = optimizerEnemy()
    const baseContext = runtime ? createBuildCalculationContext({ build, character: runtime.character, weapon: runtime.weapon, echoes: build.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)), enemy, scenario, targetId: formulaTarget?.id }) : undefined
    const mode = objective === 'normal' || objective === 'critical' || objective === 'expected' ? objective : undefined
    worker.postMessage({
      requestId,
      echoes: echoes.map((echo) => echo.equippedBy === build.id ? { ...echo, equippedBy: undefined } : echo),
      resonator, weapon, attack, enemy,
      objective, minimumStats: {}, limit: 10, includeEquippedBy: build.id,
      bonusStatLines: calculationAttackV2 ? [] : bonusStatLines,
      formula: !calculationAttackV2 && mode && formulaTarget && baseContext ? { target: { id: formulaTarget.id, label: formulaTarget.label, kind: formulaTarget.kind, mode }, node: formulaTarget[mode], inputs: baseContext.inputs, entries: baseContext.entries } : undefined,
      calculationV2: calculationAttackV2 ? {
        build,
        character: runtime.character,
        characterCatalog: showcase!.catalog,
        weapon: showcase?.weapon?.owned,
        weaponCatalog: showcase?.weapon?.catalog,
        attack: calculationAttackV2,
        scenario: calculationScenarioV2,
        partyEffects: partyEffectsV2,
        roverGender
      } : undefined
    })
  }

  const apply = async (result: OptimizerResult) => {
    if (!build) return
    const unavailable = result.echoIds.some((id) => { const echo = echoes.find((item) => item.id === id); return !echo || (echo.equippedBy && echo.equippedBy !== build.id) })
    if (unavailable) { setError('Inventory assignments changed after this search. Run the optimizer again.'); return }
    await setBuildEchoIds(build.id, result.echoIds)
    await refresh(); setMessage('Optimizer result equipped.')
  }

  return <section className="tw-optimizer-workspace">
    <header className="tw-optimizer-heading tw-panel"><div><span className="eyebrow">Build generation</span><h2>Echo optimizer</h2><p>The team target, damage mode, and enemy state are inherited automatically. Generate ranked loadouts, inspect their trade-offs, then equip the one you want.</p></div></header>
    <Panel className="optimizer-command-bar">
      <label><span>Optimization target</span><select value={calculationAttackV2?.id ?? attack?.id} onChange={(event) => { setAttackId(event.target.value); setResults([]); setGeneratedAt(undefined) }}>{calculationAttacksV2.length ? calculationAttacksV2.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : resonator?.attacks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div><span>Build</span><strong>{build?.name ?? 'Unavailable build'}</strong></div>
      <div><span>Mode</span><strong>{objective === 'expected' ? 'Average DMG' : objective === 'normal' ? 'Non-CRIT DMG' : 'CRIT DMG'}</strong></div>
      <div><span>Available</span><strong>{echoes.filter((echo) => !echo.excluded && (!echo.equippedBy || echo.equippedBy === build?.id)).length} Echoes</strong></div>
      {running ? <button className="danger" onClick={cancel}>Cancel search</button> : <button className="primary" onClick={run}><Icon name="optimize"/>Generate builds</button>}
    </Panel>
    {error && <div className="notice error">{error}</div>}
    {message && <div className="notice success">{message}</div>}
    {running && <Panel className="searching"><div className="orbit"><i/><i/><i/></div><h2>Evaluating loadouts</h2><p>The optimizer is testing legal combinations in a background worker.</p></Panel>}
    {!running && !results.length && <Panel className="optimizer-empty"><div className="empty-glyph">◎</div><h2>{echoes.length < 5 ? 'Your archive needs more Echoes' : 'Ready to generate builds'}</h2><p>{echoes.length < 5 ? 'Scan or enter at least five available pieces.' : 'Choose the attack to optimize, then generate ranked loadouts.'}</p>{echoes.length < 5 && <button className="secondary" onClick={openScanner}>Open scanner</button>}</Panel>}
    {!running && results.length > 0 && <>
      <OptimizerChart results={results} currentAtk={currentStats?.atk}/>
      <div className="optimizer-results-heading"><div><span>Showing {results.length} generated builds</span>{generatedAt && <small>Generated {new Date(generatedAt).toLocaleString()}</small>}</div><div><span className="optimizer-mode-chip">{objective === 'expected' ? 'Average DMG' : objective === 'normal' ? 'Non-CRIT DMG' : 'CRIT DMG'}</span><button className="secondary" onClick={() => { setResults([]); setGeneratedAt(undefined) }}>Clear builds</button></div></div>
      <div className="optimizer-build-list">{results.map((result, index) => {
        const resultEchoes = result.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo))
        const expanded = expandedResult === index
        const statKeys: OptimizerStatKey[] = ['hp', 'atk', 'def', 'critRate', 'critDamage', 'energyRegen', 'basicDamage', 'liberationDamage']
        return <Panel className={`optimizer-build-result ${expanded ? 'is-expanded' : ''}`} key={result.echoIds.join('-')}>
          <header>
            <button className="optimizer-result-toggle" onClick={() => setExpandedResult(expanded ? null : index)} aria-expanded={expanded}>
              <span className="optimizer-rank">#{index + 1}</span>
              <span><b>{result.complete ? 'OPTIMAL BUILD' : 'BEST FOUND'}</b><small>{(result.evaluations ?? 0).toLocaleString('en-US')} configurations evaluated</small></span>
              <span className="optimizer-score"><small>{calculationAttackV2?.name ?? formulaTarget?.label ?? attack?.name ?? 'Target score'}</small><strong>{Math.round(result.score).toLocaleString('en-US')}</strong></span>
              <span className="optimizer-score-modes"><i>Non-CRIT <b>{formatDamage(result.damage.normal)}</b></i><i>Average <b>{formatDamage(result.damage.expected)}</b></i><i>CRIT <b>{formatDamage(result.damage.critical)}</b></i></span>
              <span className="optimizer-chevron">⌄</span>
            </button>
            <button className="primary" onClick={() => apply(result)}>Equip build</button>
          </header>
          <div className="optimizer-echo-strip">{resultEchoes.map((echo) => <EchoMiniCard key={echo.id} echo={echo}/>)}</div>
          {expanded && <div className="optimizer-result-details">
            <section><h3>Build statistics</h3><div className="optimizer-stat-table">{statKeys.map((key) => {
              const previous = currentStats?.[key] ?? result.stats[key]
              const delta = result.stats[key] - previous
              return <div key={key}><span>{statLabels[key]}</span>{resonator && weapon ? <CalculatedValue detail={runtimeStatDetail(resonator, weapon, resultEchoes, key, result.stats[key])}><b>{formatStat(key, result.stats[key])}</b></CalculatedValue> : <b>{formatStat(key, result.stats[key])}</b>}<small className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}>{delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${formatStat(key, delta)}`}</small></div>
            })}</div></section>
            <section><h3>Target comparison</h3><div className="optimizer-damage-table"><div><span>Optimized score</span><CalculatedValue detail={detailForResult(result)}><b>{Math.round(result.score).toLocaleString('en-US')}</b></CalculatedValue></div><div><span>Non-CRIT damage</span><b>{formatDamage(result.damage.normal)}</b></div><div><span>Average damage</span><b>{formatDamage(result.damage.expected)}</b></div><div><span>CRIT damage</span><b>{formatDamage(result.damage.critical)}</b></div><div><span>Search status</span><b>{result.complete ? 'Complete' : 'Capped'}</b></div></div></section>
          </div>}
        </Panel>
      })}</div>
    </>}
  </section>
}

function OptimizerChart({ results, currentAtk }: { results: OptimizerResult[]; currentAtk?: number }) {
  const width = 1000
  const height = 260
  const padding = 36
  const atks = results.map((result) => result.stats.atk).concat(currentAtk ?? [])
  const scores = results.map((result) => result.score)
  const minAtk = Math.min(...atks)
  const maxAtk = Math.max(...atks)
  const minScore = Math.min(...scores)
  const maxScore = Math.max(...scores)
  const x = (value: number) => padding + ((value - minAtk) / Math.max(1, maxAtk - minAtk)) * (width - padding * 2)
  const y = (value: number) => height - padding - ((value - minScore) / Math.max(1, maxScore - minScore)) * (height - padding * 2)
  return <Panel className="optimizer-chart">
    <header><div><span className="eyebrow">Build distribution</span><h3>Optimization target vs. ATK</h3></div><div><span><i className="generated"/>Generated builds</span>{currentAtk !== undefined && <span><i className="current"/>Current ATK</span>}</div></header>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Generated build scores plotted against attack">
      {[0, 1, 2, 3, 4].map((tick) => { const tickY = padding + tick * ((height - padding * 2) / 4); return <line key={tick} x1={padding} x2={width - padding} y1={tickY} y2={tickY}/> })}
      {currentAtk !== undefined && <line className="current-line" x1={x(currentAtk)} x2={x(currentAtk)} y1={padding} y2={height - padding}/>}
      {results.map((result, index) => <circle key={result.echoIds.join('-')} className={index < 3 ? 'highlight' : ''} cx={x(result.stats.atk)} cy={y(result.score)} r={index < 3 ? 6 : 4}><title>{`#${index + 1}: ${Math.round(result.score).toLocaleString('en-US')} score, ${Math.round(result.stats.atk).toLocaleString('en-US')} ATK`}</title></circle>)}
      <text x={width / 2} y={height - 6}>ATK</text><text className="axis-y" x={-height / 2} y={13}>Target score</text>
    </svg>
  </Panel>
}
