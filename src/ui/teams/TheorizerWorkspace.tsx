import { useMemo, useState } from 'react'
import { formatDamage } from '../../domain/damage'
import { changedTheorycraftAxes, theorycraftWarnings, type TheorycraftAxis } from '../../domain/loadouts'
import type { Build, Echo, EquippedLoadout, OwnedCharacter, OwnedWeapon, StatKey, Team, TheorycraftBuild } from '../../domain/types'
import { theorycraftFromBuild } from '../../storage/loadouts'
import { formatWorkspaceStat, resolveTeamWorkspace, type TeamMemberModel, type TeamWorkspaceModel } from '../team-workspace-model'
import { BuildManagementModal } from './BuildManagementModal'

const THEORYCRAFT_AXES: Array<{ id: TheorycraftAxis; label: string; help: string }> = [
  { id: 'weapon', label: 'Weapon', help: 'Weapon, level, or refinement' },
  { id: 'sonata', label: 'Sonata', help: 'Active set composition' },
  { id: 'mainEcho', label: 'Main Echo', help: 'Main Echo identity' },
  { id: 'mainStats', label: 'Main stats', help: 'Echo cost or main-stat lines' },
  { id: 'substats', label: 'Substats', help: 'Exact per-Echo substat rolls' }
]

const COMPARISON_STATS: Array<[StatKey, string]> = [
  ['hp', 'HP'], ['atk', 'ATK'], ['def', 'DEF'], ['critRate', 'Crit. Rate'],
  ['critDamage', 'Crit. DMG'], ['energyRegen', 'Energy Regen'],
  ['basicDamage', 'Basic Attack'], ['heavyDamage', 'Heavy Attack'], ['skillDamage', 'Resonance Skill'],
  ['liberationDamage', 'Resonance Liberation'], ['healingBonus', 'Healing Bonus']
]

function memberName(member: TeamMemberModel) {
  return member.catalog?.name ?? `Member ${member.slot + 1}`
}

export function TheorizerWorkspace({ model, echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds, roverGender, refresh, updateTeam }: {
  model: TeamWorkspaceModel
  echoes: Echo[]
  builds: Build[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  equippedLoadouts: EquippedLoadout[]
  theorycraftBuilds: TheorycraftBuild[]
  roverGender: 'male' | 'female'
  refresh: () => Promise<void>
  updateTeam: (patch: Partial<Team>) => Promise<void>
}) {
  const firstSlot = model.members.find((member) => member.build)?.slot ?? 0
  const [slot, setSlot] = useState(firstSlot)
  const [axis, setAxis] = useState<TheorycraftAxis>('weapon')
  const [managing, setManaging] = useState(false)
  const member = model.members[slot]
  const alternatives = useMemo(
    () => theorycraftBuilds.filter((build) => build.characterId === member.character?.id),
    [member.character?.id, theorycraftBuilds]
  )
  const selectedId = member.comparisonSource?.type === 'theorycraft' ? member.comparisonSource.theorycraftBuildId : ''
  const comparisonCandidates = useMemo(() => alternatives.flatMap((candidate) => {
    const axes = changedTheorycraftAxes(candidate, { weapon: member.resolvedWeapon, echoes: member.resolvedEchoes })
    if (axes.length !== 1 || axes[0] !== axis || theorycraftWarnings(candidate).length || !model.team.members?.[slot]) return []
    const resolved = resolveTeamWorkspace({
      team: model.team, echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds, roverGender,
      loadoutOverrides: { [slot]: { type: 'theorycraft', theorycraftBuildId: candidate.id } }
    })
    return [{ candidate, resolved }]
  }), [alternatives, axis, builds, characters, echoes, equippedLoadouts, member.resolvedEchoes, member.resolvedWeapon, model.team, roverGender, slot, theorycraftBuilds, weapons])
  const selectedComparison = comparisonCandidates.find((entry) => entry.candidate.id === selectedId)
  const selectedTheorycraft = selectedComparison?.candidate
  const comparisonModel = selectedComparison?.resolved
  const changedAxes = selectedTheorycraft ? [axis] : []
  const setComparison = async (theorycraftBuildId: string) => {
    const members = [...(model.team.members ?? [])]
    const record = members[slot]
    if (!record) return
    members[slot] = { ...record, compareSource: theorycraftBuildId ? { type: 'theorycraft', theorycraftBuildId } : undefined }
    await updateTeam({ members })
  }
  const createComparison = async () => {
    if (!member.source) return
    const axisLabel = THEORYCRAFT_AXES.find((entry) => entry.id === axis)?.label ?? axis
    const created = await theorycraftFromBuild(member.source, `${memberName(member)} ${axisLabel} what-if`)
    await refresh()
    await setComparison(created.id)
    setManaging(true)
  }
  const comparisonShowcase = comparisonModel?.members[slot].showcase
  const statRows = COMPARISON_STATS.map(([key, label]) => {
    const baseline = Number(member.showcase?.finalStats[key] ?? 0)
    const candidate = Number(comparisonShowcase?.finalStats[key] ?? baseline)
    return { key, label, baseline, candidate, delta: candidate - baseline }
  })
  const axisLabel = THEORYCRAFT_AXES.find((entry) => entry.id === axis)?.label ?? axis

  return <div className="tw-theorizer-page">
    <section className="tw-settings-intro tw-panel"><div><span className="eyebrow">Non-destructive comparison</span><h1>What-if Theorizer</h1><p>Duplicate the active loadout, change one equipment axis, and compare it while the team, enemy, buffs, and rotation stay fixed.</p></div><div><span><b>1</b><small>axis at a time</small></span><span><b>0</b><small>live builds changed</small></span></div></section>
    <section className="tw-panel tw-theorizer-controls">
      <div className="tw-theorizer-member-tabs" role="tablist" aria-label="Character to theorize">{model.members.map((entry) => <button type="button" role="tab" aria-selected={slot === entry.slot} disabled={!entry.build} onClick={() => setSlot(entry.slot)} key={entry.slot}>{entry.catalog?.name ?? `Member ${entry.slot + 1}`}</button>)}</div>
      {member.build ? <>
        <header><div><span className="eyebrow">Fixed baseline</span><h2>{memberName(member)} · {member.build.name}</h2><p>Choose exactly one equipment axis. Character, team, enemy, buffs, and rotation stay fixed for every option.</p></div><div><button type="button" className="primary" onClick={() => void createComparison()}>New {axisLabel} option</button><button type="button" className="secondary" onClick={() => setManaging(true)}>Manage theorycrafted builds</button></div></header>
        <div className="tw-theorizer-axis-picker" role="tablist" aria-label="Equipment axis">{THEORYCRAFT_AXES.map((entry) => <button type="button" role="tab" aria-selected={axis === entry.id} className={axis === entry.id ? 'active' : ''} onClick={() => setAxis(entry.id)} key={entry.id}><b>{entry.label}</b><small>{entry.help}</small></button>)}</div>
        <section className="tw-theorizer-candidates" aria-label={`${axis} comparison options`}><header><div><span className="eyebrow">Legal one-change options</span><h3>{comparisonCandidates.length ? `${comparisonCandidates.length} ready to compare` : 'No options for this axis yet'}</h3></div></header>{comparisonCandidates.length ? <div>{comparisonCandidates.map(({ candidate, resolved }) => { const candidateMember = resolved.members[slot]; const delta = resolved.total - model.total; return <button type="button" className={selectedId === candidate.id ? 'active' : ''} aria-pressed={selectedId === candidate.id} onClick={() => void setComparison(candidate.id)} key={candidate.id}><span><b>{candidate.name}</b><small>{candidate.description || THEORYCRAFT_AXES.find((entry) => entry.id === axis)?.help}</small></span><span><small>Team rotation</small><strong>{formatDamage(resolved.total)}</strong><em className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}>{delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${formatDamage(delta)}`}</em></span><span><small>{memberName(member)}</small><strong>{formatDamage(candidateMember.contribution)}</strong></span></button> })}</div> : <p className="tw-empty-state">Create a copy, change only {axisLabel.toLowerCase()}, then return here. Invalid or multi-axis builds stay out of this list.</p>}</section>
        {selectedTheorycraft && <div className={`tw-theorizer-axis-state ${changedAxes.length === 1 ? 'is-valid' : 'is-warning'}`}><strong>{changedAxes.length === 1 ? `Comparing ${changedAxes[0]}` : changedAxes.length === 0 ? 'Change one equipment axis in the Theorycrafted Build.' : `This build changes ${changedAxes.length} axes: ${changedAxes.join(', ')}.`}</strong><small>{changedAxes.length === 1 ? 'Character, team, enemy, buffs, and rotation remain fixed.' : 'A What-if result is shown only when exactly one axis differs.'}</small></div>}
        {comparisonModel && <div className="tw-theorizer-kpis"><div><span>Team rotation</span><b>{formatDamage(model.total)}</b><strong>{formatDamage(comparisonModel.total)}</strong><small>{comparisonModel.total === model.total ? '—' : `${comparisonModel.total > model.total ? '+' : ''}${formatDamage(comparisonModel.total - model.total)}`}</small></div><div><span>Team DPS</span><b>{formatDamage(model.dps)}</b><strong>{formatDamage(comparisonModel.dps)}</strong><small>{comparisonModel.dps === model.dps ? '—' : `${comparisonModel.dps > model.dps ? '+' : ''}${formatDamage(comparisonModel.dps - model.dps)}`}</small></div><div><span>{memberName(member)} contribution</span><b>{formatDamage(member.contribution)}</b><strong>{formatDamage(comparisonModel.members[slot].contribution)}</strong><small>{comparisonModel.members[slot].contribution === member.contribution ? '—' : `${comparisonModel.members[slot].contribution > member.contribution ? '+' : ''}${formatDamage(comparisonModel.members[slot].contribution - member.contribution)}`}</small></div></div>}
        {comparisonShowcase && changedAxes.length === 1 ? <div className="tw-theorizer-results"><header><span>Stat</span><span>Current</span><span>What-if</span><span>Delta</span></header>{statRows.map((row) => <div key={row.key}><span>{row.label}</span><b>{formatWorkspaceStat(row.key, row.baseline)}</b><b>{formatWorkspaceStat(row.key, row.candidate)}</b><strong className={row.delta > 0 ? 'positive' : row.delta < 0 ? 'negative' : ''}>{row.delta === 0 ? '—' : `${row.delta > 0 ? '+' : ''}${formatWorkspaceStat(row.key, row.delta)}`}</strong></div>)}</div> : !selectedTheorycraft && <p className="tw-empty-state">Create or select a Theorycrafted Build to see a constant-context comparison.</p>}
      </> : <p className="tw-empty-state">Assign a build in Overview before starting a comparison.</p>}
    </section>
    {managing && member.character && <BuildManagementModal characterId={member.character.id} echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} refresh={refresh} onSelect={(source) => { if (source.type === 'theorycraft') void setComparison(source.theorycraftBuildId); setManaging(false) }} onClose={() => setManaging(false)}/>} 
  </div>
}
