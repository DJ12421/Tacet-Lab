import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { statLabels } from '../game-data/core'
import { generatedSonataCatalog } from '../game-data/sonatas.generated'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { echoRollRating } from '../domain/echo-grade'
import { effectiveSubStats } from '../game-data/echo-main-stats'
import { db } from '../storage/database'
import type { Build, Echo, StatKey } from '../domain/types'
import { EchoMiniCard, EquippedCharacterLabel, Icon, PageHeader, Panel } from './components'
import { EchoEditModal } from './EchoEditModal'
import './echo-inventory.css'

type SortKey = 'score' | 'newest' | 'name' | 'cost' | 'level'

const echoScore = (echo: Echo) => echoRollRating(echo).average
const sonataNames = generatedSonataCatalog.map((sonata) => sonata.name)
const echoCosts = [1, 3, 4]
const echoRarities = [5, 4, 3, 2, 1]
const ECHOES_PER_PAGE = 30

function EchoPagination({ page, pageCount, total, onChange, actions }: { page: number; pageCount: number; total: number; onChange: (page: number) => void; actions?: ReactNode }) {
  const start = total ? (page - 1) * ECHOES_PER_PAGE + 1 : 0
  const end = Math.min(page * ECHOES_PER_PAGE, total)
  return <nav className={`echo-pagination${actions ? ' echo-results-bar' : ''}`} aria-label="Echo inventory pages">
    <span>{start}–{end} <small>of {total}</small></span>
    <div>
      {actions}
      {pageCount > 1 && <><button type="button" className="echo-page-arrow" disabled={page === 1} onClick={() => onChange(page - 1)} aria-label="Previous page">‹</button>
        <label className="echo-page-select"><span className="sr-only">Page</span><select value={page} onChange={(event) => onChange(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select><small>/ {pageCount}</small></label>
        <button type="button" className="echo-page-arrow" disabled={page === pageCount} onClick={() => onChange(page + 1)} aria-label="Next page">›</button></>}
    </div>
  </nav>
}

function MultiSelect({ label, values, options, emptyLabel, onChange, icon, open, onToggle }: { label: string; values: string[]; options: Array<{ value: string; label: string }>; emptyLabel: string; onChange: (values: string[]) => void; icon?: (value: string) => ReactNode; open: boolean; onToggle: () => void }) {
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  return <label className="multi-filter">{label}<div className="multi-select">
    <button type="button" className="multi-select-trigger" aria-expanded={open} onClick={onToggle}>
      <span className="multi-select-values">{values.length ? <span className="multi-select-summary">{icon?.(values[0])}<b>{options.find((option) => option.value === values[0])?.label ?? values[0]}</b>{values.length > 1 && <i>+{values.length - 1}</i>}</span> : <em>{emptyLabel}</em>}</span><strong>⌄</strong>
    </button>
    {open && <div className="multi-select-menu">
      <div className="multi-select-options">{options.map((option) => <button type="button" className={values.includes(option.value) ? 'active' : ''} onClick={() => toggle(option.value)} key={option.value}>{icon?.(option.value)}<span>{option.label}</span><i>{values.includes(option.value) ? '✓' : ''}</i></button>)}</div>
      <footer><button type="button" className="multi-select-clear" disabled={!values.length} onClick={() => onChange([])}>Clear selections</button></footer>
    </div>}
  </div></label>
}

export function InventoryView({ echoes, builds: _builds = [], refresh, openScanner, embedded = false }: { echoes: Echo[]; builds?: Build[]; refresh: (scope?: 'all' | 'echoes' | 'echoes-builds') => Promise<void>; openScanner: () => void; embedded?: boolean }) {
  const [query, setQuery] = useState('')
  const [costs, setCosts] = useState<number[]>(echoCosts)
  const [rarities, setRarities] = useState<number[]>(echoRarities)
  const [sonatas, setSonatas] = useState<string[]>([])
  const [mainStats, setMainStats] = useState<string[]>([])
  const [subStats, setSubStats] = useState<string[]>([])
  const [lockState, setLockState] = useState<'all' | 'locked' | 'unlocked'>('all')
  const [assignment, setAssignment] = useState<'all' | 'equipped' | 'unequipped'>('all')
  const [showExcluded, setShowExcluded] = useState(false)
  const [sort, setSort] = useState<SortKey>('score')
  const [descending, setDescending] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [openMultiFilter, setOpenMultiFilter] = useState<'sonata' | 'mainStat' | 'subStat' | null>(null)
  const [editing, setEditing] = useState<Echo | null>(null)
  const [rollInfoOpen, setRollInfoOpen] = useState(false)
  const [page, setPage] = useState(1)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const statKeys = Object.keys(statLabels) as StatKey[]
  const toggle = (options: number[], values: number[], value: number, change: (next: number[]) => void) => {
    if (values.length === options.length) change([value])
    else if (values.length === 1 && values.includes(value)) change(options)
    else change(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  }
  const reset = () => { setQuery(''); setCosts(echoCosts); setRarities(echoRarities); setSonatas([]); setMainStats([]); setSubStats([]); setLockState('all'); setAssignment('all'); setShowExcluded(false); setSort('score'); setDescending(true); setOpenMultiFilter(null); setPage(1) }
  const echoMeta = useMemo(() => new Map(echoes.map((echo) => {
    const substats = effectiveSubStats(echo)
    const rollRating = echoRollRating(echo)
    const searchText = `${echo.name} ${echo.sonata} ${statLabels[echo.mainStat.key]} ${substats.map((stat) => statLabels[stat.key]).join(' ')}`.toLowerCase()
    return [echo.id, { substats, rollRating, searchText }] as const
  })), [echoes])
  const ownerByEchoId = useMemo(() => new Map(echoes.map((echo) => [echo.id, echo.equippedByName])), [echoes])
  const activeFilterCount = Number(costs.length !== echoCosts.length) + Number(rarities.length !== echoRarities.length) + Number(sonatas.length > 0) + Number(mainStats.length > 0) + Number(subStats.length > 0) + Number(lockState !== 'all') + Number(assignment !== 'all') + Number(showExcluded)

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
  }

  useEffect(() => { setPage(1) }, [assignment, costs, descending, lockState, mainStats, query, rarities, showExcluded, sonatas, sort, subStats])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const patchEcho = async (echo: Echo, patch: Partial<Echo>) => {
    const exclusivePatch = patch.locked ? { ...patch, excluded: false } : patch.excluded ? { ...patch, locked: false } : patch
    await db.echoes.update(echo.id, exclusivePatch); await refresh('echoes')
  }
  const removeEcho = async (echo: Echo) => {
    if (!confirm(`Delete ${echo.name}? This cannot be undone.`)) return
    await db.transaction('rw', db.echoes, db.equippedLoadouts, async () => {
      if (echo.equippedBy) {
        const loadout = await db.equippedLoadouts.where('characterId').equals(echo.equippedBy).first()
        if (loadout) await db.equippedLoadouts.update(loadout.id, { echoIds: loadout.echoIds.filter((id) => id !== echo.id), updatedAt: Date.now() })
      }
      await db.echoes.delete(echo.id)
    })
    await refresh('echoes-builds')
  }

  return <section className="echo-inventory-view">
    {!embedded && <PageHeader eyebrow="Echo collection" title="Your Echoes" description="Find the pieces worth building around." actions={<button className="primary" onClick={openScanner}><Icon name="plus"/>Add Echo</button>} />}
    {embedded && <div className="inventory-section-heading"><div><span className="eyebrow">Collection</span><h2>Echoes</h2></div><button className="primary" onClick={openScanner}><Icon name="plus"/>Add Echo</button></div>}
    {echoes.length > 0 && <Panel className="inventory-filter echo-inventory-toolbar">
      <div className="echo-toolbar-main">
        <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your Echoes"/></label>
        <div className="echo-quick-filters" aria-label="Quick filters">
          <button type="button" className={activeFilterCount === 0 && !query ? 'active' : ''} onClick={reset}>All</button>
          <button type="button" className={assignment === 'equipped' && lockState === 'all' && !showExcluded ? 'active' : ''} onClick={() => { setAssignment(assignment === 'equipped' ? 'all' : 'equipped'); setLockState('all'); setShowExcluded(false) }}>Equipped</button>
          <button type="button" className={lockState === 'locked' && assignment === 'all' && !showExcluded ? 'active' : ''} onClick={() => { setLockState(lockState === 'locked' ? 'all' : 'locked'); setAssignment('all'); setShowExcluded(false) }}><Icon name="lock"/>Locked</button>
        </div>
        <button type="button" className={`echo-filter-toggle${filtersOpen ? ' active' : ''}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => { if (open) setOpenMultiFilter(null); return !open })}><Icon name="settings"/>Filters{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</button>
      </div>
      {filtersOpen && <div className="filter-body echo-filter-drawer">
        <div className="filter-group echo-cost-filter"><span>Cost</span><div className="filter-chips">{echoCosts.map((value) => <button type="button" aria-pressed={costs.includes(value)} className={costs.includes(value) ? 'active' : ''} onClick={() => toggle(echoCosts, costs, value, setCosts)} key={value}>{value} cost</button>)}</div></div>
        <div className="filter-group echo-rarity-filter"><span>Rarity</span><div className="filter-chips">{echoRarities.map((value) => <button type="button" aria-pressed={rarities.includes(value)} className={rarities.includes(value) ? 'active' : ''} onClick={() => toggle(echoRarities, rarities, value, setRarities)} key={value}>{value} ★</button>)}</div></div>
        <MultiSelect label="Sonata" values={sonatas} options={sonataNames.map((name) => ({ value: name, label: name }))} emptyLabel="All Sonatas" onChange={setSonatas} icon={(name) => <img src={generatedSonataIconSources[name]} alt=""/>} open={openMultiFilter === 'sonata'} onToggle={() => setOpenMultiFilter((current) => current === 'sonata' ? null : 'sonata')}/>
        <MultiSelect label="Main stat" values={mainStats} options={statKeys.map((key) => ({ value: key, label: statLabels[key] }))} emptyLabel="Any main stat" onChange={setMainStats} open={openMultiFilter === 'mainStat'} onToggle={() => setOpenMultiFilter((current) => current === 'mainStat' ? null : 'mainStat')}/>
        <MultiSelect label="Substat" values={subStats} options={statKeys.map((key) => ({ value: key, label: statLabels[key] }))} emptyLabel="Any substat" onChange={setSubStats} open={openMultiFilter === 'subStat'} onToggle={() => setOpenMultiFilter((current) => current === 'subStat' ? null : 'subStat')}/>
        <label>Lock state<select value={lockState} onChange={(event) => setLockState(event.target.value as typeof lockState)}><option value="all">All</option><option value="locked">Locked</option><option value="unlocked">Unlocked</option></select></label>
        <label>Equipped<select value={assignment} onChange={(event) => setAssignment(event.target.value as typeof assignment)}><option value="all">All</option><option value="equipped">Equipped</option><option value="unequipped">Unequipped</option></select></label>
        <label className="check"><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)}/>Include discarded</label>
        <div className="echo-filter-footer"><button type="button" className="text-button" disabled={activeFilterCount === 0 && !query} onClick={reset}>Clear all</button></div>
      </div>}
    </Panel>}
    {filtered.length ? <>
      <div className="echo-results-anchor"><EchoPagination page={currentPage} pageCount={pageCount} total={filtered.length} onChange={changePage} actions={<><button type="button" className="roll-quality-help" onClick={() => setRollInfoOpen(true)}>Roll Grade Guide <span aria-hidden="true">ⓘ</span></button><label className="echo-sort-select"><span className="sr-only">Sort by</span><select aria-label="Sort Echoes" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="score">Roll grade</option><option value="newest">Latest</option><option value="name">Name</option><option value="cost">Cost</option><option value="level">Level</option></select></label><button className="echo-sort-direction" aria-label={descending ? 'Sort descending' : 'Sort ascending'} title={descending ? 'Descending' : 'Ascending'} onClick={() => setDescending((value) => !value)}>{descending ? '↓' : '↑'}</button></>}/></div>
      <div className="echo-grid">{pageEchoes.map((echo) => <EchoMiniCard key={echo.id} echo={echo} onClick={() => setEditing(echo)} rollRating={echoMeta.get(echo.id)?.rollRating} equipment={<><EquippedCharacterLabel name={ownerByEchoId.get(echo.id)}/><button title="Edit Echo" aria-label={`Edit ${echo.name}`} onClick={(event) => { event.stopPropagation(); setEditing(echo) }}><Icon name="edit"/></button></>} actions={<div className="card-actions"><button className={`echo-lock-action ${echo.locked ? 'locked' : 'unlocked'}`} aria-label={echo.locked ? `Unlock ${echo.name}` : `Lock ${echo.name}`} title={echo.locked ? 'Unlock' : 'Lock'} onClick={(event) => { event.stopPropagation(); void patchEcho(echo, { locked: !echo.locked }) }}><Icon name={echo.locked ? 'lock' : 'unlock'}/></button><button className="echo-discard-action" aria-label={echo.excluded ? `Restore ${echo.name}` : `Discard ${echo.name}`} title={echo.excluded ? 'Restore discarded Echo' : 'Mark as discarded'} onClick={(event) => { event.stopPropagation(); void patchEcho(echo, { excluded: !echo.excluded }) }}><Icon name="discard"/></button><button className="echo-delete-action" aria-label={`Delete ${echo.name}`} title="Delete" onClick={(event) => { event.stopPropagation(); void removeEcho(echo) }}><Icon name="trash"/></button></div>} />)}</div>
      {pageCount > 1 && <EchoPagination page={currentPage} pageCount={pageCount} total={filtered.length} onChange={changePage}/>}
    </> : echoes.length === 0 ? <Panel className="empty-state echo-empty-welcome"><div className="empty-glyph"><Icon name="echo"/></div><h2>Add your first Echo</h2><p>Scan it or enter it by hand.</p><button className="primary" onClick={openScanner}><Icon name="plus"/>Add Echo</button></Panel> : <Panel className="empty-state echo-empty-filtered"><div className="empty-glyph">⌕</div><h2>No matches</h2><button className="secondary" onClick={reset}>Clear filters</button></Panel>}
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
  </section>
}
