import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { generatedCharacterCatalog as characterCatalog } from '../game-data/characters.generated'
import { echoCatalog } from '../game-data/echoes'
import { generatedSonataCatalog as sonataCatalog, generatedSonataIconSources } from '../game-data/sonatas.generated'
import { generatedWeaponCatalog as weaponCatalog } from '../game-data/weapons.generated'
import { pendingMechanics } from '../game-data/review-status.generated'
import { getSettings } from '../storage/database'
import { ElementFilterIcon, FilterChips, Icon, PageHeader } from './components'
import { SonataPicker } from './SonataPicker'
import { statIconSource, weaponStatIconSource } from './stat-icons'
import { useBodyScrollLock } from './useDismissableLayer'

type ArchiveTab = 'characters' | 'weapons' | 'sonatas' | 'echoes'
type SortMode = 'release-order' | 'name-asc' | 'name-desc' | 'rarity-desc' | 'cost-desc'
type ArchiveDetail =
  | { kind: 'character'; item: (typeof characterCatalog)[number] }
  | { kind: 'weapon'; item: (typeof weaponCatalog)[number] }
  | { kind: 'echo'; item: (typeof echoCatalog)[number] }

const tbaSections = (kind: string, id?: string) => id ? pendingMechanics[kind]?.[id] ?? [] : []

const sortOptionsFor = (tab: ArchiveTab): Array<{ value: SortMode; label: string }> => [
  ...(tab === 'sonatas' ? [{ value: 'release-order' as const, label: 'Release order' }] : []),
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  ...((tab === 'characters' || tab === 'weapons') ? [{ value: 'rarity-desc' as const, label: 'Highest rarity' }] : []),
  ...(tab === 'echoes' ? [{ value: 'cost-desc' as const, label: 'Highest cost' }] : [])
]

const PAGE_SIZE = 48
const archiveIconRoot = `${import.meta.env.BASE_URL}sidebar-icons/`
const tabs: Array<{ id: ArchiveTab; label: string; count: number; iconSource: string }> = [
  { id: 'characters', label: 'Characters', count: characterCatalog.length, iconSource: `${archiveIconRoot}characters.svg` },
  { id: 'weapons', label: 'Weapons', count: weaponCatalog.length, iconSource: `${archiveIconRoot}weapons.svg` },
  { id: 'sonatas', label: 'Sonatas', count: sonataCatalog.length, iconSource: generatedSonataIconSources['Freezing Frost'] },
  { id: 'echoes', label: 'Echoes', count: echoCatalog.length, iconSource: `${archiveIconRoot}echoes.svg` }
]
const weaponTypes = [...new Set(weaponCatalog.map((item) => item.type))]
const characterElements = [...new Set(characterCatalog.map((item) => item.element))]
const weaponSecondaryStats = [...new Set(weaponCatalog.map((item) => item.secondaryStat))].filter((value) => value !== 'Unreleased')
const echoCosts = ['1 cost', '3 cost', '4 cost']
const characterRarities = [5, 4]
const weaponRarities = [5, 4, 3, 2, 1]
const categoryOptionsFor = (tab: ArchiveTab) => tab === 'characters' ? characterElements : tab === 'weapons' ? weaponSecondaryStats : tab === 'echoes' ? echoCosts : []
const rarityOptionsFor = (tab: ArchiveTab) => tab === 'characters' ? characterRarities : tab === 'weapons' ? weaponRarities : []
const isSelectedGenderVariant = (entry: (typeof characterCatalog)[number], gender: 'male' | 'female') =>
  !entry.gender || !characterCatalog.some((candidate) => candidate.id !== entry.id && candidate.name === entry.name && candidate.gender !== entry.gender) || entry.gender === gender

const elementSonatas: Record<string, string> = {
  Glacio: 'Freezing Frost', Fusion: 'Molten Rift', Electro: 'Void Thunder',
  Aero: 'Sierra Gale', Spectro: 'Celestial Light', Havoc: 'Havoc Eclipse'
}

function ElementIcon({ element }: { element: string }) {
  const source = generatedSonataIconSources[elementSonatas[element]]
  return <span className={`element-icon element-${element.toLowerCase()}`} title={element}>{source && <img src={source} alt=""/>}</span>
}

function CatalogImage({ src, alt }: { src?: string; alt: string }) {
  return src ? <img src={src} alt={alt} loading="lazy" decoding="async"/> : null
}

const plainDescription = (description: string) => description.replace(/<[^>]*>/g, '').replace(/\{Cus:[^}]*\}/g, '')
const NanokaText = ({ text }: { text: string }) => <>{text.split(/(<color=Highlight>.*?<\/color>)/g).map((part, index) => {
  const highlight = part.match(/^<color=Highlight>(.*?)<\/color>$/)
  return highlight ? <mark key={index}>{highlight[1]}</mark> : part
})}</>
const refinementNumberPattern = /-?\d+(?:\.\d+)?%?/g
const refinementNumberPartPattern = /^-?\d+(?:\.\d+)?%?$/
const RefinementText = ({ text, ranks }: { text: string; ranks: string[] }) => {
  const rankValues = ranks.map((rank) => plainDescription(rank).match(refinementNumberPattern) ?? [])
  let valueIndex = 0
  return <>{text.split(/(-?\d+(?:\.\d+)?%?)/g).map((part, index) => {
    if (!refinementNumberPartPattern.test(part)) return part
    const currentValueIndex = valueIndex++
    const changesWithRank = new Set(rankValues.map((values) => values[currentValueIndex])).size > 1
    return changesWithRank ? <mark className="archive-refinement-value" key={index}>{part}</mark> : part
  })}</>
}

function ArchiveDetailDialog({ detail, onClose }: { detail: ArchiveDetail; onClose: () => void }) {
  const [weaponRank, setWeaponRank] = useState(1)
  useBodyScrollLock(true)
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const { kind, item } = detail
  const image = kind === 'character' ? item.portraitSourceUrl : item.iconSourceUrl
  const subtitle = kind === 'character' ? item.title : kind === 'weapon' ? item.type : `${item.cost} cost Echo`
  const titleId = `archive-detail-${kind}-${item.id}`

  return createPortal(<div className="modal-backdrop archive-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`archive-detail-modal archive-detail-${kind}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="archive-detail-header">
        <div className="archive-detail-art"><CatalogImage src={image} alt=""/></div>
        <div><span className="eyebrow">{kind}</span><h2 id={titleId}>{item.name}</h2><p>{subtitle}</p></div>
        <button type="button" className="close" aria-label="Close details" onClick={onClose} autoFocus></button>
      </header>

      <div className="archive-detail-body">
        {tbaSections(kind, item.id).length > 0 && <p className="archive-tba-note"><strong>TBA:</strong> {tbaSections(kind, item.id).join(', ')} mechanics are not included in Tacet Lab calculations. Catalog details remain available.</p>}
        {kind === 'character' && <>
          <p className="archive-detail-description">{plainDescription(item.description)}</p>
          <dl className="archive-detail-facts">
            <div><dt>Element</dt><dd><ElementIcon element={item.element}/>{item.element}</dd></div>
            <div><dt>Weapon</dt><dd>{item.weaponType}</dd></div>
            <div><dt>Roles</dt><dd className="archive-detail-role-list">{(item.roles.length ? item.roles : [item.role]).map((role) => <span className="archive-role-chip" key={role}>{role}</span>)}</dd></div>
            <div><dt>Rarity</dt><dd aria-label={`${item.rarity} stars`}>{'★'.repeat(item.rarity)}</dd></div>
          </dl>
          <section className="archive-detail-section archive-skill-input-guide">
            <h3>Skill Input</h3>
            {item.skillInputGuide.features.length > 0 && <div className="archive-skill-guide-features"><strong>Features</strong><ul>{item.skillInputGuide.features.map((feature) => <li key={feature}><NanokaText text={feature}/></li>)}</ul></div>}
            {item.skillInputGuide.overviewImageSourceUrl && <img className="archive-skill-guide-overview" src={item.skillInputGuide.overviewImageSourceUrl} alt="Skill input overview"/>}
            {item.skillInputGuide.sections.length > 0 && <div className="archive-skill-guide-instructions"><strong>Instructions</strong>{item.skillInputGuide.sections.map((section) => <article key={section.id}>
              <h4>{section.name}</h4>
              {section.entries.map((entry) => <div className="archive-skill-guide-entry" key={entry.id}><p>· <NanokaText text={entry.description}/></p>{entry.imageSourceUrls.length > 0 && <div className="archive-skill-guide-images">{entry.imageSourceUrls.map((source) => <img src={source} alt="" key={source}/>)}</div>}</div>)}
            </article>)}</div>}
          </section>
        </>}

        {kind === 'weapon' && <>
          <p className="archive-detail-description">{plainDescription(item.description)}</p>
          <dl className="archive-detail-facts">
            <div><dt>Type</dt><dd>{item.type}</dd></div>
            <div><dt>Rarity</dt><dd aria-label={`${item.rarity} stars`}>{'★'.repeat(item.rarity)}</dd></div>
            <div><dt><img className="weapon-stat-icon" src={statIconSource('atk')} alt="" aria-hidden="true"/>ATK</dt><dd>{item.baseAtk}</dd></div>
            <div><dt><img className="weapon-stat-icon" src={weaponStatIconSource(item.secondaryStat)} alt="" aria-hidden="true"/>{item.secondaryStat}</dt><dd>{item.secondaryStatValue}</dd></div>
          </dl>
          {item.passiveName && <section className="archive-detail-section">
            <header className="archive-detail-section-header"><h3>{item.passiveName}</h3><output aria-live="polite">Current: R{weaponRank}</output></header>
            <label className="archive-rank-slider"><span>R1</span><input type="range" min="1" max="5" step="1" value={weaponRank} aria-label="Weapon rank" onChange={(event) => setWeaponRank(Number(event.target.value))}/><span>R5</span></label>
            <p className="archive-weapon-passive"><RefinementText text={plainDescription(item.passiveEffects[weaponRank - 1] ?? item.passiveEffects[0] ?? '')} ranks={item.passiveEffects}/></p>
          </section>}
        </>}

        {kind === 'echo' && <>
          <dl className="archive-detail-facts">
            <div><dt>Cost</dt><dd>{item.cost}</dd></div>
            <div><dt>Sonatas</dt><dd className="archive-detail-sonata-list">{item.sonatas.map((name) => <span className="archive-sonata-chip" key={name}><img src={generatedSonataIconSources[name]} alt=""/><b>{name}</b></span>)}</dd></div>
          </dl>
          <section className="archive-detail-section"><header className="archive-detail-section-header"><h3>Skill</h3><span>Max rank</span></header><p className="archive-echo-skill">{plainDescription(item.skillDescription || 'Skill details unavailable.')}</p></section>
        </>}
      </div>
    </section>
  </div>, document.body)
}

export function ArchiveView({ roverGender, tab, onTabChange }: { roverGender: 'male' | 'female'; tab: ArchiveTab; onTabChange: (tab: ArchiveTab) => void }) {
  const [featuredCharacterId, setFeaturedCharacterId] = useState('1506')
  const [query, setQuery] = useState('')
  const [rarities, setRarities] = useState<number[]>(() => rarityOptionsFor(tab))
  const [categories, setCategories] = useState<string[]>(() => categoryOptionsFor(tab))
  const [selectedWeaponTypes, setSelectedWeaponTypes] = useState<string[]>(weaponTypes)
  const [sonata, setSonata] = useState('all')
  const [sort, setSort] = useState<SortMode>(() => tab === 'sonatas' ? 'release-order' : 'name-asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)
  const [activeDetail, setActiveDetail] = useState<ArchiveDetail | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const detailTriggerRef = useRef<HTMLButtonElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const categoryOptions = categoryOptionsFor(tab)
  const rarityOptions = rarityOptionsFor(tab)
  const currentTab = tabs.find((item) => item.id === tab) ?? tabs[0]
  const sortOptions = sortOptionsFor(tab)
  const featuredElement = characterCatalog.find((item) => item.id === featuredCharacterId)?.element ?? 'Spectro'
  const featuredElementIcon = generatedSonataIconSources[elementSonatas[featuredElement]]

  useEffect(() => { void getSettings().then((settings) => setFeaturedCharacterId((settings as typeof settings & { homeFeaturedCharacterId?: string }).homeFeaturedCharacterId ?? '1506')) }, [])

  useEffect(() => {
    setQuery('')
    setRarities(rarityOptionsFor(tab))
    setCategories(categoryOptionsFor(tab))
    setSelectedWeaponTypes(weaponTypes)
    setSonata('all')
    setSort(tab === 'sonatas' ? 'release-order' : 'name-asc')
    setSortOpen(false)
    setVisibleLimit(PAGE_SIZE)
    setActiveDetail(null)
  }, [tab])

  useEffect(() => setVisibleLimit(PAGE_SIZE), [deferredQuery, rarities, categories, selectedWeaponTypes, sonata, sort])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const results = useMemo(() => {
    const includesQuery = (text: string) => !deferredQuery || text.toLowerCase().includes(deferredQuery)
    const includesRarity = (rarity: number) => rarities.includes(rarity)
    const includesCategory = (category: string) => categories.includes(category)
    const byName = <T extends { name: string }>(items: T[]) => sort === 'release-order' ? items : [...items].sort((a, b) => {
      if (sort === 'name-desc') return b.name.localeCompare(a.name)
      if (sort === 'rarity-desc' && 'rarity' in a && 'rarity' in b) return Number(b.rarity) - Number(a.rarity) || a.name.localeCompare(b.name)
      if (sort === 'cost-desc' && 'cost' in a && 'cost' in b) return Number(b.cost) - Number(a.cost) || a.name.localeCompare(b.name)
      return a.name.localeCompare(b.name)
    })

    if (tab === 'characters') return byName(characterCatalog.filter((item) => isSelectedGenderVariant(item, roverGender) && includesQuery(item.name) && includesRarity(item.rarity) && includesCategory(item.element)))
    if (tab === 'weapons') return byName(weaponCatalog.filter((item) => includesQuery(item.name) && includesRarity(item.rarity) && includesCategory(item.secondaryStat) && selectedWeaponTypes.includes(item.type)))
    if (tab === 'sonatas') return byName(sonataCatalog.filter((item) => includesQuery(item.name)))
    return byName(echoCatalog.filter((item) => includesQuery(item.name) && includesCategory(`${item.cost} cost`) && (sonata === 'all' || item.sonatas.includes(sonata))))
  }, [categories, deferredQuery, rarities, roverGender, selectedWeaponTypes, sonata, sort, tab])

  const visibleResults = tab === 'characters' || tab === 'weapons' ? results : results.slice(0, visibleLimit)
  const hasFilters = Boolean(query) || rarities.length !== rarityOptions.length || categories.length !== categoryOptions.length || selectedWeaponTypes.length !== weaponTypes.length || sonata !== 'all'
  const clearFilters = () => {
    setQuery('')
    setRarities(rarityOptionsFor(tab))
    setCategories(categoryOptionsFor(tab))
    setSelectedWeaponTypes(weaponTypes)
    setSonata('all')
    searchRef.current?.focus()
  }
  const openDetail = (detail: ArchiveDetail, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger
    setActiveDetail(detail)
  }
  const closeDetail = () => {
    setActiveDetail(null)
    requestAnimationFrame(() => detailTriggerRef.current?.focus())
  }

  return <section className="archive-view archive-browser">
    <PageHeader eyebrow="Discover Wuthering Waves" title="Archive" description="Pick a category and start exploring." />

    <nav className="archive-section-tabs" aria-label="Archive categories">
      {tabs.map((item) => <button type="button" aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} onClick={() => onTabChange(item.id)} key={item.id}>
        <i><img src={item.id === 'sonatas' ? featuredElementIcon : item.iconSource} alt=""/></i><strong>{item.label}</strong><b>{item.count}</b>
      </button>)}
    </nav>

    <section className="archive-controls" aria-label={`${currentTab.label} filters`}>
      <div className={`archive-toolbar-row archive-toolbar-${tab}`}>
        <label className="archive-search"><Icon name="scan"/><input ref={searchRef} aria-label={`Search ${currentTab.label}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${currentTab.label.toLowerCase()}`}/>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}<kbd>Ctrl K</kbd></label>
        <div className={`archive-sort${sortOpen ? ' open' : ''}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSortOpen(false) }} onKeyDown={(event) => { if (event.key === 'Escape') { setSortOpen(false); event.currentTarget.querySelector<HTMLButtonElement>('.archive-sort-trigger')?.focus() } }}>
          <span>Sort</span><div className="archive-sort-picker">
            <button type="button" className="archive-sort-trigger" aria-label="Sort archive" aria-haspopup="true" aria-expanded={sortOpen} onClick={() => setSortOpen((open) => !open)}><b>{sortOptions.find((option) => option.value === sort)?.label}</b><strong aria-hidden="true">⌄</strong></button>
            {sortOpen && <div className="archive-sort-menu" aria-label="Archive sort options">{sortOptions.map((option) => <button type="button" aria-pressed={sort === option.value} className={sort === option.value ? 'active' : ''} onClick={() => { setSort(option.value); setSortOpen(false) }} key={option.value}><span>{option.label}</span><i aria-hidden="true">{sort === option.value ? '✓' : ''}</i></button>)}</div>}
          </div>
        </div>
      {tab !== 'sonatas' && <>
        {tab !== 'echoes' && <FilterChips label="Rarity" hideLabel values={rarityOptions} selected={rarities} onChange={setRarities} renderValue={(value) => `${value} ★`}/>}
        {tab === 'characters' && <FilterChips
          label="Element"
          hideLabel
          values={categoryOptions}
          selected={categories}
          onChange={setCategories}
          renderValue={(value) => <ElementFilterIcon element={value}/>}
        />}
        {tab === 'weapons' && <FilterChips label="Weapon type" hideLabel values={weaponTypes} selected={selectedWeaponTypes} onChange={setSelectedWeaponTypes}/>}
        {tab === 'weapons' && <FilterChips label="Secondary stat" hideLabel values={categoryOptions} selected={categories} onChange={setCategories}/>}
        {tab === 'echoes' && <SonataPicker id="archive-sonata-filter" value={sonata} onChange={setSonata} allowAll/>}
        {tab === 'echoes' && <FilterChips label="Cost" hideLabel values={categoryOptions} selected={categories} onChange={setCategories}/>}
      </>}
      </div>
      <div className="archive-result-bar" aria-live="polite"><span><strong>{results.length}</strong> {results.length === 1 ? 'entry' : 'entries'} found</span>{hasFilters && <button type="button" className="text-button" onClick={clearFilters}>Reset filters</button>}</div>
    </section>

    {results.length === 0 && <section className="archive-empty"><span aria-hidden="true">⌕</span><h2>No matches</h2><button type="button" className="secondary" onClick={clearFilters}>Reset filters</button></section>}

    {tab === 'characters' && <div className="archive-results-grid archive-character-grid">{(visibleResults as typeof characterCatalog).map((item) => <button type="button" className="archive-entry-card archive-character-card" aria-haspopup="dialog" onClick={(event) => openDetail({ kind: 'character', item }, event.currentTarget)} key={item.id}><div className="archive-entry-art"><CatalogImage src={item.iconSourceUrl} alt={item.name}/></div><div className="archive-entry-copy"><div><h2>{item.name}</h2><ElementIcon element={item.element}/></div><p>{item.title}</p><footer><span>{item.weaponType}</span>{tbaSections('character', item.id).length > 0 && <em className="archive-tba">TBA</em>}<b aria-label={`${item.rarity} stars`}>{'★'.repeat(item.rarity)}</b></footer></div></button>)}</div>}
    {tab === 'weapons' && <div className="archive-results-grid archive-weapon-grid">{(visibleResults as typeof weaponCatalog).map((item) => <button type="button" className="archive-entry-card archive-weapon-card" aria-haspopup="dialog" onClick={(event) => openDetail({ kind: 'weapon', item }, event.currentTarget)} key={item.id}><div className="archive-entry-art"><CatalogImage src={item.iconSourceUrl} alt={item.name}/></div><div className="archive-entry-copy"><h2>{item.name}</h2><p>{item.type}</p><dl><div><dt><img className="weapon-stat-icon" src={statIconSource('atk')} alt="" aria-hidden="true"/>ATK</dt><dd>{item.baseAtk}</dd></div><div><dt><img className="weapon-stat-icon" src={weaponStatIconSource(item.secondaryStat)} alt="" aria-hidden="true"/>{item.secondaryStat}</dt><dd>{item.secondaryStatValue}</dd></div></dl><footer>{tbaSections('weapon', item.id).length > 0 && <em className="archive-tba">TBA</em>}<b aria-label={`${item.rarity} stars`}>{'★'.repeat(item.rarity)}</b></footer></div></button>)}</div>}
    {tab === 'sonatas' && <div className="archive-results-grid archive-sonata-grid">{(visibleResults as typeof sonataCatalog).map((item) => <article className="archive-sonata-card" key={item.id}><header><span><CatalogImage src={generatedSonataIconSources[item.name]} alt=""/></span><div><h2>{item.name}</h2><p>{item.echoCount} compatible Echoes</p></div></header><div className="archive-sonata-effects">{item.effects.map((effect) => <div key={effect.pieces}><b>{effect.pieces}<small>PC</small></b><p>{effect.description}</p></div>)}</div></article>)}</div>}
    {tab === 'echoes' && <div className="archive-results-grid archive-echo-grid">{(visibleResults as typeof echoCatalog).map((item) => <button type="button" className="archive-entry-card archive-echo-card" aria-haspopup="dialog" onClick={(event) => openDetail({ kind: 'echo', item }, event.currentTarget)} key={item.id}><div className="archive-entry-art"><CatalogImage src={item.iconSourceUrl} alt={item.name}/><b className={`archive-cost cost-${item.cost}`}>{item.cost}</b></div><div className="archive-entry-copy"><h2>{item.name}</h2><div className="archive-echo-sonatas" aria-label={`Sonatas: ${item.sonatas.join(', ')}`}>{item.sonatas.map((name) => <img src={generatedSonataIconSources[name]} alt="" title={name} key={name}/>)}</div><footer><span>{item.cost} cost</span>{tbaSections('echo', item.id).length > 0 && <em className="archive-tba">TBA</em>}</footer></div></button>)}</div>}

    {tab !== 'characters' && tab !== 'weapons' && visibleLimit < results.length && <div className="archive-load-more"><p>Showing {visibleResults.length} of {results.length}</p><button type="button" className="secondary" onClick={() => setVisibleLimit((value) => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, results.length - visibleLimit)} more</button></div>}
    <p className="archive-credit">Catalog and artwork from Nanoka 3.7. Select a card for details.</p>
    {activeDetail && <ArchiveDetailDialog detail={activeDetail} onClose={closeDetail}/>}
  </section>
}
