import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { generatedWeaponCatalog as weaponCatalog } from '../game-data/weapons.generated'
import { createLocalId } from '../domain/id'
import { db, setBuildEchoIds, setOwnedWeaponOwner } from '../storage/database'
import type { Build, Echo, OwnedCharacter, OwnedWeapon, Team } from '../domain/types'
import { EchoMiniCard, ElementFilterIcon, FilterChips, Icon, Panel } from './components'

const characterElements = [...new Set(characterCatalog.map((item) => item.element))]
const characterRarities = [5, 4]
const weaponTypes = [...new Set(weaponCatalog.map((item) => item.type))]
const weaponRarities = [5, 4, 3, 2, 1]

function CatalogPicker({ title, query, setQuery, filters, children, onClose }: { title: string; query: string; setQuery: (value: string) => void; filters?: ReactNode; children: ReactNode; onClose: () => void }) {
  return <div className="catalog-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="catalog-picker" role="dialog" aria-modal="true" aria-label={title}><header><div><span className="eyebrow">Add to local inventory</span><h2>{title}</h2></div><button className="text-button" onClick={onClose}>Close</button></header><div className="catalog-picker-tools"><label className="search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`}/></label>{filters}</div><div className="catalog-picker-grid">{children}</div></section></div>
}

function CharacterDetail({ character, ownedWeapons, echoes, builds, teams, refresh, onClose }: { character: OwnedCharacter; ownedWeapons: OwnedWeapon[]; echoes: Echo[]; builds: Build[]; teams: Team[]; refresh: () => Promise<void>; onClose: () => void }) {
  const catalog = characterCatalog.find((entry) => entry.id === character.catalogId)
  if (!catalog) return null
  const build = builds.find((entry) => entry.resonatorId === character.catalogId)
  const equippedEchoes = build ? build.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)) : []
  const compatibleWeapons = ownedWeapons.map((item) => ({ item, catalog: weaponCatalog.find((entry) => entry.id === item.catalogId) })).filter((entry) => entry.catalog?.type.toLowerCase() === catalog.weaponType.toLowerCase())
  const equippedWeapon = compatibleWeapons.find(({ item }) => item.id === build?.weaponId)
  const memberships = build ? teams.filter((team) => team.buildIds.includes(build.id)) : []
  const ensureBuild = async () => {
    if (build) return build
    const created: Build = { id: createLocalId(), name: `${catalog.name} build`, resonatorId: character.catalogId, weaponId: '', echoIds: [], level: character.level, skillLevel: 1 }
    await db.builds.add(created)
    return created
  }
  const toggleEcho = async (echo: Echo) => {
    const target = await ensureBuild()
    const selected = target.echoIds.includes(echo.id)
    if (!selected && echo.equippedBy && echo.equippedBy !== target.id) return
    if (!selected && target.echoIds.length >= 5) return
    const currentCost = target.echoIds.map((id) => echoes.find((item) => item.id === id)?.cost ?? 0).reduce<number>((sum, value) => sum + value, 0)
    if (!selected && currentCost + echo.cost > 12) return
    const echoIds = selected ? target.echoIds.filter((id) => id !== echo.id) : [...target.echoIds, echo.id]
    await setBuildEchoIds(target.id, echoIds)
    await refresh()
  }
  return <div className="character-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="character-detail" role="dialog" aria-modal="true" aria-label={`${catalog.name} build`}>
    <header><div><span className="eyebrow">Character loadout</span><h2>{catalog.name}</h2></div><button className="close" onClick={onClose}>×</button></header>
    <aside className="character-detail-identity"><img src={catalog.iconSourceUrl} alt=""/><div><span className={`element element-${catalog.element.toLowerCase()}`}>{catalog.element}</span><h1>{catalog.name}</h1><p>{catalog.weaponType} · {'★'.repeat(catalog.rarity)}</p></div><dl><div><dt>Level</dt><dd>{character.level}/90</dd></div><div><dt>Sequence</dt><dd>S{character.sequence}</dd></div><div><dt>Build</dt><dd>{build ? `${equippedEchoes.length}/5 Echoes` : 'Not created'}</dd></div></dl></aside>
    <main className="character-detail-workspace"><Panel className="detail-weapon"><div className="section-heading"><div><span className="eyebrow">Weapon</span><h3>{equippedWeapon?.catalog?.name ?? 'No compatible weapon owned'}</h3></div></div>{equippedWeapon?.catalog && <div className="detail-weapon-body"><img src={equippedWeapon.catalog.iconSourceUrl} alt=""/><div><strong>Lv. {equippedWeapon.item.level} · R{equippedWeapon.item.rank}</strong><span>ATK {equippedWeapon.catalog.baseAtk}</span><small>{equippedWeapon.catalog.secondaryStat}</small></div></div>}</Panel>
      <Panel className="detail-echoes"><div className="section-heading"><div><span className="eyebrow">Echo loadout</span><h3>{equippedEchoes.length}/5 equipped</h3></div><b>{equippedEchoes.reduce((sum, echo) => sum + echo.cost, 0)}/12 cost</b></div><div className="detail-echo-grid">{Array.from({ length: 5 }, (_, index) => equippedEchoes[index] ? <EchoMiniCard key={equippedEchoes[index].id} echo={equippedEchoes[index]}/> : <div className="detail-empty" key={index}><span>+</span><small>EMPTY</small></div>)}</div><div className="detail-equip-list"><span className="eyebrow">Equip from inventory</span>{echoes.filter((echo) => !echo.excluded && (!echo.equippedBy || echo.equippedBy === build?.id)).map((echo) => <button className={build?.echoIds.includes(echo.id) ? 'active' : ''} key={echo.id} onClick={() => void toggleEcho(echo)}><span>{echo.name}</span><small>{echo.cost} cost · +{echo.level}</small><b>{build?.echoIds.includes(echo.id) ? 'Unequip' : 'Equip'}</b></button>)}</div></Panel>
      <Panel className="detail-teams"><div className="section-heading"><div><span className="eyebrow">Team connections</span><h3>Teams using {catalog.name}</h3></div></div>{memberships.length ? memberships.map((team) => <article key={team.id}><strong>{team.name}</strong><span>{team.buildIds.length}/3 members · {team.rotationDuration}s rotation</span></article>) : <div className="detail-empty-team"><strong>Not assigned to a team</strong><span>Create or edit a team from the Teams tab.</span></div>}</Panel>
      {!build && <div className="notice warning">This full-catalog character has no calculation build yet. The overlay shows owned data only; combat stats will appear when the calculation roster supports this character.</div>}
    </main>
  </section></div>
}

export function CharacterInventory({ owned, weapons = [], echoes = [], builds = [], teams = [], refresh }: { owned: OwnedCharacter[]; weapons?: OwnedWeapon[]; echoes?: Echo[]; builds?: Build[]; teams?: Team[]; refresh: () => Promise<void> }) {
  const [query, setQuery] = useState(''), [elements, setElements] = useState<string[]>(characterElements), [rarities, setRarities] = useState<number[]>(characterRarities), [pickerOpen, setPickerOpen] = useState(false), [pickerQuery, setPickerQuery] = useState(''), [selected, setSelected] = useState<OwnedCharacter | null>(null)
  const deferred = useDeferredValue(query.toLowerCase())
  const visible = useMemo(() => owned.map((item) => ({ item, catalog: characterCatalog.find((entry) => entry.id === item.catalogId) })).filter(({ catalog }) => catalog && elements.includes(catalog.element) && rarities.includes(catalog.rarity) && `${catalog.name} ${catalog.element} ${catalog.weaponType}`.toLowerCase().includes(deferred)), [deferred, elements, owned, rarities])
  const available = characterCatalog.filter((entry) => !owned.some((item) => item.catalogId === entry.id) && `${entry.name} ${entry.element} ${entry.weaponType}`.toLowerCase().includes(pickerQuery.toLowerCase()))
  const add = async (catalogId: string) => { await db.characters.add({ id: createLocalId(), catalogId, level: 1, sequence: 0, locked: false, createdAt: Date.now() }); setPickerOpen(false); await refresh() }
  const update = async (item: OwnedCharacter, patch: Partial<OwnedCharacter>) => { await db.characters.update(item.id, patch); await refresh() }
  return <><Panel className="owned-add"><div><span className="eyebrow">Character roster</span><strong>Select a character card to open their loadout.</strong></div><button className="primary" onClick={() => setPickerOpen(true)}><Icon name="plus"/>Add character</button></Panel><Panel className="owned-filter chip-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search characters..."/></label><FilterChips label="Element" values={characterElements} selected={elements} onChange={setElements} renderValue={(value) => <ElementFilterIcon element={value}/>}/><FilterChips label="Rarity" values={characterRarities} selected={rarities} onChange={setRarities} renderValue={(value) => `${value} ★`}/><span>{visible.length} / {owned.length}</span></Panel>
    <div className="owned-grid">{visible.map(({ item, catalog }) => catalog && <article className="owned-card character-owned clickable" key={item.id} onClick={() => setSelected(item)}><div className="owned-art"><img src={catalog.iconSourceUrl} alt=""/><span className={`element element-${catalog.element.toLowerCase()}`}>{catalog.element.slice(0, 1)}</span></div><div className="owned-copy"><h2>{catalog.name}</h2><p>{catalog.element} · {catalog.weaponType} · {'★'.repeat(catalog.rarity)}</p><div className="owned-fields" onClick={(event) => event.stopPropagation()}><label>Level<input type="number" min="1" max="90" value={item.level} onChange={(event) => void update(item, { level: Math.max(1, Math.min(90, Number(event.target.value))) })}/></label><label>Sequence<select value={item.sequence} onChange={(event) => void update(item, { sequence: Number(event.target.value) })}>{[0, 1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>S{value}</option>)}</select></label></div><footer><span className="owned-state">Open build</span><button className="text-button" onClick={async (event) => { event.stopPropagation(); await db.characters.delete(item.id); await refresh() }}><Icon name="trash"/>Remove</button></footer></div></article>)}</div>
    {pickerOpen && <CatalogPicker title="Choose a character" query={pickerQuery} setQuery={setPickerQuery} onClose={() => setPickerOpen(false)}>{available.map((entry) => <button className="catalog-choice character-choice" key={entry.id} onClick={() => void add(entry.id)}><img src={entry.iconSourceUrl} alt=""/><span><strong>{entry.name}</strong><small>{entry.element} · {entry.weaponType}</small><b>{'★'.repeat(entry.rarity)}</b></span></button>)}</CatalogPicker>}{selected && <CharacterDetail character={selected} ownedWeapons={weapons} echoes={echoes} builds={builds} teams={teams} refresh={refresh} onClose={() => setSelected(null)}/>}</>
}

const weaponLevels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const
type CharacterCatalogItem = (typeof characterCatalog)[number]
type CompatibleCharacter = { item: OwnedCharacter; catalog: CharacterCatalogItem }

function getWeaponStats(catalog: (typeof weaponCatalog)[number], level: number) {
  return catalog.levelStats.reduce((closest, stats) => Math.abs(stats.level - level) < Math.abs(closest.level - level) ? stats : closest)
}

function highlightRankValues(text: string) {
  return text.split(/([+-]?\d+(?:\.\d+)?%?)/g).map((part, index) => /^[+-]?\d/.test(part) ? <mark className="rank-value" key={index}>{part}</mark> : part)
}

function CharacterEquipPicker({ value, options, onChange }: { value?: string; options: CompatibleCharacter[]; onChange: (characterId: string) => void }) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const selected = options.find(({ item }) => item.id === value)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => { if (!pickerRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])
  return <div ref={pickerRef} className="character-equip-picker" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="character-equip-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      {selected ? <img src={selected.catalog.iconSourceUrl} alt=""/> : <span className="equip-empty">—</span>}<b>{selected?.catalog.name ?? 'Unequipped'}</b><i>⌄</i>
    </button>
    {open && <div className="character-equip-menu"><button type="button" onClick={() => { onChange(''); setOpen(false) }}><span className="equip-empty">—</span><b>Unequipped</b></button>{options.map(({ item, catalog }) => <button type="button" className={item.id === value ? 'active' : ''} key={item.id} onClick={() => { onChange(item.id); setOpen(false) }}><img src={catalog.iconSourceUrl} alt=""/><b>{catalog.name}</b></button>)}</div>}
  </div>
}

function WeaponDetail({ weapon, characters, refresh, onClose }: { weapon: OwnedWeapon; characters: OwnedCharacter[]; refresh: () => Promise<void>; onClose: () => void }) {
  const catalog = weaponCatalog.find((entry) => entry.id === weapon.catalogId)
  if (!catalog) return null
  const compatible = characters.flatMap((item) => { const entry = characterCatalog.find((candidate) => candidate.id === item.catalogId); return entry?.weaponType.toLowerCase() === catalog.type.toLowerCase() ? [{ item, catalog: entry }] : [] })
  const levelIndex = weaponLevels.reduce((closest, level, index) => Math.abs(level - weapon.level) < Math.abs(weaponLevels[closest] - weapon.level) ? index : closest, 0)
  const stats = getWeaponStats(catalog, weaponLevels[levelIndex])
  const equip = async (characterId: string) => {
    await setOwnedWeaponOwner(weapon.id, characterId || undefined)
    await refresh()
  }
  const update = async (patch: Partial<OwnedWeapon>) => { await db.weapons.update(weapon.id, patch); await refresh() }
  return <div className="weapon-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`weapon-detail rarity-${catalog.rarity}`} role="dialog" aria-modal="true" aria-label={`${catalog.name} details`}><header><div><span className="eyebrow">Weapon details</span><h2>{catalog.name}</h2></div><button className="close" onClick={onClose}>×</button></header><div className="weapon-detail-art"><img src={catalog.iconSourceUrl} alt=""/><span>{'★'.repeat(catalog.rarity)}</span><p>{catalog.description}</p></div><div className="weapon-detail-copy"><div className="weapon-edit-row"><div className="weapon-level-control"><div className="weapon-level-heading"><span>Level</span><strong>Lv. {weaponLevels[levelIndex]}</strong></div><input aria-label="Weapon level" type="range" min="0" max={weaponLevels.length - 1} step="1" value={levelIndex} onChange={(event) => void update({ level: weaponLevels[Number(event.target.value)] })}/></div><label className="weapon-rank-control">Rank<select value={weapon.rank} onChange={(event) => void update({ rank: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>R{value}</option>)}</select></label><button className={weapon.locked ? 'weapon-lock-button locked' : 'weapon-lock-button'} onClick={() => void update({ locked: !weapon.locked })}><Icon name={weapon.locked ? 'lock' : 'unlock'}/>{weapon.locked ? 'Locked' : 'Unlocked'}</button></div><Panel className="weapon-main-stats"><span>Stats at level {weaponLevels[levelIndex]}</span><div><strong>ATK</strong><b>{stats.baseAtk}</b></div><div><strong>{catalog.secondaryStat}</strong><b>{stats.secondaryStatValue}</b></div></Panel><Panel className="weapon-passive"><span>Passive / effect</span><h3>{catalog.passiveName} · Rank {weapon.rank}</h3><p>{highlightRankValues(catalog.passiveEffects[weapon.rank - 1])}</p></Panel><div className="weapon-equip-select"><span>Equipped character</span><CharacterEquipPicker value={weapon.equippedBy} options={compatible} onChange={(characterId) => void equip(characterId)}/></div></div></section></div>
}

export function WeaponInventory({ owned, characters = [], builds = [], refresh }: { owned: OwnedWeapon[]; characters?: OwnedCharacter[]; builds?: Build[]; refresh: () => Promise<void> }) {
  const [query, setQuery] = useState(''), [types, setTypes] = useState<string[]>(weaponTypes), [rarities, setRarities] = useState<number[]>(weaponRarities), [pickerOpen, setPickerOpen] = useState(false), [pickerQuery, setPickerQuery] = useState(''), [pickerTypes, setPickerTypes] = useState<string[]>(weaponTypes), [pickerRarities, setPickerRarities] = useState<number[]>(weaponRarities), [selectedId, setSelectedId] = useState<string | null>(null)
  const deferred = useDeferredValue(query.toLowerCase())
  const visible = useMemo(() => owned.map((item) => ({ item, catalog: weaponCatalog.find((entry) => entry.id === item.catalogId) })).filter(({ catalog }) => catalog && types.includes(catalog.type) && rarities.includes(catalog.rarity) && `${catalog.name} ${catalog.type} ${catalog.secondaryStat}`.toLowerCase().includes(deferred)).sort((left, right) => (right.catalog?.rarity ?? 0) - (left.catalog?.rarity ?? 0) || (left.catalog?.name ?? '').localeCompare(right.catalog?.name ?? '')), [deferred, owned, rarities, types])
  const available = weaponCatalog.filter((entry) => pickerTypes.includes(entry.type) && pickerRarities.includes(entry.rarity) && `${entry.name} ${entry.type} ${entry.secondaryStat}`.toLowerCase().includes(pickerQuery.toLowerCase())).sort((left, right) => right.rarity - left.rarity || left.name.localeCompare(right.name))
  const selected = owned.find((item) => item.id === selectedId)
  const add = async (catalogId: string) => { await db.weapons.add({ id: createLocalId(), catalogId, level: 1, rank: 1, locked: false, createdAt: Date.now() }); setPickerOpen(false); await refresh() }
  const update = async (item: OwnedWeapon, patch: Partial<OwnedWeapon>) => { await db.weapons.update(item.id, patch); await refresh() }
  const equipCard = async (item: OwnedWeapon, characterId: string) => {
    await setOwnedWeaponOwner(item.id, characterId || undefined)
    await refresh()
  }
  return <><Panel className="owned-add"><div><span className="eyebrow">Weapon collection</span><strong>Manage each owned weapon copy.</strong></div><button className="primary" onClick={() => setPickerOpen(true)}><Icon name="plus"/>Add weapon</button></Panel><Panel className="owned-filter chip-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search weapons..."/></label><FilterChips label="Type" values={weaponTypes} selected={types} onChange={setTypes}/><FilterChips label="Rarity" values={weaponRarities} selected={rarities} onChange={setRarities} renderValue={(value) => `${value} ★`}/><span>{visible.length} / {owned.length}</span></Panel><div className="owned-grid weapon-owned-grid">{visible.map(({ item, catalog }) => { if (!catalog) return null; const stats = getWeaponStats(catalog, item.level); const compatible = characters.flatMap((character) => { const entry = characterCatalog.find((candidate) => candidate.id === character.catalogId); return entry?.weaponType.toLowerCase() === catalog.type.toLowerCase() ? [{ item: character, catalog: entry }] : [] }); return <article className={`owned-card weapon-owned clickable rarity-${catalog.rarity}`} key={item.id} onClick={() => setSelectedId(item.id)}><div className="owned-art"><div className="weapon-image-frame"><img src={catalog.iconSourceUrl} alt=""/><span className="weapon-level-rank">Lv. {item.level} · R{item.rank}</span><span className="weapon-rarity">{'★'.repeat(catalog.rarity)}</span></div></div><div className="owned-copy weapon-owned-copy"><div className="weapon-card-heading"><h2>{catalog.name}</h2></div><div className="weapon-card-stats"><p><span>ATK</span><strong>{stats.baseAtk}</strong></p><p><span>{catalog.secondaryStat}</span><strong>{stats.secondaryStatValue}</strong></p></div><div className="weapon-card-equip"><span>Equipped by</span><CharacterEquipPicker value={item.equippedBy} options={compatible} onChange={(characterId) => void equipCard(item, characterId)}/></div><footer onClick={(event) => event.stopPropagation()}><button className={item.locked ? 'weapon-action locked' : 'weapon-action'} onClick={() => void update(item, { locked: !item.locked })}><Icon name={item.locked ? 'lock' : 'unlock'}/>{item.locked ? 'Locked' : 'Unlocked'}</button><button className="weapon-action remove" disabled={item.locked || Boolean(item.equippedBy)} onClick={async () => { await db.weapons.delete(item.id); await refresh() }}><Icon name="trash"/>Remove</button></footer></div></article>})}</div>{pickerOpen && <CatalogPicker title="Choose a weapon" query={pickerQuery} setQuery={setPickerQuery} filters={<div className="catalog-picker-filters"><FilterChips label="Type" values={weaponTypes} selected={pickerTypes} onChange={setPickerTypes}/><FilterChips label="Rarity" values={weaponRarities} selected={pickerRarities} onChange={setPickerRarities} renderValue={(value) => `${value} ★`}/></div>} onClose={() => setPickerOpen(false)}>{available.map((entry) => { const stats = getWeaponStats(entry, 90); return <button className={`catalog-choice weapon-choice rarity-${entry.rarity}`} key={entry.id} onClick={() => void add(entry.id)}><img src={entry.iconSourceUrl} alt=""/><span><strong>{entry.name}</strong><small>{entry.type} · {'★'.repeat(entry.rarity)}</small><span className="picker-weapon-stats"><b>ATK {stats.baseAtk}</b><b>{entry.secondaryStat} {stats.secondaryStatValue}</b></span></span></button>})}</CatalogPicker>}{selected && <WeaponDetail weapon={selected} characters={characters} refresh={refresh} onClose={() => setSelectedId(null)}/>}</>
}
