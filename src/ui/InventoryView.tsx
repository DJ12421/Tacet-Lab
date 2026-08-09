import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { statLabels } from '../game-data/core'
import { generatedSonataCatalog } from '../game-data/sonatas.generated'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { echoRollRating } from '../domain/echo-grade'
import { effectiveSubStats } from '../game-data/echo-main-stats'
import { db } from '../storage/database'
import type { Build, Echo, StatKey } from '../domain/types'
import { EchoMiniCard, EquippedCharacterLabel, Icon, PageHeader, Panel } from './components'
import { EchoEditModal } from './EchoEditModal'

type SortKey = 'score' | 'newest' | 'name' | 'cost' | 'level'

const echoScore = (echo: Echo) => echoRollRating(echo).average
const sonataNames = generatedSonataCatalog.map((sonata) => sonata.name)
const ECHOES_PER_PAGE = 30

function EchoPagination({ page, pageCount, total, onChange }: { page: number; pageCount: number; total: number; onChange: (page: number) => void }) {
  const start = total ? (page - 1) * ECHOES_PER_PAGE + 1 : 0
  const end = Math.min(page * ECHOES_PER_PAGE, total)
  return <nav className="echo-pagination" aria-label="Echo inventory pages">
    <span>{start}–{end} of {total}</span>
    <div>
      <button type="button" className="secondary" disabled={page === 1} onClick={() => onChange(1)} aria-label="First page">«</button>
      <button type="button" className="secondary" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
      <label>Page <select value={page} onChange={(event) => onChange(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select> of {pageCount}</label>
      <button type="button" className="secondary" disabled={page === pageCount} onClick={() => onChange(page + 1)}>Next</button>
      <button type="button" className="secondary" disabled={page === pageCount} onClick={() => onChange(pageCount)} aria-label="Last page">»</button>
    </div>
  </nav>
}

function MultiSelect({ label, values, options, emptyLabel, onChange, icon }: { label: string; values: string[]; options: Array<{ value: string; label: string }>; emptyLabel: string; onChange: (values: string[]) => void; icon?: (value: string) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  return <label className="multi-filter">{label}<div className="multi-select">
    <button type="button" className="multi-select-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="multi-select-values">{values.length ? values.map((value) => <span className="multi-select-chip" key={value}>{icon?.(value)}<b>{options.find((option) => option.value === value)?.label ?? value}</b><i role="button" aria-label={`Remove ${value}`} onClick={(event) => { event.stopPropagation(); onChange(values.filter((item) => item !== value)) }}>×</i></span>) : <em>{emptyLabel}</em>}</span><strong>⌄</strong>
    </button>
    {open && <div className="multi-select-menu">
      <div className="multi-select-options">{options.map((option) => <button type="button" className={values.includes(option.value) ? 'active' : ''} onClick={() => toggle(option.value)} key={option.value}>{icon?.(option.value)}<span>{option.label}</span><i>{values.includes(option.value) ? '✓' : ''}</i></button>)}</div>
      <footer><button type="button" className="multi-select-clear" disabled={!values.length} onClick={() => onChange([])}>Clear selections</button></footer>
    </div>}
  </div></label>
}

export function InventoryView({ echoes, builds = [], refresh, openScanner, embedded = false }: { echoes: Echo[]; builds?: Build[]; refresh: (scope?: 'all' | 'echoes' | 'echoes-builds') => Promise<void>; openScanner: () => void; embedded?: boolean }) {
  const [query, setQuery] = useState('')
  const [costs, setCosts] = useState<number[]>([])
  const [rarities, setRarities] = useState<number[]>([])
  const [sonatas, setSonatas] = useState<string[]>([])
  const [mainStats, setMainStats] = useState<string[]>([])
  const [subStats, setSubStats] = useState<string[]>([])
  const [lockState, setLockState] = useState<'all' | 'locked' | 'unlocked'>('all')
  const [assignment, setAssignment] = useState<'all' | 'equipped' | 'unequipped'>('all')
  const [showExcluded, setShowExcluded] = useState(false)
  const [sort, setSort] = useState<SortKey>('score')
  const [descending, setDescending] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [editing, setEditing] = useState<Echo | null>(null)
  const [rollInfoOpen, setRollInfoOpen] = useState(false)
  const [page, setPage] = useState(1)
  const paginationTopRef = useRef<HTMLDivElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const statKeys = Object.keys(statLabels) as StatKey[]
  const toggle = (values: number[], value: number, change: (next: number[]) => void) => change(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  const reset = () => { setQuery(''); setCosts([]); setRarities([]); setSonatas([]); setMainStats([]); setSubStats([]); setLockState('all'); setAssignment('all'); setShowExcluded(false); setSort('score'); setDescending(true); setPage(1) }
  const echoMeta = useMemo(() => new Map(echoes.map((echo) => {
    const substats = effectiveSubStats(echo)
    const rollRating = echoRollRating(echo)
    const searchText = `${echo.name} ${echo.sonata} ${statLabels[echo.mainStat.key]} ${substats.map((stat) => statLabels[stat.key]).join(' ')}`.toLowerCase()
    return [echo.id, { substats, rollRating, searchText }] as const
  })), [echoes])
  const ownerByEchoId = useMemo(() => {
    const characterById = new Map(characterCatalog.map((character) => [character.id, character]))
    const owners = new Map<string, string | undefined>()
    for (const build of builds) for (const echoId of build.echoIds) owners.set(echoId, characterById.get(build.resonatorId)?.name)
    return owners
  }, [builds])

  const filtered = useMemo(() => echoes.filter((echo) =>
    (showExcluded || !echo.excluded) &&
    (!costs.length || costs.includes(echo.cost)) &&
    (!rarities.length || rarities.includes(echo.rarity)) &&
    (!sonatas.length || sonatas.includes(echo.sonata)) &&
    (!mainStats.length || mainStats.includes(echo.mainStat.key)) &&
    (!subStats.length || subStats.every((key) => echoMeta.get(echo.id)?.substats.some((stat) => stat.key === key))) &&
    (lockState === 'all' || echo.locked === (lockState === 'locked')) &&
    (assignment === 'all' || Boolean(echo.equippedBy) === (assignment === 'equipped')) &&
    (!deferredQuery || echoMeta.get(echo.id)?.searchText.includes(deferredQuery))
  ).sort((left, right) => {
    const direction = descending ? -1 : 1
    if (sort === 'score') return ((echoMeta.get(left.id)?.rollRating.average ?? echoScore(left)) - (echoMeta.get(right.id)?.rollRating.average ?? echoScore(right))) * direction || left.name.localeCompare(right.name)
    if (sort === 'name') return left.name.localeCompare(right.name) * direction
    if (sort === 'cost') return (left.cost - right.cost) * direction || (left.level - right.level) * direction
    if (sort === 'level') return (left.level - right.level) * direction || (left.cost - right.cost) * direction
    return (left.createdAt - right.createdAt) * direction
  }), [assignment, costs, deferredQuery, descending, echoes, echoMeta, lockState, mainStats, rarities, showExcluded, sonatas, sort, subStats])
  const pageCount = Math.max(1, Math.ceil(filtered.length / ECHOES_PER_PAGE))
  const currentPage = Math.min(page, pageCount)
  const pageEchoes = useMemo(() => filtered.slice((currentPage - 1) * ECHOES_PER_PAGE, currentPage * ECHOES_PER_PAGE), [currentPage, filtered])
  const changePage = (nextPage: number) => {
    setPage(Math.min(pageCount, Math.max(1, nextPage)))
    window.requestAnimationFrame(() => paginationTopRef.current?.scrollIntoView({ block: 'start' }))
  }

  useEffect(() => { setPage(1) }, [assignment, costs, descending, lockState, mainStats, query, rarities, showExcluded, sonatas, sort, subStats])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const patchEcho = async (echo: Echo, patch: Partial<Echo>) => {
    const exclusivePatch = patch.locked ? { ...patch, excluded: false } : patch.excluded ? { ...patch, locked: false } : patch
    await db.echoes.update(echo.id, exclusivePatch); await refresh('echoes')
  }
  const removeEcho = async (echo: Echo) => {
    if (!confirm(`Delete ${echo.name}? This cannot be undone.`)) return
    await db.transaction('rw', db.echoes, db.builds, async () => {
      if (echo.equippedBy) {
        const build = await db.builds.get(echo.equippedBy)
        if (build) await db.builds.update(build.id, { echoIds: build.echoIds.filter((id) => id !== echo.id) })
      }
      await db.echoes.delete(echo.id)
    })
    await refresh('echoes-builds')
  }

  return <>
    {!embedded && <PageHeader eyebrow="Archive / { indexed locally }" title="Echo inventory" description="Filter the pieces you own, compare roll grades, and reserve the strongest Echoes." actions={<button className="primary" onClick={openScanner}><Icon name="scan"/>Add Echoes</button>} />}
    {embedded && <div className="inventory-section-heading"><div><span className="eyebrow">Echo collection</span><h2>Owned Echoes</h2></div><button className="primary" onClick={openScanner}><Icon name="scan"/>Add Echoes</button></div>}
    <Panel className="inventory-filter">
      <div className="filter-heading"><div><strong>Echo filters</strong><span>{filtered.length} / {echoes.length} shown</span><button type="button" className="roll-quality-help" onClick={() => setRollInfoOpen(true)}>Roll grade <span aria-hidden="true">ⓘ</span></button></div><div><button className="text-button" onClick={reset}>Reset</button><button className="secondary" onClick={() => setFiltersOpen((open) => !open)}>{filtersOpen ? 'Collapse' : 'Expand'}</button></div></div>
      <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Echo, Sonata, or stat..."/></label>
      {filtersOpen && <div className="filter-body">
        <div className="filter-group"><span>Cost</span><div className="filter-chips">{[1,3,4].map((value) => <button className={costs.includes(value) ? 'active' : ''} onClick={() => toggle(costs, value, setCosts)} key={value}>{value} cost</button>)}</div></div>
        <div className="filter-group"><span>Rarity</span><div className="filter-chips">{[5,4,3,2,1].map((value) => <button className={rarities.includes(value) ? 'active' : ''} onClick={() => toggle(rarities, value, setRarities)} key={value}>{value} ★</button>)}</div></div>
        <MultiSelect label="Sonata" values={sonatas} options={sonataNames.map((name) => ({ value: name, label: name }))} emptyLabel="All Sonatas" onChange={setSonatas} icon={(name) => <img src={generatedSonataIconSources[name]} alt=""/>}/>
        <MultiSelect label="Main stat" values={mainStats} options={statKeys.map((key) => ({ value: key, label: statLabels[key] }))} emptyLabel="Any main stat" onChange={setMainStats}/>
        <MultiSelect label="Substat" values={subStats} options={statKeys.map((key) => ({ value: key, label: statLabels[key] }))} emptyLabel="Any substat" onChange={setSubStats}/>
        <label>Lock state<select value={lockState} onChange={(event) => setLockState(event.target.value as typeof lockState)}><option value="all">All</option><option value="locked">Locked</option><option value="unlocked">Unlocked</option></select></label>
        <label>Equipped<select value={assignment} onChange={(event) => setAssignment(event.target.value as typeof assignment)}><option value="all">All</option><option value="equipped">Equipped</option><option value="unequipped">Unequipped</option></select></label>
        <label className="check"><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)}/>Include discarded</label>
      </div>}
    </Panel>
    <div className="inventory-sort"><span>Showing {filtered.length} Echoes</span><label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="score">Roll grade</option><option value="newest">Newest</option><option value="name">Name</option><option value="cost">Cost</option><option value="level">Level</option></select></label><button className="secondary" onClick={() => setDescending((value) => !value)}>{descending ? 'Descending ↓' : 'Ascending ↑'}</button></div>
    {filtered.length ? <>
      <div ref={paginationTopRef}/>
      <EchoPagination page={currentPage} pageCount={pageCount} total={filtered.length} onChange={changePage}/>
      <div className="echo-grid">{pageEchoes.map((echo) => <EchoMiniCard key={echo.id} echo={echo} rollRating={echoMeta.get(echo.id)?.rollRating} equipment={<><EquippedCharacterLabel name={ownerByEchoId.get(echo.id)}/><button title="Edit Echo" aria-label={`Edit ${echo.name}`} onClick={(event) => { event.stopPropagation(); setEditing(echo) }}><Icon name="edit"/></button></>} actions={<div className="card-actions"><button title={echo.locked ? 'Unlock' : 'Lock'} onClick={(event) => { event.stopPropagation(); void patchEcho(echo, { locked: !echo.locked }) }}><Icon name="lock"/></button><button title={echo.excluded ? 'Restore discarded Echo' : 'Mark as discarded'} onClick={(event) => { event.stopPropagation(); void patchEcho(echo, { excluded: !echo.excluded }) }}>X</button><button title="Delete" onClick={(event) => { event.stopPropagation(); void removeEcho(echo) }}><Icon name="trash"/></button></div>} />)}</div>
      <EchoPagination page={currentPage} pageCount={pageCount} total={filtered.length} onChange={changePage}/>
    </> : <Panel className="empty-state"><div className="empty-glyph">O</div><h2>No Echoes match these filters</h2><p>Reset the filters or add another Echo.</p><button className="secondary" onClick={reset}>Reset filters</button></Panel>}
    {rollInfoOpen && <div className="modal-backdrop roll-quality-backdrop" onMouseDown={() => setRollInfoOpen(false)}><Panel className="roll-quality-modal" role="dialog" aria-modal="true" aria-labelledby="roll-quality-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">Echo evaluation</span><h2 id="roll-quality-title">How Roll Grade works</h2></div><button className="close" aria-label="Close Roll Grade information" onClick={() => setRollInfoOpen(false)}>×</button></header>
      <p>Roll Grade is a quick, probability-informed summary of an Echo's revealed substats. Character-specific build scoring remains separate.</p>
      <section><h3>1. Add simple roll points</h3><p>Non-flat substats use their position on the eight fixed roll values: the lowest earns 1 point and the highest earns 8.</p><div className="roll-tier-legend"><span className="tier-low">1–2 Low</span><span className="tier-mid">3–4 Mid</span><span className="tier-high">5–6 High</span><span className="tier-perfect">7–8 Elite</span></div><p>Flat HP, ATK, and DEF always earn 3 points because their gameplay value is generally limited.</p></section>
      <section><h3>2. Average the revealed rolls</h3><p>Add the points and divide by the number of revealed substats. Echoes with fewer than five rolls receive a provisional grade, marked with an asterisk.</p><div className="quality-formula"><b>Earned roll points</b><span>÷</span><b>Revealed substats</b><span>= average</span></div></section>
      <section><h3>3. Read the grade and color</h3><p>The boundaries are calibrated from the official substat and roll-value probabilities, then rounded so a completed Echo can be graded by adding five numbers.</p><div className="grade-legend"><span className="grade-e">E<small>5–12 · White</small></span><span className="grade-d">D<small>13–15 · Green</small></span><span className="grade-c">C<small>16–17 · Blue</small></span><span className="grade-b">B<small>18–19 · Purple</small></span><span className="grade-a">A<small>20–21 · Purple</small></span><span className="grade-s">S<small>22–23 · Gold</small></span><span className="grade-ss">SS<small>24–26 · Gold</small></span><span className="grade-sss">SSS<small>27–40 · Red</small></span></div></section>
    </Panel></div>}
    {editing && <EchoEditModal
      echo={editing}
      onClose={() => setEditing(null)}
      onSave={async (updated) => { await db.echoes.put(updated); setEditing(null); await refresh('echoes') }}
    />}
  </>
}
