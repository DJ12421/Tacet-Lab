import { useCallback, useMemo, useRef, useState } from 'react'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { statLabels } from '../game-data/core'
import { echoCatalog } from '../game-data/echoes'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { candidateErrors } from '../scanner/parser'
import type { Echo, ScanCandidate, StatKey } from '../domain/types'
import { tunableRolls } from '../game-data/tunable-rolls'
import { fixedSecondaryMainStat, mainStatKeysByCost, maxLevelByRarity, maxSubStatsForLevel, normalizeEchoMainStat } from '../game-data/echo-main-stats'
import { Confidence, formatStat, Panel } from './components'
import { SonataPicker } from './SonataPicker'
import type { DiagnosticScanCandidate } from '../scanner/types'
import { useDismissableLayer } from './useDismissableLayer'

const subStatKeys = Object.keys(tunableRolls) as StatKey[]
const levelStops = [0, 5, 10, 15, 20, 25]

function EchoPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const selected = echoCatalog.find((entry) => entry.name === value)
  const options = useMemo(() => echoCatalog.filter((entry) => `${entry.name} ${entry.cost} ${entry.sonatas.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [query])
  useDismissableLayer(open, ref, close)
  return <div className="echo-search-picker scan-echo-picker" ref={ref}>
    <button type="button" className="echo-search-trigger" aria-label={`Name ${value}`} aria-expanded={open} onClick={() => { setOpen((current) => !current); setQuery('') }}>{selected?.iconSourceUrl ? <img src={selected.iconSourceUrl} alt=""/> : <span>◇</span>}<b>{value}</b><i>⌄</i></button>
    {open && <div className="echo-search-menu"><input autoFocus aria-label="Filter Echo names" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter Echoes by name, cost, or Sonata..."/><div>{options.map((entry) => <button type="button" className={entry.name === value ? 'active' : ''} key={entry.id ?? entry.name} onClick={() => { onChange(entry.name); setOpen(false) }}>{entry.iconSourceUrl ? <img src={entry.iconSourceUrl} alt=""/> : <span>◇</span>}<b>{entry.name}</b><small>{entry.cost} cost · {entry.sonatas.join(' / ')}</small></button>)}</div></div>}
  </div>
}

function CharacterPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const selected = characterCatalog.find((entry) => entry.name === value)
  const options = useMemo(() => characterCatalog
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.name === entry.name) === index)
    .filter((entry) => `${entry.name} ${entry.element} ${entry.weaponType}`.toLowerCase().includes(query.toLowerCase())), [query])
  useDismissableLayer(open, ref, close)
  return <div className="echo-search-picker scan-character-picker" ref={ref}>
    <button type="button" className="echo-search-trigger" aria-label={`Equipped by ${value || 'Unassigned'}`} aria-expanded={open} onClick={() => { setOpen((current) => !current); setQuery('') }}>{selected ? <img src={selected.iconSourceUrl} alt=""/> : <span>—</span>}<b>{value || 'Unassigned'}</b><i>⌄</i></button>
    {open && <div className="echo-search-menu"><input autoFocus aria-label="Filter characters" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter characters..."/><div><button type="button" className={!value ? 'active' : ''} onClick={() => { onChange(''); setOpen(false) }}><span>—</span><b>Unassigned</b><small>No character</small></button>{options.map((entry) => <button type="button" className={entry.name === value ? 'active' : ''} key={entry.name} onClick={() => { onChange(entry.name); setOpen(false) }}><img src={entry.iconSourceUrl} alt=""/><b>{entry.name}</b><small>{entry.element} · {entry.weaponType}</small></button>)}</div></div>}
  </div>
}

export function ScanReviewCard({ candidate, onChange, onDiscard, onSave, selected, onSelect, onRerunField, onCopyDiagnostic }: {
  candidate: DiagnosticScanCandidate
  onChange: (candidate: DiagnosticScanCandidate) => void
  onDiscard: () => void
  onSave: () => void
  selected?: boolean
  onSelect?: (selected: boolean) => void
  onRerunField?: (regionId: string) => void
  onCopyDiagnostic?: (includeImages: boolean) => void
}) {
  const errors = candidateErrors(candidate)
  const selectedEcho = echoCatalog.find((entry) => entry.name === candidate.fields.name.value)
  const rarityOptions = selectedEcho?.rarities?.filter((value): value is Echo['rarity'] => [1, 2, 3, 4, 5].includes(value)) ?? [1, 2, 3, 4, 5] as Echo['rarity'][]
  const maxLevel = maxLevelByRarity[candidate.fields.rarity.value]
  const maxSubStats = maxSubStatsForLevel(candidate.fields.level.value)
  const secondary = fixedSecondaryMainStat({ cost: candidate.fields.cost.value, rarity: candidate.fields.rarity.value, level: candidate.fields.level.value })
  const updateFields = (fields: Partial<ScanCandidate['fields']>) => onChange({ ...candidate, fields: { ...candidate.fields, ...fields } })
  const updateBuildCard = (patch: Partial<NonNullable<ScanCandidate['buildCard']>>) => {
    if (candidate.buildCard) onChange({ ...candidate, buildCard: { ...candidate.buildCard, ...patch } })
  }
  const normalizedMain = (cost: Echo['cost'], rarity: Echo['rarity'], level: number, key = candidate.fields.mainStat.value.key) => normalizeEchoMainStat({ cost, rarity, level, mainStat: { key, value: candidate.fields.mainStat.value.value } })
  const selectEcho = (name: string) => {
    const entry = echoCatalog.find((item) => item.name === name)
    if (!entry) return
    const sonata = entry.sonatas.includes(candidate.fields.sonata.value) ? candidate.fields.sonata.value : entry.sonatas[0] ?? candidate.fields.sonata.value
    const supportedRarities = entry.rarities?.filter((value): value is Echo['rarity'] => [1, 2, 3, 4, 5].includes(value)) ?? [1, 2, 3, 4, 5] as Echo['rarity'][]
    const rarity = supportedRarities.includes(candidate.fields.rarity.value) ? candidate.fields.rarity.value : Math.max(...supportedRarities) as Echo['rarity']
    const level = Math.min(candidate.fields.level.value, maxLevelByRarity[rarity])
    updateFields({
      name: { value: name, confidence: 1 },
      cost: { value: entry.cost, confidence: 1 },
      rarity: { value: rarity, confidence: 1 },
      level: { value: level, confidence: 1 },
      sonata: { value: sonata, confidence: 1 },
      mainStat: { value: normalizedMain(entry.cost, rarity, level), confidence: 1 },
      subStats: candidate.fields.subStats.slice(0, maxSubStatsForLevel(level))
    })
  }
  const setRarity = (rarity: Echo['rarity']) => {
    const level = Math.min(candidate.fields.level.value, maxLevelByRarity[rarity])
    updateFields({ rarity: { value: rarity, confidence: 1 }, level: { value: level, confidence: 1 }, mainStat: { value: normalizedMain(candidate.fields.cost.value, rarity, level), confidence: 1 }, subStats: candidate.fields.subStats.slice(0, maxSubStatsForLevel(level)) })
  }
  const setLevel = (level: number) => updateFields({ level: { value: level, confidence: 1 }, mainStat: { value: normalizedMain(candidate.fields.cost.value, candidate.fields.rarity.value, level), confidence: 1 }, subStats: candidate.fields.subStats.slice(0, maxSubStatsForLevel(level)) })
  const setMainStat = (key: StatKey) => updateFields({ mainStat: { value: normalizedMain(candidate.fields.cost.value, candidate.fields.rarity.value, candidate.fields.level.value, key), confidence: 1 } })
  const setSubStat = (index: number, key: StatKey, rollIndex?: number) => updateFields({ subStats: candidate.fields.subStats.map((field, fieldIndex) => {
    if (fieldIndex !== index) return field
    const rolls = tunableRolls[key] ?? []
    const currentIndex = rolls.findIndex((roll) => Math.abs(roll.value - field.value.value) < .001)
    return { value: { key, value: rolls[Math.max(0, rollIndex ?? currentIndex)]?.value ?? 0 }, confidence: 1 }
  }) })
  const setState = (field: 'locked' | 'excluded', value: boolean) => updateFields({ [field]: { value, confidence: 1 }, ...(value ? { [field === 'locked' ? 'excluded' : 'locked']: { value: false, confidence: 1 } } : {}) })
  const lowConfidence = Object.values(candidate.evidence ?? {}).some((entry) => entry.confidence < .55 || !entry.validation.valid)
  const lowConfidenceCount = Object.values(candidate.evidence ?? {}).filter((entry) => entry.confidence < .55 || !entry.validation.valid).length
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const sonataMissing = !candidate.fields.sonata.value.trim() || candidate.fields.sonata.value === 'Unknown Sonata'

  return <Panel className={`review-card ${candidate.buildCard ? 'build-card-review ' : ''}${errors.length === 0 && !lowConfidence && !evidenceOpen ? 'valid-compact' : ''}`}>
    <div className="review-topbar">
      <div>{onSelect && <label className="review-select"><input type="checkbox" checked={Boolean(candidate.selected)} onChange={(event) => onSelect(event.target.checked)}/>Select</label>}<button className="text-button" type="button" onClick={() => setEvidenceOpen((open) => !open)}>{evidenceOpen ? 'Hide field evidence' : 'Show field evidence'}</button></div>
      <div className="review-actions"><button className="review-discard" onClick={onDiscard}>Discard</button><button className="primary" disabled={errors.length > 0} onClick={onSave}>Approve & save</button></div>
    </div>
    <section className={`review-attention ${errors.length ? 'needs-attention' : 'is-ready'}`}>
      <div><strong>{errors.length ? `${errors.length} required ${errors.length === 1 ? 'fix' : 'fixes'}` : 'Required fields are ready'}</strong><small>{errors.length ? 'Resolve these before this Echo can be saved.' : 'Review the values below, then approve when they match the image.'}</small></div>
      {errors.length > 0 && <ul>{errors.map((message) => <li key={message}>{message}</li>)}</ul>}
      {lowConfidenceCount > 0 && <button type="button" className="text-button" onClick={() => setEvidenceOpen(true)}>{lowConfidenceCount} low-confidence {lowConfidenceCount === 1 ? 'field' : 'fields'} — inspect evidence</button>}
    </section>
    <div className="review-fields">
      {candidate.buildCard && <section className="scan-build-card-summary">
        <header><div><span className="eyebrow">Official Discord build card</span><h3>Character loadout</h3></div><img src={candidate.buildCard.sourceImageDataUrl} alt="Scanned build card"/></header>
        <div className="scan-build-card-fields">
          <label>Character <Confidence value={candidate.buildCard.character.confidence}/><select value={candidate.buildCard.characterCatalogId ?? ''} onChange={(event) => { const entry = characterCatalog.find((item) => item.id === event.target.value); if (entry) updateBuildCard({ characterCatalogId: entry.id, character: { value: entry.name, confidence: 1 } }) }}><option value="">Choose character</option>{characterCatalog.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
          <label>Character level <Confidence value={candidate.buildCard.characterLevel.confidence}/><input type="number" min="1" max="90" value={candidate.buildCard.characterLevel.value} onChange={(event) => updateBuildCard({ characterLevel: { value: Math.max(1, Math.min(90, Number(event.target.value))), confidence: 1 } })}/></label>
          <label>Sequence <Confidence value={candidate.buildCard.sequence.confidence}/><select value={candidate.buildCard.sequence.value} onChange={(event) => updateBuildCard({ sequence: { value: Number(event.target.value), confidence: 1 } })}>{[0, 1, 2, 3, 4, 5, 6].map((value) => <option value={value} key={value}>S{value}</option>)}</select></label>
          <label>Weapon <Confidence value={candidate.buildCard.weapon.confidence}/><select value={candidate.buildCard.weaponCatalogId ?? ''} onChange={(event) => { const entry = weaponCatalog.find((item) => item.id === event.target.value); if (entry) updateBuildCard({ weaponCatalogId: entry.id, weapon: { value: entry.name, confidence: 1 } }) }}><option value="">Choose weapon</option>{weaponCatalog.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
          <label>Weapon level <Confidence value={candidate.buildCard.weaponLevel.confidence}/><input type="number" min="1" max="90" value={candidate.buildCard.weaponLevel.value} onChange={(event) => updateBuildCard({ weaponLevel: { value: Math.max(1, Math.min(90, Number(event.target.value))), confidence: 1 } })}/></label>
        </div>
        <div className="scan-build-card-skills"><span>Skills</span>{['Normal', 'Skill', 'Forte', 'Liberation', 'Intro'].map((label, index) => <label key={label}>{label}<Confidence value={candidate.buildCard!.skillLevels[index]?.confidence ?? 0}/><input type="number" min="1" max="10" value={candidate.buildCard!.skillLevels[index]?.value ?? 1} onChange={(event) => updateBuildCard({ skillLevels: candidate.buildCard!.skillLevels.map((field, fieldIndex) => fieldIndex === index ? { value: Math.max(1, Math.min(10, Number(event.target.value))), confidence: 1 } : field) })}/></label>)}</div>
      </section>}
      <label className="scan-name-field">Name <Confidence value={candidate.fields.name.confidence}/><EchoPicker value={candidate.fields.name.value} onChange={selectEcho}/></label>
      <label className={sonataMissing ? 'field-needs-attention' : ''}>Sonata {sonataMissing && <b className="required-field-badge">Required</b>}<Confidence value={candidate.fields.sonata.confidence}/><SonataPicker id={`sonata-options-${candidate.id}`} value={candidate.fields.sonata.value} allowedNames={selectedEcho?.sonatas} onChange={(value) => updateFields({ sonata: { value, confidence: 1 } })}/></label>
      <label>Rarity <Confidence value={candidate.fields.rarity.confidence}/><select value={candidate.fields.rarity.value} onChange={(event) => setRarity(Number(event.target.value) as Echo['rarity'])}>{rarityOptions.map((value) => <option key={value} value={value}>{value} star</option>)}</select></label>
      <label>Cost <Confidence value={candidate.fields.cost.confidence}/><div className="scan-readonly-field"><b>{candidate.fields.cost.value}</b><small>From Echo catalog</small></div></label>
      <label>Equipped by <Confidence value={candidate.fields.equippedBy.confidence}/><CharacterPicker value={candidate.fields.equippedBy.value} onChange={(value) => updateFields({ equippedBy: { value, confidence: 1 } })}/></label>
      <div className="echo-level-editor scan-level-editor"><label>Level <Confidence value={candidate.fields.level.confidence}/><strong>+{candidate.fields.level.value}</strong><input aria-label="Level" type="range" min="0" max={maxLevel} value={candidate.fields.level.value} onChange={(event) => setLevel(Number(event.target.value))}/></label><div>{levelStops.filter((level) => level <= maxLevel).map((level) => <button type="button" className={candidate.fields.level.value === level ? 'active' : ''} onClick={() => setLevel(level)} key={level}>+{level}</button>)}</div></div>
      <div className="echo-state-review"><span>In-game state</span><label><input type="checkbox" checked={candidate.fields.locked.value} onChange={(event) => setState('locked', event.target.checked)}/>Locked <Confidence value={candidate.fields.locked.confidence}/></label><label><input type="checkbox" checked={candidate.fields.excluded.value} onChange={(event) => setState('excluded', event.target.checked)}/>Discarded <Confidence value={candidate.fields.excluded.confidence}/></label><small>Read independently from the C lock and Z discard icons. Confidence now reflects the captured icon pixels.</small></div>
      <div className="echo-main-stat-group scan-main-stat-group">
        <div className="echo-stat-line main"><span>Primary <Confidence value={candidate.fields.mainStat.confidence}/></span><select value={candidate.fields.mainStat.value.key} onChange={(event) => setMainStat(event.target.value as StatKey)}>{mainStatKeysByCost[candidate.fields.cost.value].map((key) => <option key={key} value={key}>{statLabels[key]}</option>)}</select><div className="echo-fixed-stat"><span>Level value</span><strong>{formatStat(candidate.fields.mainStat.value.key, candidate.fields.mainStat.value.value)}</strong></div></div>
        <div className="echo-stat-line secondary-main"><span>Secondary</span><div className="echo-readonly-name">{statLabels[secondary.key]}</div><div className="echo-fixed-stat"><span>Fixed value</span><strong>{formatStat(secondary.key, secondary.value)}</strong></div></div>
      </div>
      <div className="echo-editor-substats scan-substats"><header><div><span className="eyebrow">Fixed roll values</span><h3>Substats</h3></div><b>{candidate.fields.subStats.length}/{maxSubStats}</b></header>{candidate.fields.subStats.map((field, index) => { const rolls = tunableRolls[field.value.key] ?? []; const rollIndex = Math.max(0, rolls.findIndex((roll) => Math.abs(roll.value - field.value.value) < .001)); return <div className="echo-substat-row" key={`${candidate.id}-${index}`}><div className="echo-stat-line"><span>#{index + 1} <Confidence value={field.confidence}/></span><select value={field.value.key} onChange={(event) => setSubStat(index, event.target.value as StatKey, 0)}>{subStatKeys.map((key) => <option key={key} value={key}>{statLabels[key]}</option>)}</select><strong>{formatStat(field.value.key, rolls[rollIndex]?.value ?? field.value.value)}</strong><button type="button" className="text-button" onClick={() => updateFields({ subStats: candidate.fields.subStats.filter((_, fieldIndex) => fieldIndex !== index) })}>Remove</button></div><div className="echo-roll-slider"><input aria-label={`Substat ${index + 1} roll`} type="range" min="0" max={Math.max(0, rolls.length - 1)} step="1" value={rollIndex} onChange={(event) => setSubStat(index, field.value.key, Number(event.target.value))}/><div>{rolls.map((roll, point) => <i className={point === rollIndex ? 'active' : ''} key={roll.value}>{roll.value}</i>)}</div></div></div> })}<button type="button" className="secondary add-substat" disabled={candidate.fields.subStats.length >= maxSubStats} onClick={() => updateFields({ subStats: [...candidate.fields.subStats, { value: { key: 'critRate', value: tunableRolls.critRate?.[0].value ?? 6.3 }, confidence: 1 }] })}>+ Add substat</button></div>
      {candidate.duplicateOf && <div className="notice warning">Possible duplicate. Saving creates a separate inventory item.</div>}
      {errors.length > 0 && <div className="notice error">{errors.join(' ')}</div>}
      {evidenceOpen && candidate.evidence && <div className="scan-evidence-drawer"><header><div><span className="eyebrow">Local diagnostics</span><h3>Field evidence</h3></div><div>{onCopyDiagnostic && <><button type="button" className="text-button" onClick={() => onCopyDiagnostic(false)}>Copy report</button><button type="button" className="text-button" onClick={() => onCopyDiagnostic(true)}>Copy with images</button></>}</div></header><div className="scan-evidence-grid">{Object.values(candidate.evidence).map((evidence) => <article className={evidence.validation.valid ? '' : 'invalid'} key={evidence.region.id}><header><b>{evidence.region.label}</b><span>{Math.round(evidence.confidence * 100)}%</span></header><div><figure><img src={evidence.originalCrop} alt={`${evidence.region.label} original crop`}/><figcaption>Original</figcaption></figure><figure><img src={evidence.processedCrop} alt={`${evidence.region.label} processed crop`}/><figcaption>{evidence.preprocessing}</figcaption></figure></div><code>{evidence.rawOcr.trim() || 'Visual classifier'}</code><small>{evidence.workerId} · {Math.round(evidence.processingMs)} ms</small>{evidence.validation.messages.map((message) => <p key={message}>{message}</p>)}{onRerunField && !candidate.buildCard && <footer><button type="button" className="text-button" onClick={() => onRerunField(evidence.region.id)}>Re-run field</button></footer>}</article>)}</div></div>}
    </div>
  </Panel>
}
