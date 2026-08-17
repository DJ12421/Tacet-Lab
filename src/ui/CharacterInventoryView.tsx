import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { characterCatalog, echoCatalog, weaponCatalog, type CharacterCatalogEntry } from '../game-data'
import { createLocalId } from '../domain/id'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { db } from '../storage/database'
import type { AppSettings, Build, Echo, EquippedLoadout, OwnedCharacter, OwnedWeapon, Team, TheorycraftBuild } from '../domain/types'
import { ElementFilterIcon, FilterChips, Icon, Panel } from './components'
import { CharacterShowcase } from './CharacterShowcase'

const SKILLS = ['Basic', 'Skill', 'Forte', 'Liberation', 'Intro']
const characterElements = [...new Set(characterCatalog.map((item) => item.element))]
const characterRarities = [5, 4]
const weaponCatalogById = new Map(weaponCatalog.map((entry) => [entry.id, entry]))
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

export function Picker({ title, query, setQuery, filters, children, onClose }: { title: string; query: string; setQuery: (value: string) => void; filters?: ReactNode; children: ReactNode; onClose: () => void }) {
  return createPortal(<div className="catalog-picker-backdrop character-catalog-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="catalog-picker" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" className="text-button" onClick={onClose}>Close</button></header><div className="catalog-picker-tools"><label className="search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name..."/></label>{filters}</div><div className="catalog-picker-grid">{children}</div></section></div>, document.body)
}

function LoadoutSquare({ label, image, topLeft, bottomRight, className = '' }: { label: string; image?: string; topLeft?: string; bottomRight?: ReactNode; className?: string }) {
  return <div className={`character-loadout-square ${className}`} title={label}>{image ? <img src={image} alt="" loading="lazy" decoding="async"/> : <span>+</span>}{topLeft && <b className="loadout-corner loadout-top-left">{topLeft}</b>}{bottomRight && <b className="loadout-corner loadout-bottom-right">{bottomRight}</b>}</div>
}

export interface CharacterInventoryProps {
  owned: OwnedCharacter[]
  weapons?: OwnedWeapon[]
  echoes?: Echo[]
  builds?: Build[]
  equippedLoadouts?: EquippedLoadout[]
  theorycraftBuilds?: TheorycraftBuild[]
  teams?: Team[]
  settings: AppSettings
  roverGender: 'male' | 'female'
  refresh: () => Promise<void>
  characterIdentifier?: string
  onCharacterChange?: (character: { id: string; name: string } | null) => void
}

const characterRouteKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

export function CharacterInventory({ owned, weapons = [], echoes = [], builds = [], equippedLoadouts = [], theorycraftBuilds = [], settings, roverGender, refresh, characterIdentifier, onCharacterChange }: CharacterInventoryProps) {
  const [query, setQuery] = useState('')
  const [elements, setElements] = useState<string[]>(characterElements)
  const [rarities, setRarities] = useState<number[]>(characterRarities)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerElements, setPickerElements] = useState<string[]>(characterElements)
  const [pickerRarities, setPickerRarities] = useState<number[]>(characterRarities)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const deferred = useDeferredValue(query.toLowerCase())
  const rows = useMemo(() => {
    const seenRovers = new Set<string>()
    const loadoutByCharacter = new Map(equippedLoadouts.map((entry) => [entry.characterId, entry]))
    const weaponById = new Map(weapons.map((entry) => [entry.id, entry]))
    const echoById = new Map(echoes.map((entry) => [entry.id, entry]))
    return owned.flatMap((item) => {
      const catalog = displayCatalog(item.catalogId, roverGender)
      if (!catalog) return []
      if (isGenderVariant(catalog)) {
        if (seenRovers.has(catalog.name)) return []
        seenRovers.add(catalog.name)
      }
      const loadout = loadoutByCharacter.get(item.id)
      const weapon = loadout?.weaponId ? weaponById.get(loadout.weaponId) : undefined
      const equipped = loadout?.echoIds.flatMap((id) => {
        const echo = echoById.get(id)
        return echo ? [echo] : []
      }) ?? []
      return [{ item, catalog, weapon, weaponEntry: weapon ? weaponCatalogById.get(weapon.catalogId) : undefined, equipped }]
    })
  }, [echoes, equippedLoadouts, owned, roverGender, weapons])
  useEffect(() => {
    if (!characterIdentifier) {
      setSelectedId(null)
      return
    }
    const routeKey = characterRouteKey(characterIdentifier)
    const match = rows.find(({ catalog }) => catalog.id === characterIdentifier || characterRouteKey(catalog.name) === routeKey)
    setSelectedId(match?.item.id ?? null)
  }, [characterIdentifier, rows])
  const visible = useMemo(() => rows
    .filter(({ catalog }) => elements.includes(catalog.element) && rarities.includes(catalog.rarity) && `${catalog.name} ${catalog.element} ${catalog.weaponType}`.toLowerCase().includes(deferred))
    .sort((left, right) => Number(Boolean(right.item.favorite)) - Number(Boolean(left.item.favorite)) || left.catalog.name.localeCompare(right.catalog.name)), [deferred, elements, rarities, rows])
  const available = useMemo(() => {
    const ownedNames = new Set(owned.flatMap((item) => {
      const catalog = displayCatalog(item.catalogId, roverGender)
      return catalog ? [catalog.name] : []
    }))
    const normalizedQuery = pickerQuery.toLowerCase()
    return characterCatalog.filter((entry) => isSelectedGenderVariant(entry, roverGender)
      && !ownedNames.has(entry.name)
      && pickerElements.includes(entry.element)
      && pickerRarities.includes(entry.rarity)
      && `${entry.name} ${entry.element} ${entry.weaponType}`.toLowerCase().includes(normalizedQuery))
  }, [owned, pickerElements, pickerQuery, pickerRarities, roverGender])
  const add = async (catalogId: string) => {
    const id = createLocalId()
    await db.transaction('rw', [db.characters, db.equippedLoadouts], async () => {
      await db.characters.add({ id, catalogId, level: 1, sequence: 0, locked: false, favorite: false, skillLevels: [1, 1, 1, 1, 1], createdAt: Date.now() })
      await db.equippedLoadouts.add({ id: `equipped:${id}`, characterId: id, weaponId: '', echoIds: [], updatedAt: Date.now() })
    })
    setPickerOpen(false)
    await refresh()
  }
  const selected = rows.find(({ item }) => item.id === selectedId)

  if (selected) return <CharacterShowcase character={selected.item} catalog={selected.catalog} weapons={weapons} echoes={echoes} builds={builds} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} settings={settings} refresh={refresh} onBack={() => { setSelectedId(null); onCharacterChange?.(null) }}/>

  return <>
    <Panel className="owned-add"><div><span className="eyebrow">Characters</span><strong>Pick a character</strong></div><button type="button" className="primary" onClick={() => setPickerOpen(true)}><Icon name="plus"/>Add character</button></Panel>
    <Panel className="owned-filter chip-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search characters..."/></label><FilterChips label="Element" values={characterElements} selected={elements} onChange={setElements} renderValue={(value) => <ElementFilterIcon element={value}/>}/><FilterChips label="Rarity" values={characterRarities} selected={rarities} onChange={setRarities} renderValue={(value) => `${value} ★`}/><span>{visible.length} / {owned.length}</span></Panel>
    <div className="character-candy-grid">{visible.map(({ item, catalog, weapon, weaponEntry, equipped }) => {
      const openCharacter = () => { setSelectedId(item.id); onCharacterChange?.({ id: catalog.id, name: catalog.name }) }
      return <article className={`character-candy-card rarity-${catalog.rarity}`} key={item.id} role="button" tabIndex={0} onClick={openCharacter} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openCharacter() }}>
        <button className={item.favorite ? 'favorite active' : 'favorite'} aria-label="Favorite character" onClick={async (event) => { event.stopPropagation(); await db.characters.update(item.id, { favorite: !item.favorite }); await refresh() }}>♥</button>
        <div className="candy-character-art"><img src={catalog.iconSourceUrl} alt="" loading="lazy" decoding="async"/></div>
        <div className="candy-character-copy"><header><div className={catalog.titleCardSourceUrl ? 'candy-title-card has-title-card' : 'candy-title-card'}>{catalog.titleCardSourceUrl && <img src={catalog.titleCardSourceUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement?.classList.remove('has-title-card') }}/>}<h2>{catalog.name}</h2></div><p>{catalog.element} · {catalog.weaponType} · <Stars rarity={catalog.rarity}/></p></header><div className="candy-level"><strong>Lv. {item.level}</strong><b>S{item.sequence}</b></div><div className="candy-skills">{skillsFor(item).map((level, index) => <span key={SKILLS[index]} title={`${SKILLS[index]} Lv. ${level}`}><i>{level}</i></span>)}</div></div>
        <div className="candy-loadout"><LoadoutSquare className={weaponEntry ? `rarity-${weaponEntry.rarity}` : ''} label={weaponEntry?.name || 'Weapon'} image={weaponEntry?.iconSourceUrl} topLeft={weapon ? `${weapon.level}/90` : undefined} bottomRight={weapon ? `R${weapon.rank}` : undefined}/>{Array.from({ length: 5 }, (_, index) => { const echo = equipped[index]; const sonataIcon = echo ? generatedSonataIconSources[echo.sonata] : undefined; return <LoadoutSquare key={index} label={echo?.name || `Echo ${index + 1}`} image={echo ? echoCatalog.find((entry) => entry.name === echo.name)?.iconSourceUrl : undefined} topLeft={echo ? `+${echo.level}` : undefined} bottomRight={sonataIcon ? <img className="loadout-sonata-icon" src={sonataIcon} alt={echo?.sonata || ''}/> : undefined}/> })}</div>
      </article>
    })}</div>
    {pickerOpen && <Picker title="Choose a character" query={pickerQuery} setQuery={setPickerQuery} filters={<div className="catalog-picker-filters"><FilterChips label="Element" values={characterElements} selected={pickerElements} onChange={setPickerElements} renderValue={(value) => <ElementFilterIcon element={value}/>}/><FilterChips label="Rarity" values={characterRarities} selected={pickerRarities} onChange={setPickerRarities} renderValue={(value) => `${value} ★`}/></div>} onClose={() => setPickerOpen(false)}>{available.map((entry) => <button className={`catalog-choice character-choice rarity-${entry.rarity}`} key={entry.id} onClick={() => void add(entry.id)}><img src={entry.iconSourceUrl} alt=""/><span><strong>{entry.name}</strong><small>{entry.element} · {entry.weaponType}</small><Stars rarity={entry.rarity}/></span></button>)}</Picker>}
  </>
}
