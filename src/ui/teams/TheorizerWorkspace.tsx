import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { defaultTheorycraftSlots, groupTheorycraftSonatas } from '../../domain/loadouts'
import type { Build, Echo, EquippedLoadout, FormulaResultMode, OwnedCharacter, OwnedWeapon, StatKey, TheorycraftBuild } from '../../domain/types'
import { echoCatalog, sonataCatalog, statLabels } from '../../game-data'
import { fixedSecondaryMainStat, maxLevelByRarity, primaryMainStatValue } from '../../game-data/echo-main-stats'
import { generatedSonataIconSources } from '../../game-data/sonatas.generated'
import type { TheorizerMode, TheorizerRankingRequest, TheorizerRankingResponse } from '../../workers/theorizer.worker'
import { optimizerStatIconSource } from '../OptimizerSetup'
import { formatWorkspaceStat, type TeamMemberModel, type TeamWorkspaceModel } from '../team-workspace-model'

type RankedSuggestion = TheorizerRankingResponse['results'][number]

let theorizerWorker: Worker | undefined
let theorizerRequestId = 0
const theorizerPending = new Map<number, { resolve: (value: TheorizerRankingResponse) => void; reject: (error: Error) => void }>()
const theorizerCache: Array<{ input: Omit<TheorizerRankingRequest, 'requestId'>; response: TheorizerRankingResponse }> = []

function sameRankingInput(left: Omit<TheorizerRankingRequest, 'requestId'>, right: Omit<TheorizerRankingRequest, 'requestId'>) {
  return left.mode === right.mode && left.targetId === right.targetId && left.resultMode === right.resultMode
    && left.scalesWith === right.scalesWith && left.element === right.element && left.weaponType === right.weaponType
    && left.memberSlot === right.memberSlot && left.baseline === right.baseline && left.team === right.team
    && left.echoes === right.echoes && left.builds === right.builds && left.characters === right.characters
    && left.weapons === right.weapons && left.equippedLoadouts === right.equippedLoadouts
    && left.theorycraftBuilds === right.theorycraftBuilds && left.roverGender === right.roverGender
    && left.substatDraft === right.substatDraft
}

function rankTheorizer(input: Omit<TheorizerRankingRequest, 'requestId'>) {
  const cachedIndex = theorizerCache.findIndex((entry) => sameRankingInput(entry.input, input))
  if (cachedIndex >= 0) {
    const [cached] = theorizerCache.splice(cachedIndex, 1)
    theorizerCache.push(cached)
    return Promise.resolve(cached.response)
  }
  if (theorizerWorker && theorizerPending.size) {
    theorizerWorker.terminate()
    for (const pending of theorizerPending.values()) pending.reject(new Error('Theorizer ranking superseded.'))
    theorizerPending.clear()
    theorizerWorker = undefined
  }
  if (!theorizerWorker) {
    theorizerWorker = new Worker(new URL('../../workers/theorizer.worker.ts', import.meta.url), { type: 'module' })
    theorizerWorker.onmessage = (event: MessageEvent<TheorizerRankingResponse>) => {
      const pending = theorizerPending.get(event.data.requestId)
      if (!pending) return
      theorizerPending.delete(event.data.requestId)
      pending.resolve(event.data)
    }
    theorizerWorker.onerror = () => {
      for (const pending of theorizerPending.values()) pending.reject(new Error('Theorizer ranking failed.'))
      theorizerPending.clear()
      theorizerWorker?.terminate()
      theorizerWorker = undefined
    }
  }
  const requestId = ++theorizerRequestId
  const pending = new Promise<TheorizerRankingResponse>((resolve, reject) => {
    theorizerPending.set(requestId, { resolve, reject })
    theorizerWorker!.postMessage({ ...input, requestId })
  })
  return pending.then((response) => {
    theorizerCache.push({ input, response })
    if (theorizerCache.length > 24) theorizerCache.shift()
    return response
  })
}

const MODES: Array<{ id: TheorizerMode; label: string }> = [
  { id: 'mainStats', label: 'Main Stats' },
  { id: 'substats', label: 'Sub Stats' },
  { id: 'sonatas', label: 'Sonata Sets' },
  { id: 'weapons', label: 'Weapons' }
]

type ComparisonStats = NonNullable<TheorizerRankingResponse['baselineStats']>
type ComparisonStat = { key: StatKey; read: (stats: ComparisonStats) => number }
const directStat = (key: 'hp' | 'atk' | 'def' | 'critRate' | 'critDamage' | 'energyRegen' | 'healingBonus'): ComparisonStat => ({ key, read: (stats) => stats[key] })
const typeStat = (key: 'basicDamage' | 'heavyDamage' | 'skillDamage' | 'liberationDamage', type: 'basic' | 'heavy' | 'skill' | 'liberation'): ComparisonStat => ({ key, read: (stats) => stats.typeDamage[type] ?? 0 })
const elementStat = (key: 'spectroDamage' | 'fusionDamage' | 'glacioDamage' | 'electroDamage' | 'aeroDamage' | 'havocDamage', element: 'spectro' | 'fusion' | 'glacio' | 'electro' | 'aero' | 'havoc'): ComparisonStat => ({ key, read: (stats) => stats.elementalDamage[element] })
const COMPARISON_GROUPS: Array<{ label: string; stats: ComparisonStat[] }> = [
  { label: 'Basic stats', stats: [directStat('hp'), directStat('atk'), directStat('def')] },
  { label: 'Combat stats', stats: [directStat('critRate'), directStat('critDamage'), directStat('energyRegen'), directStat('healingBonus')] },
  { label: 'Damage bonuses', stats: [typeStat('basicDamage', 'basic'), typeStat('heavyDamage', 'heavy'), typeStat('skillDamage', 'skill'), typeStat('liberationDamage', 'liberation')] },
  { label: 'Element bonuses', stats: [elementStat('spectroDamage', 'spectro'), elementStat('fusionDamage', 'fusion'), elementStat('glacioDamage', 'glacio'), elementStat('electroDamage', 'electro'), elementStat('aeroDamage', 'aero'), elementStat('havocDamage', 'havoc')] }
]
const THEORIZER_RARITY: Echo['rarity'] = 5
const THEORIZER_LEVEL = maxLevelByRarity[THEORIZER_RARITY]
const clone = <T,>(value: T): T => structuredClone(value)
const memberName = (member: TeamMemberModel) => member.catalog?.name ?? `Member ${member.slot + 1}`
const counts = (values: string[]) => [...new Set(values)].map((name) => ({ name, pieces: values.filter((value) => value === name).length }))

function baselineDraft(member: TeamMemberModel): TheorycraftBuild {
  const now = Date.now()
  const echoes = member.resolvedEchoes
  const fallbackSlots = defaultTheorycraftSlots()
  const slots = Array.from({ length: 5 }, (_, index) => {
    const echo = echoes[index]
    return echo
      ? { cost: echo.cost, rarity: echo.rarity, level: echo.level, mainStatKey: echo.mainStat.key }
      : { ...fallbackSlots[index]!, rarity: THEORIZER_RARITY, level: THEORIZER_LEVEL }
  })
  const sonatas = counts(echoes.map((echo) => echo.sonata))
  const missingPieces = 5 - sonatas.reduce((sum, entry) => sum + entry.pieces, 0)
  if (missingPieces > 0) {
    const name = sonatas[0]?.name ?? echoCatalog.find((echo) => echo.name === member.resolvedEchoes[0]?.name)?.sonatas[0] ?? sonataCatalog[0]?.name ?? ''
    const existing = sonatas.find((entry) => entry.name === name)
    if (existing) existing.pieces += missingPieces
    else if (name) sonatas.push({ name, pieces: missingPieces })
  }
  return {
    id: `theorizer-${now}`,
    name: `${memberName(member)} suggestion`,
    description: '',
    characterId: member.character!.id,
    weapon: { catalogId: member.resolvedWeapon?.catalogId ?? '', level: member.resolvedWeapon?.level ?? 90, rank: member.resolvedWeapon?.rank ?? 1 },
    mainEchoName: echoes[0]?.name ?? echoCatalog.find((echo) => echo.cost === slots[0].cost)?.name ?? '',
    slots,
    sonatas,
    substats: { mode: 'slots', slots: Array.from({ length: 5 }, (_, index) => clone(echoes[index]?.subStats ?? [])) },
    createdAt: now,
    updatedAt: now
  }
}

function MainStatPlan({ draft }: { draft: TheorycraftBuild }) {
  return <span className="tw-theorizer-main-plan">{draft.slots.map((slot, index) => {
    const value = primaryMainStatValue(slot.cost, slot.rarity, slot.level, slot.mainStatKey) ?? 0
    const secondary = fixedSecondaryMainStat({ cost: slot.cost, rarity: slot.rarity, level: slot.level })
    return <span className="tw-theorizer-stat-slot" key={index}><strong>{slot.cost}</strong><span><img src={optimizerStatIconSource(slot.mainStatKey)} alt={statLabels[slot.mainStatKey]}/><b>{formatWorkspaceStat(slot.mainStatKey, value)}</b></span><em><img src={optimizerStatIconSource(secondary.key)} alt={statLabels[secondary.key]}/>{formatWorkspaceStat(secondary.key, secondary.value)}</em></span>
  })}</span>
}

function SonataPlan({ draft }: { draft: TheorycraftBuild }) {
  return <span className="tw-theorizer-sonata-plan">{groupTheorycraftSonatas(draft.sonatas).map((group, index) => <span title={group.names.join(', ')} key={`${group.key}:${index}`}><b>{group.pieces}<small>pc</small></b><span className="tw-theorizer-sonata-icons">{group.names.map((name) => generatedSonataIconSources[name] && <img src={generatedSonataIconSources[name]} alt="" key={name}/>)}</span><strong>{group.label}</strong></span>)}</span>
}

function ComparisonModal({ entry, baselineScore, baselineStats, resultModeLabel, targetLabel, onClose }: {
  entry: RankedSuggestion
  baselineScore: number
  baselineStats?: TheorizerRankingResponse['baselineStats']
  resultModeLabel: string
  targetLabel: string
  onClose: () => void
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  const percent = baselineScore ? entry.delta / baselineScore * 100 : 0
  return createPortal(<div className="modal-backdrop tw-theorizer-compare-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="tw-theorizer-compare-modal" role="dialog" aria-modal="true" aria-labelledby="tw-theorizer-compare-title">
      <header><div><span className="eyebrow">Current vs. suggestion</span><h2 id="tw-theorizer-compare-title">{entry.label}</h2><p>{targetLabel} · {resultModeLabel}</p></div><button type="button" className="close" aria-label="Close comparison" onClick={onClose}>×</button></header>
      <div className="tw-theorizer-damage-comparison"><span><small>Current</small><strong>{baselineScore.toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong></span><i aria-hidden="true">→</i><span><small>Suggested</small><strong>{entry.score.toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong></span><em className={entry.delta > 0 ? 'positive' : entry.delta < 0 ? 'negative' : ''}>{entry.delta > 0 ? '+' : ''}{entry.delta.toLocaleString('en-US', { maximumFractionDigits: 0 })} <small>({percent > 0 ? '+' : ''}{percent.toFixed(2)}%)</small></em></div>
      <div className="tw-theorizer-comparison-groups">{COMPARISON_GROUPS.map((group) => {
        const rows = group.stats.flatMap(({ key, read }) => {
          const before = baselineStats && read(baselineStats)
          const after = entry.candidateStats && read(entry.candidateStats)
          return typeof before === 'number' && typeof after === 'number' && (before !== 0 || after !== 0) ? [{ key, before, after }] : []
        })
        return rows.length ? <section key={group.label}><h3>{group.label}</h3><div>{rows.map(({ key, before, after }) => {
          const delta = after - before
          return <span className={Math.abs(delta) >= .001 ? 'is-changed' : ''} key={key}><img src={optimizerStatIconSource(key)} alt=""/><b>{statLabels[key]}</b><small>{formatWorkspaceStat(key, before)}</small><i aria-hidden="true">→</i><strong>{formatWorkspaceStat(key, after)}</strong><em className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}>{Math.abs(delta) < .001 ? '—' : `${delta > 0 ? '+' : ''}${formatWorkspaceStat(key, delta)}`}</em></span>
        })}</div></section> : null
      })}</div>
    </section>
  </div>, document.body)
}

/* Previous live five-Echo substat editor, retained for possible restoration.
function SubstatEditor({ echoes, draft, baselineSlots, score, baselineScore, resultModeLabel, loading, saving, saveMessage, onChange, onReset, onSave }: {
  echoes: Echo[]; draft: TheorycraftBuild; baselineSlots: StatLine[][]; score: number; baselineScore: number; resultModeLabel: string; loading: boolean; saving: boolean; saveMessage: string
  onChange: (slots: StatLine[][]) => void; onReset: () => void; onSave: () => void
}) {
  const slots = draft.substats.mode === 'slots' ? draft.substats.slots : []
  const delta = score - baselineScore
  const percent = baselineScore ? delta / baselineScore * 100 : 0
  const changed = JSON.stringify(slots) !== JSON.stringify(baselineSlots)
  const setLine = (slotIndex: number, lineIndex: number, key: StatKey, rollIndex: number) => {
    const rolls = tunableRolls[key] ?? []
    onChange(slots.map((lines, index) => index === slotIndex
      ? lines.map((line, currentLineIndex) => currentLineIndex === lineIndex ? { key, value: rolls[rollIndex]?.value ?? line.value } : line)
      : lines))
  }
  const resetLine = (slotIndex: number, lineIndex: number) => {
    const original = baselineSlots[slotIndex]?.[lineIndex]
    const current = slots[slotIndex]?.[lineIndex]
    if (!original || !current) return
    onChange(slots.map((lines, index) => index !== slotIndex ? lines : lines.map((line, currentLineIndex) => {
      if (currentLineIndex === lineIndex) return clone(original)
      return line.key === original.key ? clone(current) : line
    })))
  }
  return <div className="tw-theorizer-substat-editor">
    <header><div><span className="eyebrow">Live ranked damage</span><strong>{score.toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong><small>{loading ? 'Calculating…' : resultModeLabel}</small></div><div className="tw-theorizer-substat-actions"><em className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'is-base'}>{Math.abs(delta) < .01 ? 'Current build' : `${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US', { maximumFractionDigits: 0 })} · ${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`}</em><button type="button" className="secondary" disabled={!changed || saving} onClick={onReset}>Reset all</button><button type="button" disabled={!changed || saving} onClick={onSave}>{saving ? 'Saving…' : 'Save theorycraft'}</button></div></header>
    {saveMessage && <p className="tw-theorizer-substat-message">{saveMessage}</p>}
    <div>{Array.from({ length: 5 }, (_, slotIndex) => {
      const echo = echoes[slotIndex]
      const lines = slots[slotIndex] ?? []
      return <article key={echo?.id ?? slotIndex}>
        <header>{echo ? <img src={echoArtwork(echo)} alt=""/> : <span>{slotIndex + 1}</span>}<div><strong>{echo?.name ?? `Echo ${slotIndex + 1}`}</strong><small>{echo ? `Cost ${echo.cost} · +${echo.level}` : 'No Echo equipped'}</small></div></header>
        <div>{lines.length ? lines.map((line, lineIndex) => {
          const rolls = tunableRolls[line.key] ?? []
          const exactIndex = rolls.findIndex((roll) => Math.abs(roll.value - line.value) < .001)
          const rollIndex = Math.max(0, exactIndex)
          const keys = availableSubstatKeys(SUBSTAT_KEYS, lines, lineIndex).filter((key) => key !== draft.slots[slotIndex]?.mainStatKey)
          const original = baselineSlots[slotIndex]?.[lineIndex]
          const isChanged = !original || original.key !== line.key || Math.abs(original.value - line.value) >= .001
          return <div className={`tw-theorizer-substat-line${isChanged ? ' is-changed' : ''}`} key={lineIndex}><span><select aria-label={`Echo ${slotIndex + 1} substat ${lineIndex + 1}`} value={line.key} onChange={(event) => { const key = event.target.value as StatKey; setLine(slotIndex, lineIndex, key, Math.min(rollIndex, (tunableRolls[key]?.length ?? 1) - 1)) }}>{keys.map((key) => <option value={key} key={key}>{statLabels[key]}</option>)}</select><strong>{formatWorkspaceStat(line.key, exactIndex >= 0 ? rolls[rollIndex]?.value ?? line.value : line.value)}</strong>{isChanged && <button type="button" className="text-button" onClick={() => resetLine(slotIndex, lineIndex)}>Reset</button>}</span><input aria-label={`${statLabels[line.key]} value`} type="range" min="0" max={Math.max(0, rolls.length - 1)} step="1" value={rollIndex} onChange={(event) => setLine(slotIndex, lineIndex, line.key, Number(event.target.value))}/></div>
        }) : <p>No revealed substats.</p>}</div>
      </article>
    })}</div>
  </div>
}
*/

function SubstatStepTable({ entries, baselineScore, resultModeLabel, loading }: {
  entries: RankedSuggestion[]; baselineScore: number; resultModeLabel: string; loading: boolean
}) {
  const addPrefix = 'preview:substat:add:'
  const removePrefix = 'preview:substat:remove:'
  const rows = entries.filter((entry) => entry.id.startsWith(addPrefix))
  const removals = new Map(entries.filter((entry) => entry.id.startsWith(removePrefix)).map((entry) => [entry.id.slice(removePrefix.length), entry]))
  const largestDelta = Math.max(...entries.filter((entry) => entry.id.startsWith('preview:substat:')).map((entry) => Math.abs(entry.delta)), 1)
  const tone = (delta: number) => delta > .005 ? 'positive' : delta < -.005 ? 'negative' : 'neutral'
  return <section className="tw-theorizer-substat-steps" aria-labelledby="tw-substat-step-title">
    <header><div><span className="eyebrow">Substat efficiency</span><h3 id="tw-substat-step-title">Per-step change <small>(gain / loss)</small></h3></div><p>One mid-value roll · {resultModeLabel}</p></header>
    {loading ? <p className="tw-empty-state">Calculating each substat step…</p> : !rows.length ? <p className="tw-empty-state">No substat comparisons are available.</p> : <div className="tw-theorizer-substat-table-wrap"><table>
      <thead><tr><th scope="col">Substat</th><th scope="col">+1 DMG</th><th scope="col">+1 DMG %</th><th scope="col">−1 DMG</th><th scope="col">−1 DMG %</th></tr></thead>
      <tbody>{rows.map((entry) => {
        const removed = removals.get(entry.id.slice(addPrefix.length))
        const addPercent = baselineScore ? entry.delta / baselineScore * 100 : 0
        const removeDelta = removed?.delta ?? 0
        const removePercent = baselineScore ? removeDelta / baselineScore * 100 : 0
        return <tr key={entry.id} title={`${entry.detail} / ${removed?.detail ?? '−1 roll'}`}>
          <th scope="row"><span aria-hidden="true">›</span>{entry.label}</th>
          <td className={tone(entry.delta)}><strong>{entry.delta > 0 ? '+' : ''}{entry.delta.toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong><i aria-hidden="true"><span style={{ width: `${Math.abs(entry.delta) / largestDelta * 100}%` }}/></i></td>
          <td className={tone(entry.delta)}><strong>{addPercent > 0 ? '+' : ''}{addPercent.toFixed(2)}%</strong><i aria-hidden="true"><span style={{ width: `${Math.abs(entry.delta) / largestDelta * 100}%` }}/></i></td>
          <td className={tone(removeDelta)}><strong>{removeDelta > 0 ? '+' : ''}{removeDelta.toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong><i aria-hidden="true"><span style={{ width: `${Math.abs(removeDelta) / largestDelta * 100}%` }}/></i></td>
          <td className={tone(removeDelta)}><strong>{removePercent > 0 ? '+' : ''}{removePercent.toFixed(2)}%</strong><i aria-hidden="true"><span style={{ width: `${Math.abs(removeDelta) / largestDelta * 100}%` }}/></i></td>
        </tr>
      })}</tbody>
    </table></div>}
  </section>
}

export function TheorizerWorkspace({ member, model, echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds, roverGender, refresh: _refresh }: {
  member: TeamMemberModel; model: TeamWorkspaceModel; echoes: Echo[]; builds: Build[]; characters: OwnedCharacter[]; weapons: OwnedWeapon[]
  equippedLoadouts: EquippedLoadout[]; theorycraftBuilds: TheorycraftBuild[]; roverGender: 'male' | 'female'; refresh: () => Promise<void>
}) {
  const [mode, setMode] = useState<TheorizerMode>('mainStats')
  const [targetId, setTargetId] = useState(() => model.team.calculationV2?.selectedAttackByBuild[member.build!.id] ?? member.calculationRowsV2[0]?.attack.id ?? '')
  const [selectedId, setSelectedId] = useState('')
  const [ranking, setRanking] = useState<Pick<TheorizerRankingResponse, 'baselineScore' | 'baselineStats' | 'results'>>({ baselineScore: 0, results: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const resultMode: FormulaResultMode = model.team.calculationV2?.resultMode ?? model.team.scenario?.resultMode ?? 'expected'
  const baseline = useMemo(() => baselineDraft(member), [member])
  /* Previous editable substat draft/save state, retained with SubstatEditor.
  const [substatSlots, setSubstatSlots] = useState<StatLine[][]>(() => member.resolvedEchoes.map((echo) => clone(echo.subStats)))
  useEffect(() => setSubstatSlots(member.resolvedEchoes.map((echo) => clone(echo.subStats))), [member.build?.id])
  const substatDraft = useMemo<TheorycraftBuild>(() => ({
    ...clone(baseline),
    id: 'preview:substats',
    substats: { mode: 'slots', slots: Array.from({ length: 5 }, (_, index) => clone(substatSlots[index] ?? [])) }
  }), [baseline, substatSlots])
  const baselineSubstatSlots = baseline.substats.mode === 'slots' ? baseline.substats.slots : []
  const updateSubstatSlots = (slots: StatLine[][]) => { setSaveMessage(''); setSubstatSlots(slots) }
  const saveTheorycraft = async () => {
    setSaving(true)
    setSaveMessage('')
    try {
      const now = Date.now()
      const loadoutSource = model.team.members?.[member.slot]?.loadoutSource
      const source: TheorycraftBuild['source'] = loadoutSource?.type === 'equipped'
        ? { type: 'equipped' }
        : loadoutSource?.type === 'saved' ? { type: 'saved', id: loadoutSource.buildId } : undefined
      await db.theorycraftBuilds.add({
        ...clone(substatDraft), id: createLocalId(), name: `${memberName(member)} substat theorycraft`,
        description: 'Saved from the Theorizer substat comparison.', source, createdAt: now, updatedAt: now
      })
      await refresh()
      setSaveMessage('Theorycraft build saved. Equipment was not changed.')
    } catch (reason) {
      setSaveMessage(reason instanceof Error ? reason.message : 'The theorycraft build could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  */
  const targetGroups = [...member.calculationRowsV2.reduce((groups, row) => {
    const targets = groups.get(row.attack.group) ?? []
    targets.push({ id: row.attack.id, label: row.attack.name })
    groups.set(row.attack.group, targets)
    return groups
  }, new Map<string, Array<{ id: string; label: string }>>())]
  const targets = targetGroups.flatMap(([, entries]) => entries)
  const activeTargetId = targets.some((target) => target.id === targetId) ? targetId : targets[0]?.id ?? ''

  useEffect(() => {
    let current = true
    if (!activeTargetId) {
      setLoading(false)
      setError('No calculable action is available for this character.')
      setRanking({ baselineScore: 0, results: [] })
      return () => { current = false }
    }
    setLoading(true)
    setError('')
    if (mode !== 'substats') setRanking({ baselineScore: 0, results: [] })
    void rankTheorizer({
      team: model.team,
      echoes,
      builds,
      characters,
      weapons,
      equippedLoadouts,
      theorycraftBuilds,
      roverGender,
      mode,
      baseline,
      memberSlot: member.slot,
      targetId: activeTargetId,
      resultMode,
      scalesWith: member.attacks[0]?.scalesWith ?? 'atk',
      element: member.catalog?.element ?? 'Aero',
      weaponType: member.catalog?.weaponType,
      substatDraft: undefined
    }).then((response) => {
      if (!current) return
      setRanking(response)
      setLoading(false)
    }).catch((reason) => {
      if (!current) return
      setError(reason instanceof Error ? reason.message : 'Theorizer ranking failed.')
      setLoading(false)
    })
    return () => { current = false }
  }, [activeTargetId, baseline, builds, characters, echoes, equippedLoadouts, member.attacks, member.catalog?.element, member.catalog?.weaponType, member.resolvedEchoes, member.slot, mode, model.team, resultMode, roverGender, theorycraftBuilds, weapons])

  const ranked: RankedSuggestion[] = ranking.results
  const selected = ranked.find((entry) => entry.id === selectedId)
  const resultModeLabel = resultMode === 'expected' ? 'Avg DMG' : resultMode === 'normal' ? 'Non-crit DMG' : 'Crit DMG'
  const modeLabel = MODES.find((entry) => entry.id === mode)?.label ?? 'options'

  return <section className="tw-theorizer tw-panel">
    <header className="tw-theorizer-header"><div><span className="eyebrow">✦ Theorizer</span><h2>Build suggestions</h2><p>Pick an action and compare one gear axis at a time.</p></div><div className="tw-theorizer-modes" role="tablist" aria-label="Suggestion type">{MODES.map((entry) => <button type="button" role="tab" aria-selected={mode === entry.id} className={mode === entry.id ? 'active' : ''} onClick={() => { setMode(entry.id); setSelectedId('') }} key={entry.id}>{entry.label}</button>)}</div></header>
    <div className="tw-theorizer-toolbar"><label><span>Rank for</span><select value={activeTargetId} onChange={(event) => { setTargetId(event.target.value); setSelectedId('') }}>{targetGroups.map(([group, entries]) => <optgroup label={group} key={group}>{entries.map((target) => <option value={target.id} key={target.id}>{target.label}</option>)}</optgroup>)}</select></label></div>
    {mode === 'substats' ? <>{error ? <p className="tw-empty-state">{error}</p> : <SubstatStepTable entries={ranked} baselineScore={ranking.baselineScore} resultModeLabel={resultModeLabel} loading={loading}/>}</> : <>
    <div className="tw-theorizer-list-heading"><span>{mode === 'sonatas' ? 'Set plans' : modeLabel} ({ranked.length})</span><b>Ranked by {resultModeLabel}</b></div>
    <div className="tw-theorizer-list">{loading ? <p className="tw-empty-state">Calculating every valid {modeLabel.toLowerCase()} option…</p> : error ? <p className="tw-empty-state">{error}</p> : ranked.length ? ranked.map((entry, index) => {
      const percent = ranking.baselineScore ? entry.delta / ranking.baselineScore * 100 : 0
      const isBaseline = entry.id.endsWith(':baseline')
      return <button type="button" className={selected?.id === entry.id ? 'active' : ''} aria-haspopup="dialog" onClick={() => setSelectedId(entry.id)} key={entry.id}><span className={`tw-theorizer-rank${isBaseline ? ' is-base' : ''}`}>{entry.rank ?? index + 1}</span><span className={`tw-theorizer-summary mode-${mode}`}>{mode === 'mainStats' ? <MainStatPlan draft={entry.draft}/> : mode === 'sonatas' ? <SonataPlan draft={entry.draft}/> : <><span className="tw-theorizer-art">{entry.image ? <img src={entry.image} alt=""/> : <b>{entry.label.slice(0, 2).toUpperCase()}</b>}</span><span className="tw-theorizer-name"><strong>{entry.label}</strong><small>{entry.detail}</small></span></>}</span><span className="tw-theorizer-score"><strong>{entry.score.toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong><em className={isBaseline ? 'is-base' : entry.delta > 0 ? 'positive' : entry.delta < 0 ? 'negative' : ''}>{isBaseline ? 'base' : `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`}</em></span></button>
    }) : <p className="tw-empty-state">No valid suggestions are available for this loadout.</p>}</div>
    </>}
    {selected && <ComparisonModal entry={selected} baselineScore={ranking.baselineScore} baselineStats={ranking.baselineStats} resultModeLabel={resultModeLabel} targetLabel={targets.find((target) => target.id === activeTargetId)?.label ?? 'Selected action'} onClose={() => setSelectedId('')}/>}
  </section>
}
