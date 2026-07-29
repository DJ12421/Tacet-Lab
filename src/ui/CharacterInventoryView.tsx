import { useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { characterCatalog, echoCatalog, weaponCatalog, type CharacterCatalogEntry } from '../game-data'
import { createLocalId } from '../domain/id'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { db } from '../storage/database'
import type { AppSettings, Build, Echo, OwnedCharacter, OwnedWeapon, Team } from '../domain/types'
import { Icon, Panel } from './components'
import { CharacterShowcase } from './CharacterShowcase'

const SKILLS = ['Basic', 'Skill', 'Forte', 'Liberation', 'Intro']
const isGenderVariant = (entry: CharacterCatalogEntry) => entry.gender !== null && characterCatalog.some((candidate) => candidate.id !== entry.id && candidate.name === entry.name && candidate.gender !== entry.gender)
const isSelectedGenderVariant = (entry: CharacterCatalogEntry, gender: 'male' | 'female') => !isGenderVariant(entry) || entry.gender === gender

function displayCatalog(catalogId: string, gender: 'male' | 'female') {
  const entry = characterCatalog.find((candidate) => candidate.id === catalogId)
  if (!entry || !isGenderVariant(entry)) return entry
  return characterCatalog.find((candidate) => candidate.name === entry.name && candidate.gender === gender) || entry
}

const skillsFor = (character: OwnedCharacter) => character.skillLevels?.length === 5 ? character.skillLevels : [1, 1, 1, 1, 1]

function Stars({ rarity }: { rarity: number }) {
  return <span className={rarity === 4 ? 'rarity-stars four-star' : 'rarity-stars'}>{'★'.repeat(rarity)}</span>
}

function Chips<T extends string | number>({ values, selected, label, onChange }: { values: T[]; selected: T | 'all'; label: string; onChange: (value: T | 'all') => void }) {
  return <div className="owned-chip-filter"><span>{label}</span><div className="filter-chips"><button className={selected === 'all' ? 'active' : ''} onClick={() => onChange('all')}>All</button>{values.map((value) => <button className={selected === value ? 'active' : ''} key={value} onClick={() => onChange(value)}>{typeof value === 'number' ? `${value} ★` : value}</button>)}</div></div>
}

function Picker({ title, query, setQuery, filters, children, onClose }: { title: string; query: string; setQuery: (value: string) => void; filters?: ReactNode; children: ReactNode; onClose: () => void }) {
  return createPortal(<div className="catalog-picker-backdrop character-catalog-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="catalog-picker" role="dialog" aria-modal="true" aria-label={title}><header><div><span className="eyebrow">Local inventory</span><h2>{title}</h2></div><button type="button" className="text-button" onClick={onClose}>Close</button></header><div className="catalog-picker-tools"><label className="search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`}/></label>{filters}</div><div className="catalog-picker-grid">{children}</div></section></div>, document.body)
}

function LoadoutSquare({ label, image, topLeft, bottomRight, className = '' }: { label: string; image?: string; topLeft?: string; bottomRight?: ReactNode; className?: string }) {
  return <div className={`character-loadout-square ${className}`} title={label}>{image ? <img src={image} alt=""/> : <span>+</span>}{topLeft && <b className="loadout-corner loadout-top-left">{topLeft}</b>}{bottomRight && <b className="loadout-corner loadout-bottom-right">{bottomRight}</b>}</div>
}

export interface CharacterInventoryProps {
  owned: OwnedCharacter[]
  weapons?: OwnedWeapon[]
  echoes?: Echo[]
  builds?: Build[]
  teams?: Team[]
  settings: AppSettings
  roverGender: 'male' | 'female'
  refresh: () => Promise<void>
}

export function CharacterInventory({ owned, weapons = [], echoes = [], builds = [], settings, roverGender, refresh }: CharacterInventoryProps) {
  const [query, setQuery] = useState('')
  const [element, setElement] = useState<string | 'all'>('all')
  const [rarity, setRarity] = useState<number | 'all'>('all')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerElement, setPickerElement] = useState<string | 'all'>('all')
  const [pickerRarity, setPickerRarity] = useState<number | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const deferred = useDeferredValue(query.toLowerCase())
  const rows = useMemo(() => {
    const seenRovers = new Set<string>()
    return owned.flatMap((item) => {
      const catalog = displayCatalog(item.catalogId, roverGender)
      if (!catalog) return []
      if (isGenderVariant(catalog)) {
        if (seenRovers.has(catalog.name)) return []
        seenRovers.add(catalog.name)
      }
      return [{ item, catalog }]
    })
  }, [owned, roverGender])
  const visible = rows
    .filter(({ catalog }) => (element === 'all' || catalog.element === element) && (rarity === 'all' || catalog.rarity === rarity) && `${catalog.name} ${catalog.element} ${catalog.weaponType}`.toLowerCase().includes(deferred))
    .sort((left, right) => Number(Boolean(right.item.favorite)) - Number(Boolean(left.item.favorite)) || left.catalog.name.localeCompare(right.catalog.name))
  const addCatalog = characterCatalog.filter((entry) => isSelectedGenderVariant(entry, roverGender))
  const available = addCatalog.filter((entry) => !owned.some((item) => displayCatalog(item.catalogId, roverGender)?.name === entry.name)
    && (pickerElement === 'all' || entry.element === pickerElement)
    && (pickerRarity === 'all' || entry.rarity === pickerRarity)
    && `${entry.name} ${entry.element} ${entry.weaponType}`.toLowerCase().includes(pickerQuery.toLowerCase()))
  const add = async (catalogId: string) => {
    await db.characters.add({ id: createLocalId(), catalogId, level: 1, sequence: 0, locked: false, favorite: false, skillLevels: [1, 1, 1, 1, 1], createdAt: Date.now() })
    setPickerOpen(false)
    await refresh()
  }
  const selected = rows.find(({ item }) => item.id === selectedId)

  if (selected) return <CharacterShowcase character={selected.item} catalog={selected.catalog} weapons={weapons} echoes={echoes} builds={builds} settings={settings} refresh={refresh} onBack={() => setSelectedId(null)}/>

  return <>
    <Panel className="owned-add"><div><span className="eyebrow">Character roster</span><strong>Favorites stay at the top. Select a character to view their full loadout.</strong></div><button type="button" className="primary" onClick={() => setPickerOpen(true)}><Icon name="plus"/>Add character</button></Panel>
    <Panel className="owned-filter chip-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search characters..."/></label><Chips label="Element" values={[...new Set(addCatalog.map((item) => item.element))]} selected={element} onChange={setElement}/><Chips label="Rarity" values={[5, 4]} selected={rarity} onChange={setRarity}/><span>{visible.length} / {owned.length}</span></Panel>
    <div className="character-candy-grid">{visible.map(({ item, catalog }) => {
      const build = builds.find((entry) => entry.resonatorId === item.catalogId)
      const weapon = weapons.find((entry) => entry.id === build?.weaponId)
      const weaponEntry = weaponCatalog.find((entry) => entry.id === weapon?.catalogId)
      const equipped = build?.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)) || []
      return <article className={`character-candy-card rarity-${catalog.rarity}`} key={item.id} role="button" tabIndex={0} onClick={() => setSelectedId(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedId(item.id) }}>
        <button className={item.favorite ? 'favorite active' : 'favorite'} aria-label="Favorite character" onClick={async (event) => { event.stopPropagation(); await db.characters.update(item.id, { favorite: !item.favorite }); await refresh() }}>♥</button>
        <div className="candy-character-art"><img src={catalog.iconSourceUrl} alt=""/></div>
        <div className="candy-character-copy"><header><div className={catalog.titleCardSourceUrl ? 'candy-title-card has-title-card' : 'candy-title-card'}>{catalog.titleCardSourceUrl && <img src={catalog.titleCardSourceUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement?.classList.remove('has-title-card') }}/>}<h2>{catalog.name}</h2></div><p>{catalog.element} · {catalog.weaponType} · <Stars rarity={catalog.rarity}/></p></header><div className="candy-level"><strong>Lv. {item.level}</strong><b>S{item.sequence}</b></div><div className="candy-skills">{skillsFor(item).map((level, index) => <span key={SKILLS[index]} title={`${SKILLS[index]} Lv. ${level}`}><i>{level}</i></span>)}</div></div>
        <div className="candy-loadout"><LoadoutSquare className={weaponEntry ? `rarity-${weaponEntry.rarity}` : ''} label={weaponEntry?.name || 'Weapon'} image={weaponEntry?.iconSourceUrl} topLeft={weapon ? `${weapon.level}/90` : undefined} bottomRight={weapon ? `R${weapon.rank}` : undefined}/>{Array.from({ length: 5 }, (_, index) => { const echo = equipped[index]; const sonataIcon = echo ? generatedSonataIconSources[echo.sonata] : undefined; return <LoadoutSquare key={index} label={echo?.name || `Echo ${index + 1}`} image={echo ? echoCatalog.find((entry) => entry.name === echo.name)?.iconSourceUrl : undefined} topLeft={echo ? `+${echo.level}` : undefined} bottomRight={sonataIcon ? <img className="loadout-sonata-icon" src={sonataIcon} alt={echo?.sonata || ''}/> : undefined}/> })}</div>
      </article>
    })}</div>
    {pickerOpen && <Picker title="Choose a character" query={pickerQuery} setQuery={setPickerQuery} filters={<div className="catalog-picker-filters"><Chips label="Element" values={[...new Set(addCatalog.map((item) => item.element))]} selected={pickerElement} onChange={setPickerElement}/><Chips label="Rarity" values={[5, 4]} selected={pickerRarity} onChange={setPickerRarity}/></div>} onClose={() => setPickerOpen(false)}>{available.map((entry) => <button className={`catalog-choice character-choice rarity-${entry.rarity}`} key={entry.id} onClick={() => void add(entry.id)}><img src={entry.iconSourceUrl} alt=""/><span><strong>{entry.name}</strong><small>{entry.element} · {entry.weaponType}</small><Stars rarity={entry.rarity}/></span></button>)}</Picker>}
  </>
}
