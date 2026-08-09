import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { echoCatalog } from '../game-data/echoes'
import { generatedSonataCatalog as sonataCatalog } from '../game-data/sonatas.generated'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { ElementFilterIcon, FilterChips, Icon, PageHeader, Panel } from './components'
import { SonataPicker } from './SonataPicker'

type ArchiveTab = 'characters' | 'weapons' | 'sonatas' | 'echoes'

const tabs: Array<{ id: ArchiveTab; label: string; count: number }> = [
  { id: 'characters', label: 'Characters', count: characterCatalog.length },
  { id: 'weapons', label: 'Weapons', count: weaponCatalog.length },
  { id: 'sonatas', label: 'Sonatas', count: sonataCatalog.length },
  { id: 'echoes', label: 'Echoes', count: echoCatalog.length }
]
const weaponTypes = [...new Set(weaponCatalog.map((item) => item.type))]
const characterElements = [...new Set(characterCatalog.map((item) => item.element))]
const weaponSecondaryStats = [...new Set(weaponCatalog.map((item) => item.secondaryStat))].filter((value) => value !== 'Unreleased')
const echoCosts = ['1-cost', '3-cost', '4-cost']
const characterRarities = [5, 4]
const weaponRarities = [5, 4, 3, 2, 1]
const categoryOptionsFor = (tab: ArchiveTab) => tab === 'characters' ? characterElements : tab === 'weapons' ? weaponSecondaryStats : tab === 'echoes' ? echoCosts : []
const rarityOptionsFor = (tab: ArchiveTab) => tab === 'characters' ? characterRarities : weaponRarities
const isSelectedGenderVariant = (entry: (typeof characterCatalog)[number], gender: 'male' | 'female') =>
  !entry.gender || !characterCatalog.some((candidate) => candidate.id !== entry.id && candidate.name === entry.name && candidate.gender !== entry.gender) || entry.gender === gender

const elementSonatas: Record<string, string> = {
  Glacio: sonataCatalog[0].name,
  Fusion: sonataCatalog[1].name,
  Electro: sonataCatalog[2].name,
  Aero: sonataCatalog[3].name,
  Spectro: sonataCatalog[4].name,
  Havoc: sonataCatalog[5].name
}

function ElementIcon({ element }: { element: string }) {
  const sonata = elementSonatas[element]
  return <span className={`element-icon element-${element.toLowerCase()}`} title={element}><img src={generatedSonataIconSources[sonata]} alt=""/></span>
}

export function ArchiveView({ roverGender, tab, onTabChange }: { roverGender: 'male' | 'female'; tab: ArchiveTab; onTabChange: (tab: ArchiveTab) => void }) {
  const [query, setQuery] = useState('')
  const [rarities, setRarities] = useState<number[]>(() => rarityOptionsFor(tab))
  const [categories, setCategories] = useState<string[]>(() => categoryOptionsFor(tab))
  const [selectedWeaponTypes, setSelectedWeaponTypes] = useState<string[]>(weaponTypes)
  const [sonata, setSonata] = useState('all')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())

  const categoryOptions = useMemo(() => categoryOptionsFor(tab), [tab])
  const rarityOptions = rarityOptionsFor(tab)
  useEffect(() => {
    setRarities(rarityOptionsFor(tab))
    setCategories(categoryOptionsFor(tab))
    setSelectedWeaponTypes(weaponTypes)
    setSonata('all')
  }, [tab])

  const changeTab = (next: ArchiveTab) => { onTabChange(next); setQuery(''); setRarities(rarityOptionsFor(next)); setCategories(categoryOptionsFor(next)); setSelectedWeaponTypes(weaponTypes); setSonata('all') }
  const matches = (text: string, itemRarity?: number, itemCategory?: string) =>
    (!deferredQuery || text.toLowerCase().includes(deferredQuery)) &&
    (itemRarity === undefined || rarities.includes(itemRarity)) &&
    (itemCategory === undefined || categories.includes(itemCategory))

  const characters = characterCatalog.filter((item) => isSelectedGenderVariant(item, roverGender) && matches(`${item.name} ${item.nickname} ${item.element} ${item.weaponType}`, item.rarity, item.element))
  const weapons = weaponCatalog.filter((item) => matches(`${item.name} ${item.type} ${item.secondaryStat}`, item.rarity, item.secondaryStat) && selectedWeaponTypes.includes(item.type))
  const sonatas = sonataCatalog.filter((item) => matches(item.name))
  const echoes = echoCatalog.filter((item) => matches(`${item.name} ${item.sonatas.join(' ')}`, undefined, `${item.cost}-cost`) && (sonata === 'all' || item.sonatas.includes(sonata)))
  const visibleCount = tab === 'characters' ? characters.length : tab === 'weapons' ? weapons.length : tab === 'sonatas' ? sonatas.length : echoes.length

  return <section className="archive-view">
    <PageHeader eyebrow="Database / Nanoka 3.5" title="Wuthering Waves Archive" description="Browse the complete imported character, weapon, Sonata, and Echo catalogs." />
    <div className="archive-tabs" role="tablist">{tabs.map((item) => <button role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => changeTab(item.id)} key={item.id}><span>{item.label}</span><b>{item.count}</b></button>)}</div>
    <Panel className="archive-toolbar chip-toolbar"><label className="search"><Icon name="scan"/><input aria-label="Search archive" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tab}...`}/></label>
      {tab !== 'sonatas' && tab !== 'echoes' && <FilterChips label="Rarity" values={rarityOptions} selected={rarities} onChange={setRarities} renderValue={(value) => `${value} ★`}/>}
      {tab === 'characters' && <FilterChips label="Element" values={categoryOptions} selected={categories} onChange={setCategories} renderValue={(value) => <ElementFilterIcon element={value}/>}/>}
      {tab === 'weapons' && <FilterChips label="Weapon type" values={weaponTypes} selected={selectedWeaponTypes} onChange={setSelectedWeaponTypes}/>}
      {tab === 'weapons' && <FilterChips label="Secondary stat" values={categoryOptions} selected={categories} onChange={setCategories}/>}
      {tab === 'echoes' && <SonataPicker id="archive-sonata-filter" value={sonata} onChange={setSonata} allowAll/>}
      {tab === 'echoes' && <FilterChips label="Cost" values={categoryOptions} selected={categories} onChange={setCategories}/>}
      <span className="archive-count">{visibleCount} shown</span>
    </Panel>

    {tab === 'characters' && <div className="catalog-grid characters">{characters.map((item) => <a className="catalog-card character" href={item.articleUrl} target="_blank" rel="noreferrer" key={item.id}><div className="catalog-art"><img src={item.iconSourceUrl} alt=""/></div><div className="catalog-copy"><div className="character-name"><h2>{item.name}</h2><ElementIcon element={item.element}/></div><p>{item.title}</p><footer><span>{item.element}</span><span>{item.weaponType}</span><b>{'★'.repeat(item.rarity)}</b></footer></div></a>)}</div>}
    {tab === 'weapons' && <div className="catalog-grid weapons">{weapons.map((item) => <a className="catalog-card weapon" href={item.articleUrl} target="_blank" rel="noreferrer" key={item.id}><div className="catalog-art"><img src={item.iconSourceUrl} alt=""/></div><div className="catalog-copy"><h2>{item.name}</h2><p>{item.type}</p><footer><span>ATK <strong>{item.baseAtk}</strong></span><span>{item.secondaryStat} <strong>{item.secondaryStatValue}</strong></span><b>{'★'.repeat(item.rarity)}</b></footer></div></a>)}</div>}
    {tab === 'sonatas' && <div className="catalog-grid sonatas">{sonatas.map((item) => <article className="catalog-card sonata" key={item.id}><div className="sonata-heading"><div className="sonata-mark"><img src={generatedSonataIconSources[item.name]} alt={`${item.name} icon`}/></div><div><h2>{item.name}</h2><span>{item.echoCount} compatible Echoes</span></div></div><div className="sonata-effect-preview">{item.effects.map((effect) => <div key={effect.pieces}><b>{effect.pieces}-piece</b><p>{effect.description}</p></div>)}</div><details className="sonata-effects"><summary aria-label={`Show full ${item.name} set effects`}/><div className="sonata-effect-list">{item.effects.map((effect) => <div key={effect.pieces}><b>{effect.pieces}-piece</b><p>{effect.description}</p></div>)}</div></details></article>)}</div>}
    {tab === 'echoes' && <div className="catalog-grid echoes">{echoes.map((item) => <a className="catalog-card echo-catalog" href={item.articleUrl} target="_blank" rel="noreferrer" key={item.id}><div className="catalog-art"><img src={item.iconSourceUrl} alt=""/><span className={`cost cost-${item.cost}`}>{item.cost}</span></div><div className="catalog-copy"><h2>{item.name}</h2><p>{item.sonatas.join(' · ')}</p><footer><span>{item.cost} cost</span><b>{'★'.repeat(Math.max(...(item.rarities ?? [1])))}</b></footer></div></a>)}</div>}
    {visibleCount === 0 && <Panel className="empty-state"><h2>No archive entries match</h2><p>Clear a filter or try a broader search.</p></Panel>}
    <p className="archive-credit">Catalog metadata and artwork imported from Nanoka 3.5 with permission. Cards open the matching Nanoka entry.</p>
  </section>
}
