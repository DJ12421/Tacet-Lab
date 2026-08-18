import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { echoCatalog } from '../game-data/echoes'
import { generatedSonataCatalog as sonataCatalog, generatedSonataIconSources } from '../game-data/sonatas.generated'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { ElementFilterIcon, FilterChips, Icon, PageHeader } from './components'
import { SonataPicker } from './SonataPicker'

type ArchiveTab = 'characters' | 'weapons' | 'sonatas' | 'echoes'
type SortMode = 'release-order' | 'name-asc' | 'name-desc' | 'rarity-desc' | 'cost-desc'

const PAGE_SIZE = 48
const tabs: Array<{ id: ArchiveTab; label: string; count: number; icon: Parameters<typeof Icon>[0]['name'] }> = [
  { id: 'characters', label: 'Characters', count: characterCatalog.length, icon: 'team' },
  { id: 'weapons', label: 'Weapons', count: weaponCatalog.length, icon: 'build' },
  { id: 'sonatas', label: 'Sonatas', count: sonataCatalog.length, icon: 'optimize' },
  { id: 'echoes', label: 'Echoes', count: echoCatalog.length, icon: 'echo' }
]
const weaponTypes = [...new Set(weaponCatalog.map((item) => item.type))]
const characterElements = [...new Set(characterCatalog.map((item) => item.element))]
const weaponSecondaryStats = [...new Set(weaponCatalog.map((item) => item.secondaryStat))].filter((value) => value !== 'Unreleased')
const echoCosts = ['1-cost', '3-cost', '4-cost']
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

export function ArchiveView({ roverGender, tab, onTabChange }: { roverGender: 'male' | 'female'; tab: ArchiveTab; onTabChange: (tab: ArchiveTab) => void }) {
  const [query, setQuery] = useState('')
  const [rarities, setRarities] = useState<number[]>(() => rarityOptionsFor(tab))
  const [categories, setCategories] = useState<string[]>(() => categoryOptionsFor(tab))
  const [selectedWeaponTypes, setSelectedWeaponTypes] = useState<string[]>(weaponTypes)
  const [sonata, setSonata] = useState('all')
  const [sort, setSort] = useState<SortMode>(() => tab === 'sonatas' ? 'release-order' : 'name-asc')
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)
  const searchRef = useRef<HTMLInputElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const categoryOptions = categoryOptionsFor(tab)
  const rarityOptions = rarityOptionsFor(tab)
  const currentTab = tabs.find((item) => item.id === tab) ?? tabs[0]

  useEffect(() => {
    setQuery('')
    setRarities(rarityOptionsFor(tab))
    setCategories(categoryOptionsFor(tab))
    setSelectedWeaponTypes(weaponTypes)
    setSonata('all')
    setSort(tab === 'sonatas' ? 'release-order' : 'name-asc')
    setVisibleLimit(PAGE_SIZE)
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
    return byName(echoCatalog.filter((item) => includesQuery(`${item.name} ${item.sonatas.join(' ')}`) && includesCategory(`${item.cost}-cost`) && (sonata === 'all' || item.sonatas.includes(sonata))))
  }, [categories, deferredQuery, rarities, roverGender, selectedWeaponTypes, sonata, sort, tab])

  const visibleResults = results.slice(0, visibleLimit)
  const hasFilters = Boolean(query) || rarities.length !== rarityOptions.length || categories.length !== categoryOptions.length || selectedWeaponTypes.length !== weaponTypes.length || sonata !== 'all'
  const clearFilters = () => {
    setQuery('')
    setRarities(rarityOptionsFor(tab))
    setCategories(categoryOptionsFor(tab))
    setSelectedWeaponTypes(weaponTypes)
    setSonata('all')
    searchRef.current?.focus()
  }

  return <section className="archive-view archive-browser">
    <PageHeader eyebrow="Discover Wuthering Waves" title="Archive" description="Pick a category and start exploring." />

    <nav className="archive-section-tabs" aria-label="Archive categories">
      {tabs.map((item) => <button type="button" aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} onClick={() => onTabChange(item.id)} key={item.id}>
        <i><Icon name={item.icon}/></i><strong>{item.label}</strong><b>{item.count}</b>
      </button>)}
    </nav>

    <section className="archive-controls" aria-label={`${currentTab.label} filters`}>
      <div className="archive-toolbar-row">
        <label className="archive-search"><Icon name="scan"/><input ref={searchRef} aria-label={`Search ${currentTab.label}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${currentTab.label.toLowerCase()}`}/>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}<kbd>Ctrl K</kbd></label>
        <label className="archive-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
          {tab === 'sonatas' && <option value="release-order">Release order</option>}
          <option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option>
          {(tab === 'characters' || tab === 'weapons') && <option value="rarity-desc">Highest rarity</option>}
          {tab === 'echoes' && <option value="cost-desc">Highest cost</option>}
        </select></label>
      {tab !== 'sonatas' && <>
        {tab !== 'echoes' && <FilterChips label="Rarity" values={rarityOptions} selected={rarities} onChange={setRarities} renderValue={(value) => `${value} ★`}/>} 
        {tab === 'characters' && <FilterChips label="Element" values={categoryOptions} selected={categories} onChange={setCategories} renderValue={(value) => <ElementFilterIcon element={value}/>}/>} 
        {tab === 'weapons' && <FilterChips label="Weapon type" values={weaponTypes} selected={selectedWeaponTypes} onChange={setSelectedWeaponTypes}/>} 
        {tab === 'weapons' && <FilterChips label="Secondary stat" values={categoryOptions} selected={categories} onChange={setCategories}/>} 
        {tab === 'echoes' && <SonataPicker id="archive-sonata-filter" value={sonata} onChange={setSonata} allowAll/>}
        {tab === 'echoes' && <FilterChips label="Cost" values={categoryOptions} selected={categories} onChange={setCategories}/>} 
      </>}
      </div>
      <div className="archive-result-bar" aria-live="polite"><span><strong>{results.length}</strong> {results.length === 1 ? 'entry' : 'entries'} found</span>{hasFilters && <button type="button" className="text-button" onClick={clearFilters}>Reset filters</button>}</div>
    </section>

    {results.length === 0 && <section className="archive-empty"><span aria-hidden="true">⌕</span><h2>No matches</h2><button type="button" className="secondary" onClick={clearFilters}>Reset filters</button></section>}

    {tab === 'characters' && <div className="archive-results-grid archive-character-grid">{(visibleResults as typeof characterCatalog).map((item) => <a className="archive-entry-card archive-character-card" href={item.articleUrl} target="_blank" rel="noreferrer" key={item.id}><div className="archive-entry-art"><CatalogImage src={item.iconSourceUrl} alt={item.name}/><span className="archive-external" aria-hidden="true">↗</span></div><div className="archive-entry-copy"><div><h2>{item.name}</h2><ElementIcon element={item.element}/></div><p>{item.title}</p><footer><span>{item.weaponType}</span><b aria-label={`${item.rarity} stars`}>{'★'.repeat(item.rarity)}</b></footer></div></a>)}</div>}
    {tab === 'weapons' && <div className="archive-results-grid archive-weapon-grid">{(visibleResults as typeof weaponCatalog).map((item) => <a className="archive-entry-card archive-weapon-card" href={item.articleUrl} target="_blank" rel="noreferrer" key={item.id}><div className="archive-entry-art"><CatalogImage src={item.iconSourceUrl} alt={item.name}/><span className="archive-external" aria-hidden="true">↗</span></div><div className="archive-entry-copy"><h2>{item.name}</h2><p>{item.type}</p><dl><div><dt>ATK</dt><dd>{item.baseAtk}</dd></div><div><dt>{item.secondaryStat}</dt><dd>{item.secondaryStatValue}</dd></div></dl><footer><b aria-label={`${item.rarity} stars`}>{'★'.repeat(item.rarity)}</b></footer></div></a>)}</div>}
    {tab === 'sonatas' && <div className="archive-results-grid archive-sonata-grid">{(visibleResults as typeof sonataCatalog).map((item) => <article className="archive-sonata-card" key={item.id}><header><span><CatalogImage src={generatedSonataIconSources[item.name]} alt=""/></span><div><h2>{item.name}</h2><p>{item.echoCount} compatible Echoes</p></div></header><div className="archive-sonata-effects">{item.effects.map((effect) => <div key={effect.pieces}><b>{effect.pieces}<small>PC</small></b><p>{effect.description}</p></div>)}</div></article>)}</div>}
    {tab === 'echoes' && <div className="archive-results-grid archive-echo-grid">{(visibleResults as typeof echoCatalog).map((item) => <a className="archive-entry-card archive-echo-card" href={item.articleUrl} target="_blank" rel="noreferrer" key={item.id}><div className="archive-entry-art"><CatalogImage src={item.iconSourceUrl} alt={item.name}/><b className={`archive-cost cost-${item.cost}`}>{item.cost}</b><span className="archive-external" aria-hidden="true">↗</span></div><div className="archive-entry-copy"><h2>{item.name}</h2><p>{item.sonatas.join(' · ')}</p><footer><span>{item.cost} cost</span><b aria-label={`${Math.max(...(item.rarities ?? [1]))} stars`}>{'★'.repeat(Math.max(...(item.rarities ?? [1])))}</b></footer></div></a>)}</div>}

    {visibleLimit < results.length && <div className="archive-load-more"><p>Showing {visibleResults.length} of {results.length}</p><button type="button" className="secondary" onClick={() => setVisibleLimit((value) => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, results.length - visibleLimit)} more</button></div>}
    <p className="archive-credit">Catalog and artwork from Nanoka 3.6. Cards open Nanoka in a new tab.</p>
  </section>
}
