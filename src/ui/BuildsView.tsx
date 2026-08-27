import { useMemo, useState } from 'react'
import { aggregateStats, calculateDamage, formatDamage } from '../domain/damage'
import { createLocalId } from '../domain/id'
import { createTheorycraftBuild, loadoutCharacterId, resolveLoadout, theorycraftWarnings, type LoadoutCollections } from '../domain/loadouts'
import type { AggregatedStats, Build, Echo, EquippedLoadout, LoadoutSourceRef, OwnedCharacter, OwnedWeapon, StatKey, TheorycraftBuild, TheorycraftEchoSlot } from '../domain/types'
import { characterCatalog, echoCatalog, resonators, sonataCatalog, statLabels, weaponCatalog, weapons as damageWeapons } from '../game-data'
import { mainStatKeysByCost, maxLevelByRarity, maxSubStatsForLevel } from '../game-data/echo-main-stats'
import { tunableRolls } from '../game-data/tunable-rolls'
import { db } from '../storage/database'
import { duplicateSavedBuild, equipSavedBuild, equipmentConflicts, saveEquippedBuild, theorycraftFromBuild } from '../storage/loadouts'
import { Icon, PageHeader, Panel } from './components'

type Props = {
  echoes: Echo[]; builds: Build[]; characters: OwnedCharacter[]; weapons: OwnedWeapon[]
  equippedLoadouts: EquippedLoadout[]; theorycraftBuilds: TheorycraftBuild[]; refresh: () => Promise<void>
  embedded?: boolean
  management?: boolean
  characterId?: string
  onSelectSource?: (source: LoadoutSourceRef) => void
}

const sourceKey = (source: LoadoutSourceRef) => source.type === 'equipped' ? `equipped:${source.characterId}` : source.type === 'saved' ? `saved:${source.buildId}` : `theorycraft:${source.theorycraftBuildId}`
const statKeys = Object.keys(tunableRolls) as StatKey[]
const summaryStatKeys = ['hp', 'atk', 'def', 'critRate', 'critDamage', 'energyRegen'] as const satisfies readonly (keyof AggregatedStats & StatKey)[]

function sourceLabel(source: LoadoutSourceRef, collections: LoadoutCollections) {
  if (source.type === 'equipped') return 'Equipped Build'
  if (source.type === 'saved') return collections.builds.find((entry) => entry.id === source.buildId)?.name ?? 'Missing saved build'
  return collections.theorycraftBuilds.find((entry) => entry.id === source.theorycraftBuildId)?.name ?? 'Missing theorycraft build'
}

function LoadoutSummary({ source, collections }: { source: LoadoutSourceRef; collections: LoadoutCollections }) {
  const resolved = resolveLoadout(source, collections)
  const catalog = characterCatalog.find((entry) => entry.id === resolved.character?.catalogId)
  const weapon = weaponCatalog.find((entry) => entry.id === resolved.weapon?.catalogId)
  const cost = resolved.echoes.reduce((sum, echo) => sum + echo.cost, 0)
  const sonatas = [...new Set(resolved.echoes.map((echo) => echo.sonata).filter(Boolean))]
  return <div className="loadout-summary">
    <div className="loadout-summary-character">{catalog?.iconSourceUrl && <img src={catalog.iconSourceUrl} alt=""/>}<span><strong>{catalog?.name ?? 'Missing character'}</strong><small>{weapon?.name ?? 'No weapon'}</small></span></div>
    <div className="loadout-summary-facts"><span><b>{resolved.echoes.length}/5</b> Echoes</span><span><b>{cost}/12</b> cost</span><span><b>{sonatas.length || 0}</b> Sonatas</span></div>
    {resolved.warnings.length > 0 && <div className="notice warning compact">{resolved.warnings.join(' ')}</div>}
  </div>
}

function ManagementGear({ source, collections }: { source: LoadoutSourceRef; collections: LoadoutCollections }) {
  const resolved = resolveLoadout(source, collections)
  const weapon = weaponCatalog.find((entry) => entry.id === resolved.weapon?.catalogId)
  return <div className="build-management-gear">
    <span className="build-management-weapon">{weapon?.iconSourceUrl && <img src={weapon.iconSourceUrl} alt=""/>}<small>Lv. {resolved.weapon?.level ?? 1}</small><b>R{resolved.weapon?.rank ?? 1}</b></span>
    {Array.from({ length: 5 }, (_, index) => { const echo = resolved.echoes[index]; const catalog = echo && echoCatalog.find((entry) => entry.name === echo.name); return <span className="build-management-echo" key={echo?.id ?? index}>{catalog?.iconSourceUrl ? <img src={catalog.iconSourceUrl} alt=""/> : <i>+</i>}{echo && <><small>+{echo.level}</small><b>{statLabels[echo.mainStat.key]} {echo.mainStat.value}%</b></>}</span> })}
  </div>
}

function TheorycraftEditor({ value, ownedCharacter, onClose, onSaved }: { value: TheorycraftBuild; ownedCharacter?: OwnedCharacter; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(() => structuredClone(value))
  const character = characterCatalog.find((entry) => entry.id === ownedCharacter?.catalogId) ?? characterCatalog[0]
  const compatibleWeapons = weaponCatalog.filter((entry) => entry.type.toLowerCase() === character?.weaponType.toLowerCase())
  const compatibleMainEchoes = echoCatalog.filter((entry) => entry.rarities?.includes(draft.slots[0]?.rarity ?? 5))
  const warnings = theorycraftWarnings(draft)
  const liveResolved = ownedCharacter ? resolveLoadout({ type: 'theorycraft', theorycraftBuildId: draft.id }, { characters: [ownedCharacter], weapons: [], echoes: [], builds: [], equippedLoadouts: [], theorycraftBuilds: [draft] }) : undefined
  const liveResonator = resonators.find((entry) => entry.id === ownedCharacter?.catalogId)
  const liveWeapon = damageWeapons.find((entry) => entry.id === liveResolved?.weapon?.catalogId)
  const liveStats = liveResonator && liveWeapon ? aggregateStats(liveResonator, liveWeapon, liveResolved?.echoes ?? []) : undefined
  const liveDamage = liveStats && liveResonator?.attacks[0] ? calculateDamage(liveStats, liveResonator.attacks[0], { level: 100, resistance: 10, damageReduction: 0 }) : undefined
  const updateSlot = (index: number, patch: Partial<TheorycraftEchoSlot>) => setDraft((current) => ({ ...current, slots: current.slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot), updatedAt: Date.now() }))
  const updateSubstatSlot = (index: number, lines: Array<{ key: StatKey; value: number }>) => setDraft((current) => current.substats.mode === 'slots' ? ({ ...current, substats: { mode:'slots', slots:current.substats.slots.map((slot, slotIndex) => slotIndex === index ? lines : slot) }, updatedAt:Date.now() }) : current)
  const save = async () => { if (warnings.length) return; await db.theorycraftBuilds.put({ ...draft, name: draft.name.trim() || 'Theorycraft build', updatedAt: Date.now() }); await onSaved(); onClose() }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><Panel className="modal theorycraft-editor">
    <header><div><span className="eyebrow">Hypothetical loadout</span><h2>{draft.name}</h2></div><button className="text-button" onClick={onClose}>Close</button></header>
    <div className="theorycraft-grid">
      <label>Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
      <label>Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
      <label>Weapon<select value={draft.weapon.catalogId} onChange={(event) => setDraft({ ...draft, weapon: { ...draft.weapon, catalogId: event.target.value } })}>{compatibleWeapons.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
      <label>Weapon level<input type="number" min="1" max="90" value={draft.weapon.level} onChange={(event) => setDraft({ ...draft, weapon: { ...draft.weapon, level: Math.max(1, Math.min(90, Number(event.target.value))) } })}/></label>
      <label>Rank<input type="number" min="1" max="5" value={draft.weapon.rank} onChange={(event) => setDraft({ ...draft, weapon: { ...draft.weapon, rank: Math.max(1, Math.min(5, Number(event.target.value))) } })}/></label>
      <label>Main Echo<select value={draft.mainEchoName} onChange={(event) => { const main = echoCatalog.find((entry) => entry.name === event.target.value); setDraft({ ...draft, mainEchoName: event.target.value, slots: draft.slots.map((slot, index) => index === 0 && main ? { ...slot, cost: main.cost } : slot) }) }}>{compatibleMainEchoes.map((entry) => <option value={entry.name} key={entry.id}>{entry.name} · Cost {entry.cost}</option>)}</select></label>
    </div>
    <section><div className="section-heading"><div><span className="eyebrow">Anonymous Echoes</span><h3>Five stat slots</h3></div><b>{draft.slots.reduce((sum, slot) => sum + slot.cost, 0)}/12 cost</b></div>
      <div className="theorycraft-slots">{draft.slots.map((slot, index) => <article key={index}><strong>{index === 0 ? 'Main Echo slot' : `Slot ${index + 1}`}</strong>
        <label>Cost<select value={slot.cost} disabled={index === 0} onChange={(event) => { const cost = Number(event.target.value) as Echo['cost']; updateSlot(index, { cost, mainStatKey: mainStatKeysByCost[cost][0] }) }}>{[4, 3, 1].map((cost) => <option value={cost} key={cost}>{cost}</option>)}</select></label>
        <label>Rarity<select value={slot.rarity} onChange={(event) => { const rarity = Number(event.target.value) as Echo['rarity']; updateSlot(index, { rarity, level: Math.min(slot.level, maxLevelByRarity[rarity]) }) }}>{[5, 4, 3, 2, 1].map((rarity) => <option value={rarity} key={rarity}>{rarity} star</option>)}</select></label>
        <label>Level<input type="number" min="0" max={maxLevelByRarity[slot.rarity]} value={slot.level} onChange={(event) => updateSlot(index, { level: Number(event.target.value) })}/></label>
        <label>Main stat<select value={slot.mainStatKey} onChange={(event) => updateSlot(index, { mainStatKey: event.target.value as StatKey })}>{mainStatKeysByCost[slot.cost].map((key) => <option value={key} key={key}>{statLabels[key]}</option>)}</select></label>
      </article>)}</div>
    </section>
    <section><div className="section-heading"><div><span className="eyebrow">Sonata composition</span><h3>Exactly five pieces</h3></div><button className="secondary" onClick={() => setDraft({ ...draft, sonatas: [...draft.sonatas, { name: sonataCatalog[0]?.name ?? '', pieces: 0 }] })}>Add Sonata</button></div>
      <div className="theorycraft-sonatas">{draft.sonatas.map((sonata, index) => <div key={`${index}:${sonata.name}`}><select value={sonata.name} onChange={(event) => setDraft({ ...draft, sonatas: draft.sonatas.map((entry, entryIndex) => entryIndex === index ? { ...entry, name: event.target.value } : entry) })}>{sonataCatalog.map((entry) => <option value={entry.name} key={entry.name}>{entry.name}</option>)}</select><input type="number" min="0" max="5" value={sonata.pieces} onChange={(event) => setDraft({ ...draft, sonatas: draft.sonatas.map((entry, entryIndex) => entryIndex === index ? { ...entry, pieces: Number(event.target.value) } : entry) })}/><button className="danger text" onClick={() => setDraft({ ...draft, sonatas: draft.sonatas.filter((_, entryIndex) => entryIndex !== index) })}>Remove</button></div>)}</div>
    </section>
    <section><div className="section-heading"><div><span className="eyebrow">Echo substats</span><h3>Main stat and up to five unique rolls per Echo</h3></div><select value={draft.substats.mode} onChange={(event) => { const mode = event.target.value; setDraft({ ...draft, substats: mode === 'slots' ? { mode:'slots', slots:Array.from({ length:5 }, () => []) } : mode === 'values' ? { mode:'values', values:{} } : { mode:'rolls', quality:'mid', rolls:{} } }) }}><option value="slots">Exact rolls per Echo</option><option value="values">Legacy direct totals</option><option value="rolls">Legacy estimated rolls</option></select></div>
      {draft.substats.mode === 'slots' ? <div className="theorycraft-slot-substats">{draft.slots.map((slot, slotIndex) => {
        const lines = draft.substats.mode === 'slots' ? draft.substats.slots[slotIndex] ?? [] : []
        const availableKeys = (Object.keys(tunableRolls) as StatKey[]).filter((key) => key !== slot.mainStatKey)
        return <article key={slotIndex}><header><strong>{slotIndex === 0 ? 'Main Echo' : `Echo ${slotIndex + 1}`}</strong><small>{lines.length}/{maxSubStatsForLevel(slot.level)} substats</small></header>{lines.map((line, lineIndex) => <div key={`${line.key}:${lineIndex}`}><select aria-label={`Echo ${slotIndex + 1} substat ${lineIndex + 1}`} value={line.key} onChange={(event) => { const key = event.target.value as StatKey; updateSubstatSlot(slotIndex, lines.map((entry, index) => index === lineIndex ? { key, value:tunableRolls[key]?.[0]?.value ?? 0 } : entry)) }}>{availableKeys.filter((key) => key === line.key || !lines.some((entry, index) => index !== lineIndex && entry.key === key)).map((key) => <option value={key} key={key}>{statLabels[key]}</option>)}</select><select aria-label={`${statLabels[line.key]} roll`} value={line.value} onChange={(event) => updateSubstatSlot(slotIndex, lines.map((entry, index) => index === lineIndex ? { ...entry, value:Number(event.target.value) } : entry))}>{(tunableRolls[line.key] ?? []).map((roll) => <option value={roll.value} key={roll.value}>{roll.value}{['hp','atk','def'].includes(line.key) ? '' : '%'}</option>)}</select><button type="button" className="danger text" onClick={() => updateSubstatSlot(slotIndex, lines.filter((_, index) => index !== lineIndex))}>Remove</button></div>)}<button type="button" className="secondary" disabled={lines.length >= maxSubStatsForLevel(slot.level) || lines.length >= availableKeys.length} onClick={() => { const key = availableKeys.find((candidate) => !lines.some((line) => line.key === candidate)); if (key) updateSubstatSlot(slotIndex, [...lines, { key, value:tunableRolls[key]?.[0]?.value ?? 0 }]) }}>Add substat</button></article>
      })}</div> : <>
        {draft.substats.mode === 'rolls' && <label>Roll quality<select value={draft.substats.quality} onChange={(event) => { const quality = event.target.value as 'low' | 'mid' | 'high'; setDraft((current) => current.substats.mode === 'rolls' ? { ...current, substats: { ...current.substats, quality } } : current) }}><option value="low">Low</option><option value="mid">Mid</option><option value="high">High</option></select></label>}
        <div className="theorycraft-substats">{statKeys.map((key) => <label key={key}>{statLabels[key]}<input type="number" min="0" step={draft.substats.mode === 'values' ? .1 : 1} value={draft.substats.mode === 'values' ? draft.substats.values[key] ?? 0 : draft.substats.rolls[key] ?? 0} onChange={(event) => { const value = Number(event.target.value); setDraft((current) => current.substats.mode === 'values' ? { ...current, substats: { ...current.substats, values: { ...current.substats.values, [key]: value } } } : current.substats.mode === 'rolls' ? { ...current, substats: { ...current.substats, rolls: { ...current.substats.rolls, [key]: value } } } : current) }}/></label>)}</div>
      </>}
    </section>
    {warnings.length > 0 && <div className="notice warning"><strong>Feasibility warnings</strong>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    {liveStats && <section><div className="section-heading"><div><span className="eyebrow">Live calculation</span><h3>Final stats and formula preview</h3></div>{liveDamage && <b>{liveResonator?.attacks[0]?.name}: {formatDamage(liveDamage.expected)} average DMG</b>}</div><div className="loadout-final-stats">{summaryStatKeys.map((key) => <span key={key}><small>{statLabels[key]}</small><b>{formatDamage(liveStats[key] ?? 0)}</b></span>)}</div></section>}
    <div className="notice warning">Damage values remain based on unverified bundled game data. Verify important results against the current English in-game UI.</div>
    <div className="modal-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={warnings.length > 0} onClick={() => void save()}>Save theorycraft</button></div>
  </Panel></div>
}

export function BuildsView({ echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds, refresh, embedded = false, management = false, characterId, onSelectSource }: Props) {
  const collections = useMemo<LoadoutCollections>(() => ({ echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds }), [echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds])
  const sources = useMemo<LoadoutSourceRef[]>(() => {
    const candidates: LoadoutSourceRef[] = [
      ...characters.map((character) => ({ type: 'equipped' as const, characterId: character.id })),
      ...builds.map((build) => ({ type: 'saved' as const, buildId: build.id })),
      ...theorycraftBuilds.map((build) => ({ type: 'theorycraft' as const, theorycraftBuildId: build.id }))
    ]
    return characterId ? candidates.filter((source) => loadoutCharacterId(source, collections) === characterId) : candidates
  }, [characters, builds, theorycraftBuilds, characterId, collections])
  const [selectedKey, setSelectedKey] = useState(sourceKey(sources[0] ?? { type: 'equipped', characterId: '' }))
  const [compareKey, setCompareKey] = useState('')
  const [editing, setEditing] = useState<TheorycraftBuild>()
  const [message, setMessage] = useState('')
  const selected = sources.find((source) => sourceKey(source) === selectedKey) ?? sources[0]
  const selectedCharacterId = selected ? loadoutCharacterId(selected, collections) : undefined
  const compareOptions = sources.filter((source) => sourceKey(source) !== sourceKey(selected ?? { type: 'equipped', characterId: '' }) && loadoutCharacterId(source, collections) === selectedCharacterId)

  const run = async (action: () => Promise<unknown>, success: string) => { try { setMessage(''); await action(); await refresh(); setMessage(success) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } }
  const createTc = async (character: OwnedCharacter) => { const created = createTheorycraftBuild(character); created.id = createLocalId(); await db.theorycraftBuilds.add(created); await refresh(); setEditing(created); setSelectedKey(sourceKey({ type: 'theorycraft', theorycraftBuildId: created.id })) }
  const equip = async (build: Build) => {
    const conflicts = await equipmentConflicts(build.id)
    if (conflicts.length && !confirm(`Equip ${build.name}? Items will move from ${conflicts.join(', ')}.`)) return
    await run(() => equipSavedBuild(build.id), `${build.name} equipped. The saved snapshot was not changed.`)
  }
  const deleteSource = async (source: LoadoutSourceRef) => {
    if (source.type === 'equipped') return
    if (!confirm(`Delete ${sourceLabel(source, collections)}? This cannot be undone.`)) return
    await run(async () => {
      const characterId = loadoutCharacterId(source, collections)
      await db.transaction('rw', [db.builds, db.theorycraftBuilds, db.teams, db.optimizerProfiles, db.optimizerRuns], async () => {
        const matches = (candidate?: LoadoutSourceRef) => Boolean(candidate && sourceKey(candidate) === sourceKey(source))
        await db.teams.toCollection().modify((team) => {
          team.members = team.members?.map((member) => ({ ...member,
            loadoutSource: matches(member.loadoutSource) && characterId ? { type: 'equipped', characterId } : member.loadoutSource,
            compareSource: matches(member.compareSource) ? undefined : member.compareSource
          }))
        })
        if (source.type === 'saved') {
          const profileIds = (await db.optimizerProfiles.where('buildId').equals(source.buildId).toArray()).map((entry) => entry.id)
          await db.optimizerRuns.where('buildId').equals(source.buildId).delete()
          if (profileIds.length) await db.optimizerProfiles.bulkDelete(profileIds)
          await db.builds.delete(source.buildId)
        } else await db.theorycraftBuilds.delete(source.theorycraftBuildId)
      })
      setSelectedKey(sourceKey(sources.find((entry) => sourceKey(entry) !== sourceKey(source)) ?? { type: 'equipped', characterId: '' }))
    }, 'Build deleted. Team members fell back to Equipped.')
  }
  const rename = async (source: LoadoutSourceRef) => {
    if (source.type === 'equipped') return
    const current = sourceLabel(source, collections); const name = prompt('Build name', current)?.trim(); if (!name) return
    await run(async () => { if (source.type === 'saved') await db.builds.update(source.buildId, { name, updatedAt: Date.now() }); else await db.theorycraftBuilds.update(source.theorycraftBuildId, { name, updatedAt: Date.now() }) }, 'Build renamed.')
  }
  const describe = async (source: LoadoutSourceRef) => {
    if (source.type === 'equipped') return
    const current = source.type === 'saved' ? builds.find((entry) => entry.id === source.buildId)?.description : theorycraftBuilds.find((entry) => entry.id === source.theorycraftBuildId)?.description
    const description = prompt('Build description', current ?? ''); if (description === null) return
    await run(async () => { if (source.type === 'saved') await db.builds.update(source.buildId, { description, updatedAt: Date.now() }); else await db.theorycraftBuilds.update(source.theorycraftBuildId, { description, updatedAt: Date.now() }) }, 'Description updated.')
  }
  const duplicate = async (source: LoadoutSourceRef) => run(async () => { if (source.type === 'saved') await duplicateSavedBuild(source.buildId); else if (source.type === 'theorycraft') await theorycraftFromBuild(source) }, 'Build duplicated.')
  const toTheorycraft = async (source: LoadoutSourceRef) => run(async () => { const created = await theorycraftFromBuild(source); setSelectedKey(sourceKey({ type: 'theorycraft', theorycraftBuildId: created.id })); setEditing(created) }, 'Theorycraft copy created.')
  const removeMissingReferences = async (buildId: string) => run(async () => {
    const build = builds.find((entry) => entry.id === buildId); if (!build) return
    const echoIds = build.echoIds.filter((id) => echoes.some((echo) => echo.id === id))
    const weaponId = weapons.some((weapon) => weapon.id === build.weaponId) ? build.weaponId : ''
    await db.builds.update(buildId, { echoIds, weaponId, updatedAt: Date.now() })
  }, 'Missing inventory references removed from the snapshot.')
  const replaceMissingReferences = async (buildId: string) => run(async () => {
    const build = builds.find((entry) => entry.id === buildId); if (!build) return
    const characterId = build.characterId ?? characters.find((entry) => entry.catalogId === build.resonatorId)?.id
    const equipped = equippedLoadouts.find((entry) => entry.characterId === characterId)
    if (!equipped) throw new Error('No Equipped loadout is available for replacements.')
    const used = new Set(build.echoIds.filter((id) => echoes.some((echo) => echo.id === id)))
    const echoIds = build.echoIds.flatMap((id, index) => {
      if (echoes.some((echo) => echo.id === id)) return [id]
      const replacement = equipped.echoIds[index] ?? equipped.echoIds.find((candidate) => !used.has(candidate))
      if (!replacement || used.has(replacement)) return []
      used.add(replacement); return [replacement]
    })
    const weaponId = weapons.some((weapon) => weapon.id === build.weaponId) ? build.weaponId : equipped.weaponId
    await db.builds.update(buildId, { echoIds, weaponId, updatedAt: Date.now() })
  }, 'Missing references replaced from the current Equipped loadout where possible.')

  if (!sources.length) return <>{!embedded && <PageHeader eyebrow="Loadout studio" title="Builds" description="Add an owned character before creating loadouts."/>}<Panel><p>No owned characters are available.</p></Panel></>
  const grouped = (type: LoadoutSourceRef['type']) => sources.filter((source) => source.type === type)
  const selectedResolved = selected ? resolveLoadout(selected, collections) : undefined
  const selectedCatalog = resonators.find((entry) => entry.id === selectedResolved?.character?.catalogId)
  const selectedWeapon = damageWeapons.find((entry) => entry.id === selectedResolved?.weapon?.catalogId)
  const selectedStats = selectedCatalog && selectedWeapon ? aggregateStats(selectedCatalog, selectedWeapon, selectedResolved?.echoes ?? []) : undefined
  if (management) {
    const equipped = grouped('equipped')[0]
    const saved = grouped('saved')
    const theorycraft = grouped('theorycraft')
    const card = (source: LoadoutSourceRef) => <article className={`build-management-card ${source.type}`} key={sourceKey(source)}>
      <header><strong>{sourceLabel(source, collections)}{source.type === 'equipped' && ' Build'}</strong><span>{source.type === 'equipped' ? 'Current' : source.type === 'saved' ? 'Saved' : 'Theorycraft'}</span></header>
      <ManagementGear source={source} collections={collections}/>
      <footer>
        {onSelectSource && <button title="Use this build" onClick={() => onSelectSource(source)}><Icon name="team"/></button>}
        {source.type === 'equipped' && <><button title="Save snapshot" onClick={() => void run(() => saveEquippedBuild(source.characterId), 'Snapshot saved.')}><Icon name="download"/></button><button title="Copy to theorycraft" onClick={() => void toTheorycraft(source)}><Icon name="plus"/></button></>}
        {source.type === 'saved' && <><button title="Equip" onClick={() => { const build = builds.find((entry) => entry.id === source.buildId); if (build) void equip(build) }}><Icon name="build"/></button><button title="Duplicate" onClick={() => void duplicate(source)}><Icon name="plus"/></button><button title="Rename" onClick={() => void rename(source)}><Icon name="edit"/></button><button title="Delete" onClick={() => void deleteSource(source)}><Icon name="trash"/></button></>}
        {source.type === 'theorycraft' && <><button title="Edit" onClick={() => setEditing(theorycraftBuilds.find((entry) => entry.id === source.theorycraftBuildId))}><Icon name="edit"/></button><button title="Duplicate" onClick={() => void duplicate(source)}><Icon name="plus"/></button><button title="Delete" onClick={() => void deleteSource(source)}><Icon name="trash"/></button></>}
      </footer>
    </article>
    return <div className="build-management-content">
      {message && <div className="notice warning">{message}</div>}
      {equipped && <section className="build-management-equipped">{card(equipped)}</section>}
      <section className="build-management-group"><header><h3>Builds</h3><button onClick={() => { if (equipped?.type === 'equipped') void run(() => saveEquippedBuild(equipped.characterId), 'New build saved.') }}><Icon name="plus"/>New Build</button></header><div className="build-management-cards">{saved.map(card)}</div><p><b>ⓘ</b>A Build is comprised of a weapon and 5 Echoes.</p></section>
      <section className="build-management-group"><header><h3>Theorycrafted Builds</h3><button onClick={() => { const character = characters.find((entry) => entry.id === characterId); if (character) void createTc(character) }}><Icon name="plus"/>New Theorycrafted Build</button></header><div className="build-management-cards">{theorycraft.map(card)}</div><p><b>ⓘ</b>Theorycrafted Builds are separate hypothetical loadouts. Editing or selecting one never changes the equipped build.</p></section>
      {editing && <TheorycraftEditor value={editing} ownedCharacter={characters.find((entry) => entry.id === editing.characterId)} onClose={() => setEditing(undefined)} onSaved={refresh}/>} 
    </div>
  }
  return <>
    {!embedded && <PageHeader eyebrow="Loadout studio" title="Equipped, saved, and theorycraft builds" description="Preview snapshots freely. Only the explicit Equip action moves owned inventory." actions={selectedCharacterId && <button className="primary" onClick={() => { const character = characters.find((entry) => entry.id === selectedCharacterId); if (character) void createTc(character) }}><Icon name="plus"/>New theorycraft</button>}/>} 
    {embedded && selectedCharacterId && <div className="loadout-library-actions"><button className="primary" onClick={() => { const character = characters.find((entry) => entry.id === selectedCharacterId); if (character) void createTc(character) }}><Icon name="plus"/>New theorycraft</button></div>}
    {message && <div className="notice warning">{message}</div>}
    <div className="loadout-library">
      <aside>{(['equipped', 'saved', 'theorycraft'] as const).map((type) => <section key={type}><h2>{type === 'equipped' ? 'Equipped' : type === 'saved' ? 'Saved Builds' : 'Theorycrafted Builds'}</h2>{grouped(type).map((source) => <button className={sourceKey(source) === sourceKey(selected!) ? 'active' : ''} key={sourceKey(source)} onClick={() => { setSelectedKey(sourceKey(source)); setCompareKey('') }}><strong>{sourceLabel(source, collections)}</strong><small>{characterCatalog.find((entry) => entry.id === resolveLoadout(source, collections).character?.catalogId)?.name}</small></button>)}</section>)}</aside>
      <section><Panel className="loadout-detail"><div className="section-heading"><div><span className="eyebrow">{selected?.type}</span><h2>{selected ? sourceLabel(selected, collections) : ''}</h2></div><div className="button-row">
        {selected?.type === 'equipped' && <><button className="secondary" onClick={() => void run(() => saveEquippedBuild(selected.characterId), 'Snapshot saved.')}>Save snapshot</button><button className="secondary" onClick={() => void toTheorycraft(selected)}>Copy to theorycraft</button></>}
        {selected?.type === 'saved' && <><button className="primary" onClick={() => { const build = builds.find((entry) => entry.id === selected.buildId); if (build) void equip(build) }}>Equip</button><button className="secondary" onClick={() => void toTheorycraft(selected)}>Copy to theorycraft</button><button className="secondary" onClick={() => void duplicate(selected)}>Duplicate</button>{selectedResolved?.warnings.some((warning) => warning.includes('missing')) && <><button className="secondary" onClick={() => void replaceMissingReferences(selected.buildId)}>Replace from Equipped</button><button className="secondary" onClick={() => void removeMissingReferences(selected.buildId)}>Remove missing references</button></>}</>}
        {selected?.type === 'theorycraft' && <><button className="primary" onClick={() => setEditing(theorycraftBuilds.find((entry) => entry.id === selected.theorycraftBuildId))}>Edit</button><button className="secondary" onClick={() => void duplicate(selected)}>Duplicate</button></>}
        {selected?.type !== 'equipped' && <><button className="text" onClick={() => void rename(selected!)}>Rename</button><button className="text" onClick={() => void describe(selected!)}>Describe</button><button className="danger text" onClick={() => void deleteSource(selected!)}>Delete</button></>}
      </div></div>{selected && <LoadoutSummary source={selected} collections={collections}/>} 
      {selectedStats && <div className="loadout-final-stats">{summaryStatKeys.map((key) => <span key={key}><small>{statLabels[key]}</small><b>{formatDamage(selectedStats[key] ?? 0)}</b></span>)}</div>}
      <label className="loadout-compare">Compare with<select value={compareKey} onChange={(event) => setCompareKey(event.target.value)}><option value="">None</option>{compareOptions.map((source) => <option value={sourceKey(source)} key={sourceKey(source)}>{sourceLabel(source, collections)}</option>)}</select></label>
      {compareKey && <div className="loadout-comparison"><article><h3>{sourceLabel(selected!, collections)}</h3><LoadoutSummary source={selected!} collections={collections}/></article><article><h3>{sourceLabel(compareOptions.find((source) => sourceKey(source) === compareKey)!, collections)}</h3><LoadoutSummary source={compareOptions.find((source) => sourceKey(source) === compareKey)!} collections={collections}/></article></div>}
      </Panel></section>
    </div>
    {editing && <TheorycraftEditor value={editing} ownedCharacter={characters.find((entry) => entry.id === editing.characterId)} onClose={() => setEditing(undefined)} onSaved={refresh}/>} 
  </>
}
