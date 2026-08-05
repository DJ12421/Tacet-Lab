import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { echoMatchesOptimizerProfile } from '../domain/optimizer'
import type { AggregatedStats, Echo, OptimizerProfile, OptimizerStatKey, StatKey } from '../domain/types'
import { echoCatalog, sonataCatalog, statLabels } from '../game-data'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { mainStatKeysByCost } from '../game-data/echo-main-stats'
import { EchoMiniCard, formatStat, Icon, Panel } from './components'

const CORE_STATS: OptimizerStatKey[] = ['hp', 'atk', 'def', 'critRate', 'critDamage', 'energyRegen', 'basicDamage', 'heavyDamage', 'skillDamage', 'liberationDamage']
const RESULT_LIMITS = [5, 10, 20, 50, 100]
const WORKER_COUNTS: Array<number | 'auto'> = ['auto', 1, 2, 4, 8, 12, 16]
const STAT_ICON_NAMES: Partial<Record<StatKey, string>> = {
  hp: 'Icon_Attribute_Health.webp', hpPercent: 'Icon_Attribute_Health.webp',
  atk: 'Icon_Attribute_Attack.webp', atkPercent: 'Icon_Attribute_Attack.webp',
  def: 'Icon_Attribute_Defense.webp', defPercent: 'Icon_Attribute_Defense.webp',
  critRate: 'Icon_Attribute_Crit_Rate.webp', critDamage: 'Icon_Attribute_Crit_DMG.webp',
  energyRegen: 'Icon_Attribute_Energy_Regen.webp', healingBonus: 'Icon_Attribute_Healing.webp',
  basicDamage: 'Icon_Basic_Attack_DMG_Amplification.webp', heavyDamage: 'Icon_Heavy_Attack_DMG_Amplification.webp',
  skillDamage: 'Icon_Resonance_Skill_DMG_Amplification.webp', liberationDamage: 'Icon_Resonance_Liberation_DMG_Amplification.webp',
  glacioDamage: 'Icon_Glacio_DMG_Bonus.webp', fusionDamage: 'Icon_Fusion_DMG_Bonus.webp',
  electroDamage: 'Icon_Electro_DMG_Bonus.webp', aeroDamage: 'Icon_Aero_DMG_Bonus.webp',
  spectroDamage: 'Icon_Spectro_DMG_Bonus.webp', havocDamage: 'Icon_Havoc_DMG_Bonus.webp'
}

function optimizerStatIconSource(stat: StatKey) {
  return `https://wuwa-optimizer.com/images/icons/${STAT_ICON_NAMES[stat] ?? 'Icon_Attribute_Attack.webp'}`
}

function OptimizerEchoThumb({ echo, main }: { echo?: Echo; main?: boolean }) {
  if (!echo) return <span className="optimizer-echo-thumb is-empty" aria-label="Empty Echo slot"><b>+</b></span>
  const artwork = echoCatalog.find((entry) => entry.name === echo.name)?.iconSourceUrl
  const sonataIcon = generatedSonataIconSources[echo.sonata]
  return <span className={`optimizer-echo-thumb${main ? ' is-main' : ''}`} title={`${echo.name} · +${echo.level} · ${echo.cost} cost`}>
    {artwork ? <img className="optimizer-echo-thumb-art" src={artwork} alt={echo.name} loading="lazy"/> : <b className="optimizer-echo-thumb-fallback">◇</b>}
    <strong>+{echo.level}</strong><b className={`cost-${echo.cost}`}>{echo.cost}</b>
    <img className="optimizer-echo-stat-icon" src={optimizerStatIconSource(echo.mainStat.key)} alt="" title={statLabels[echo.mainStat.key]} aria-hidden="true"/>
    {sonataIcon && <img className="optimizer-echo-sonata-icon" src={sonataIcon} alt="" title={echo.sonata}/>}
  </span>
}
const SONATA_MODE_COPY: Record<OptimizerProfile['sonataMode'], string> = {
  any: 'Allow every legal set shape that uses the enabled Sonata effects.',
  highest: 'Require the highest generated set effect for at least one enabled Sonata.',
  dual: 'Require active effects from at least two different enabled Sonatas.',
  custom: 'Require every Sonata threshold listed below.'
}

type OptimizerSetupProps = {
  profile: OptimizerProfile
  setProfile: Dispatch<SetStateAction<OptimizerProfile>>
  echoes: Echo[]
  currentEchoes: Echo[]
  buildId: string
  buildName: string
  characterName: string
  portraitUrl?: string
  weaponName: string
  currentStats?: AggregatedStats
  currentScore?: number
  objectiveLabel: string
  targetId: string
  targets: Array<{ id: string; label: string }>
  onTargetChange: (id: string) => void
  scalesWith: string[]
  running: boolean
  onRun: () => void
  onCancel: () => void
}

export function OptimizerSetup(props: OptimizerSetupProps) {
  const {
    profile, setProfile, echoes, currentEchoes, buildId, buildName, characterName, portraitUrl, weaponName,
    currentStats, currentScore, objectiveLabel, targetId, targets, onTargetChange, scalesWith, running, onRun, onCancel
  } = props
  const [constraintStat, setConstraintStat] = useState<OptimizerStatKey>('energyRegen')
  const [requirementSonata, setRequirementSonata] = useState(sonataCatalog[0]?.name ?? '')
  const [requirementPieces, setRequirementPieces] = useState(2)
  const [exclusionSearch, setExclusionSearch] = useState('')
  const update = (patch: Partial<OptimizerProfile>) => setProfile((current) => ({ ...current, ...patch, updatedAt: Date.now() }))
  const eligible = useMemo(() => echoes.filter((echo) => echoMatchesOptimizerProfile(echo, profile, buildId)), [buildId, echoes, profile])
  const mainOptions = eligible
  const sonataCounts = useMemo(() => new Map(echoes.map((echo) => echo.sonata).map((name) => [name, echoes.filter((echo) => echo.sonata === name).length])), [echoes])
  const filteredExclusions = echoes.filter((echo) => `${echo.name} ${echo.sonata} ${statLabels[echo.mainStat.key]}`.toLowerCase().includes(exclusionSearch.toLowerCase()))

  const toggleRarity = (rarity: Echo['rarity']) => update({
    rarities: profile.rarities.includes(rarity) ? profile.rarities.filter((entry) => entry !== rarity) : [...profile.rarities, rarity].sort()
  })
  const toggleMainStat = (cost: Echo['cost'], key: StatKey) => {
    const costKey = String(cost) as '1' | '3' | '4'
    const selected = profile.mainStatsByCost[costKey]
    update({ mainStatsByCost: { ...profile.mainStatsByCost, [costKey]: selected.includes(key) ? selected.filter((entry) => entry !== key) : [...selected, key] } })
  }
  const toggleSonata = (name: string) => update({
    allowedSonatas: profile.allowedSonatas.includes(name) ? profile.allowedSonatas.filter((entry) => entry !== name) : [...profile.allowedSonatas, name]
  })
  const addConstraint = () => {
    if (constraintStat in profile.minimumStats || constraintStat in profile.maximumStats) return
    update({ minimumStats: { ...profile.minimumStats, [constraintStat]: currentStats?.[constraintStat] ?? 0 } })
  }
  const removeConstraint = (stat: OptimizerStatKey) => {
    const minimumStats = { ...profile.minimumStats }
    const maximumStats = { ...profile.maximumStats }
    delete minimumStats[stat]
    delete maximumStats[stat]
    update({ minimumStats, maximumStats })
  }
  const constraintKeys = [...new Set([...Object.keys(profile.minimumStats), ...Object.keys(profile.maximumStats)])] as OptimizerStatKey[]
  const availableRequirementPieces = sonataCatalog.find((sonata) => sonata.name === requirementSonata)?.effects.map((effect) => effect.pieces) ?? []
  const addRequirement = () => {
    if (!requirementSonata || profile.requiredSonataEffects.some((entry) => entry.sonata === requirementSonata && entry.pieces === requirementPieces)) return
    update({ requiredSonataEffects: [...profile.requiredSonataEffects, { sonata: requirementSonata, pieces: requirementPieces }] })
  }

  return <>
    <section className="optimizer-setup-grid">
      <Panel className="optimizer-current-build">
        <div className="optimizer-current-hero">
          {portraitUrl ? <img src={portraitUrl} alt=""/> : <div className="optimizer-portrait-placeholder"><Icon name="build"/></div>}
          <div><span className="eyebrow">Current loadout</span><h2>{characterName}</h2><strong>{buildName}</strong><small>{weaponName}</small></div>
        </div>
        <div className="optimizer-current-echoes" aria-label="Current Echo loadout">{Array.from({ length: 5 }, (_, index) => <OptimizerEchoThumb echo={currentEchoes[index]} main={index === 0} key={currentEchoes[index]?.id ?? index}/>)}</div>
        <dl className="optimizer-current-stats">{CORE_STATS.slice(0, 8).map((key) => <div key={key}><dt>{statLabels[key]}</dt><dd>{currentStats ? formatStat(key, currentStats[key]) : 'Unavailable'}</dd></div>)}</dl>
        <div className="optimizer-current-target"><span>{objectiveLabel}</span><b>{currentScore === undefined ? 'Unavailable' : Math.floor(currentScore).toLocaleString('en-US')}</b></div>
      </Panel>

      <div className="optimizer-filter-column">
        <Panel className="optimizer-filter-card">
          <header><div><span className="eyebrow">Inventory filters</span><h3>Echo level and rarity</h3></div><b>{eligible.length}/{echoes.length}</b></header>
          <div className="optimizer-level-filter">
            <label><span>Minimum level</span><input type="number" min="0" max="25" value={profile.levelLow} onChange={(event) => update({ levelLow: Math.min(profile.levelHigh, Math.max(0, Number(event.target.value))) })}/></label>
            <div><input aria-label="Minimum Echo level" type="range" min="0" max="25" value={profile.levelLow} onChange={(event) => update({ levelLow: Math.min(profile.levelHigh, Number(event.target.value)) })}/><input aria-label="Maximum Echo level" type="range" min="0" max="25" value={profile.levelHigh} onChange={(event) => update({ levelHigh: Math.max(profile.levelLow, Number(event.target.value)) })}/></div>
            <label><span>Maximum level</span><input type="number" min="0" max="25" value={profile.levelHigh} onChange={(event) => update({ levelHigh: Math.max(profile.levelLow, Math.min(25, Number(event.target.value))) })}/></label>
          </div>
          <div className="optimizer-toggle-row"><span>Rarity</span><div>{([1, 2, 3, 4, 5] as Echo['rarity'][]).map((rarity) => <button type="button" className={profile.rarities.includes(rarity) ? 'active' : ''} onClick={() => toggleRarity(rarity)} key={rarity}>{rarity}★ <small>{echoes.filter((echo) => echo.rarity === rarity).length}</small></button>)}</div></div>
        </Panel>

        <Panel className="optimizer-filter-card optimizer-main-stat-card">
          <header><div><span className="eyebrow">Main stat configuration</span><h3>Allowed stats by Echo cost</h3></div></header>
          {([1, 3, 4] as Echo['cost'][]).map((cost) => <section key={cost}><div><b>{cost}-Cost</b><span>{eligible.filter((echo) => echo.cost === cost).length} eligible</span></div><div>{mainStatKeysByCost[cost].map((key) => {
            const active = profile.mainStatsByCost[String(cost) as '1' | '3' | '4'].includes(key)
            return <button type="button" className={active ? 'active' : ''} onClick={() => toggleMainStat(cost, key)} title={statLabels[key]} key={key}><span>{statLabels[key]}</span><small>{echoes.filter((echo) => echo.cost === cost && echo.mainStat.key === key).length}</small></button>
          })}</div></section>)}
        </Panel>

        <details className="optimizer-editor optimizer-exclusion-editor">
          <summary><span><b>Individual Echo exclusions</b><small>{profile.excludedEchoIds.length} manually excluded</small></span><i>Manage</i></summary>
          <div><input type="search" placeholder="Search Echoes, Sonatas, or main stats" value={exclusionSearch} onChange={(event) => setExclusionSearch(event.target.value)}/><div className="optimizer-exclusion-list">{filteredExclusions.map((echo) => <label key={echo.id}><input type="checkbox" checked={profile.excludedEchoIds.includes(echo.id)} onChange={() => update({ excludedEchoIds: profile.excludedEchoIds.includes(echo.id) ? profile.excludedEchoIds.filter((id) => id !== echo.id) : [...profile.excludedEchoIds, echo.id] })}/><span><b>{echo.name}</b><small>{echo.cost}-Cost · Lv. {echo.level} · {echo.sonata} · {statLabels[echo.mainStat.key]}</small></span>{echo.equippedBy && <em>{echo.equippedByName ?? 'Equipped'}</em>}</label>)}</div></div>
        </details>
      </div>

      <div className="optimizer-rule-column">
        <Panel className="optimizer-filter-card optimizer-sonata-card">
          <header><div><span className="eyebrow">Sonata configuration</span><h3>Allowed set effects</h3></div><b>{profile.allowedSonatas.length}/{sonataCatalog.length}</b></header>
          <label className="optimizer-field"><span>Build pattern</span><select value={profile.sonataMode} onChange={(event) => update({ sonataMode: event.target.value as OptimizerProfile['sonataMode'] })}><option value="any">Any allowed pattern</option><option value="highest">Highest-tier set effect</option><option value="dual">Two active Sonatas</option><option value="custom">Custom requirements</option></select><small>{SONATA_MODE_COPY[profile.sonataMode]}</small></label>
          <label className="optimizer-check"><input type="checkbox" checked={profile.allowNoSonata} onChange={(event) => update({ allowNoSonata: event.target.checked })}/><span>Allow builds with no active Sonata effect</span></label>
          <details className="optimizer-sonata-picker"><summary><span>Choose allowed Sonatas</span><b>{profile.allowedSonatas.length} enabled</b></summary><div className="optimizer-picker-actions"><button type="button" onClick={() => update({ allowedSonatas: sonataCatalog.map((sonata) => sonata.name) })}>Enable all</button><button type="button" onClick={() => update({ allowedSonatas: [] })}>Disable all</button></div><div>{sonataCatalog.map((sonata) => <button type="button" className={profile.allowedSonatas.includes(sonata.name) ? 'active' : ''} onClick={() => toggleSonata(sonata.name)} key={sonata.id}><span>{sonata.name}</span><small>{sonata.effects.map((effect) => `${effect.pieces}-pc`).join(' · ')} · {sonataCounts.get(sonata.name) ?? 0} Echoes</small></button>)}</div></details>
          {profile.sonataMode === 'custom' && <div className="optimizer-requirements"><div><select value={requirementSonata} onChange={(event) => { const name = event.target.value; setRequirementSonata(name); setRequirementPieces(sonataCatalog.find((sonata) => sonata.name === name)?.effects[0]?.pieces ?? 1) }}>{sonataCatalog.map((sonata) => <option value={sonata.name} key={sonata.id}>{sonata.name}</option>)}</select><select value={requirementPieces} onChange={(event) => setRequirementPieces(Number(event.target.value))}>{availableRequirementPieces.map((pieces) => <option value={pieces} key={pieces}>{pieces}-piece</option>)}</select><button type="button" onClick={addRequirement}>Add</button></div>{profile.requiredSonataEffects.map((entry) => <span key={`${entry.sonata}-${entry.pieces}`}>{entry.sonata} · {entry.pieces}-piece<button type="button" aria-label={`Remove ${entry.sonata} requirement`} onClick={() => update({ requiredSonataEffects: profile.requiredSonataEffects.filter((required) => required !== entry) })}>×</button></span>)}</div>}
        </Panel>

        <Panel className="optimizer-filter-card optimizer-source-card">
          <header><div><span className="eyebrow">Equipment rules</span><h3>Echo sources and main slot</h3></div></header>
          <label className="optimizer-field"><span>Use equipped Echoes</span><select value={profile.equippedPolicy} onChange={(event) => update({ equippedPolicy: event.target.value as OptimizerProfile['equippedPolicy'] })}><option value="current">Current build + unassigned</option><option value="team">Include current teammates</option><option value="all">Include every saved build</option></select><small>Borrowed Echoes are disclosed before applying a result.</small></label>
          <label className="optimizer-field"><span>Main Echo policy</span><select value={profile.mainEchoPolicy} onChange={(event) => update({ mainEchoPolicy: event.target.value as OptimizerProfile['mainEchoPolicy'] })}><option value="current">Keep current main Echo</option><option value="any">Optimize the main Echo too</option><option value="selected">Require a selected main Echo</option></select><small>The main Echo is evaluated as slot one, including its active mechanics.</small></label>
          {profile.mainEchoPolicy === 'selected' && <label className="optimizer-field"><span>Selected main Echo</span><select value={profile.selectedMainEchoId ?? ''} onChange={(event) => update({ selectedMainEchoId: event.target.value || undefined })}><option value="">Choose an Echo</option>{mainOptions.map((echo) => <option value={echo.id} key={echo.id}>{echo.name} · Lv. {echo.level} · {echo.sonata}</option>)}</select></label>}
          <label className="optimizer-check"><input type="checkbox" checked={profile.allowPartial} onChange={(event) => update({ allowPartial: event.target.checked })}/><span>Allow partial builds with fewer than five Echoes</span></label>
        </Panel>

        <Panel className="optimizer-filter-card optimizer-constraint-card">
          <header><div><span className="eyebrow">Build constraints</span><h3>Minimum and maximum values</h3></div><b>{constraintKeys.length}</b></header>
          <div className="optimizer-add-constraint"><select value={constraintStat} onChange={(event) => setConstraintStat(event.target.value as OptimizerStatKey)}>{CORE_STATS.map((key) => <option value={key} key={key}>{statLabels[key]}</option>)}</select><button type="button" onClick={addConstraint}>Add constraint</button></div>
          <div className="optimizer-constraint-list">{constraintKeys.map((key) => <div key={key}><span>{statLabels[key]}</span><label><small>Minimum</small><input type="number" step="0.1" value={profile.minimumStats[key] ?? ''} placeholder="None" onChange={(event) => { const value = event.target.value; const minimumStats = { ...profile.minimumStats }; if (value === '') delete minimumStats[key]; else minimumStats[key] = Number(value); update({ minimumStats }) }}/></label><label><small>Maximum</small><input type="number" step="0.1" value={profile.maximumStats[key] ?? ''} placeholder="None" onChange={(event) => { const value = event.target.value; const maximumStats = { ...profile.maximumStats }; if (value === '') delete maximumStats[key]; else maximumStats[key] = Number(value); update({ maximumStats }) }}/></label><button type="button" aria-label={`Remove ${statLabels[key]} constraint`} onClick={() => removeConstraint(key)}>×</button></div>)}</div>
          <div className="optimizer-score-constraints"><label><span>Minimum target score</span><input type="number" value={profile.minimumScore ?? ''} placeholder="None" onChange={(event) => update({ minimumScore: event.target.value === '' ? undefined : Number(event.target.value) })}/></label><label><span>Maximum target score</span><input type="number" value={profile.maximumScore ?? ''} placeholder="None" onChange={(event) => update({ maximumScore: event.target.value === '' ? undefined : Number(event.target.value) })}/></label></div>
        </Panel>
      </div>
    </section>

    <div className="optimizer-scales-with"><span>Selected target scales with</span>{scalesWith.map((label) => <b key={label}>{label}</b>)}<small>Team effects, enemy state, sequences, weapon effects, and enabled conditions are frozen when generation starts.</small></div>
    <Panel className="optimizer-run-bar">
      <label><span>Optimization target</span><select value={targetId} onChange={(event) => onTargetChange(event.target.value)}>{targets.map((target) => <option value={target.id} key={target.id}>{target.label}</option>)}</select></label>
      <label><span>Results</span><select value={profile.resultLimit} onChange={(event) => update({ resultLimit: Number(event.target.value) })}>{RESULT_LIMITS.map((limit) => <option value={limit} key={limit}>{limit} builds</option>)}</select></label>
      <label><span>Workers</span><select value={profile.workerCount} onChange={(event) => update({ workerCount: event.target.value === 'auto' ? 'auto' : Number(event.target.value) })}>{WORKER_COUNTS.map((count) => <option value={count} key={count}>{count === 'auto' ? 'Auto' : count}</option>)}</select></label>
      <label><span>Search</span><select value={profile.searchMode} onChange={(event) => update({ searchMode: event.target.value as OptimizerProfile['searchMode'] })}><option value="exact">Exact</option><option value="fast">Fast · capped</option></select></label>
      {profile.searchMode === 'fast' && <label><span>Evaluation cap</span><input type="number" min="1000" step="100000" value={profile.maxEvaluations} onChange={(event) => update({ maxEvaluations: Math.max(1000, Number(event.target.value)) })}/></label>}
      <span className="optimizer-run-summary"><small>Available</small><b>{eligible.length} Echoes</b></span>
      {running ? <button className="danger" onClick={onCancel}>Cancel search</button> : <button className="primary" onClick={onRun}><Icon name="optimize"/>Generate builds</button>}
    </Panel>
  </>
}
