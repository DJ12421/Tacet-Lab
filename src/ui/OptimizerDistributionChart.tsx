import { useEffect, useMemo, useState } from 'react'
import type { AggregatedStats, OptimizerPlotPoint, OptimizerResult, OptimizerStatKey } from '../domain/types'
import { statLabels } from '../game-data'
import { Panel } from './components'

const PLOT_STATS: OptimizerStatKey[] = ['hp', 'atk', 'def', 'critRate', 'critDamage', 'energyRegen', 'basicDamage', 'heavyDamage', 'skillDamage', 'liberationDamage', 'spectroDamage', 'fusionDamage', 'glacioDamage', 'electroDamage', 'aeroDamage', 'havocDamage', 'healingBonus']

function buildKey(echoIds: string[]) { return echoIds.join(':') }

export function OptimizerDistributionChart({
  points, results, currentStats, currentScore, plotStat, onPlotStatChange, selectedKey, highlightedKeys, onSelect, onToggleHighlight
}: {
  points: OptimizerPlotPoint[]
  results: OptimizerResult[]
  currentStats?: AggregatedStats
  currentScore?: number
  plotStat: OptimizerStatKey
  onPlotStatChange: (stat: OptimizerStatKey) => void
  selectedKey?: string
  highlightedKeys: string[]
  onSelect: (key?: string) => void
  onToggleHighlight: (key: string) => void
}) {
  const width = 1200
  const height = 440
  const padding = { left: 76, right: 28, top: 26, bottom: 58 }
  const [showFrontier, setShowFrontier] = useState(true)
  const [rangeLow, setRangeLow] = useState(Number.NEGATIVE_INFINITY)
  const [rangeHigh, setRangeHigh] = useState(Number.POSITIVE_INFINITY)
  const resultKeys = useMemo(() => new Set(results.map((result) => buildKey(result.echoIds))), [results])
  const highlighted = useMemo(() => new Set(highlightedKeys), [highlightedKeys])
  const source = useMemo(() => {
    const unique = new Map<string, OptimizerPlotPoint>()
    for (const point of points) unique.set(buildKey(point.echoIds), { ...point, x: point.stats?.[plotStat] ?? point.x })
    for (const result of results) unique.set(buildKey(result.echoIds), { x: result.stats[plotStat], y: result.score, echoIds: result.echoIds, mainEchoId: result.mainEchoId ?? result.echoIds[0], stats: result.stats })
    return [...unique.values()]
  }, [plotStat, points, results])
  const fullMin = Math.min(...source.map((point) => point.x), currentStats?.[plotStat] ?? Number.POSITIVE_INFINITY)
  const fullMax = Math.max(...source.map((point) => point.x), currentStats?.[plotStat] ?? Number.NEGATIVE_INFINITY)
  useEffect(() => { setRangeLow(fullMin); setRangeHigh(fullMax) }, [fullMin, fullMax, plotStat])
  const visible = source.filter((point) => point.x >= rangeLow && point.x <= rangeHigh)
  const minX = Math.min(...visible.map((point) => point.x), currentStats?.[plotStat] ?? Number.POSITIVE_INFINITY)
  const maxX = Math.max(...visible.map((point) => point.x), currentStats?.[plotStat] ?? Number.NEGATIVE_INFINITY)
  const minY = Math.min(...visible.map((point) => point.y), currentScore ?? Number.POSITIVE_INFINITY)
  const maxY = Math.max(...visible.map((point) => point.y), currentScore ?? Number.NEGATIVE_INFINITY)
  const safeMinX = Number.isFinite(minX) ? minX : 0
  const safeMaxX = Number.isFinite(maxX) ? maxX : safeMinX + 1
  const safeMinY = Number.isFinite(minY) ? minY : 0
  const safeMaxY = Number.isFinite(maxY) ? maxY : safeMinY + 1
  const x = (value: number) => padding.left + (value - safeMinX) / Math.max(1e-9, safeMaxX - safeMinX) * (width - padding.left - padding.right)
  const y = (value: number) => height - padding.bottom - (value - safeMinY) / Math.max(1e-9, safeMaxY - safeMinY) * (height - padding.top - padding.bottom)
  const frontier = useMemo(() => {
    let best = Number.NEGATIVE_INFINITY
    return [...visible].sort((left, right) => right.x - left.x || right.y - left.y).filter((point) => {
      if (point.y <= best) return false
      best = point.y
      return true
    }).reverse()
  }, [visible])
  const frontierPath = frontier.map((point, index) => `${index ? 'L' : 'M'} ${x(point.x)} ${y(point.y)}`).join(' ')
  const formatAxis = (value: number, stat?: OptimizerStatKey) => stat && !['hp', 'atk', 'def'].includes(stat) ? `${value.toFixed(1)}%` : Math.round(value).toLocaleString('en-US')

  const download = () => {
    const payload = JSON.stringify({ plotStat, points: source.map((point) => ({ x: point.x, y: point.y, echoIds: point.echoIds, mainEchoId: point.mainEchoId })), frontier: frontier.map((point) => [point.x, point.y]) }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `tacet-lab-optimizer-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (!source.length) return null
  return <Panel className="optimizer-chart optimizer-distribution-chart">
    <header><div><span className="eyebrow">Build distribution</span><h3>Optimization target vs. <select value={plotStat} onChange={(event) => onPlotStatChange(event.target.value as OptimizerStatKey)}>{PLOT_STATS.map((stat) => <option value={stat} key={stat}>{statLabels[stat]}</option>)}</select></h3></div><div><button type="button" className={showFrontier ? 'active' : ''} onClick={() => setShowFrontier((current) => !current)}>Pareto frontier</button><button type="button" onClick={download}>Download data</button></div></header>
    <div className="optimizer-chart-legend"><span><i className="generated"/>Search sample</span><span><i className="ranked"/>Ranked builds</span><span><i className="highlighted"/>Compared builds</span><span><i className="selected"/>Selected build</span><span><i className="current"/>Current build</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Generated build scores plotted against ${statLabels[plotStat]}`}>
      {[0, 1, 2, 3, 4, 5].map((tick) => {
        const tx = padding.left + tick * (width - padding.left - padding.right) / 5
        const ty = padding.top + tick * (height - padding.top - padding.bottom) / 5
        const xv = safeMinX + tick * (safeMaxX - safeMinX) / 5
        const yv = safeMaxY - tick * (safeMaxY - safeMinY) / 5
        return <g key={tick}><line x1={tx} x2={tx} y1={padding.top} y2={height - padding.bottom}/><line x1={padding.left} x2={width - padding.right} y1={ty} y2={ty}/><text x={tx} y={height - 30}>{formatAxis(xv, plotStat)}</text><text className="axis-tick-y" x={padding.left - 10} y={ty + 4}>{formatAxis(yv)}</text></g>
      })}
      {showFrontier && frontierPath && <path className="optimizer-frontier" d={frontierPath}/>} 
      {visible.map((point) => {
        const key = buildKey(point.echoIds)
        const ranked = resultKeys.has(key)
        const selected = selectedKey === key
        const compared = highlighted.has(key)
        const toggle = () => { onSelect(key); onToggleHighlight(key) }
        return <circle key={key} className={`${ranked ? 'ranked' : ''} ${compared ? 'highlighted' : ''} ${selected ? 'selected' : ''}`} cx={x(point.x)} cy={y(point.y)} r={selected ? 7 : compared ? 6 : ranked ? 5 : 3} tabIndex={0} role="button" onClick={toggle} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle() } }}><title>{`${formatAxis(point.y)} target · ${formatAxis(point.x, plotStat)} ${statLabels[plotStat]}${ranked ? ' · Ranked build' : ''}${compared ? ' · In comparison tray' : ''}`}</title></circle>
      })}
      {currentStats && currentScore !== undefined && <polygon className="optimizer-current-point" points={`${x(currentStats[plotStat])},${y(currentScore) - 8} ${x(currentStats[plotStat]) + 7},${y(currentScore)} ${x(currentStats[plotStat])},${y(currentScore) + 8} ${x(currentStats[plotStat]) - 7},${y(currentScore)}`}><title>Current build</title></polygon>}
      <text x={width / 2} y={height - 5}>{statLabels[plotStat]}</text><text className="axis-y" x={-height / 2} y={18}>Optimization target</text>
    </svg>
    {fullMin < fullMax && <div className="optimizer-chart-range"><label><span>Visible minimum</span><input type="range" min={fullMin} max={fullMax} step={(fullMax - fullMin) / 100} value={Number.isFinite(rangeLow) ? rangeLow : fullMin} onChange={(event) => setRangeLow(Math.min(Number(event.target.value), rangeHigh))}/><b>{formatAxis(Number.isFinite(rangeLow) ? rangeLow : fullMin, plotStat)}</b></label><label><span>Visible maximum</span><input type="range" min={fullMin} max={fullMax} step={(fullMax - fullMin) / 100} value={Number.isFinite(rangeHigh) ? rangeHigh : fullMax} onChange={(event) => setRangeHigh(Math.max(Number(event.target.value), rangeLow))}/><b>{formatAxis(Number.isFinite(rangeHigh) ? rangeHigh : fullMax, plotStat)}</b></label></div>}
  </Panel>
}
