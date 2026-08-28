import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { statLabels } from '../game-data/core'
import { echoCatalog } from '../game-data/echoes'
import { generatedSonataCatalog, generatedSonataIconSources } from '../game-data/sonatas.generated'
import { effectiveSubStats, fixedSecondaryMainStat, mainStatError, mainStatKeysByCost, maxLevelByRarity, maxSubStatsForLevel, normalizeEchoMainStat } from '../game-data/echo-main-stats'
import { tunableRolls } from '../game-data/tunable-rolls'
import type { Echo, StatKey } from '../domain/types'
import { EchoMiniCard, formatStat, Panel } from './components'
import { useDismissableLayer } from './useDismissableLayer'
import { availableSubstatKeys, duplicateSubstatKeys } from '../domain/echo-substats'

const sonataNames = generatedSonataCatalog.map((sonata) => sonata.name)
const subStatKeys = Object.keys(tunableRolls) as StatKey[]
const levelStops = [0, 5, 10, 15, 20, 25]

function SearchablePicker({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; icon?: string; detail?: string }>; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const selected = options.find((option) => option.value === value)
  const visible = options.filter((option) => `${option.value} ${option.detail ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  useDismissableLayer(open, ref, close)
  return <label>{label}<div className="echo-search-picker" ref={ref}>
    <button type="button" className="echo-search-trigger" onClick={() => { setOpen((current) => !current); setQuery('') }}>{selected?.icon ? <img src={selected.icon} alt=""/> : <span>◇</span>}<b>{value}</b><i>⌄</i></button>
    {open && <div className="echo-search-menu"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Filter ${label.toLowerCase()}...`}/><div>{visible.map((option) => <button type="button" className={option.value === value ? 'active' : ''} key={option.value} onClick={() => { onChange(option.value); setOpen(false) }}>{option.icon ? <img src={option.icon} alt=""/> : <span>◇</span>}<b>{option.value}</b>{option.detail && <small>{option.detail}</small>}</button>)}</div></div>}
  </div></label>
}

function ReadOnlyStat({ label, children }: { label: string; children: ReactNode }) {
  return <div className="echo-fixed-stat"><span>{label}</span>{children}</div>
}

export function EchoEditModal({ echo, onClose, onSave }: { echo: Echo; onClose: () => void; onSave: (echo: Echo) => Promise<void> }) {
  const [draft, setDraft] = useState<Echo>(() => {
    const catalogEcho = echoCatalog.find((item) => item.name === echo.name)
    const canonicalEcho = catalogEcho ? { ...structuredClone(echo), cost: catalogEcho.cost } : structuredClone(echo)
    return { ...canonicalEcho, mainStat: normalizeEchoMainStat(canonicalEcho), subStats: effectiveSubStats(canonicalEcho) }
  })
  const [error, setError] = useState('')
  const selectedEcho = echoCatalog.find((item) => item.name === draft.name)
  const canonicalCost = selectedEcho?.cost ?? draft.cost
  const echoOptions = useMemo(() => echoCatalog
    .filter((item) => item.sonatas.includes(draft.sonata))
    .map((item) => ({ value: item.name, icon: item.iconSourceUrl, detail: `${item.cost} cost` })), [draft.sonata])
  const sonataOptions = sonataNames.map((name) => ({ value: name, icon: generatedSonataIconSources[name] }))
  const secondary = fixedSecondaryMainStat(draft)
  const maxSubStats = maxSubStatsForLevel(draft.level)
  const updateCore = (patch: Partial<Pick<Echo, 'rarity' | 'level'>>, key = draft.mainStat.key) => setDraft((current) => {
    const next = { ...current, ...patch }
    return { ...next, mainStat: normalizeEchoMainStat({ ...next, mainStat: { ...next.mainStat, key } }), subStats: current.subStats.slice(0, maxSubStatsForLevel(next.level)) }
  })
  const setSubStat = (index: number, key: StatKey, rollIndex?: number) => setDraft((current) => ({ ...current, subStats: current.subStats.map((stat, statIndex) => {
    if (statIndex !== index) return stat
    const rolls = tunableRolls[key] ?? []
    const currentIndex = rolls.findIndex((roll) => Math.abs(roll.value - stat.value) < 0.001)
    return { key, value: rolls[Math.max(0, rollIndex ?? currentIndex)]?.value ?? 0 }
  }) }))
  const submit = async () => {
    if (!draft.name.trim() || !draft.sonata.trim()) { setError('Name and Sonata are required.'); return }
    if (!selectedEcho?.sonatas.includes(draft.sonata)) { setError('Choose an Echo available for the selected Sonata.'); return }
    if (duplicateSubstatKeys(draft.subStats).length) { setError('Each substat type can only appear once.'); return }
    const normalizedDraft = draft.cost === canonicalCost
      ? draft
      : { ...draft, cost: canonicalCost, mainStat: normalizeEchoMainStat({ ...draft, cost: canonicalCost }) }
    const invalidMainStat = mainStatError(normalizedDraft.cost, normalizedDraft.rarity, normalizedDraft.level, normalizedDraft.mainStat)
    if (invalidMainStat) { setError(invalidMainStat); return }
    await onSave(normalizedDraft)
  }

  return createPortal(<div className="modal-backdrop echo-editor-backdrop" onMouseDown={onClose}>
    <Panel className="echo-edit-modal" onMouseDown={(event) => event.stopPropagation()}>
      <header className="echo-editor-header"><div><span className="eyebrow">Edit Echo</span><h2>{draft.name}</h2></div><button className="close" aria-label="Close Echo editor" onClick={onClose}>×</button></header>
      <div className="echo-editor-layout">
        <section className="echo-editor-fields">
          <div className="echo-editor-identity">
            <SearchablePicker label="Name" value={draft.name} options={echoOptions} onChange={(name) => { const entry = echoCatalog.find((item) => item.name === name); if (!entry) return; setDraft((current) => { const next = { ...current, name, cost: entry.cost }; return { ...next, mainStat: normalizeEchoMainStat(next) } }) }}/>
            <SearchablePicker label="Sonata" value={draft.sonata} options={sonataOptions} onChange={(sonata) => setDraft({ ...draft, sonata })}/>
            <label>Cost<div className="echo-readonly-name echo-canonical-cost"><b>{canonicalCost}</b></div></label>
            <label>Rarity<select value={draft.rarity} onChange={(event) => { const rarity = Number(event.target.value) as Echo['rarity']; updateCore({ rarity, level: Math.min(draft.level, maxLevelByRarity[rarity]) }) }}>{[2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} star</option>)}</select></label>
          </div>
          {selectedEcho && !selectedEcho.sonatas.includes(draft.sonata) && <div className="notice warning">Choose an Echo available for {draft.sonata}.</div>}
          <div className="echo-level-editor"><label>Level <strong>+{draft.level}</strong><input type="range" min="0" max={maxLevelByRarity[draft.rarity]} value={draft.level} onChange={(event) => updateCore({ level: Number(event.target.value) })}/></label><div>{levelStops.filter((level) => level <= maxLevelByRarity[draft.rarity]).map((level) => <button type="button" className={draft.level === level ? 'active' : ''} onClick={() => updateCore({ level })} key={level}>+{level}</button>)}</div></div>
          <div className="echo-main-stat-group">
            <div className="echo-stat-line main"><span>Primary</span><select value={draft.mainStat.key} onChange={(event) => updateCore({}, event.target.value as StatKey)}>{mainStatKeysByCost[draft.cost].map((key) => <option key={key} value={key}>{statLabels[key]}</option>)}</select><ReadOnlyStat label="Level value"><strong>{formatStat(draft.mainStat.key, draft.mainStat.value)}</strong></ReadOnlyStat></div>
            <div className="echo-stat-line secondary-main"><span>Secondary</span><div className="echo-readonly-name">{statLabels[secondary.key]}</div><ReadOnlyStat label="Fixed value"><strong>{formatStat(secondary.key, secondary.value)}</strong></ReadOnlyStat></div>
          </div>
          <div className="echo-editor-substats"><header><h3>Substats</h3><span>{draft.subStats.length}/{maxSubStats} tuned</span></header>{draft.subStats.map((stat, index) => { const rolls = tunableRolls[stat.key] ?? []; const rollIndex = Math.max(0, rolls.findIndex((roll) => Math.abs(roll.value - stat.value) < 0.001)); const keys = availableSubstatKeys(subStatKeys, draft.subStats, index); return <div className="echo-substat-row" key={index}><div className="echo-stat-line"><span>#{index + 1}</span><select value={stat.key} onChange={(event) => setSubStat(index, event.target.value as StatKey, 0)}>{keys.map((key) => <option key={key} value={key}>{statLabels[key]}</option>)}</select><strong>{formatStat(stat.key, rolls[rollIndex]?.value ?? stat.value)}</strong><button type="button" className="text-button" onClick={() => setDraft({ ...draft, subStats: draft.subStats.filter((_, statIndex) => statIndex !== index) })}>Remove</button></div><div className="echo-roll-slider"><input aria-label={`Substat ${index + 1} roll`} type="range" min="0" max={Math.max(0, rolls.length - 1)} step="1" value={rollIndex} onChange={(event) => setSubStat(index, stat.key, Number(event.target.value))}/><div>{rolls.map((roll, point) => <i className={point === rollIndex ? 'active' : ''} key={roll.value}>{roll.value}</i>)}</div></div></div> })}{(() => { const keys = availableSubstatKeys(subStatKeys, draft.subStats); const key = keys[0]; return <button type="button" className="secondary add-substat" disabled={draft.subStats.length >= maxSubStats || !key} onClick={() => key && setDraft({ ...draft, subStats: [...draft.subStats, { key, value: tunableRolls[key]?.[0].value ?? 0 }] })}><span aria-hidden="true">+</span> Add substat</button> })()}</div>
          <div className="echo-editor-states"><label><input type="checkbox" checked={draft.locked} onChange={(event) => setDraft({ ...draft, locked: event.target.checked, excluded: event.target.checked ? false : draft.excluded })}/>Locked</label><label><input type="checkbox" checked={draft.excluded} onChange={(event) => setDraft({ ...draft, excluded: event.target.checked, locked: event.target.checked ? false : draft.locked })}/>Discarded</label></div>
          {error && <div className="notice error">{error}</div>}
        </section>
        <aside className="echo-editor-previews"><div><span className="eyebrow">Before edit</span><EchoMiniCard echo={echo}/></div><div><span className="eyebrow">Live preview</span><EchoMiniCard echo={draft}/></div></aside>
      </div>
      <footer className="echo-editor-actions"><button className="text-button" onClick={onClose}>Cancel</button><button className="primary" onClick={() => void submit()}>Save Echo</button></footer>
    </Panel>
  </div>, document.body)
}
