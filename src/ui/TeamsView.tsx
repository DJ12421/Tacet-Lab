import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { combatEffectDefinitions, formatDamage, resolveCombatTarget, type CombatEffectDefinition } from '../domain/combat/runtime'
import { applicableTeamStatusEffects, negativeStatusActions, negativeStatusMotionValues } from '../game-data/combat/negative-status'
import { resolveCharacterSubstatProfile } from '../domain/character-substat-score'
import { echoRollRating } from '../domain/echo-grade'
import { createLocalId } from '../domain/id'
import type { BuffEffect, Build, DamageType, Echo, EquippedLoadout, FormulaResultMode, LoadoutSourceRef, OwnedCharacter, OwnedWeapon, RotationAction, ScenarioValue, StatKey, Team, TheorycraftBuild } from '../domain/types'
import { characterCatalog, sonataCatalog, statLabels, weaponCatalog } from '../game-data'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import type { CalculationTrace } from '../domain/combat'
import { db } from '../storage/database'
import { setEquippedEchoIds } from '../storage/loadouts'
import { EchoWaveform } from './EchoWaveform'
import { EchoPicker, richSkillDescription } from './CharacterShowcase'
import { EchoEditModal } from './EchoEditModal'
import { CharacterSubstatProfileContext, EchoMiniCard, ElementFilterIcon, FilterChips, Icon } from './components'
import { Picker as CharacterPicker } from './CharacterInventoryView'
import { CalculatedValue, traceCalculationDetail } from './CalculationDetails'
import { showcaseStatDetail, sumDetail } from './calculation-detail-model'
import { OptimizerView } from './OptimizerView'
import { BuildsView, TheorycraftEditor } from './BuildsView'
import { TheorizerWorkspace } from './team-workspace/TheorizerWorkspace'
import { useWorkspacePreference } from './team-workspace/useWorkspacePreference'
import { statIconSource, weaponStatIconSource } from './stat-icons'
import {
  compactAttackLabel, echoArtwork, formatWorkspaceStat, resolveTeamWorkspace, teamBuffLabel,
  type TeamActionModel, type TeamAttackGroup, type TeamMemberModel, type TeamWorkspaceInput, type TeamWorkspaceModel
} from './team-workspace-model'
import { defaultEnabledSkillTreeBonusIds, inherentSkillBonusId, skillTreeBonusId } from './character-showcase-model'
import './team-workspace.css'

type WorkspaceTab = 'settings' | 0 | 1 | 2
type MemberSection = 'overview' | 'forte' | 'optimizer' | 'theorizer' | 'rotation'
type TeamRouteSection = 'overview' | 'forte' | 'optimize' | 'theorizer' | 'rotation'

const MEMBER_SECTIONS: Array<{ id: MemberSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'forte', label: 'Forte' },
  { id: 'optimizer', label: 'Optimizer' },
  { id: 'theorizer', label: 'Theorizer' },
  { id: 'rotation', label: 'Rotation' }
]

const DAMAGE_RESULT_MODES: Array<{ id: FormulaResultMode; label: string }> = [
  { id: 'normal', label: 'Base' },
  { id: 'expected', label: 'Avg' },
  { id: 'critical', label: 'Crit' }
]

const ROTATION_ATTACK_GROUPS: Array<{ id: TeamAttackGroup; label: string }> = [
  { id: 'basic', label: 'Basic' },
  { id: 'skill', label: 'Skill' },
  { id: 'forte', label: 'Forte Circuit' },
  { id: 'liberation', label: 'Liberation' },
  { id: 'intro', label: 'Intro' },
  { id: 'outro', label: 'Outro' },
  { id: 'echo', label: 'Echo Skill' },
  { id: 'tuneBreak', label: 'Tune Break' },
  { id: 'status', label: 'Negative Status' }
]

const CORE_STATS: Array<[StatKey, string]> = [
  ['hp', 'HP'], ['atk', 'ATK'], ['def', 'DEF'], ['critRate', 'Crit. Rate'],
  ['critDamage', 'Crit. DMG'], ['energyRegen', 'Energy Regen']
]

const FORMULA_GROUP_ORDER = [
  'Normal Attack',
  'Basic Attack',
  'Resonance Skill',
  'Forte Circuit',
  'Resonance Liberation',
  'Outro Skill',
  'Intro Skill',
  'Tune Break',
  'Elemental Effects',
  'Echo Skill'
]

const ELEMENT_DAMAGE_STATS: Record<string, StatKey> = {
  Spectro:'spectroDamage', Fusion:'fusionDamage', Glacio:'glacioDamage', Electro:'electroDamage', Aero:'aeroDamage', Havoc:'havocDamage'
}

const DAMAGE_STATS: Array<[StatKey, string]> = [
  ['basicDamage', 'Basic Attack'], ['heavyDamage', 'Heavy Attack'], ['skillDamage', 'Res. Skill'],
  ['liberationDamage', 'Res. Liberation'], ['healingBonus', 'Healing Bonus']
]

function formationStatRows(member: TeamMemberModel): Array<[StatKey, string]> {
  const elementKey = member.catalog ? ELEMENT_DAMAGE_STATS[member.catalog.element] : undefined
  const ordered: Array<[StatKey, string]> = [...CORE_STATS, ...(elementKey && member.catalog ? [[elementKey, `${member.catalog.element} DMG Bonus`] as [StatKey, string]] : []), ...DAMAGE_STATS]
  const aliases: Partial<Record<StatKey, StatKey>> = { hpPercent: 'hp', atkPercent: 'atk', defPercent: 'def' }
  const weights = member.catalog ? resolveCharacterSubstatProfile(member.catalog).weights : {}
  const priority = Object.entries(weights)
    .filter(([key, weight]) => key !== 'energyRegen' && Number(weight) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
  const selected = new Set<StatKey>()
  for (const [key] of priority) {
    const stat = (aliases[key as StatKey] ?? key) as StatKey
    if (ordered.some(([candidate]) => candidate === stat)) selected.add(stat)
    if (selected.size === 5) break
  }
  for (const [key] of ordered) {
    if (selected.size >= 5) break
    if (key !== 'energyRegen') selected.add(key)
  }
  selected.add('energyRegen')
  return ordered.filter(([key]) => selected.has(key))
}

function resolvedMemberStat(member: TeamMemberModel, key: StatKey) {
  return member.conditionedStats?.[key as keyof typeof member.conditionedStats]
    ?? (member.showcase ? member.showcase.finalStats[key as keyof typeof member.showcase.finalStats] : 0)
}

function resolvedMemberStatDelta(member: TeamMemberModel, key: StatKey) {
  if (!member.showcase) return 0
  const baseValue = Number(member.showcase.finalStats[key as keyof typeof member.showcase.finalStats] ?? 0)
  return Number(resolvedMemberStat(member, key) ?? 0) - baseValue
}

function resolvedMemberStatDetail(member: TeamMemberModel, key: StatKey, label: string) {
  if (!member.showcase) return sumDetail(label, 0, [])
  const baseDetail = showcaseStatDetail(member.showcase, key, label)
  const value = Number(resolvedMemberStat(member, key) ?? 0)
  const delta = resolvedMemberStatDelta(member, key)
  if (Math.abs(delta) < 1e-9) return baseDetail
  return {
    ...baseDetail,
    value:formatWorkspaceStat(key, value),
    rows:[...baseDetail.rows, { label:'Active reviewed effects', value:`${delta > 0 ? '+' : ''}${formatWorkspaceStat(key, delta)}` }],
    note:'Includes the currently selected reviewed buffs and effects.'
  }
}

const ELEMENT_COLORS: Record<string, string> = {
  Aero: '#73d9c6', Electro: '#a98bf5', Fusion: '#ef7662', Glacio: '#78bde8', Havoc: '#c06ddb', Spectro: '#e6c96b'
}

const ROTATION_CHART_COLORS = ['#8de4d4', '#e4bb5e', '#e78674', '#9d87de', '#69b9d7', '#c7d0cd', '#72b98c', '#d28db3']
const DAMAGE_TYPE_ORDER: DamageType[] = ['basic', 'heavy', 'skill', 'liberation', 'intro', 'outro', 'echo', 'tuneBreak', 'status', 'healing']
const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  basic: 'Basic', heavy: 'Heavy', skill: 'Skill', liberation: 'Liberation',
  intro: 'Intro', outro: 'Outro', echo: 'Echo', tuneBreak:'Tune Break', status: 'Status DMG', healing: 'Healing'
}

interface TeamsViewProps {
  echoes: Echo[]
  builds: Build[]
  equippedLoadouts: EquippedLoadout[]
  theorycraftBuilds: TheorycraftBuild[]
  teams: Team[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  refresh: () => Promise<void>
  openScanner: () => void
  galleryRequest: number
  roverGender: 'male' | 'female'
  route?: { team?: string; character?: string; section?: TeamRouteSection }
  onRouteChange?: (route: { team?: string; character?: string; section?: TeamRouteSection }) => void
}

const routeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const memberSectionFromRoute = (section?: TeamRouteSection): MemberSection => section === 'optimize' ? 'optimizer' : section ?? 'overview'
const memberSectionToRoute = (section: MemberSection): TeamRouteSection => section === 'optimizer' ? 'optimize' : section === 'forte' || section === 'theorizer' || section === 'rotation' ? section : 'overview'

function percent(value: number, total: number) {
  return total > 0 ? `${(value / total * 100).toFixed(1)}%` : '0.0%'
}

function teamMemberName(member: TeamMemberModel) {
  return member.catalog?.name ?? member.build?.name ?? `Member ${member.slot + 1}`
}

function readableWarning(warning: string) {
  if (warning.includes('numeric formula is not present in the reviewed source data')) {
    return 'Damage is unavailable because this formula has not been verified in the current game data.'
  }
  return warning
}

function MemberAvatar({ member, compact = false }: { member: Partial<TeamMemberModel> & { slot: number }; compact?: boolean }) {
  if (!member.catalog || !member.character) return <div className={`tw-avatar tw-avatar-empty ${compact ? 'compact' : ''}`}><span>+</span><small>Empty</small></div>
  return <div className={`tw-avatar ${compact ? 'compact' : ''}`}>
    <img src={member.catalog.iconSourceUrl} alt=""/>
    <span>Lv. {member.character.level}</span><b>S{member.character.sequence}</b>
  </div>
}

function EchoThumbs({ member, decorated = false }: { member: TeamMemberModel; decorated?: boolean }) {
  return <div className="tw-echo-thumbs" aria-label="Equipped Echoes">{Array.from({ length: 5 }, (_, index) => {
    const echo = member.showcase?.echoSlots[index]
    return <span className={echo ? '' : 'empty'} key={echo?.id ?? index} title={echo?.name ?? `Empty Echo slot ${index + 1}`}>
      {echo && echoArtwork(echo) && <img className="tw-echo-artwork" src={echoArtwork(echo)} alt=""/>}
      {echo && decorated && <><small>+{echo.level}</small><b>{echo.cost}</b>
        <img className="tw-echo-main-stat-icon" src={statIconSource(echo.mainStat.key)} alt="" title={statLabels[echo.mainStat.key]} aria-hidden="true"/>
        {generatedSonataIconSources[echo.sonata] && <img className="tw-echo-sonata-icon" src={generatedSonataIconSources[echo.sonata]} alt="" title={echo.sonata}/>}
      </>}
      {echo && !decorated && <b>{echo.cost}</b>}
      {!echo && <b>+</b>}
    </span>
  })}</div>
}

function WarningList({ warnings, compact = false }: { warnings: string[]; compact?: boolean }) {
  if (!warnings.length) return null
  return <aside className={`tw-warnings ${compact ? 'compact' : ''}`} role="status">
    {!compact && <header>
      <span aria-hidden="true">!</span>
      <div><strong>Data notice</strong></div>
      <b>{warnings.length}</b>
    </header>}
    <div className="tw-warning-items">{warnings.map((warning) => <p key={warning}><i aria-hidden="true">!</i>{readableWarning(warning)}</p>)}</div>
  </aside>
}

function SonataChips({ member }: { member: TeamMemberModel }) {
  return <div className="tw-chip-list">{member.showcase?.sonatas.length ? member.showcase.sonatas.map((sonata) =>
    <span className="tw-chip" key={sonata.name}>{sonata.iconSourceUrl && <img src={sonata.iconSourceUrl} alt=""/>}<b>{sonata.name}</b><small>{sonata.count}</small></span>
  ) : <span className="tw-chip muted">No Sonata coverage</span>}</div>
}

function TeamMemberColumn({ member, model, loadoutOptions, onChooseCharacter, onAssign, onManage }: {
  member: TeamMemberModel
  model: TeamWorkspaceModel
  loadoutOptions: Array<{ value: string; label: string }>
  onChooseCharacter: () => void
  onAssign: (buildId: string) => Promise<void>
  onManage: () => void
}) {
  const [buffsOpen, setBuffsOpen] = useWorkspacePreference(`team:${model.team.id}:member:${member.slot}:buffs-open`, false)
  const buffs = [...member.receivedBuffs, ...member.appliedBuffs]
  const resultMode = model.team.scenario?.resultMode ?? 'expected'
  const currentSource = member.source ? (member.source.type === 'equipped' ? `equipped:${member.source.characterId}` : member.source.type === 'saved' ? `saved:${member.source.buildId}` : `theorycraft:${member.source.theorycraftBuildId}`) : ''
  const currentBuildLabel = loadoutOptions.find((option) => option.value === currentSource)?.label ?? 'Choose Build'
  return <article className={`tw-member-column ${member.build ? '' : 'is-empty'}`} style={member.catalog ? { '--tw-member-accent': ELEMENT_COLORS[member.catalog.element] ?? '#c8d0ce' } as CSSProperties : undefined}>
    {!member.build && <button type="button" className="tw-empty-member-picker" onClick={onChooseCharacter}>
        <MemberAvatar member={member}/><div><span className="eyebrow">Member {member.slot + 1}</span><h3>Empty slot</h3><p>{loadoutOptions.length ? 'Choose a character and build' : 'Add an owned character first'}</p></div>
      </button>}
    {member.build ? <>
      <button type="button" className="tw-member-build-row" onClick={onManage} aria-haspopup="dialog" aria-label={`Change build for ${teamMemberName(member)}`}><img className="tw-build-character-icon" src={member.catalog?.iconSourceUrl} alt=""/><span className="tw-build-label"><strong>{member.catalog?.name}</strong><small>{currentBuildLabel}</small></span><i aria-hidden="true">⌄</i></button>
      <section className="tw-member-showcase" role="button" tabIndex={0} onClick={onChooseCharacter} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onChooseCharacter() } }} aria-label={`Change character for ${teamMemberName(member)}`}>
        {member.catalog?.portraitSourceUrl && <img src={member.catalog.portraitSourceUrl} alt=""/>}
        <button type="button" className="tw-member-remove" aria-label={`Remove ${member.catalog?.name ?? 'member'}`} onClick={(event) => { event.stopPropagation(); void onAssign('') }} onKeyDown={(event) => event.stopPropagation()}>×</button>
        <div className="tw-member-showcase-copy">
          <span>{member.catalog?.element} · {member.catalog?.role}</span>
          <h3>{member.catalog?.name}</h3>
          <strong>Lv. {member.character?.level ?? member.build.level} / 90 <b>S{member.character?.sequence ?? 0}</b></strong>
        </div>
        <dl aria-label="Key stats">
          {formationStatRows(member).map(([key, label]) => <div className={Math.abs(resolvedMemberStatDelta(member, key)) > 1e-9 ? 'is-modified' : undefined} key={key}><dt><img className="tw-stat-icon" src={statIconSource(key)} alt="" aria-hidden="true"/>{label}</dt><dd>{formatWorkspaceStat(key, resolvedMemberStat(member, key))}</dd></div>)}
        </dl>
      </section>
      <div className="tw-member-loadout-row">
        <div className="tw-member-weapon" title={member.showcase?.weapon?.catalog.name ?? 'No weapon'}>
          {member.showcase?.weapon?.catalog.iconSourceUrl ? <img src={member.showcase.weapon.catalog.iconSourceUrl} alt={member.showcase.weapon.catalog.name}/> : <b>+</b>}
          {member.showcase?.weapon && <><small className="tw-weapon-level">Lv. {member.showcase.weapon.owned.level}</small><small className="tw-weapon-rank">R{member.showcase.weapon.owned.rank}</small></>}
        </div>
        <EchoThumbs member={member} decorated/>
      </div>
      <SonataChips member={member}/>
      {buffs.length > 0 && <details className="tw-member-buffs" open={buffsOpen} onToggle={(event) => setBuffsOpen(event.currentTarget.open)}>
        <summary><span>Team buffs</span><b>{buffs.length}</b><i aria-hidden="true">⌄</i></summary>
        <div>{buffs.map((buff, index) => <div key={`${buff.id}-${index}`}>
          <span><small>{index < member.receivedBuffs.length ? 'Received' : 'Applied'}</small><strong>{buff.name}</strong></span>
          <b>{buff.stat !== 'amplify' && <img className="tw-stat-icon" src={statIconSource(buff.stat)} alt="" aria-hidden="true"/>}{buff.stat === 'amplify' ? 'Amplify' : statLabels[buff.stat]} {buff.value}%</b>
        </div>)}</div>
      </details>}
      {model.actions.length > 0 && <><dl className="tw-mini-facts"><div><dt>Rotation damage</dt><dd><CalculatedValue detail={sumDetail(`${teamMemberName(member)} rotation`, member.contribution, model.actions.filter((row) => row.member?.slot === member.slot).map((row) => ({ label: compactAttackLabel(row.attack?.name ?? 'Action'), value: row[resultMode] })))}>{formatDamage(member.contribution)}</CalculatedValue></dd></div><div><dt>Team share</dt><dd><CalculatedValue detail={sumDetail(`${teamMemberName(member)} rotation share`, member.contributionPercent, [{ label: 'Member contribution', value: member.contribution }, { label: 'Team rotation', value: model.total }], 'Member contribution ÷ team rotation × 100')}>{percent(member.contribution, model.total)}</CalculatedValue></dd></div></dl>
      <div className="tw-progress" aria-hidden="true"><span style={{ width: `${member.contributionPercent}%` }}/></div></>}
    </> : <div className="tw-empty-copy"><strong>No member assigned</strong><p>The slot stays visible so the team structure is always clear.</p></div>}
  </article>
}

interface TeamGalleryCardProps {
  team: Team
  builds: Build[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  echoes: Echo[]
  equippedLoadouts: EquippedLoadout[]
  theorycraftBuilds: TheorycraftBuild[]
  onOpen: () => void
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}

interface CharacterFilterOption {
  catalogId: string
  name: string
  favorite: boolean
  iconSourceUrl: string
}

function CharacterFilterPicker({ value, options, onChange }: {
  value: string
  options: CharacterFilterOption[]
  onChange: (value: string) => void
}) {
  const pickerRef = useRef<HTMLDetailsElement>(null)
  const selected = options.find((option) => option.catalogId === value)
  const choose = (nextValue: string) => {
    onChange(nextValue)
    pickerRef.current?.removeAttribute('open')
  }

  return <details
    className="tw-character-filter"
    ref={pickerRef}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute('open')
    }}
    onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.currentTarget.removeAttribute('open')
        event.currentTarget.querySelector('summary')?.focus()
      }
    }}
  >
    <summary>
      {selected ? <img src={selected.iconSourceUrl} alt=""/> : <span className="tw-character-filter-all">ALL</span>}
      <b>{selected?.name ?? 'All characters'}</b>
      {selected?.favorite && <span className="tw-character-filter-heart" aria-label="Favorite">♥</span>}
      <i aria-hidden="true">⌄</i>
    </summary>
    <div className="tw-character-filter-menu">
      <button type="button" className={value === 'all' ? 'active' : ''} onClick={() => choose('all')}>
        <span className="tw-character-filter-all">ALL</span><b>All characters</b>
      </button>
      {options.map((option) => <button type="button" className={value === option.catalogId ? 'active' : ''} key={option.catalogId} onClick={() => choose(option.catalogId)}>
        <img src={option.iconSourceUrl} alt=""/>
        <b>{option.name}</b>
        {option.favorite && <span className="tw-character-filter-heart" aria-label="Favorite">♥</span>}
      </button>)}
    </div>
  </details>
}

function TeamGalleryCard({ team, builds, characters, weapons, echoes, equippedLoadouts, theorycraftBuilds, onOpen, onRename, onDelete }: TeamGalleryCardProps) {
  const [name, setName] = useState(team.name)
  useEffect(() => setName(team.name), [team.name])

  const commitName = () => {
    const nextName = name.trim()
    if (!nextName) setName(team.name)
    else if (nextName !== team.name) void onRename(nextName)
  }

  const workspace = resolveTeamWorkspace({ team, builds, characters, weapons, echoes, equippedLoadouts, theorycraftBuilds })
  const members = workspace.members.map((member) => ({
    slot: member.slot,
    build: member.build,
    character: member.character,
    catalog: member.catalog,
    weapon: member.showcase?.weapon?.owned,
    weaponEntry: member.showcase?.weapon?.catalog,
    equippedEchoes: member.showcase?.equippedEchoes ?? [],
    activeSonatas: member.showcase?.sonatas.flatMap((candidate) => {
      const entry = sonataCatalog.find((sonata) => sonata.name === candidate.name)
      const activePieces = Math.max(0, ...(entry?.effects.filter((effect) => candidate.count >= effect.pieces).map((effect) => effect.pieces) ?? []))
      return activePieces ? [{ ...candidate, activePieces }] : []
    }) ?? []
  }))

  return <article className="tw-gallery-card">
    <header>
      <input aria-label={`Team name for ${team.name}`} value={name} onClick={(event) => event.stopPropagation()} onChange={(event) => setName(event.target.value)} onBlur={commitName} onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') { setName(team.name); event.currentTarget.blur() }
      }}/>
      <button type="button" className="tw-gallery-delete" aria-label={`Delete ${team.name}`} onClick={() => void onDelete()}><Icon name="trash"/></button>
    </header>
    <button type="button" className="tw-gallery-open" onClick={onOpen} aria-label={`Open ${team.name}`}>
      <span className="tw-gallery-members">{members.map(({ slot, build, character, catalog, weapon, weaponEntry, equippedEchoes, activeSonatas }) => <span className={`tw-gallery-member ${catalog ? '' : 'empty'}`} key={slot} style={catalog ? { '--tw-card-element': ELEMENT_COLORS[catalog.element] ?? '#8de4d4' } as CSSProperties : undefined}>
        {catalog?.portraitSourceUrl && <img className="tw-gallery-portrait" src={catalog.portraitSourceUrl} alt=""/>}
        {catalog ? <>
          <span className="tw-gallery-character"><span><strong>{catalog.name}</strong><em className="tw-gallery-level">Lv. {character?.level ?? build?.level ?? 1} · S{character?.sequence ?? 0}</em><span className="tw-gallery-sonatas">{activeSonatas.length ? activeSonatas.map((sonata) => <small className="tw-gallery-sonata" title={sonata.name} aria-label={`${sonata.name}, ${sonata.activePieces}-piece set bonus`} key={sonata.name}><img src={sonata.iconSourceUrl} alt="" aria-hidden="true"/><span>{sonata.name}</span><b>{sonata.activePieces}</b></small>) : <small className="tw-gallery-sonata empty">No active Sonata</small>}</span></span></span>
          <span className="tw-gallery-loadout">
            <span className="weapon">{weaponEntry?.iconSourceUrl && <img src={weaponEntry.iconSourceUrl} alt=""/>}<b>{weapon ? `${weapon.level}/90` : '—'}</b><small>{weapon ? `R${weapon.rank}` : 'No weapon'}</small></span>
            {Array.from({ length: 5 }, (_, index) => { const echo = equippedEchoes[index]; return <span key={echo?.id ?? index} className={echo ? '' : 'empty'}>{echo && <img className="tw-gallery-stat-icon" src={statIconSource(echo.mainStat.key)} alt="" title={statLabels[echo.mainStat.key]} aria-hidden="true"/>}<b>{echo ? `+${echo.level}` : '+'}</b><small>{echo?.cost ?? '—'}</small></span> })}
          </span>
        </> : <span className="tw-gallery-empty-member"><span>+</span><strong>Empty member slot</strong></span>}
      </span>)}</span>
    </button>
  </article>
}

function TeamGallery({ teams, builds, characters, weapons, echoes, equippedLoadouts, theorycraftBuilds, onCreate, onOpen, onRename, onDelete }: {
  teams: Team[]
  builds: Build[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  echoes: Echo[]
  equippedLoadouts: EquippedLoadout[]
  theorycraftBuilds: TheorycraftBuild[]
  onCreate: () => Promise<void>
  onOpen: (teamId: string) => void
  onRename: (teamId: string, name: string) => Promise<void>
  onDelete: (team: Team) => Promise<void>
}) {
  const [characterFilter, setCharacterFilter] = useWorkspacePreference('gallery:character-filter', 'all')
  const [query, setQuery] = useWorkspacePreference('gallery:query', '')
  const characterOptions = useMemo(() => {
    const options = new Map<string, CharacterFilterOption>()
    characters.forEach((owned) => {
      const catalog = characterCatalog.find((entry) => entry.id === owned.catalogId)
      if (!catalog) return
      const existing = options.get(owned.catalogId)
      options.set(owned.catalogId, {
        catalogId: owned.catalogId,
        name: catalog.name,
        favorite: Boolean(owned.favorite || existing?.favorite),
        iconSourceUrl: catalog.iconSourceUrl
      })
    })
    return [...options.values()].sort((left, right) => Number(right.favorite) - Number(left.favorite) || left.name.localeCompare(right.name))
  }, [characters])
  const visibleTeams = teams.filter((team) => {
    const matchesName = team.name.toLowerCase().includes(query.trim().toLowerCase())
    const matchesCharacter = characterFilter === 'all' || (team.members ?? []).some((member) => characters.find((character) => character.id === member.characterId)?.catalogId === characterFilter)
      || team.buildIds.some((buildId) => builds.find((build) => build.id === buildId)?.resonatorId === characterFilter)
    return matchesName && matchesCharacter
  }).sort((left, right) => left.name.localeCompare(right.name))

  return <div className="tw-gallery-page">
    <section className="tw-gallery-controls tw-panel">
      <div><span className="eyebrow">Team Loadout</span><h1>Your teams</h1><p>Choose a team to open its full composition, member sheets, buffs, and rotation workspace.</p></div>
      <label><span>Character filter</span><CharacterFilterPicker value={characterFilter} options={characterOptions} onChange={setCharacterFilter}/></label>
      <label><span>Team name</span><span className="search-field"><Icon name="scan"/><input data-search="" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teams..."/><kbd>Ctrl K</kbd></span></label>
      <button type="button" className="primary tw-gallery-create" onClick={() => void onCreate()}><Icon name="plus"/>Add team</button>
      <strong className="tw-gallery-count">Showing {visibleTeams.length} of {teams.length} teams</strong>
    </section>
    {visibleTeams.length ? <div className="tw-gallery-grid">{visibleTeams.map((team) => <TeamGalleryCard team={team} builds={builds} characters={characters} weapons={weapons} echoes={echoes} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} onOpen={() => onOpen(team.id)} onRename={(name) => onRename(team.id, name)} onDelete={() => onDelete(team)} key={team.id}/>)}</div>
      : <section className="tw-gallery-empty tw-panel"><span>{teams.length ? 'No matches' : 'No teams yet'}</span><h2>{teams.length ? 'Try another character or team name.' : 'Create your first team.'}</h2>{!teams.length && <button className="primary" onClick={() => void onCreate()}><Icon name="plus"/>Add team</button>}</section>}
  </div>
}

function TeamWorkspaceHeader({ team, model, onBack, onRename, onDelete }: {
  team: Team
  model: TeamWorkspaceModel
  onBack: () => void
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(team.name)
  useEffect(() => setName(team.name), [team.id, team.name])
  const commitName = () => {
    const next = name.trim()
    if (!next) setName(team.name)
    else if (next !== team.name) void onRename(next)
  }
  const readyMembers = model.members.filter((member) => member.build && member.showcase?.weapon && member.showcase.equippedEchoes.length === 5 && member.showcase.totalEchoCost <= 12).length
  return <header className="tw-workspace-header tw-panel">
    <button type="button" className="tw-back-to-gallery" onClick={onBack}><span aria-hidden="true">←</span> Teams</button>
    <label className="tw-workspace-name"><span>Team name</span><input value={name} onChange={(event) => setName(event.target.value)} onBlur={commitName} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setName(team.name); event.currentTarget.blur() } }}/></label>
    <div className="tw-workspace-status" aria-label="Team status">
      <span><small>Builds ready</small><b>{readyMembers} of 3</b></span>
      <span><small>Rotation</small><b>{team.actions.length ? `${team.actions.length} actions` : 'Not set'}</b></span>
    </div>
    <button type="button" className="tw-workspace-delete" onClick={() => void onDelete()} aria-label={`Delete ${team.name}`}><Icon name="trash"/></button>
  </header>
}

function BuildManagementModal({ characterId, echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds, refresh, onSelect, onClose, onEditTheorycraft }: {
  characterId: string
  echoes: Echo[]
  builds: Build[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  equippedLoadouts: EquippedLoadout[]
  theorycraftBuilds: TheorycraftBuild[]
  refresh: () => Promise<void>
  onSelect: (source: LoadoutSourceRef) => void
  onClose: () => void
  onEditTheorycraft: (build: TheorycraftBuild) => void
}) {
  return createPortal(<div className="modal-backdrop tw-build-management-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="tw-build-management-modal" role="dialog" aria-modal="true" aria-label="Build Management">
      <header><div><Icon name="build"/><h2>Build Management</h2></div><button type="button" aria-label="Close build management" onClick={onClose}>×</button></header>
      <div className="tw-build-management-body"><BuildsView echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} refresh={refresh} embedded management characterId={characterId} onSelectSource={onSelect} onEditTheorycraft={onEditTheorycraft}/></div>
    </section>
  </div>, document.body)
}

function OwnedCharacterPicker({ characters, onSelect, onClose }: { characters: OwnedCharacter[]; onSelect: (character: OwnedCharacter) => void; onClose: () => void }) {
  const elements = [...new Set(characterCatalog.map((entry) => entry.element))]
  const rarities = [...new Set(characterCatalog.map((entry) => entry.rarity))].sort((left, right) => right - left)
  const [query, setQuery] = useState('')
  const [selectedElements, setSelectedElements] = useState(elements)
  const [selectedRarities, setSelectedRarities] = useState(rarities)
  const visible = characters.flatMap((character) => {
    const catalog = characterCatalog.find((entry) => entry.id === character.catalogId)
    if (!catalog || !selectedElements.includes(catalog.element) || !selectedRarities.includes(catalog.rarity) || !`${catalog.name} ${catalog.element} ${catalog.weaponType}`.toLowerCase().includes(query.toLowerCase())) return []
    return [{ character, catalog }]
  }).sort((left, right) => Number(Boolean(right.character.favorite)) - Number(Boolean(left.character.favorite)) || left.catalog.name.localeCompare(right.catalog.name))
  return <CharacterPicker title="Choose a character" query={query} setQuery={setQuery} filters={<div className="catalog-picker-filters"><FilterChips label="Element" values={elements} selected={selectedElements} onChange={setSelectedElements} renderValue={(value) => <ElementFilterIcon element={value}/>} /><FilterChips label="Rarity" values={rarities} selected={selectedRarities} onChange={setSelectedRarities} renderValue={(value) => `${value} ★`}/></div>} onClose={onClose}>
    {visible.map(({ character, catalog }) => <button className={`catalog-choice character-choice rarity-${catalog.rarity}`} key={character.id} onClick={() => onSelect(character)}><img src={catalog.iconSourceUrl} alt=""/><span><strong>{catalog.name}</strong><small>{catalog.element} · {catalog.weaponType}</small><b>{'★'.repeat(catalog.rarity)}</b></span></button>)}
  </CharacterPicker>
}

function ScenarioSlider({ name, value, min = 0, max, unit = 'Stacks', suffix = '', ticks: tickValues, disabled = false, onCommit }: { name: string; value: number; min?: number; max: number; unit?: string; suffix?: string; ticks?: readonly number[]; disabled?: boolean; onCommit: (value: number) => void }) {
  const boundedValue = Math.max(min, Math.min(max, Math.trunc(value)))
  const [draft, setDraft] = useState(boundedValue)
  useEffect(() => setDraft(boundedValue), [boundedValue])
  const commit = (next: number) => { if (next !== boundedValue) onCommit(next) }
  const ticks = tickValues ?? Array.from({ length:max - min + 1 }, (_, index) => min + index).filter((tick) => max - min <= 9 || tick === max || ((tick - min) % 2 === 0 && tick !== max - 1))
  const displayedValue = disabled ? min : draft
  return <div className={`tw-scenario-slider${displayedValue !== min ? ' is-active' : ''}${disabled ? ' is-unavailable' : ''}`} title={disabled ? `${name} is unavailable with this team.` : undefined}>
    <span className="tw-scenario-slider-heading"><strong>{name}</strong><b>{displayedValue}{suffix}</b></span>
    {unit && <small>{disabled ? 'Unavailable with this team' : unit}</small>}
    <input aria-label={unit === 'Stacks' ? `${name} stacks` : name} type="range" min={min} max={max} step="1" value={displayedValue} disabled={disabled} style={{ '--tw-slider-fill':`${(displayedValue - min) / (max - min) * 100}%` } as CSSProperties} onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={(event) => commit(Number(event.currentTarget.value))} onKeyUp={(event) => commit(Number(event.currentTarget.value))} onBlur={(event) => commit(Number(event.currentTarget.value))}/>
    <span className="tw-scenario-slider-ticks">{ticks.map((tick) => <button type="button" aria-label={`Set ${name} to ${tick}${suffix}`} aria-pressed={displayedValue === tick} className={displayedValue === tick ? 'active' : ''} disabled={disabled} key={tick} style={{ left:`${(tick - min) / (max - min) * 100}%` }} onClick={() => { setDraft(tick); commit(tick) }}>{tick}</button>)}</span>
  </div>
}

function TeamOverview({ model, echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds, refresh, updateTeam }: {
  model: TeamWorkspaceModel
  echoes: Echo[]
  builds: Build[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  equippedLoadouts: EquippedLoadout[]
  theorycraftBuilds: TheorycraftBuild[]
  refresh: () => Promise<void>
  updateTeam: (patch: Partial<Team>) => Promise<void>
}) {
  const [scenarioOpen, setScenarioOpen] = useWorkspacePreference(`team:${model.team.id}:scenario-open`, false)
  const [managingMemberSlot, setManagingMemberSlot] = useState<number>()
  const [choosingMemberSlot, setChoosingMemberSlot] = useState<number>()
  const [editingTheorycraft, setEditingTheorycraft] = useState<TheorycraftBuild>()
  const resultMode = model.team.scenario?.resultMode ?? 'expected'
  const resultModeLabel = resultMode === 'expected' ? 'Average' : resultMode === 'normal' ? 'Non-crit' : 'Critical'
  const applicableStatuses = applicableTeamStatusEffects(model.members.flatMap((member) => member.character ? [member.character.catalogId] : []))
  const loadoutOptions = characters.flatMap((character) => {
    const catalog = characterCatalog.find((entry) => entry.id === character.catalogId)
    return [
      { value: `equipped:${character.id}`, label: `${catalog?.name ?? 'Character'} · Equipped Build`, shortLabel: 'Equipped Build', characterId: character.id },
      ...builds.filter((build) => (build.characterId === character.id || (!build.characterId && build.resonatorId === character.catalogId))).map((build) => ({ value: `saved:${build.id}`, label: `${catalog?.name ?? 'Character'} · ${build.name}`, shortLabel: build.name, characterId: character.id })),
      ...theorycraftBuilds.filter((build) => build.characterId === character.id).map((build) => ({ value: `theorycraft:${build.id}`, label: `${catalog?.name ?? 'Character'} · ${build.name} (TC)`, shortLabel: `${build.name} (TC)`, characterId: character.id }))
    ]
  })
  const chooseMember = async (slot: number, sourceValue: string) => {
    const previous = model.team.members?.[slot]
    const members = [...(model.team.members ?? [])]
    if (sourceValue) {
      const separator = sourceValue.indexOf(':'); const type = sourceValue.slice(0, separator); const id = sourceValue.slice(separator + 1)
      const loadoutSource: LoadoutSourceRef = type === 'equipped' ? { type, characterId: id } : type === 'saved' ? { type, buildId: id } : { type: 'theorycraft', theorycraftBuildId: id }
      const characterId = type === 'equipped' ? id : type === 'saved' ? (builds.find((entry) => entry.id === id)?.characterId ?? characters.find((entry) => entry.catalogId === builds.find((build) => build.id === id)?.resonatorId)?.id) : theorycraftBuilds.find((entry) => entry.id === id)?.characterId
      if (!characterId) return
      const record = { memberId: previous?.memberId ?? `member:${model.team.id}:${createLocalId()}`, characterId, loadoutSource, compareSource: previous?.characterId === characterId ? previous.compareSource : undefined }
      if (slot < members.length) members[slot] = record
      else members.push(record)
    } else members.splice(slot, 1)
    const buildIds = members.map((member) => member.memberId)
    const scenario = model.team.scenario
    const keepBuildRecords = <T,>(records: Record<string, T> = {}) => Object.fromEntries(Object.entries(records).filter(([buildId]) => buildIds.includes(buildId)))
    await updateTeam({
      members, buildIds,
      actions: model.team.actions.filter((action) => buildIds.includes(action.buildId)),
      buffs: (model.team.buffs ?? []).filter((buff) => buildIds.includes(buff.sourceBuildId)),
      ...(scenario ? { scenario: { ...scenario, memberConditions: keepBuildRecords(scenario.memberConditions), selectedTargetByBuild: keepBuildRecords(scenario.selectedTargetByBuild), ...(scenario.compareBuildId && buildIds.includes(scenario.compareBuildId) ? {} : { compareBuildId: undefined }) } } : {})
    })
  }
  if (editingTheorycraft) return <div className="tw-member-page"><TheorycraftEditor value={editingTheorycraft} ownedCharacter={characters.find((character) => character.id === editingTheorycraft.characterId)} onSaved={refresh} onClose={() => setEditingTheorycraft(undefined)}/></div>
  return <div className="tw-settings-page">
    <details className="tw-environment-details tw-panel" open={scenarioOpen} onToggle={(event) => setScenarioOpen(event.currentTarget.open)}>
      <summary>
        <span className="tw-environment-summary">
          <span className="tw-environment-heading"><strong className="tw-environment-title">Combat scenario</strong><small>Enemy &amp; timing</small></span>
          {model.actions.length ? <><b className="rotation">{resultModeLabel} {formatDamage(model.total)}</b><b className="dps">{formatDamage(model.dps)} DPS</b></> : <b className="empty">No rotation yet</b>}
          <span>Lv. {model.team.enemy.level} enemy · {model.team.enemy.resistance}% RES</span>
          <span>{model.team.rotationDuration.toFixed(1)}s window</span>
        </span>
        <i aria-hidden="true">⌄</i>
      </summary>
      <section className="tw-metrics">
        <div><span>{resultModeLabel} rotation</span><CalculatedValue detail={sumDetail(`${resultModeLabel} rotation`, model.total, model.actions.map((row) => ({ label: `${row.action.timestamp.toFixed(1)}s · ${compactAttackLabel(row.attack?.name ?? 'Missing attack')}`, value: row[resultMode] })))}><strong>{formatDamage(model.total)}</strong></CalculatedValue></div>
        <div><span>Rotation DPS</span><CalculatedValue detail={sumDetail('Rotation DPS', model.dps, [{ label: `${resultModeLabel} rotation total`, value: model.total }, { label: 'Rotation duration', value: model.team.rotationDuration }], `${resultModeLabel} rotation ÷ rotation duration`)}><strong>{formatDamage(model.dps)}</strong></CalculatedValue><small>{model.team.rotationDuration.toFixed(1)} second window</small></div>
        <label><span>Enemy Cost (Tune Break)</span><select value={model.team.enemy.cost ?? 4} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, cost:Number(event.target.value) as 1 | 3 | 4 } })}><option value={1}>1 Cost</option><option value={3}>3 Cost</option><option value={4}>4 Cost</option></select></label>
        <label><span>DMG reduction %</span><input type="number" min="0" max="100" value={model.team.enemy.damageReduction} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, damageReduction: Math.max(0, Math.min(100, Number(event.target.value))) } })}/></label>
        <label><span>DEF ignore %</span><input type="number" min="0" max="100" value={model.team.enemy.defenseIgnore ?? 0} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, defenseIgnore: Math.max(0, Math.min(100, Number(event.target.value))) } })}/></label>
        <label><span>DEF reduction %</span><input type="number" min="0" max="100" value={model.team.enemy.defenseReduction ?? 0} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, defenseReduction: Math.max(0, Math.min(100, Number(event.target.value))) } })}/></label>
        <label><span>RES ignore %</span><input type="number" min="0" max="100" value={model.team.enemy.resistanceIgnore ?? 0} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, resistanceIgnore: Math.max(0, Math.min(100, Number(event.target.value))) } })}/></label>
      </section>
      <small className="tw-slider-hint">Click a number below a slider to jump to that value.</small>
      <section className="tw-scenario-slider-grid" aria-label="Enemy level and resistance">
        <ScenarioSlider name="Enemy level" unit="" value={model.team.enemy.level} min={1} max={120} ticks={[1, 30, 60, 90, 120]} onCommit={(level) => void updateTeam({ enemy:{ ...model.team.enemy, level } })}/>
        <ScenarioSlider name="Enemy resistance" unit="" suffix="%" value={model.team.enemy.resistance} min={-100} max={100} ticks={[-100, -50, 0, 50, 100]} onCommit={(resistance) => void updateTeam({ enemy:{ ...model.team.enemy, resistance } })}/>
      </section>
      <section className="tw-status-effects" aria-label="Status effects">
        <header><strong>Status effects</strong><small>Set enemy stacks for damage previews and rotations.</small></header>
        <div className="tw-status-slider-grid">
          <ScenarioSlider name="Tune Strain" value={applicableStatuses.has('tune-strain') ? model.team.enemy.strainStacks ?? 0 : 0} max={4} disabled={!applicableStatuses.has('tune-strain')} onCommit={(strainStacks) => void updateTeam({ enemy:{ ...model.team.enemy, strainStacks } })}/>
          <ScenarioSlider name="Havoc Bane" value={applicableStatuses.has('havoc-bane') ? model.team.enemy.havocBaneStacks ?? 0 : 0} max={3} disabled={!applicableStatuses.has('havoc-bane')} onCommit={(havocBaneStacks) => void updateTeam({ enemy:{ ...model.team.enemy, havocBaneStacks } })}/>
          {negativeStatusActions.map(({ status, name }) => <ScenarioSlider key={status} name={name} value={applicableStatuses.has(status) ? model.team.enemy.statusStacks?.[status] ?? 0 : 0} max={negativeStatusMotionValues[status].length - 1} disabled={!applicableStatuses.has(status)} onCommit={(stacks) => void updateTeam({ enemy:{ ...model.team.enemy, statusStacks:{ ...model.team.enemy.statusStacks, [status]:stacks } } })}/>)}
          <ScenarioSlider name="Electro Rage" value={applicableStatuses.has('electro-rage') ? model.team.enemy.electroRageStacks ?? 0 : 0} max={13} disabled={!applicableStatuses.has('electro-rage')} onCommit={(electroRageStacks) => void updateTeam({ enemy:{ ...model.team.enemy, electroRageStacks } })}/>
        </div>
      </section>
    </details>

    <section className="tw-member-columns">{model.members.map((member) => { const memberOptions = member.character ? loadoutOptions.filter((option) => option.characterId === member.character?.id).map((option) => ({ ...option, label: option.shortLabel })) : loadoutOptions; return <TeamMemberColumn key={member.slot} member={member} model={model} loadoutOptions={memberOptions} onChooseCharacter={() => setChoosingMemberSlot(member.slot)} onAssign={(source) => chooseMember(member.slot, source)} onManage={() => { if (member.character) setManagingMemberSlot(member.slot) }}/> })}</section>
    <BuffWorkspace model={model} updateTeam={updateTeam}/>
    {choosingMemberSlot !== undefined && <OwnedCharacterPicker characters={characters} onSelect={(character) => { void chooseMember(choosingMemberSlot, `equipped:${character.id}`); setChoosingMemberSlot(undefined) }} onClose={() => setChoosingMemberSlot(undefined)}/>} 
    {managingMemberSlot !== undefined && model.members[managingMemberSlot]?.character && <BuildManagementModal characterId={model.members[managingMemberSlot].character!.id} echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} refresh={refresh} onSelect={(source) => { const value = source.type === 'equipped' ? `equipped:${source.characterId}` : source.type === 'saved' ? `saved:${source.buildId}` : `theorycraft:${source.theorycraftBuildId}`; void chooseMember(managingMemberSlot, value); setManagingMemberSlot(undefined) }} onClose={() => setManagingMemberSlot(undefined)} onEditTheorycraft={setEditingTheorycraft}/>}
  </div>
}

function BuffWorkspace({ model, updateTeam }: { model: TeamWorkspaceModel; updateTeam: (patch: Partial<Team>) => Promise<void> }) {
  const [modifiersOpen, setModifiersOpen] = useWorkspacePreference(`team:${model.team.id}:modifiers-open`, false)
  const buffs = model.team.buffs ?? []
  const updateBuff = (id: string, patch: Partial<BuffEffect>) => updateTeam({ buffs: buffs.map((buff) => buff.id === id ? { ...buff, ...patch } : buff) })
  const addBuff = async () => {
    const member = model.members.find((entry) => entry.build && entry.attacks.length)
    const attack = member?.attacks[0]
    if (!member?.build || !attack) return
    await updateTeam({ buffs: [...buffs, { id: createLocalId(), name: 'Team buff', sourceBuildId: member.build.id, target: 'team', triggerAttackId: attack.id, duration: 10, stat: 'atkPercent', value: 10, stackingGroup: createLocalId() }] })
  }
  return <details className="tw-panel tw-buff-workspace tw-advanced-modifiers" open={modifiersOpen} onToggle={(event) => setModifiersOpen(event.currentTarget.open)}>
    <summary><span><small>Optional scenario tools</small><strong>Custom modifiers</strong></span><b>{buffs.length ? `${buffs.length} added` : 'None added'}</b><i aria-hidden="true">⌄</i></summary>
    <div className="tw-advanced-modifiers-body"><header><div><span className="eyebrow">Custom modifiers</span><h2>Extra buffs and amplification</h2><p>Add only effects that are not already provided by a character, weapon, Echo, or Sonata.</p></div><button className="secondary" onClick={() => void addBuff()} disabled={!model.members.some((member) => member.build && member.attacks.length)}><Icon name="plus"/>Add modifier</button></header>
    <div className="tw-buff-list">{buffs.map((buff) => {
      const source = model.members.find((member) => member.build?.id === buff.sourceBuildId)
      const attacks = source?.attacks ?? []
      return <div className="tw-buff-row" key={buff.id}>
        <label><span>Name</span><input value={buff.name} onChange={(event) => void updateBuff(buff.id, { name: event.target.value })}/></label>
        <label><span>Source</span><select value={buff.sourceBuildId} onChange={(event) => { const member = model.members.find((entry) => entry.build?.id === event.target.value); void updateBuff(buff.id, { sourceBuildId: event.target.value, triggerAttackId: member?.attacks[0]?.id ?? '' }) }}>{model.members.flatMap((member) => member.build ? [<option value={member.build.id} key={member.build.id}>{teamMemberName(member)}</option>] : [])}</select></label>
        <label><span>Trigger</span><select value={buff.triggerAttackId} onChange={(event) => void updateBuff(buff.id, { triggerAttackId: event.target.value })}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{compactAttackLabel(attack.name)}</option>)}</select></label>
        <label><span>Target</span><select value={buff.target} onChange={(event) => void updateBuff(buff.id, { target: event.target.value as BuffEffect['target'] })}><option value="self">Self</option><option value="next">Next member</option><option value="team">Team</option></select></label>
        <label><span>Effect</span><select value={buff.stat} onChange={(event) => void updateBuff(buff.id, { stat: event.target.value as BuffEffect['stat'] })}><option value="amplify">Amplification</option><option value="atkPercent">ATK %</option><option value="hpPercent">HP %</option><option value="defPercent">DEF %</option><option value="critRate">Crit. Rate</option><option value="critDamage">Crit. DMG</option><option value="basicDamage">Basic DMG</option><option value="heavyDamage">Heavy DMG</option><option value="skillDamage">Skill DMG</option><option value="liberationDamage">Liberation DMG</option><option value="healingBonus">Healing Bonus</option></select></label>
        <label><span>Value %</span><input type="number" value={buff.value} onChange={(event) => void updateBuff(buff.id, { value: Number(event.target.value) })}/></label>
        <label><span>Duration</span><input type="number" min="0" step="0.1" value={buff.duration} onChange={(event) => void updateBuff(buff.id, { duration: Math.max(0, Number(event.target.value)) })}/></label>
        <button className="tw-remove" aria-label={`Remove ${buff.name}`} onClick={() => void updateTeam({ buffs: buffs.filter((entry) => entry.id !== buff.id) })}><Icon name="trash"/></button>
      </div>
    })}{!buffs.length && <p className="tw-empty-state">No authored modifiers.</p>}</div>
    </div>
  </details>
}

const ROTATION_DEFAULT_CLIP_DURATION = 0.8
const ROTATION_MIN_CLIP_DURATION = 0.1
const ROTATION_SNAP = 0.1

function defaultRotationClipDuration(group: TeamAttackGroup) {
  return { basic: 0.2, skill: 0.8, forte: 0.3, liberation: 1.5, intro: 0.5, outro: 0.5, echo: 0.2, tuneBreak: 0.8, status: 0.8 }[group]
}

function timelineClamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function timelineRound(value: number) {
  return Number(value.toFixed(2))
}

function compactDamage(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}m`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 100_000 ? 0 : 1))}k`
  return Math.floor(value).toLocaleString('en-US')
}

function damageChartMaximum(value: number) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const ceiling = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return ceiling * magnitude
}

function actionDuration(action: RotationAction, rotationDuration: number) {
  return timelineClamp(action.duration ?? ROTATION_DEFAULT_CLIP_DURATION, ROTATION_MIN_CLIP_DURATION, Math.max(ROTATION_MIN_CLIP_DURATION, rotationDuration - action.timestamp))
}

function actionMultiplier(action: RotationAction) {
  return Math.max(1, Math.min(99, Math.floor(action.multiplier ?? 1)))
}

function sameActions(left: RotationAction[], right: RotationAction[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

type TimelineGesture =
  | { kind: 'move' | 'trim-start' | 'trim-end'; pointerId: number; originX: number; actionId: string; selectedIds: string[]; original: RotationAction[]; preview: RotationAction[]; changed: boolean }
  | { kind: 'box'; pointerId: number; startTime: number; currentTime: number; startX: number; currentX: number; startY: number; currentY: number; initialIds: string[] }

interface TimelineQuickCreate { buildId: string; timestamp: number; attackId: string }

interface TimelineMenu { actionId: string; x: number; y: number }

function RotationWorkspace({ model, updateTeam, focusBuildId }: { model: TeamWorkspaceModel; updateTeam: (patch: Partial<Team>) => Promise<void>; focusBuildId?: string }) {
  const forteGroupLabel = (group: TeamAttackGroup) => ROTATION_ATTACK_GROUPS.find((entry) => entry.id === group)?.label ?? group
  const damageSourceLabel = (type: DamageType) => type === 'basic' ? 'Basic DMG'
    : type === 'heavy' ? 'Heavy DMG'
      : type === 'skill' ? 'Skill DMG'
        : type === 'liberation' ? 'Liberation DMG'
          : type === 'intro' ? 'Intro DMG'
            : type === 'outro' ? 'Outro DMG'
              : type === 'echo' ? 'Echo DMG'
                : type === 'tuneBreak' ? 'Tune Break DMG'
                  : type === 'status' ? 'Status DMG' : 'Healing'
  const firstMember = model.members.find((entry) => entry.build && entry.attacks.length)
  const rotationPreferenceKey = `${model.team.id}:${focusBuildId ?? 'team'}`
  const [draftBuildId, setDraftBuildId] = useWorkspacePreference(`rotation:${rotationPreferenceKey}:build`, focusBuildId ?? firstMember?.build?.id ?? '')
  const draftMember = model.members.find((entry) => entry.build?.id === draftBuildId) ?? firstMember
  const [draftAttackId, setDraftAttackId] = useWorkspacePreference(`rotation:${rotationPreferenceKey}:attack`, draftMember?.attacks[0]?.id ?? '')
  const [draftTimestamp, setDraftTimestamp] = useWorkspacePreference(`rotation:${rotationPreferenceKey}:timestamp`, Math.min(model.team.rotationDuration, Math.ceil((model.team.actions.at(-1)?.timestamp ?? -1) + 1)))
  const [draftDuration, setDraftDuration] = useWorkspacePreference(`rotation:${rotationPreferenceKey}:duration`, defaultRotationClipDuration(draftMember?.attacks[0]?.group ?? 'skill'))
  const [analysisMode, setAnalysisMode] = useWorkspacePreference<'character' | 'type'>(`rotation:${model.team.id}:analysis`, 'character')
  const [timelineActions, setTimelineActions] = useState<RotationAction[]>(model.team.actions)
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([])
  const [timelineScale, setTimelineScale] = useWorkspacePreference(`rotation:${model.team.id}:scale`, 56)
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [quickCreate, setQuickCreate] = useState<TimelineQuickCreate | null>(null)
  const [timelineMenu, setTimelineMenu] = useState<TimelineMenu | null>(null)
  const [boxSelection, setBoxSelection] = useState<{ startTime: number; currentTime: number; startY: number; currentY: number } | null>(null)
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const [cardDropTarget, setCardDropTarget] = useState<{ actionId: string; after: boolean } | null>(null)
  const timelineViewportRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<TimelineGesture | null>(null)
  const undoStackRef = useRef<RotationAction[][]>([])
  const redoStackRef = useRef<RotationAction[][]>([])
  const [clipboardActions, setClipboardActions] = useState<RotationAction[]>([])
  const resultMode = model.team.scenario?.resultMode ?? 'expected'
  useEffect(() => { setTimelineActions(model.team.actions) }, [model.team.actions])
  useEffect(() => {
    if (!focusBuildId || model.members.some((entry) => entry.build?.id === draftBuildId)) return
    setDraftBuildId(focusBuildId)
  }, [draftBuildId, focusBuildId, model.members])
  useEffect(() => {
    if (!draftMember?.attacks.some((attack) => attack.id === draftAttackId)) { setDraftAttackId(draftMember?.attacks[0]?.id ?? ''); setDraftDuration(defaultRotationClipDuration(draftMember?.attacks[0]?.group ?? 'skill')) }
  }, [draftAttackId, draftMember])
  useEffect(() => {
    if (!isPlaying) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = (now - previous) / 1000
      previous = now
      setPlayhead((current) => {
        const next = current + elapsed
        if (next >= model.team.rotationDuration) {
          setIsPlaying(false)
          return model.team.rotationDuration
        }
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, model.team.rotationDuration])

  const commitActions = (next: RotationAction[], previous = timelineActions) => {
    if (next.some((action) => !Number.isFinite(action.timestamp) || (action.duration !== undefined && !Number.isFinite(action.duration)))) return
    if (sameActions(next, previous)) return
    undoStackRef.current.push(previous)
    if (undoStackRef.current.length > 80) undoStackRef.current.shift()
    redoStackRef.current = []
    setTimelineActions(next)
    void updateTeam({ actions: next })
  }
  const restoreActions = (next: RotationAction[]) => {
    setTimelineActions(next)
    setSelectedActionIds((current) => current.filter((id) => next.some((action) => action.id === id)))
    void updateTeam({ actions: next })
  }
  const undoTimeline = () => {
    const previous = undoStackRef.current.pop()
    if (!previous) return
    redoStackRef.current.push(timelineActions)
    restoreActions(previous)
  }
  const redoTimeline = () => {
    const next = redoStackRef.current.pop()
    if (!next) return
    undoStackRef.current.push(timelineActions)
    restoreActions(next)
  }
  const copySelected = (ids = selectedActionIds) => {
    setClipboardActions(timelineActions.filter((action) => ids.includes(action.id)).map((action) => ({ ...action })))
  }
  const pasteSelected = () => {
    if (!clipboardActions.length) return
    const firstTimestamp = Math.min(...clipboardActions.map((action) => action.timestamp))
    const pasted = clipboardActions.map((action) => {
      const duration = actionDuration(action, model.team.rotationDuration)
      const timestamp = timelineClamp(playhead + action.timestamp - firstTimestamp, 0, Math.max(0, model.team.rotationDuration - duration))
      return { ...action, id: createLocalId(), timestamp: timelineRound(timestamp), duration }
    })
    commitActions([...timelineActions, ...pasted])
    setSelectedActionIds(pasted.map((action) => action.id))
  }
  const deleteSelected = () => {
    if (!selectedActionIds.length) return
    commitActions(timelineActions.filter((action) => !selectedActionIds.includes(action.id)))
    setSelectedActionIds([])
  }
  const duplicateSelected = (ids = selectedActionIds) => {
    const source = timelineActions.filter((action) => ids.includes(action.id))
    if (!source.length) return
    const latestEnd = Math.max(...source.map((action) => action.timestamp + actionDuration(action, model.team.rotationDuration)))
    const shift = latestEnd + ROTATION_SNAP <= model.team.rotationDuration ? ROTATION_SNAP : -ROTATION_SNAP
    const duplicates = source.map((action) => {
      const duration = actionDuration(action, model.team.rotationDuration)
      return { ...action, id: createLocalId(), timestamp: timelineRound(timelineClamp(action.timestamp + shift, 0, Math.max(0, model.team.rotationDuration - duration))), duration }
    })
    commitActions([...timelineActions, ...duplicates])
    setSelectedActionIds(duplicates.map((action) => action.id))
  }
  const nudgeSelected = (direction: -1 | 1, free = false) => {
    if (!selectedActionIds.length) return
    const step = free ? 0.01 : ROTATION_SNAP
    const selected = timelineActions.filter((action) => selectedActionIds.includes(action.id))
    const minimum = Math.min(...selected.map((action) => action.timestamp))
    const maximum = Math.max(...selected.map((action) => action.timestamp + actionDuration(action, model.team.rotationDuration)))
    const delta = timelineClamp(direction * step, -minimum, model.team.rotationDuration - maximum)
    commitActions(timelineActions.map((action) => selectedActionIds.includes(action.id) ? { ...action, timestamp: timelineRound(action.timestamp + delta) } : action))
  }
  const updateAction = (id: string, patch: Partial<RotationAction>) => {
    const next = timelineActions.map((action) => action.id === id ? { ...action, ...patch } : action)
    commitActions(next)
  }
  const selectClip = (event: ReactPointerEvent, actionId: string) => {
    if (event.button !== 0) return
    event.stopPropagation()
    setTimelineMenu(null)
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    const alreadySelected = selectedActionIds.includes(actionId)
    const selectedIds = additive
      ? alreadySelected ? selectedActionIds.filter((id) => id !== actionId) : [...selectedActionIds, actionId]
      : alreadySelected ? selectedActionIds : [actionId]
    setSelectedActionIds(selectedIds)
    if (additive && alreadySelected) return
    const handle = (event.target as HTMLElement).dataset.timelineHandle
    const kind = handle === 'start' ? 'trim-start' as const : handle === 'end' ? 'trim-end' as const : 'move' as const
    const gestureIds = kind === 'move' ? (selectedIds.includes(actionId) ? selectedIds : [actionId]) : [actionId]
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    gestureRef.current = { kind, pointerId: event.pointerId, originX: event.clientX, actionId, selectedIds: gestureIds, original: timelineActions, preview: timelineActions, changed: false }
  }
  const beginBoxSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    const lanes = event.currentTarget.closest<HTMLElement>('.tw-sequencer-lanes')
    if (!lanes) return
    const time = timelineClamp((event.clientX - rect.left) / timelineScale, 0, model.team.rotationDuration)
    const lanesRect = lanes.getBoundingClientRect()
    const startY = event.clientY - lanesRect.top
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    const initialIds = additive ? selectedActionIds : []
    event.currentTarget.setPointerCapture(event.pointerId)
    if (!additive) setSelectedActionIds([])
    setPlayhead(timelineRound(time))
    setTimelineMenu(null)
    setBoxSelection({ startTime: time, currentTime: time, startY, currentY: startY })
    gestureRef.current = { kind: 'box', pointerId: event.pointerId, startTime: time, currentTime: time, startX: event.clientX, currentX: event.clientX, startY: event.clientY, currentY: event.clientY, initialIds }
  }
  const moveTimelineGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'box') {
      const lanes = event.currentTarget.querySelector<HTMLElement>('.tw-sequencer-lanes')
      const lane = event.currentTarget.querySelector<HTMLElement>('[data-timeline-lane]')
      if (!lanes || !lane) return
      const rect = lane.getBoundingClientRect()
      const lanesRect = lanes.getBoundingClientRect()
      const currentTime = timelineClamp((event.clientX - rect.left) / timelineScale, 0, model.team.rotationDuration)
      gesture.currentTime = currentTime
      gesture.currentX = event.clientX
      gesture.currentY = event.clientY
      setBoxSelection({ startTime: gesture.startTime, currentTime, startY: gesture.startY - lanesRect.top, currentY: event.clientY - lanesRect.top })
      const selectionRect = {
        left: Math.min(gesture.startX, gesture.currentX), right: Math.max(gesture.startX, gesture.currentX),
        top: Math.min(gesture.startY, gesture.currentY), bottom: Math.max(gesture.startY, gesture.currentY)
      }
      const intersecting = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-timeline-action-id]')].filter((clip) => {
        const clipRect = clip.getBoundingClientRect()
        return clipRect.right >= selectionRect.left && clipRect.left <= selectionRect.right && clipRect.bottom >= selectionRect.top && clipRect.top <= selectionRect.bottom
      }).map((clip) => clip.dataset.timelineActionId).filter((id): id is string => Boolean(id))
      setSelectedActionIds([...new Set([...gesture.initialIds, ...intersecting])])
      return
    }
    const rawDelta = (event.clientX - gesture.originX) / timelineScale
    const delta = event.altKey ? timelineRound(rawDelta) : timelineRound(Math.round(rawDelta / ROTATION_SNAP) * ROTATION_SNAP)
    const target = gesture.original.find((action) => action.id === gesture.actionId)
    if (!target) return
    let preview = gesture.original
    if (gesture.kind === 'move') {
      const selected = gesture.original.filter((action) => gesture.selectedIds.includes(action.id))
      const minimum = Math.min(...selected.map((action) => action.timestamp))
      const maximum = Math.max(...selected.map((action) => action.timestamp + actionDuration(action, model.team.rotationDuration)))
      const bounded = timelineClamp(delta, -minimum, model.team.rotationDuration - maximum)
      preview = gesture.original.map((action) => gesture.selectedIds.includes(action.id) ? { ...action, timestamp: timelineRound(action.timestamp + bounded) } : action)
    } else if (gesture.kind === 'trim-start') {
      const end = target.timestamp + actionDuration(target, model.team.rotationDuration)
      const timestamp = timelineClamp(target.timestamp + delta, 0, end - ROTATION_MIN_CLIP_DURATION)
      preview = gesture.original.map((action) => action.id === target.id ? { ...action, timestamp: timelineRound(timestamp), duration: timelineRound(end - timestamp) } : action)
    } else {
      const duration = timelineClamp(actionDuration(target, model.team.rotationDuration) + delta, ROTATION_MIN_CLIP_DURATION, model.team.rotationDuration - target.timestamp)
      preview = gesture.original.map((action) => action.id === target.id ? { ...action, duration: timelineRound(duration) } : action)
    }
    gesture.preview = preview
    gesture.changed = !sameActions(preview, gesture.original)
    setTimelineActions(preview)
  }
  const endTimelineGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    setBoxSelection(null)
    if (gesture.kind !== 'box' && gesture.changed) commitActions(gesture.preview, gesture.original)
  }
  const openTimelineMenu = (event: ReactMouseEvent, actionId: string) => {
    event.preventDefault()
    event.stopPropagation()
    if (!selectedActionIds.includes(actionId)) setSelectedActionIds([actionId])
    setTimelineMenu({ actionId, x: event.clientX, y: event.clientY })
  }
  const openQuickCreate = (event: ReactMouseEvent<HTMLDivElement>, member: TeamMemberModel & { build: Build }) => {
    if (event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    const timestamp = timelineRound(timelineClamp((event.clientX - rect.left) / timelineScale, 0, model.team.rotationDuration - ROTATION_MIN_CLIP_DURATION))
    setPlayhead(timestamp)
    setQuickCreate({ buildId: member.build.id, timestamp, attackId: member.attacks[0]?.id ?? '' })
  }
  const addQuickAction = () => {
    if (!quickCreate) return
    const member = model.members.find((entry) => entry.build?.id === quickCreate.buildId)
    const attack = member?.attacks.find((entry) => entry.id === quickCreate.attackId)
    if (!member?.build || !attack) return
    const next: RotationAction = { id: createLocalId(), timestamp: quickCreate.timestamp, duration: timelineClamp(defaultRotationClipDuration(attack.group), ROTATION_MIN_CLIP_DURATION, model.team.rotationDuration - quickCreate.timestamp), buildId: member.build.id, attackId: attack.id, formulaTargetId: member.catalog ? `${member.catalog.id}:${attack.id}` : undefined }
    commitActions([...timelineActions, next])
    setSelectedActionIds([next.id])
    setQuickCreate(null)
  }
  const fitTimeline = () => {
    const available = Math.max(320, (timelineViewportRef.current?.clientWidth ?? 900) - 144)
    setTimelineScale(timelineClamp(available / model.team.rotationDuration, 24, 160))
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, select, textarea, button, [contenteditable="true"]')) return
      const command = event.ctrlKey || event.metaKey
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redoTimeline(); else undoTimeline() }
      else if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); redoTimeline() }
      else if (command && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected() }
      else if (command && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelected() }
      else if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected() }
      else if (command && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelectedActionIds(timelineActions.map((action) => action.id)) }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected() }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); nudgeSelected(event.key === 'ArrowLeft' ? -1 : 1, event.altKey) }
      else if (event.key === ' ') { event.preventDefault(); if (playhead >= model.team.rotationDuration) setPlayhead(0); setIsPlaying((current) => !current) }
      else if (event.key === 'Escape') { setSelectedActionIds([]); setTimelineMenu(null); setQuickCreate(null) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clipboardActions, isPlaying, model.team.rotationDuration, playhead, selectedActionIds, timelineActions])
  const addAction = async () => {
    const attack = draftMember?.attacks.find((entry) => entry.id === draftAttackId) ?? draftMember?.attacks[0]
    if (!draftMember?.build || !attack || !Number.isFinite(draftTimestamp) || !Number.isFinite(draftDuration)) return
    const duration = timelineClamp(draftDuration, ROTATION_MIN_CLIP_DURATION, model.team.rotationDuration)
    const timestamp = timelineClamp(draftTimestamp, 0, Math.max(0, model.team.rotationDuration - duration))
    commitActions([...timelineActions, { id: createLocalId(), timestamp, duration, buildId: draftMember.build.id, attackId: attack.id, formulaTargetId: `${draftMember.catalog?.id}:${attack.id}` }])
    setDraftTimestamp(Math.min(model.team.rotationDuration, Number((draftTimestamp + 1).toFixed(1))))
  }
  const duplicateAction = (row: TeamActionModel) => duplicateSelected([row.action.id])
  const moveAction = (index: number, direction: -1 | 1) => {
    const other = model.actions[index + direction]
    const current = model.actions[index]
    if (!other || !current) return
    commitActions(timelineActions.map((action) => action.id === current.action.id ? { ...action, timestamp: other.action.timestamp } : action.id === other.action.id ? { ...action, timestamp: current.action.timestamp } : action))
  }
  const reorderActionCard = (sourceId: string, targetId: string, after: boolean) => {
    if (sourceId === targetId) return
    const ordered = [...timelineActions].sort((left, right) => left.timestamp - right.timestamp)
    const sourceIndex = ordered.findIndex((action) => action.id === sourceId)
    const targetIndex = ordered.findIndex((action) => action.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const timestamps = ordered.map((action) => action.timestamp)
    const [source] = ordered.splice(sourceIndex, 1)
    const adjustedTarget = ordered.findIndex((action) => action.id === targetId)
    ordered.splice(adjustedTarget + (after ? 1 : 0), 0, source)
    commitActions(ordered.map((action, index) => ({ ...action, timestamp: timestamps[index] })))
  }
  const rotationTotal = model.actions.reduce((total, row) => total + row[resultMode], 0)
  const members = model.members.filter((member): member is TeamMemberModel & { build: Build } => Boolean(member.build))
  const damageTypes = DAMAGE_TYPE_ORDER.filter((type) => (model.byType[type] ?? 0) > 0)
  const memberSegments = members.filter((member) => member.contribution > 0).map((member, index) => ({ label: teamMemberName(member), value: member.contribution, color: ROTATION_CHART_COLORS[index] }))
  const typeSegments = damageTypes.map((type, index) => ({ label: DAMAGE_TYPE_LABELS[type], value: model.byType[type] ?? 0, color: ROTATION_CHART_COLORS[index] }))
  const segments = analysisMode === 'character' ? memberSegments : typeSegments
  let chartCursor = 0
  const chartStops = segments.map((segment) => {
    const start = chartCursor
    chartCursor += rotationTotal > 0 ? segment.value / rotationTotal * 100 : 0
    return `${segment.color} ${start}% ${chartCursor}%`
  })
  const chartStyle = { '--tw-rotation-chart': rotationTotal > 0 && chartStops.length ? `conic-gradient(${chartStops.join(',')})` : '#151b1c' } as CSSProperties
  const activeRows = model.actions.filter((row) => row.action.timestamp <= playhead && playhead < row.action.timestamp + actionDuration(row.action, model.team.rotationDuration))
  const activeActionIds = new Set(activeRows.map((row) => row.action.id))
  const currentDamage = activeRows.reduce((total, row) => total + row[resultMode], 0)
  const activeEffectCount = activeRows.reduce((total, row) => total + row.activeBuffs.length + row.activates.length, 0)
  const damageSources = model.actions.flatMap((row) => {
    const memberIndex = members.findIndex((member) => member.build.id === row.action.buildId)
    if (memberIndex < 0) return []
    const duration = actionDuration(row.action, model.team.rotationDuration)
    const start = timelineClamp(row.action.timestamp, 0, model.team.rotationDuration)
    const end = timelineClamp(row.action.timestamp + duration, start, model.team.rotationDuration)
    if (end <= start) return []
    return [{ row, memberIndex, start, end, damage: row[resultMode] }]
  })
  const damageBoundaries = [...new Set([0, model.team.rotationDuration, ...damageSources.flatMap((source) => [source.start, source.end])])].sort((left, right) => left - right)
  const damageIntervals = damageBoundaries.slice(0, -1).flatMap((start, intervalIndex) => {
    const end = damageBoundaries[intervalIndex + 1]
    const activeSources = damageSources.filter((source) => source.start < end && source.end > start)
    let stackBottom = 0
    return members.flatMap((_member, memberIndex) => {
      const sources = activeSources.filter((source) => source.memberIndex === memberIndex)
      const damage = sources.reduce((total, source) => total + source.damage, 0)
      if (damage <= 0) return []
      const interval = { start, end, damage, stackBottom, memberIndex, actionIds: sources.map((source) => source.row.action.id), attackNames: sources.map((source) => compactAttackLabel(source.row.attack?.name ?? 'Missing attack')) }
      stackBottom += damage
      return [interval]
    })
  })
  const peakActiveDamage = Math.max(0, ...damageBoundaries.slice(0, -1).map((start, index) => {
    const end = damageBoundaries[index + 1]
    return damageSources.filter((source) => source.start < end && source.end > start).reduce((total, source) => total + source.damage, 0)
  }))
  const damageAxisMaximum = damageChartMaximum(peakActiveDamage)
  const damageAxisTicks = Array.from({ length: 4 }, (_, index) => damageAxisMaximum * (3 - index) / 3)
  const damageTimeTicks = Array.from({ length: 5 }, (_, index) => model.team.rotationDuration * index / 4)
  const rulerTicks = Array.from({ length: Math.floor(model.team.rotationDuration) + 1 }, (_, index) => index)

  return <section className="tw-panel tw-rotation"><header><div><span className="eyebrow">Team sequence</span><h2>Rotation</h2><p>Arrange actions on the timeline and review their damage.</p></div><label className="tw-rotation-window"><span>Rotation time</span><input type="number" min="1" max="600" step="0.1" value={model.team.rotationDuration} onChange={(event) => void updateTeam({ rotationDuration: Math.max(1, Math.min(600, Number(event.target.value) || 1)) })}/>s</label></header>
    <section className="tw-sequencer" aria-label="Interactive rotation timeline">
      <header className="tw-sequencer-toolbar">
        <div className="tw-transport" role="group" aria-label="Playback controls">
          <button type="button" onClick={() => { setIsPlaying(false); setPlayhead(0) }} title="Return to start">|◀</button>
          <button type="button" className={isPlaying ? 'is-active' : ''} onClick={() => { if (playhead >= model.team.rotationDuration) setPlayhead(0); setIsPlaying((current) => !current) }} aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
          <span><b>{playhead.toFixed(2)}s</b><small>/ {model.team.rotationDuration.toFixed(1)}s</small></span>
        </div>
        <div className="tw-playback-readout" aria-live="polite"><span><small>Now</small><b>{activeRows.length ? activeRows.map((row) => compactAttackLabel(row.attack?.name ?? 'Missing attack')).join(' + ') : 'Ready'}</b></span><span><small>Active effects</small><b>{activeEffectCount}</b></span><span><small>Current DMG</small><b>{formatDamage(currentDamage)}</b></span></div>
        <div className="tw-edit-controls" role="group" aria-label="Timeline editing controls">
          <button type="button" onClick={undoTimeline} disabled={!undoStackRef.current.length} title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" onClick={redoTimeline} disabled={!redoStackRef.current.length} title="Redo (Ctrl+Y)">Redo</button>
          <button type="button" onClick={() => copySelected()} disabled={!selectedActionIds.length} title="Copy selected clips (Ctrl+C)">Copy</button>
          <button type="button" onClick={pasteSelected} disabled={!clipboardActions.length} title="Paste at playhead (Ctrl+V)">Paste</button>
          <button type="button" onClick={() => duplicateSelected()} disabled={!selectedActionIds.length} title="Duplicate selected clips (Ctrl+D)">Duplicate</button>
          <button type="button" className="danger" onClick={deleteSelected} disabled={!selectedActionIds.length} title="Delete selected clips">Delete</button>
        </div>
        <div className="tw-zoom-controls" role="group" aria-label="Timeline zoom controls">
          <button type="button" onClick={() => setTimelineScale((current) => timelineClamp(current - 12, 24, 160))} aria-label="Zoom out">−</button>
          <button type="button" onClick={fitTimeline}>Fit</button>
          <button type="button" onClick={() => setTimelineScale((current) => timelineClamp(current + 12, 24, 160))} aria-label="Zoom in">+</button>
          <span>{Math.round(timelineScale)} px/s</span>
        </div>
      </header>
      <div className="tw-sequencer-viewport" ref={timelineViewportRef} onPointerMove={moveTimelineGesture} onPointerUp={endTimelineGesture} onPointerCancel={endTimelineGesture}>
        <div className="tw-sequencer-canvas" style={{ width: 128 + model.team.rotationDuration * timelineScale }}>
          <div className="tw-ruler-row"><span className="tw-ruler-corner">Tracks</span><div className="tw-ruler" style={{ width: model.team.rotationDuration * timelineScale }} onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setPlayhead(timelineRound(timelineClamp((event.clientX - rect.left) / timelineScale, 0, model.team.rotationDuration))); setIsPlaying(false) }}>{rulerTicks.map((tick) => <i style={{ left: tick * timelineScale }} key={tick}><b>{tick}s</b></i>)}</div></div>
          <div className="tw-playhead" style={{ left: 128 + playhead * timelineScale }} aria-hidden="true"><i/><span/></div>
          <div className="tw-sequencer-lanes">{members.map((member, memberIndex) => {
            const laneActions = timelineActions.filter((action) => action.buildId === member.build.id).sort((left, right) => left.timestamp - right.timestamp)
            const rowEnds: number[] = []
            const clips = laneActions.map((action) => {
              const duration = actionDuration(action, model.team.rotationDuration)
              let row = rowEnds.findIndex((end) => end <= action.timestamp)
              if (row < 0) { row = rowEnds.length; rowEnds.push(action.timestamp + duration) } else rowEnds[row] = action.timestamp + duration
              return { action, duration, row }
            })
            const laneHeight = Math.max(72, rowEnds.length * 34 + 24)
            const accent = member.catalog ? ELEMENT_COLORS[member.catalog.element] ?? ROTATION_CHART_COLORS[memberIndex] : ROTATION_CHART_COLORS[memberIndex]
            return <div className="tw-sequencer-lane" style={{ height: laneHeight, '--tw-lane-accent': accent } as CSSProperties} key={member.build.id}>
              <div className="tw-lane-label">{member.catalog?.iconSourceUrl && <img src={member.catalog.iconSourceUrl} alt=""/>}<span><b>{teamMemberName(member)}</b><small>{laneActions.length} {laneActions.length === 1 ? 'clip' : 'clips'}</small></span></div>
              <div className="tw-lane-stage" data-timeline-lane={member.build.id} style={{ width: model.team.rotationDuration * timelineScale, height: laneHeight }} onPointerDown={beginBoxSelection} onDoubleClick={(event) => openQuickCreate(event, member)}>
                {Array.from({ length: Math.floor(model.team.rotationDuration) + 1 }, (_, tick) => <i className="tw-grid-line" style={{ left: tick * timelineScale }} key={tick}/>) }
                {clips.map(({ action, duration, row }) => {
                  const attack = member.attacks.find((entry) => entry.id === action.attackId)
                  const selected = selectedActionIds.includes(action.id)
                  const active = activeActionIds.has(action.id)
                  return <article data-timeline-action-id={action.id} className={`tw-timeline-clip ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''}`} style={{ left: action.timestamp * timelineScale, top: 6 + row * 34, width: Math.max(18, duration * timelineScale) }} aria-label={`${attack?.name ?? 'Missing attack'}, ${action.timestamp.toFixed(1)} seconds, duration ${duration.toFixed(1)} seconds`} aria-selected={selected} key={action.id} onPointerDown={(event) => selectClip(event, action.id)} onContextMenu={(event) => openTimelineMenu(event, action.id)} onDoubleClick={(event) => { event.stopPropagation(); document.getElementById(`rotation-action-${action.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}>
                    <span className="tw-clip-handle start" data-timeline-handle="start" aria-hidden="true"/>
                    <span className="tw-clip-copy"><b>{attack?.name ?? 'Missing attack'}</b><small>{actionMultiplier(action) > 1 ? `×${actionMultiplier(action)} · ` : ''}{action.timestamp.toFixed(1)}–{(action.timestamp + duration).toFixed(1)}s</small></span>
                    <span className="tw-clip-handle end" data-timeline-handle="end" aria-hidden="true"/>
                  </article>
                })}
              </div>
            </div>
          })}{boxSelection && <span className="tw-selection-box" style={{ left: 128 + Math.min(boxSelection.startTime, boxSelection.currentTime) * timelineScale, top: Math.min(boxSelection.startY, boxSelection.currentY), width: Math.abs(boxSelection.currentTime - boxSelection.startTime) * timelineScale, height: Math.max(2, Math.abs(boxSelection.currentY - boxSelection.startY)) }}/>}</div>
        </div>
      </div>
      <footer className="tw-sequencer-help"><span>Double-click a track to add an action.</span><span>Drag to move or trim · Hold Alt for free timing</span></footer>
      {quickCreate && (() => { const member = model.members.find((entry) => entry.build?.id === quickCreate.buildId); return <div className="tw-quick-create" role="dialog" aria-label="Add timeline action"><span><b>Add at {quickCreate.timestamp.toFixed(1)}s</b><small>{member ? teamMemberName(member) : 'Character'}</small></span><select autoFocus value={quickCreate.attackId} onChange={(event) => setQuickCreate({ ...quickCreate, attackId: event.target.value })}>{ROTATION_ATTACK_GROUPS.map((group) => { const attacks = member?.attacks.filter((attack) => attack.group === group.id) ?? []; return attacks.length ? <optgroup label={group.label} key={group.id}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{compactAttackLabel(attack.name)}</option>)}</optgroup> : null })}</select><button type="button" className="primary" disabled={!quickCreate.attackId} onClick={addQuickAction}>Add clip</button><button type="button" onClick={() => setQuickCreate(null)}>Cancel</button></div> })()}
      {timelineMenu && <div className="tw-timeline-menu" style={{ left: timelineMenu.x, top: timelineMenu.y }} role="menu"><button type="button" onClick={() => { copySelected(selectedActionIds.includes(timelineMenu.actionId) ? selectedActionIds : [timelineMenu.actionId]); setTimelineMenu(null) }}>Copy selection</button><button type="button" onClick={() => { duplicateSelected(selectedActionIds.includes(timelineMenu.actionId) ? selectedActionIds : [timelineMenu.actionId]); setTimelineMenu(null) }}>Duplicate</button><button type="button" onClick={() => { const ids = selectedActionIds.includes(timelineMenu.actionId) ? selectedActionIds : [timelineMenu.actionId]; commitActions(timelineActions.filter((action) => !ids.includes(action.id))); setSelectedActionIds([]); setTimelineMenu(null) }}>Delete</button></div>}
    </section>
    <div className="tw-rotation-layout">
      <section className="tw-rotation-editor" aria-label="Rotation editor">
        <div className="tw-rotation-sequence-head"><span>Play order</span><b>{model.actions.length} {model.actions.length === 1 ? 'action' : 'actions'}</b></div>
        <div className="tw-rotation-timeline">{model.actions.map((row, index) => {
          const value = row[resultMode]
          const trace = row.traces?.[resultMode]
          const effectCount = row.activeBuffs.length + row.activates.length
          const multiplier = actionMultiplier(row.action)
          const dragTarget = cardDropTarget?.actionId === row.action.id
          return <article id={`rotation-action-${row.action.id}`} draggable className={`tw-rotation-card ${row.warnings.length ? 'is-invalid' : ''} ${selectedActionIds.includes(row.action.id) ? 'is-selected' : ''} ${activeActionIds.has(row.action.id) ? 'is-playing' : ''} ${draggedCardId === row.action.id ? 'is-dragging' : ''} ${dragTarget ? cardDropTarget.after ? 'drop-after' : 'drop-before' : ''}`} key={row.action.id} onClick={() => setSelectedActionIds([row.action.id])} onDragStart={(event: ReactDragEvent<HTMLElement>) => { setDraggedCardId(row.action.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', row.action.id) }} onDragOver={(event) => { event.preventDefault(); if (draggedCardId === row.action.id) return; const rect = event.currentTarget.getBoundingClientRect(); setCardDropTarget({ actionId: row.action.id, after: event.clientY >= rect.top + rect.height / 2 }) }} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedCardId; const rect = event.currentTarget.getBoundingClientRect(); if (sourceId) reorderActionCard(sourceId, row.action.id, event.clientY >= rect.top + rect.height / 2); setDraggedCardId(null); setCardDropTarget(null) }} onDragEnd={() => { setDraggedCardId(null); setCardDropTarget(null) }}>
            <div className="tw-rotation-marker"><b>{index + 1}</b><span>{row.action.timestamp.toFixed(1)}s</span></div>
            <div className="tw-rotation-card-main">
              <div className="tw-rotation-action-summary"><div><small>{row.member ? teamMemberName(row.member) : 'Unassigned'}</small><strong>{compactAttackLabel(row.attack?.name ?? 'Missing attack')}</strong><span className="tw-action-tags">{row.attack && <><em className="forte">{forteGroupLabel(row.attack.group)}</em><em className="damage">{damageSourceLabel(row.attack.type)}</em></>}</span></div><label className="tw-action-multiplier" title="Repeat this action without adding duplicate cards" onClick={(event) => event.stopPropagation()}><b>×</b><input aria-label={`Action ${index + 1} repeat multiplier`} type="number" min="1" max="99" step="1" value={multiplier} onChange={(event) => void updateAction(row.action.id, { multiplier: Math.max(1, Math.min(99, Math.round(Number(event.target.value) || 1))) })}/></label><CalculatedValue detail={multiplier > 1 ? sumDetail(`${compactAttackLabel(row.attack?.name ?? 'Action')} · ${resultMode}`, value, [{ label: `One action × ${multiplier}`, value: value / multiplier }]) : trace ? traceCalculationDetail(trace, `${compactAttackLabel(row.attack?.name ?? 'Action')} · ${resultMode}`) : sumDetail(`${resultMode} damage`, value, [{ label: 'Calculated action', value }])}><strong className="tw-rotation-result"><small>{resultMode === 'expected' ? 'Avg DMG' : resultMode === 'normal' ? 'Non-crit' : 'Crit DMG'}</small>{formatDamage(value)}</strong></CalculatedValue></div>
              <details className="tw-rotation-action-editor"><summary>Edit action and mechanics <span>{effectCount ? `${effectCount} active effects` : 'No additional effects'}</span></summary><div>
                <div className="tw-rotation-action-fields"><label><span>Character</span><select aria-label={`Action ${index + 1} character`} value={row.action.buildId} onChange={(event) => { const member = model.members.find((entry) => entry.build?.id === event.target.value); const attack = member?.attacks[0]; const attackId = attack?.id ?? ''; void updateAction(row.action.id, { buildId: event.target.value, attackId, duration: defaultRotationClipDuration(attack?.group ?? 'skill'), formulaTargetId: member?.catalog ? `${member.catalog.id}:${attackId}` : undefined }) }}>{model.members.flatMap((member) => member.build ? [<option value={member.build.id} key={member.build.id}>{teamMemberName(member)}</option>] : [])}</select></label><label><span>Attack</span><select aria-label={`Action ${index + 1} attack`} value={row.attack?.id ?? row.action.attackId} onChange={(event) => { const attack = row.member?.attacks.find((entry) => entry.id === event.target.value); void updateAction(row.action.id, { attackId: event.target.value, duration: defaultRotationClipDuration(attack?.group ?? 'skill'), formulaTargetId: row.member?.catalog ? `${row.member.catalog.id}:${event.target.value}` : undefined }) }}>{ROTATION_ATTACK_GROUPS.map((group) => { const attacks = row.member?.attacks.filter((attack) => attack.group === group.id) ?? []; return attacks.length ? <optgroup label={group.label} key={group.id}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{compactAttackLabel(attack.name)}</option>)}</optgroup> : null })}</select></label><label><span>Time</span><input aria-label={`Action ${index + 1} timestamp`} type="number" min="0" max={model.team.rotationDuration} step="0.1" value={row.action.timestamp} onChange={(event) => void updateAction(row.action.id, { timestamp: Number(event.target.value) })}/></label><label><span>Duration</span><input aria-label={`Action ${index + 1} duration`} type="number" min={ROTATION_MIN_CLIP_DURATION} max={Math.max(ROTATION_MIN_CLIP_DURATION, model.team.rotationDuration - row.action.timestamp)} step="0.1" value={actionDuration(row.action, model.team.rotationDuration)} onChange={(event) => void updateAction(row.action.id, { duration: Number(event.target.value) })}/></label></div>
                <div className="tw-rotation-mechanics"><span className="tw-buff-state"><b>{row.activeBuffs.length ? 'Active authored buffs' : 'No additional effects'}</b>{row.activeBuffs.map((buff) => <small key={buff.id}>{teamBuffLabel(buff)}</small>)}{row.activates.map((buff) => <small className="activates" key={buff.id}>Activates {buff.name} until {(row.action.timestamp + buff.duration).toFixed(1)}s</small>)}</span><span className="tw-rotation-level">Lv. {row.attack?.skillLevel ?? '—'}<small>{row.attack?.scalesWith === 'level' ? 'Level-based damage' : `${row.attack?.scalesWith.toUpperCase() ?? '—'} scaling`}</small></span></div>
                <div className="tw-action-breakdown"><div><span>Non-crit <b>{formatDamage(row.normal)}</b></span><span>Average <b>{formatDamage(row.expected)}</b></span><span>Critical <b>{formatDamage(row.critical)}</b></span><span>Multiplier <b>{row.attack?.multiplierLabel ?? 'Missing'}</b></span></div></div>
              </div></details>
              {row.warnings.length > 0 && <p className="tw-action-warning">{row.warnings.join(' ')}</p>}
            </div>
            <div className="tw-rotation-card-actions"><button type="button" title="Move earlier" aria-label={`Move action ${index + 1} earlier`} disabled={index === 0} onClick={() => void moveAction(index, -1)}>↑</button><button type="button" title="Move later" aria-label={`Move action ${index + 1} later`} disabled={index === model.actions.length - 1} onClick={() => void moveAction(index, 1)}>↓</button><button type="button" title="Duplicate" aria-label={`Duplicate action ${index + 1}`} onClick={() => void duplicateAction(row)}>⧉</button><button type="button" title="Remove" className="tw-remove" aria-label={`Remove action ${index + 1}`} onClick={() => commitActions(timelineActions.filter((action) => action.id !== row.action.id))}><Icon name="trash"/></button></div>
          </article>
        })}{!model.actions.length && <p className="tw-empty-state">Choose the first action below to begin the rotation and populate the analysis.</p>}</div>
        <div className="tw-rotation-composer">
          <label><span>Character</span><select value={draftMember?.build?.id ?? ''} onChange={(event) => setDraftBuildId(event.target.value)}>{model.members.flatMap((member) => member.build ? [<option value={member.build.id} key={member.build.id}>{teamMemberName(member)}</option>] : [])}</select></label>
          <label><span>Attack</span><select value={draftAttackId} onChange={(event) => { setDraftAttackId(event.target.value); setDraftDuration(defaultRotationClipDuration(draftMember?.attacks.find((attack) => attack.id === event.target.value)?.group ?? 'skill')) }}>{ROTATION_ATTACK_GROUPS.map((group) => { const attacks = draftMember?.attacks.filter((attack) => attack.group === group.id) ?? []; return attacks.length ? <optgroup label={group.label} key={group.id}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{compactAttackLabel(attack.name)}</option>)}</optgroup> : null })}</select></label>
          <label><span>Time</span><input type="number" min="0" max={model.team.rotationDuration} step="0.1" value={draftTimestamp} onChange={(event) => setDraftTimestamp(Number(event.target.value))}/></label>
          <label><span>Duration</span><input type="number" min={ROTATION_MIN_CLIP_DURATION} max={model.team.rotationDuration} step="0.1" value={draftDuration} onChange={(event) => setDraftDuration(Number(event.target.value))}/></label>
          <button className="primary" onClick={() => void addAction()} disabled={!draftMember?.build || !draftAttackId || !Number.isFinite(draftTimestamp) || !Number.isFinite(draftDuration)}><Icon name="plus"/>Add</button>
        </div>
      </section>

      <aside className="tw-rotation-analysis" aria-label="Rotation analysis">
        <div className="tw-rotation-kpis"><div><span>{resultMode === 'expected' ? 'Average rotation' : resultMode === 'normal' ? 'Non-crit rotation' : 'Critical rotation'}</span><CalculatedValue detail={sumDetail('Rotation total', rotationTotal, model.actions.map((row) => ({ label: `${row.action.timestamp.toFixed(1)}s · ${compactAttackLabel(row.attack?.name ?? 'Missing attack')}`, value: row[resultMode] })))}><strong>{formatDamage(rotationTotal)}</strong></CalculatedValue></div><div><span>DPS</span><strong>{formatDamage(rotationTotal / Math.max(1, model.team.rotationDuration))}</strong></div><div><span>Window</span><strong>{model.team.rotationDuration.toFixed(1)}s</strong></div></div>
        <section className="tw-analysis-card tw-damage-chart"><header><div><span className="eyebrow">Damage distribution</span><h3>{analysisMode === 'character' ? 'Team contribution' : 'Damage types'}</h3></div><div className="tw-chart-toggle" role="group" aria-label="Chart grouping"><button type="button" aria-pressed={analysisMode === 'character'} onClick={() => setAnalysisMode('character')}>Character</button><button type="button" aria-pressed={analysisMode === 'type'} onClick={() => setAnalysisMode('type')}>Damage type</button></div></header>
          <div className="tw-donut-layout"><div className="tw-donut" style={chartStyle} role="img" aria-label={rotationTotal ? `${analysisMode} damage distribution` : 'No calculated damage'}><div><strong>{formatDamage(rotationTotal)}</strong><span>Total damage</span></div></div><div className="tw-donut-legend">{segments.map((segment) => <div key={segment.label}><i style={{ background: segment.color }}/><span>{segment.label}</span><b>{percent(segment.value, rotationTotal)}</b><small>{formatDamage(segment.value)}</small></div>)}{!segments.length && <p>No calculated damage yet.</p>}</div></div>
        </section>
        <section className="tw-analysis-card tw-damage-matrix"><header><div><span className="eyebrow">Damage split</span><h3>Type by character</h3></div></header>
          {damageTypes.length && members.length ? <div className="tw-damage-table-scroll"><table><thead><tr><th>Type</th>{members.map((member) => <th key={member.build.id}>{teamMemberName(member)}</th>)}<th>Total</th></tr></thead><tbody>{damageTypes.map((type) => <tr key={type}><th>{DAMAGE_TYPE_LABELS[type]}</th>{members.map((member) => <td key={member.build.id}>{member.byType[type] ? formatDamage(member.byType[type] ?? 0) : '—'}</td>)}<td><b>{formatDamage(model.byType[type] ?? 0)}</b><small>{percent(model.byType[type] ?? 0, rotationTotal)}</small></td></tr>)}<tr className="tw-damage-total"><th>Total</th>{members.map((member) => <td key={member.build.id}><b>{formatDamage(member.contribution)}</b></td>)}<td><b>{formatDamage(rotationTotal)}</b></td></tr></tbody></table></div> : <p className="tw-analysis-empty">Damage rows will appear when the rotation contains calculated attacks.</p>}
        </section>
        <section className="tw-analysis-card tw-damage-over-time"><header><div><span className="eyebrow">Timeline analysis</span><h3>Damage over time</h3></div><b>Peak {compactDamage(peakActiveDamage)}</b></header>
          <div className="tw-damage-time-chart" role="group" aria-label={`Stacked action damage across the ${model.team.rotationDuration.toFixed(1)} second rotation`}>
            <div className="tw-damage-y-axis">{damageAxisTicks.map((tick, index) => <span style={{ top: `${index / (damageAxisTicks.length - 1) * 100}%` }} key={tick}>{compactDamage(tick)}</span>)}</div>
            <div className="tw-damage-plot">
              {damageAxisTicks.map((tick, index) => <i className="horizontal" style={{ top: `${index / (damageAxisTicks.length - 1) * 100}%` }} key={`y-${tick}`}/>)}
              {damageTimeTicks.map((tick, index) => <i className="vertical" style={{ left: `${index / (damageTimeTicks.length - 1) * 100}%` }} key={`x-${tick}`}/>)}
              {damageIntervals.map(({ start, end, damage, memberIndex, stackBottom, actionIds, attackNames }) => {
                const color = ROTATION_CHART_COLORS[Math.max(0, memberIndex) % ROTATION_CHART_COLORS.length]
                const left = model.team.rotationDuration > 0 ? start / model.team.rotationDuration * 100 : 0
                const width = model.team.rotationDuration > 0 ? (end - start) / model.team.rotationDuration * 100 : 0
                const height = Math.max(1, damage / damageAxisMaximum * 100)
                const bottom = stackBottom / damageAxisMaximum * 100
                const isActive = start <= playhead && playhead < end
                return <button type="button" className={`tw-damage-spike ${end <= playhead ? 'is-past' : ''} ${isActive ? 'is-active' : ''}`} style={{ left: `${left}%`, bottom: `${bottom}%`, width: `${width}%`, height: `${height}%`, '--tw-spike-color': color } as CSSProperties} title={`Character ${memberIndex + 1} · ${start.toFixed(1)}s–${end.toFixed(1)}s · ${attackNames.join(' + ')} · ${formatDamage(damage)} DMG`} aria-label={`Character ${memberIndex + 1}, ${attackNames.join(' and ')}, ${formatDamage(damage)} damage from ${start.toFixed(1)} to ${end.toFixed(1)} seconds`} key={`${start}:${end}:${memberIndex}`} onClick={() => { setPlayhead(start); setIsPlaying(false); setSelectedActionIds(actionIds) }}/>
              })}
              <span className="tw-damage-cursor" style={{ left: `${model.team.rotationDuration > 0 ? playhead / model.team.rotationDuration * 100 : 0}%` }}/>
            </div>
            <div className="tw-damage-x-axis">{damageTimeTicks.map((tick, index) => <span style={{ left: `${index / (damageTimeTicks.length - 1) * 100}%` }} key={tick}>{Number(tick.toFixed(1))}s</span>)}</div>
          </div>
          <div className="tw-damage-time-legend">{members.map((member, index) => <span key={member.build.id}><i style={{ background: ROTATION_CHART_COLORS[index % ROTATION_CHART_COLORS.length] }}/>{teamMemberName(member)}</span>)}<small>Height is total action damage; width is action duration; overlaps stack Character 1 upward.</small></div>
        </section>
      </aside>
    </div>
  </section>
}

function GameDescription({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const copyRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const copy = copyRef.current
    if (!copy || expanded) return
    const measure = () => setCanExpand(copy.scrollHeight > copy.clientHeight + 1)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [canExpand, expanded, value])

  const copy = <div ref={copyRef} className={`tw-game-description-copy ${expanded ? 'is-expanded' : ''}`}>{richSkillDescription(value)}</div>
  if (!canExpand) return <div className="tw-game-description">{copy}</div>
  return <button type="button" className="tw-game-description tw-description-trigger" aria-expanded={expanded} aria-label={expanded ? 'Collapse description' : 'Expand description'} onClick={() => setExpanded((current) => !current)}>
    {copy}<span className="tw-description-toggle" aria-hidden="true">⌄</span>
  </button>
}

interface ForteAttackGroup {
  name: string
  type: string
  multipliers: number[]
  attackIds: string[]
}

function splitSkillDescription(value: string) {
  const headingPattern = /<size=\d+>\s*<color=Title>([\s\S]*?)<\/color>\s*<\/size>/gi
  const headings = [...value.matchAll(headingPattern)]
  if (!headings.length) return [{ title: '', description: value }]
  const sections: Array<{ title: string; description: string }> = []
  const preamble = value.slice(0, headings[0].index ?? 0).trim()
  if (preamble) sections.push({ title: '', description: preamble })
  headings.forEach((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length
    const end = headings[index + 1]?.index ?? value.length
    sections.push({ title: heading[1].replace(/<[^>]+>/g, '').trim(), description: value.slice(start, end).replace(/<size=10>\s*<\/size>/gi, '').trim() })
  })
  return sections
}

function normalizedMoveName(value: string) {
  return value.toLowerCase().replace(/mid[- ]air/g, 'plunging').replace(/normal attack/g, 'basic attack').replace(/[^a-z0-9]+/g, ' ').trim()
}

function attackSectionScore(sectionTitle: string, attack: ForteAttackGroup) {
  const section = normalizedMoveName(sectionTitle)
  const name = normalizedMoveName(attack.name)
  if (!section) return 0
  let score = 0
  if (name.includes(section)) score += 20
  const sectionWords = new Set(section.split(' ').filter((word) => word.length > 2))
  name.split(' ').forEach((word) => { if (sectionWords.has(word)) score += 2 })
  if (section.includes('basic attack') && attack.type === 'basic') score += 4
  if (section.includes('heavy attack') && attack.type === 'heavy') score += 6
  if (section.includes('plunging') && name.includes('plunging')) score += 12
  if (section.includes('dodge counter') && name.includes('dodge counter')) score += 12
  return score
}

const flatValueSuffixPattern = /(?:^|\s+)(?:sta(?:mina)?\s+cost|concerto\s+(?:regen|regeneration|recovery)|cooldown|duration|resonance(?:\s+energy)?\s+cost)\s*$/i

function flatValueMoveName(valueName: string, skillName: string) {
  const label = valueName.startsWith(`${skillName} - `) ? valueName.slice(skillName.length + 3) : valueName
  return label.replace(flatValueSuffixPattern, '').replace(/\s+-\s*$/, '').trim()
}

function flatValueSectionScore(sectionTitle: string, valueName: string, skillName: string) {
  const section = normalizedMoveName(sectionTitle)
  const move = normalizedMoveName(flatValueMoveName(valueName, skillName))
  if (!section) return 0
  if (!move) return 1
  let score = 0
  if (section === move) score += 100
  else if (move.includes(section)) score += 30
  else if (section.includes(move)) score += 20
  const sectionWords = new Set(section.split(' ').filter((word) => word.length > 2))
  move.split(' ').forEach((word) => { if (sectionWords.has(word)) score += 2 })
  return score
}

function flatValueLabel(valueName: string, skillName: string, sectionTitle: string) {
  const label = valueName.startsWith(`${skillName} - `) ? valueName.slice(skillName.length + 3) : valueName
  if (!sectionTitle) return label
  const sectionPrefix = new RegExp(`^${sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+-)?\\s+`, 'i')
  return label.replace(sectionPrefix, '')
}

function ForteDamageRows({ attacks, member, resultMode }: { attacks: ForteAttackGroup[]; member: TeamMemberModel; resultMode: 'normal' | 'expected' | 'critical' }) {
  if (!attacks.length) return null
  return <dl className="tw-skill-damage-rows">{attacks.map((attack) => {
    const calculationRows = attack.attackIds.flatMap((attackId) => {
      const target = member.character ? resolveCombatTarget(member.character.catalogId, attackId, member.resolvedEchoes) : undefined
      return target ? member.formulaRows.filter((row) => row.target.id === target.id) : []
    })
    const damage = calculationRows.reduce((total, row) => total + row[resultMode], 0)
    const detail = calculationRows.length === 1
      ? traceCalculationDetail(calculationRows[0].traces[resultMode], compactAttackLabel(attack.name))
      : sumDetail(`${compactAttackLabel(attack.name)} · ${resultMode}`, damage, calculationRows.map((row, rowIndex) => ({ label: compactAttackLabel(row.target.label) || String(rowIndex + 1), value: row[resultMode] })))
    const hitValues = calculationRows.map((row) => row[resultMode])
    const label = compactAttackLabel(attack.name)
    return <div key={`${attack.name}:${attack.type}`}><dt>{label}<small>{attack.type}{hitValues.length > 1 ? ` · ${hitValues.length}-hit sequence` : ''}</small></dt><dd><CalculatedValue detail={detail} presentation="tooltip" tooltipValues={hitValues.map(formatDamage)}><b>{calculationRows.length ? formatDamage(damage) : '—'}</b></CalculatedValue><small>{resultMode}</small></dd></div>
  })}</dl>
}

function ForteWorkspace({ member, model, refresh, focusTarget, effects, values, updateInputs }: { member: TeamMemberModel; model: TeamWorkspaceModel; refresh: () => Promise<void>; focusTarget?: string } & ReviewedEffectListProps) {
  const [showNonDamageRows, setShowNonDamageRows] = useWorkspacePreference(`forte:${model.team.id}:${member.slot}:show-non-damage`, false)
  if (!member.catalog || !member.character || !member.showcase) return null
  const skillEntries = [
    ...Object.entries(member.catalog.skillIcons).map(([key, skill], index) => ({ key, skill, level: member.showcase!.skillLevels[index] ?? 1, skillLevelIndex: index })),
    { key: 'outroSkill', skill: member.catalog.skillTreeExtras.outroSkill, level: undefined, skillLevelIndex: -1 }
  ].filter(({ skill }) => skill.name || skill.description || skill.iconSourceUrl)
  const bonusBranches = member.catalog.skillTreeExtras.bonusStatBranches
  const bonusNodes = Object.entries(bonusBranches).flatMap(([branch, nodes]) => nodes.map((node, sourceIndex) => ({ ...node, id: skillTreeBonusId(branch as keyof typeof bonusBranches, sourceIndex) })))
  const enabledNodeIds = member.character.enabledSkillTreeBonusIds ?? defaultEnabledSkillTreeBonusIds(member.catalog)
  const passiveCards = [
    ...member.catalog.skillTreeExtras.inherentSkills.map((skill, index) => ({ ...skill, eyebrow: `Inherent Skill ${index + 1}`, id: inherentSkillBonusId(index), inherentSkillIndex: index })),
    { ...member.catalog.skillTreeExtras.tuneBreakSkill, eyebrow: 'Tune Break', id: undefined, inherentSkillIndex: undefined }
  ].filter((skill) => skill.name || skill.description || skill.iconSourceUrl)
  const characterEffects = effects.filter((effect) => effect.sourceKind === 'character')
  const effectName = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const effectsForName = (name: string) => characterEffects.filter((effect) => effect.minimumSequence === undefined && effectName(effect.label) === effectName(name))
  const resultMode = model.team.scenario?.resultMode ?? 'expected'
  const updateCharacter = async (patch: Partial<OwnedCharacter>) => {
    await db.characters.update(member.character!.id, patch)
    await refresh()
  }
  const toggleNode = async (id: string) => {
    const enabled = new Set(enabledNodeIds)
    if (enabled.has(id)) enabled.delete(id)
    else enabled.add(id)
    await updateCharacter({ enabledSkillTreeBonusIds: [...enabled].sort() })
  }

  return <section className={`tw-forte-workspace ${showNonDamageRows ? '' : 'hide-non-damage'}`}>
    <header className="tw-forte-heading"><div><span className="eyebrow">{member.catalog.name}</span><h2>Forte &amp; sequences</h2></div><button type="button" aria-pressed={showNonDamageRows} onClick={() => setShowNonDamageRows((shown) => !shown)}>{showNonDamageRows ? 'Hide non-DMG rows' : 'Show non-DMG rows'}</button></header>
    <aside className="tw-sequence-column">
      <header><span>Sequence</span><b>S{member.character.sequence}</b></header>
      {member.catalog.sequenceIcons.slice(0, 6).map((sequence) => { const active = member.character!.sequence >= sequence.sequence; return <article className={`${active ? 'unlocked ' : ''}${focusTarget === `sequence-${sequence.sequence}` ? 'tw-forte-focus' : ''}`} data-forte-target={`sequence-${sequence.sequence}`} key={sequence.sequence}>
        <button type="button" className="tw-node-header" aria-pressed={active} onClick={() => void updateCharacter({ sequence: active ? sequence.sequence - 1 : sequence.sequence })}><img src={sequence.iconSourceUrl} alt=""/><span><strong>{sequence.name}</strong><small>Sequence Node {sequence.sequence}</small></span></button>
        <GameDescription value={sequence.description}/>
        <ReviewedEffectList effects={characterEffects.filter((effect) => effect.minimumSequence === sequence.sequence)} values={values} updateInputs={updateInputs}/>
      </article>})}
    </aside>
    <div className="tw-skill-board">
      <div className="tw-skill-grid">{skillEntries.map(({ key, skill, level, skillLevelIndex }) => {
        const attacks = member.attacks.filter((attack) => attack.skillName === skill.name)
        const flatValues = member.catalog!.flatSkillValues.filter((value) => value.skillLevelIndex === skillLevelIndex)
        const attackGroups = [...attacks.reduce((groups, attack) => {
          const groupKey = `${attack.name}:${attack.type}`
          const existing = groups.get(groupKey)
          if (existing) {
            existing.multipliers.push(attack.multiplier)
            existing.attackIds.push(attack.id)
          } else groups.set(groupKey, { name: attack.name, type: attack.type, multipliers: [attack.multiplier], attackIds: [attack.id] })
          return groups
        }, new Map<string, ForteAttackGroup>()).values()]
        const sectionBlocks = splitSkillDescription(skill.description).map((section) => ({ ...section, attacks: [] as ForteAttackGroup[], flatValues: [] as typeof flatValues }))
        const unmatchedAttacks: ForteAttackGroup[] = []
        attackGroups.forEach((attack) => {
          let bestIndex = -1
          let bestScore = 0
          sectionBlocks.forEach((section, sectionIndex) => {
            const score = attackSectionScore(section.title, attack)
            if (score > bestScore) { bestScore = score; bestIndex = sectionIndex }
          })
          if (bestIndex >= 0) sectionBlocks[bestIndex].attacks.push(attack)
          else unmatchedAttacks.push(attack)
        })
        const unmatchedFlatValues: typeof flatValues = []
        flatValues.forEach((value) => {
          let bestIndex = -1
          let bestScore = 0
          sectionBlocks.forEach((section, sectionIndex) => {
            const score = flatValueSectionScore(section.title, value.name, skill.name)
            if (score > bestScore) { bestScore = score; bestIndex = sectionIndex }
          })
          if (bestIndex >= 0) sectionBlocks[bestIndex].flatValues.push(value)
          else unmatchedFlatValues.push(value)
        })
        if (unmatchedAttacks.length || unmatchedFlatValues.length) sectionBlocks.push({ title: sectionBlocks.length > 1 ? 'Other Details' : '', description: '', attacks: unmatchedAttacks, flatValues: unmatchedFlatValues })
        return <article className={`tw-skill-card skill-${key}${focusTarget === `skill-${key}` ? ' tw-forte-focus' : ''}`} data-forte-target={`skill-${key}`} key={key}>
          <header>{skillLevelIndex < 0 ? <span>Outro Skill</span> : <label>Skill level <select aria-label={`${skill.name} level`} value={level} onChange={(event) => { const levels = [...member.showcase!.skillLevels]; levels[skillLevelIndex] = Number(event.target.value); void updateCharacter({ skillLevels: levels }) }}>{Array.from({ length: 10 }, (_, index) => <option value={index + 1} key={index + 1}>Lv. {index + 1}</option>)}</select></label>}</header>
          <div className="tw-skill-title"><img src={skill.iconSourceUrl} alt=""/><div><strong>{skill.name}</strong><small>{key.replace(/([A-Z])/g, ' $1')}</small></div></div>
          <div className="tw-skill-sections">{sectionBlocks.map((section, sectionIndex) => <section key={`${section.title}-${sectionIndex}`}>
            {section.title && <h3>{section.title}</h3>}
            {section.description && <GameDescription value={section.description}/>}
            {section.flatValues.length > 0 && <dl className="tw-flat-values">{section.flatValues.map((value) => {
              const valueIndex = Math.max(0, Math.min(value.values.length - 1, (level ?? 1) - 1))
              return <div key={value.id}><dt>{flatValueLabel(value.name, skill.name, section.title)}<small>Flat value</small></dt><dd>{value.values[valueIndex] ?? value.values[0] ?? '—'}</dd></div>
            })}</dl>}
            <ForteDamageRows attacks={section.attacks} member={member} resultMode={resultMode}/>
          </section>)}</div>
          <ReviewedEffectList effects={effectsForName(skill.name)} values={values} updateInputs={updateInputs}/>
        </article>
      })}</div>
      <div className="tw-passive-grid">{passiveCards.map((skill) => { const active = skill.id ? enabledNodeIds.includes(skill.id) : undefined; return <article className={`tw-passive-card ${active === true ? 'is-enabled' : active === false ? 'is-disabled' : ''}`} key={`${skill.eyebrow}-${skill.name}`}>
        {skill.id ? <button type="button" className="tw-skill-title tw-node-toggle" aria-pressed={active} onClick={() => void toggleNode(skill.id!)}><img src={skill.iconSourceUrl} alt=""/><span><strong>{skill.name}</strong><small>{skill.eyebrow}</small></span></button> : <div className="tw-skill-title"><img src={skill.iconSourceUrl} alt=""/><div><strong>{skill.name}</strong><small>{skill.eyebrow}</small></div></div>}
        <GameDescription value={skill.description}/>
        <ReviewedEffectList effects={effectsForName(skill.name)} values={values} updateInputs={updateInputs}/>
      </article>})}</div>
      {bonusNodes.length > 0 && <section className="tw-bonus-nodes"><header><span className="eyebrow">Skill tree</span><h3>Bonus stat nodes</h3></header><div>{bonusNodes.map((node) => { const active = enabledNodeIds.includes(node.id); return <article className={active ? 'is-enabled' : 'is-disabled'} key={node.id}><button type="button" className="tw-bonus-node-header" aria-pressed={active} onClick={() => void toggleNode(node.id)}><img src={node.iconSourceUrl} alt=""/><strong>{node.name}</strong></button><GameDescription value={node.description}/></article> })}</div></section>}
    </div>
  </section>
}

function TeamEchoCard({ echo, ownerName, onChange, onEdit }: { echo: Echo; ownerName: string; onChange: () => void; onEdit: () => void }) {
  const ownerCatalog = characterCatalog.find((candidate) => candidate.name === ownerName)
  const characterSubstatProfile = ownerCatalog ? resolveCharacterSubstatProfile(ownerCatalog) : undefined
  return <CharacterSubstatProfileContext.Provider value={characterSubstatProfile}>
    <EchoMiniCard
      echo={echo}
      rollRating={characterSubstatProfile ? undefined : echoRollRating(echo)}
      actions={<div className="tw-overview-echo-actions"><button type="button" onClick={onEdit}><Icon name="edit"/>Edit Echo</button><button type="button" onClick={onChange}>↔ Switch Echo</button></div>}
    />
  </CharacterSubstatProfileContext.Provider>
}

const TRACE_LABELS: Record<string, string> = {
  'applied-effects': 'Active reviewed effects',
  'scaling-power': 'Scaling Power',
  'motion-value': 'Skill Multiplier',
  'motion-value-factor': 'Skill Multiplier Bonus',
  'flat-damage': 'Flat DMG',
  'flat-value': 'Flat Value',
  'bonus-factor': 'Total DMG Bonus',
  'support-bonus-factor': 'Total Bonus',
  'amplification-factor': 'Amplification Multiplier',
  'vulnerability-factor': 'Vulnerability Multiplier',
  'final-damage-factor': 'Final DMG Multiplier',
  'special-multiplier': 'Special Multiplier',
  'damage-reduction-factor': 'DMG Reduction Multiplier',
  'defence-multiplier': 'Enemy DEF Multiplier',
  'resistance-multiplier': 'Enemy RES Multiplier',
  'pre-crit': 'Before CRIT',
  'result-normal': 'Non-crit DMG',
  'result-critical': 'Critical DMG',
  'result-expected': 'Average DMG',
  result: 'Final Value',
  'crit-rate': 'Effective Crit. Rate',
  'crit-damage': 'Crit. DMG',
  'triggered-actions': 'Triggered Actions',
  'basicDamage': 'Basic Attack DMG Bonus',
  'heavyDamage': 'Heavy Attack DMG Bonus',
  'skillDamage': 'Res. Skill DMG Bonus',
  'liberationDamage': 'Res. Liberation DMG Bonus',
  'introDamage': 'Intro Skill DMG Bonus',
  'outroDamage': 'Outro Skill DMG Bonus',
  'echoDamage': 'Echo Skill DMG Bonus',
  'tuneBreakDamage': 'Tune Break DMG Bonus',
  'spectroDamage': 'Spectro DMG Bonus',
  'fusionDamage': 'Fusion DMG Bonus',
  'glacioDamage': 'Glacio DMG Bonus',
  'electroDamage': 'Electro DMG Bonus',
  'aeroDamage': 'Aero DMG Bonus',
  'havocDamage': 'Havoc DMG Bonus',
  'physicalDamage': 'Physical DMG Bonus'
}

type TraceSelection = { trace: CalculationTrace; title: string; value: number; mode: 'normal' | 'critical' | 'expected' }

const traceLabel = (stage: string) => {
  const encoded = stage.includes(':') ? stage.slice(stage.indexOf(':') + 1) : stage
  const raw = TRACE_LABELS[encoded] ?? TRACE_LABELS[stage] ?? encoded.replace(/^hit-(\d+)$/, 'Hit $1')
  return raw.replace(/([a-z])([A-Z])/g, '$1 $2').split('-').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
}
const traceValue = (trace: CalculationTrace) => {
  if (typeof trace.value !== 'number') return String(trace.value ?? '')
  if (trace.stage === 'motion-value' || trace.stage.startsWith('percent:')) return `${(trace.value * 100).toLocaleString('en-US', { maximumFractionDigits: 3 })}%`
  if (/(?:factor|multiplier)$/.test(trace.stage)) return `${(trace.value * 100).toLocaleString('en-US', { maximumFractionDigits: 3 })}%`
  return trace.value.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

const traceNumber = (value: number | string | undefined, digits = 8) => typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits:digits }) : '0'
const tracePercent = (value: number | string | undefined) => `${traceNumber(typeof value === 'number' ? value * 100 : 0)}%`
const traceChild = (trace: CalculationTrace, stage: string) => trace.children.find((entry) => entry.stage === stage)

function TraceSources({ trace, empty = 'No additional contribution.' }: { trace: CalculationTrace; empty?: string }) {
  if (!trace.children.length) return <small className="tw-trace-empty">{empty}</small>
  return <dl className="tw-trace-sources">{trace.children.map((entry, index) => <div key={`${entry.stage}-${index}`}><dt>{traceLabel(entry.stage)}</dt><dd>{traceValue(entry)}</dd>{entry.children.length > 0 && <TraceSources trace={entry}/>}</div>)}</dl>
}

function TraceSection({ title, value, children, source }: { title: string; value: string; children: ReactNode; source?: CalculationTrace }) {
  return <section className="tw-trace-section"><h3>{title}</h3><code><b>{value}</b><span>=</span>{children}</code>{source && <TraceSources trace={source}/>}</section>
}

function CalculationTraceDialog({ selection, onClose }: { selection: TraceSelection; onClose: () => void }) {
  const { trace, title, value, mode } = selection
  const effects = trace.children.find((entry) => entry.stage === 'applied-effects')
  const triggeredActions = traceChild(trace, 'triggered-actions')
  const hits = trace.children.filter((entry) => /^hit-\d+$/.test(entry.stage))
  const scaling = traceChild(trace, 'scaling-power')
  const bonus = traceChild(trace, 'bonus-factor')
  const amplify = traceChild(trace, 'amplification-factor')
  const vulnerability = traceChild(trace, 'vulnerability-factor')
  const finalDamage = traceChild(trace, 'final-damage-factor')
  const special = traceChild(trace, 'special-multiplier')
  const reduction = traceChild(trace, 'damage-reduction-factor')
  const defense = traceChild(trace, 'defence-multiplier')
  const resistance = traceChild(trace, 'resistance-multiplier')
  const critRate = traceChild(trace, 'crit-rate')
  const critDamage = traceChild(trace, 'crit-damage')
  const modeStage = `result-${mode}`
  const modeLabel = mode === 'normal' ? 'Non-crit' : mode === 'critical' ? 'Critical' : 'Average'
  const factor = (entry: CalculationTrace | undefined) => typeof entry?.value === 'number' ? entry.value : 1
  const bonusValue = (entry: CalculationTrace | undefined) => factor(entry) - 1
  const selectedHits = hits.map((hit) => (traceChild(hit, modeStage) ?? traceChild(hit, 'result'))?.value).filter((entry): entry is number => typeof entry === 'number')
  const scalingStat = scaling?.children[0]?.children.find((entry) => entry.stage.startsWith('stat-total:'))
  const scalingRatio = scaling?.children[0]?.children.find((entry) => entry.stage === 'percent:Scaling ratio')
  const baseStat = scalingStat?.children.find((entry) => entry.stage.startsWith('number:Base '))
  const percentStat = scalingStat?.children.find((entry) => entry.stage.startsWith('percent:Total '))
  const flatStat = scalingStat?.children.find((entry) => entry.stage.startsWith('number:Flat '))
  const characterLevel = traceChild(defense ?? { stage:'', children:[] }, 'number:Character level')?.value
  const enemyLevel = traceChild(defense ?? { stage:'', children:[] }, 'number:Enemy level')?.value
  const defenseReduction = traceChild(defense ?? { stage:'', children:[] }, 'percent:DEF reduction')
  const defenseIgnore = traceChild(defense ?? { stage:'', children:[] }, 'percent:DEF ignore')
  const baseResistance = resistance?.children.find((entry) => entry.stage.startsWith('percent:Base '))
  const resistanceReduction = traceChild(resistance ?? { stage:'', children:[] }, 'percent:RES reduction')
  const resistanceIgnore = traceChild(resistance ?? { stage:'', children:[] }, 'percent:RES ignore')
  const totalResistanceReduction = Number(resistanceReduction?.value ?? 0) + Number(resistanceIgnore?.value ?? 0)
  const effectiveResistance = Number(baseResistance?.value ?? 0) - totalResistanceReduction
  const firstHit = hits[0]
  const firstHitExpression = firstHit && scaling
    ? `(${traceNumber(scaling?.value)} × ${tracePercent(Number(traceChild(firstHit, 'motion-value')?.value ?? 0) * Number(traceChild(firstHit, 'motion-value-factor')?.value ?? 1))} + ${traceNumber(traceChild(firstHit, 'flat-damage')?.value)}) × (1 + ${tracePercent(bonusValue(bonus))}) × (1 + ${tracePercent(bonusValue(amplify))}) × (1 + ${tracePercent(bonusValue(vulnerability))}) × (1 + ${tracePercent(bonusValue(finalDamage))}) × (1 + ${tracePercent(bonusValue(special))}) × ${tracePercent(defense?.value)} × ${tracePercent(resistance?.value)} × ${tracePercent(reduction?.value)}`
    : traceNumber(value)
  const baseExpression = !scaling ? selectedHits.map(formatDamage).join(' + ') || traceNumber(value) : mode === 'critical' ? `${firstHitExpression} × ${tracePercent(critDamage?.value)}` : mode === 'expected' ? `${firstHitExpression} × (1 + ${tracePercent(critRate?.value)} × (${tracePercent(critDamage?.value)} - 100%))` : firstHitExpression
  const ownExpression = selectedHits.length > 1 ? selectedHits.map((hit) => traceNumber(hit)).join(' + ') : baseExpression
  const selectedExpression = triggeredActions ? `${ownExpression} + ${traceNumber(triggeredActions.value)}` : ownExpression
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return createPortal(<div className="tw-trace-backdrop" role="presentation" onMouseDown={onClose}>
    <article className="tw-trace tw-panel" role="dialog" aria-modal="true" aria-label={`${title} calculation trace`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">Calculation trace</span><h2>{title}</h2></div><strong>{modeLabel} {formatDamage(value)}</strong><button type="button" className="close" aria-label="Close calculation trace" onClick={onClose}>×</button></header>
      <div className="tw-trace-body">
        <TraceSection title={`${title} · ${modeLabel} DMG`} value={formatDamage(value)}>{selectedExpression}</TraceSection>
        {hits.filter((hit) => traceChild(hit, 'motion-value')).map((hit, index) => {
          const motion = traceChild(hit, 'motion-value')
          const motionFactor = traceChild(hit, 'motion-value-factor')
          const totalMotion = Number(motion?.value ?? 0) * Number(motionFactor?.value ?? 1)
          return <TraceSection title={hits.length === 1 ? 'Total Skill Multiplier' : `${traceLabel(hit.stage)} Skill Multiplier`} value={tracePercent(totalMotion)} source={motionFactor}>{tracePercent(motion?.value)} × (1 + {tracePercent(Number(motionFactor?.value ?? 1) - 1)})</TraceSection>
        })}
        {scaling && <TraceSection title="Scaling Power" value={traceNumber(scaling.value)} source={scaling}>{scaling.children.map((entry) => traceNumber(entry.value)).join(' + ')}</TraceSection>}
        {scalingStat && <TraceSection title={traceLabel(scalingStat.stage)} value={traceNumber(scalingStat.value)}>{traceNumber(baseStat?.value)} × (1 + {tracePercent(percentStat?.value)}) + {traceNumber(flatStat?.value)}</TraceSection>}
        {baseStat && <TraceSection title={traceLabel(baseStat.stage)} value={traceNumber(baseStat.value)} source={baseStat}>{baseStat.children.map((entry) => traceNumber(entry.value)).join(' + ')}</TraceSection>}
        {percentStat && <TraceSection title={traceLabel(percentStat.stage)} value={tracePercent(percentStat.value)} source={percentStat}>{percentStat.children.length ? percentStat.children.map((entry) => tracePercent(entry.value)).join(' + ') : '0%'}</TraceSection>}
        {flatStat && Number(flatStat.value) !== 0 && <TraceSection title={traceLabel(flatStat.stage)} value={traceNumber(flatStat.value)} source={flatStat}>{flatStat.children.map((entry) => traceNumber(entry.value)).join(' + ')}</TraceSection>}
        {scalingRatio && Number(scalingRatio.value) !== 1 && <TraceSection title="Scaling Ratio" value={tracePercent(scalingRatio.value)}>{tracePercent(scalingRatio.value)}</TraceSection>}
        {bonus && <TraceSection title="Total DMG Bonus" value={tracePercent(bonusValue(bonus))} source={bonus}>{bonus.children.length ? bonus.children.map((entry) => tracePercent(entry.value)).join(' + ') : '0%'}</TraceSection>}
        {amplify && <TraceSection title="Total Amplify" value={tracePercent(bonusValue(amplify))} source={amplify}>{amplify.children.length ? amplify.children.map((entry) => tracePercent(entry.value)).join(' + ') : '0%'}</TraceSection>}
        {vulnerability && <TraceSection title="Total Vulnerability" value={tracePercent(bonusValue(vulnerability))} source={vulnerability}>{vulnerability.children.length ? vulnerability.children.map((entry) => tracePercent(entry.value)).join(' + ') : '0%'}</TraceSection>}
        {finalDamage && <TraceSection title="Total Final DMG" value={tracePercent(bonusValue(finalDamage))} source={finalDamage}>{finalDamage.children.length ? finalDamage.children.map((entry) => tracePercent(entry.value)).join(' + ') : '0%'}</TraceSection>}
        {special && <TraceSection title="Total Special Multiplier" value={tracePercent(bonusValue(special))} source={special}>{special.children.length ? `${special.children.map((entry) => `(1 + ${tracePercent(entry.value)})`).join(' × ')} - 100%` : '0%'}</TraceSection>}
        {defense && <TraceSection title="Enemy DEF Multiplier" value={tracePercent(defense.value)} source={defense}>{`(800 + 8 × ${traceNumber(characterLevel)}) / ((800 + 8 × ${traceNumber(characterLevel)}) + (792 + 8 × ${traceNumber(enemyLevel)}) × (1 - ${tracePercent(defenseReduction?.value)}) × (1 - ${tracePercent(defenseIgnore?.value)}))`}</TraceSection>}
        {resistance && <TraceSection title="Enemy RES Multiplier" value={tracePercent(resistance.value)} source={resistance}>{totalResistanceReduction === 0 ? `1 - ${tracePercent(baseResistance?.value)}` : Number(baseResistance?.value ?? 0) <= 0 ? `1 - (${tracePercent(baseResistance?.value)} - ${tracePercent(totalResistanceReduction)} / 2)` : effectiveResistance >= 0 ? `1 - ${tracePercent(baseResistance?.value)} + ${tracePercent(totalResistanceReduction)}` : `1 + (${tracePercent(-effectiveResistance)} / 2)`}</TraceSection>}
        {reduction && <TraceSection title="DMG Reduction Multiplier" value={tracePercent(reduction.value)} source={reduction}>1 - {tracePercent(1 - Number(reduction.value ?? 1))}</TraceSection>}
        {triggeredActions && <TraceSection title="Triggered Actions" value={traceNumber(triggeredActions.value)} source={triggeredActions}>{triggeredActions.children.map((entry) => traceNumber(entry.value)).join(' + ')}</TraceSection>}
        {hits.map((hit, index) => {
          const preCrit = traceChild(hit, 'pre-crit')
          const result = hit.children.find((entry) => entry.stage === modeStage)?.value
          const normal = traceChild(hit, 'result-normal') ?? traceChild(hit, 'result')
          return <TraceSection title={hits.length === 1 ? 'Non-crit Damage' : `${traceLabel(hit.stage)} Non-crit`} value={formatDamage(Number(normal?.value ?? 0))} key={`${hit.stage}-${index}`}>{traceNumber(preCrit?.value ?? normal?.value)}{typeof result === 'number' && mode !== 'normal' ? ` · selected ${formatDamage(result)}` : ''}</TraceSection>
        })}
        {critDamage && hits.length > 0 && <TraceSection title="Critical Damage" value={formatDamage(hits.reduce((total, hit) => total + Number(traceChild(hit, 'result-critical')?.value ?? 0), 0))} source={critDamage}>{hits.map((hit) => `${traceNumber(traceChild(hit, 'pre-crit')?.value)} × ${tracePercent(critDamage.value)}`).join(' + ')}</TraceSection>}
        {critRate && critDamage && hits.length > 0 && <TraceSection title="Average Damage" value={formatDamage(hits.reduce((total, hit) => total + Number(traceChild(hit, 'result-expected')?.value ?? 0), 0))} source={critRate}>{hits.map((hit) => `${traceNumber(traceChild(hit, 'pre-crit')?.value)} × (1 + ${tracePercent(critRate.value)} × (${tracePercent(critDamage.value)} - 100%))`).join(' + ')}</TraceSection>}
        {effects && typeof effects.value === 'number' && effects.value > 0 && <p className="tw-trace-effects">Includes {effects.value} active reviewed {effects.value === 1 ? 'effect' : 'effects'}.</p>}
      </div>
    </article>
  </div>, document.body)
}

function ReviewedEffectCard({ effect, values, updateInputs }: {
  effect: CombatEffectDefinition
  values: Record<string, ScenarioValue>
  updateInputs: (patch: Record<string, ScenarioValue>) => void
}) {
  const numericInput = effect.inputs.find((input) => input.kind === 'number')
  const numericValue = numericInput && typeof values[numericInput.id] === 'number' ? Number(values[numericInput.id]) : 0
  const stackOptions = effect.activationKind === 'stacks' && numericInput
    ? Array.from({ length:Math.floor(numericInput.maximum ?? 0) + 1 }, (_, value) => value).filter((value) => value === 0 || value >= (numericInput.minimum ?? 0))
    : []
  const active = effect.inputs.length === 0 || effect.inputs.every((input) => input.kind === 'number' ? Number(values[input.id] ?? 0) > 0 : values[input.id] === true)
  const toggle = () => updateInputs(Object.fromEntries(effect.inputs.map((input) => [input.id, !active])))
  const formatResult = (result: CombatEffectDefinition['results'][number]) => {
    if (typeof result.value === 'string') return result.value
    const activation = result.perActivation && numericValue > 0 ? numericValue : 1
    const value = result.value * activation
    const formatted = result.percent ? `${Number((value * 100).toFixed(3))}%` : Number(value.toFixed(3)).toLocaleString()
    const unit = effect.activationKind === 'stacks' ? 'stack' : 'point'
    return result.perActivation && numericValue <= 1 ? `${formatted} / ${unit}` : formatted
  }
  return <article className={active ? effect.inputs.length ? 'is-active' : 'is-fixed' : 'is-inactive'}>
    <header className="tw-effect-copy">
      <span><strong>{effect.label} {effect.description && <span className="tw-effect-info" title={effect.description} aria-label={effect.description}>i</span>}</strong><small>Buff · {effect.sourceLabel}</small></span>
      <b>{effect.badge}</b>
    </header>
    {effect.inputs.length > 0 && <div className="tw-effect-condition">
      {numericInput
          ? <><span className="tw-condition-toggle" aria-pressed={active}><i/><strong title={effect.description}>{effect.description ?? 'Set the active amount'}</strong></span><label>{effect.activationKind === 'stacks' ? 'Stacks' : 'Value'}{effect.activationKind === 'stacks'
            ? <select value={numericValue} onChange={(event) => updateInputs({ [numericInput.id]:Number(event.target.value) })}>{stackOptions.map((value) => <option value={value} key={value}>{value === 0 ? 'Off' : value}</option>)}</select>
            : <input type="number" min={numericInput.minimum} max={numericInput.maximum} value={numericValue} onChange={(event) => updateInputs({ [numericInput.id]:Number(event.target.value) })}/>}</label></>
          : <button type="button" className="tw-condition-toggle" aria-pressed={active} title={effect.description} onClick={toggle}><i/><strong>{effect.description ?? (active ? 'Effect active' : 'Activate effect')}</strong></button>}
    </div>}
    {active && effect.results.length > 0 && <dl className="tw-effect-results">{effect.results.map((result, index) => <div key={`${result.label}-${index}`}><dt>{result.label}</dt><dd>{formatResult(result)}</dd></div>)}</dl>}
  </article>
}

type ReviewedEffectListProps = {
  effects: CombatEffectDefinition[]
  values: Record<string, ScenarioValue>
  updateInputs: (patch: Record<string, ScenarioValue>) => void
}

function ReviewedEffectList({ effects, values, updateInputs }: ReviewedEffectListProps) {
  if (!effects.length) return null
  return <div className="tw-v2-effect-list">{effects.map((effect) => <ReviewedEffectCard effect={effect} values={values} updateInputs={updateInputs} key={effect.id}/>)}</div>
}

function FormulaResultSheet({ member, model, updateTeam }: { member: TeamMemberModel; model: TeamWorkspaceModel; updateTeam: (patch: Partial<Team>) => Promise<void> }) {
  const [trace, setTrace] = useState<TraceSelection | null>(null)
  const scenario = model.team.scenario ?? { resultMode: 'expected' as const, memberConditions: {}, enemyConditions: {}, selectedTargetByBuild: {} }
  const mode = scenario.resultMode
  const buildId = member.build?.id ?? ''
  const elementStat = member.catalog ? ELEMENT_DAMAGE_STATS[member.catalog.element] : undefined
  const coreStats: Array<[StatKey, string]> = elementStat && member.catalog ? [...CORE_STATS, [elementStat, `${member.catalog.element} DMG Bonus`]] : CORE_STATS
  const groups = [...new Set(member.formulaRows.map((row) => row.target.group))]
  const rowsByGroup = new Map(groups.map((group) => [group, member.formulaRows.filter((row) => row.target.group === group)]))
  const orderedGroups = [...groups].sort((left, right) => {
    const leftOrder = FORMULA_GROUP_ORDER.indexOf(left)
    const rightOrder = FORMULA_GROUP_ORDER.indexOf(right)
    return (leftOrder < 0 ? FORMULA_GROUP_ORDER.length : leftOrder) - (rightOrder < 0 ? FORMULA_GROUP_ORDER.length : rightOrder)
      || left.localeCompare(right)
  })
  const updateScenario = (patch: Partial<typeof scenario>) => updateTeam({ scenario: { ...scenario, ...patch } })
  const selectRow = (row: TeamMemberModel['formulaRows'][number]) => {
    if (buildId) void updateScenario({ selectedTargetByBuild: { ...scenario.selectedTargetByBuild, [buildId]: row.target.id } })
    setTrace({ trace: row.traces[mode], title: compactAttackLabel(row.target.label), value: row[mode], mode })
  }
  const renderGroup = (group: string) => <article className="tw-sheet-column" key={group}>
    <header><span>{compactAttackLabel(group)}</span><small>{mode}</small></header>
    {rowsByGroup.get(group)?.map((row) => <button className={scenario.selectedTargetByBuild[buildId] === row.target.id ? 'selected' : ''} onClick={() => selectRow(row)} key={row.target.id}><span>{compactAttackLabel(row.target.label)}<small>{row.target.kind}</small></span><b>{formatDamage(row[mode])}</b></button>)}
  </article>
  return <>
    <section className="tw-formula-grid">
      <article className="tw-sheet-column tw-sheet-stats"><header><span>Basic Stats</span></header><dl>{coreStats.map(([key, label]) => <div className={Math.abs(resolvedMemberStatDelta(member, key)) > 1e-9 ? 'is-modified' : undefined} key={key}><dt><img className="tw-stat-icon" src={statIconSource(key)} alt="" aria-hidden="true"/>{label}</dt><dd>{member.showcase ? <CalculatedValue detail={resolvedMemberStatDetail(member, key, label)}>{formatWorkspaceStat(key, resolvedMemberStat(member, key))}</CalculatedValue> : '—'}</dd></div>)}</dl><header><span>Bonus Stats</span></header><dl>{DAMAGE_STATS.map(([key, label]) => <div className={Math.abs(resolvedMemberStatDelta(member, key)) > 1e-9 ? 'is-modified' : undefined} key={key}><dt><img className="tw-stat-icon" src={statIconSource(key)} alt="" aria-hidden="true"/>{label}</dt><dd>{member.showcase ? <CalculatedValue detail={resolvedMemberStatDetail(member, key, label)}>{formatWorkspaceStat(key, resolvedMemberStat(member, key))}</CalculatedValue> : '—'}</dd></div>)}</dl></article>
      <div className="tw-sheet-results">{orderedGroups.map(renderGroup)}</div>
    </section>
    {trace && <CalculationTraceDialog selection={trace} onClose={() => setTrace(null)}/>}
  </>
}

function MainEchoOverviewCard({ member, effects, values, updateInputs }: { member: TeamMemberModel } & ReviewedEffectListProps) {
  const mainEcho = member.showcase?.echoSlots[0]
  if (!mainEcho) return <article className="tw-main-echo-overview is-empty"><header><span className="eyebrow">Main Echo</span><h2>No main Echo</h2></header><p>Equip an Echo in slot 1 to complete this loadout.</p></article>
  return <article className="tw-main-echo-overview">
    <header className="tw-main-echo-identity"><img src={echoArtwork(mainEcho)} alt=""/><span><span className="eyebrow">Main Echo</span><h2>{mainEcho.name}</h2><small>Rarity {mainEcho.rarity} · Cost {mainEcho.cost} · +{mainEcho.level}</small></span></header>
    <ReviewedEffectList effects={effects} values={values} updateInputs={updateInputs}/>
  </article>
}

function CharacterOverviewWorkspace({ member, model, updateTeam, weaponPassive, onChangeEcho, onEditEcho, onOpenForteTarget, effects, values, updateInputs }: {
  member: TeamMemberModel
  model: TeamWorkspaceModel
  updateTeam: (patch: Partial<Team>) => Promise<void>
  weaponPassive?: string
  onChangeEcho: (slot: number) => void
  onEditEcho: (echo: Echo, slot: number) => void
  onOpenForteTarget: (target: string) => void
} & ReviewedEffectListProps) {
  const [weaponDetailsOpen, setWeaponDetailsOpen] = useWorkspacePreference(`overview:${model.team.id}:${member.slot}:weapon-details-open`, false)
  if (!member.build || !member.catalog || !member.character || !member.showcase) return null
  const catalog = member.catalog
  const showcase = member.showcase
  const weaponEffects = effects.filter((effect) => effect.sourceKind === 'weapon')
  const sonataEffects = effects.filter((effect) => effect.sourceKind === 'sonata')
  const echoEffects = effects.filter((effect) => effect.sourceKind === 'echo')

  return <>
    <section className="tw-overview-sheet tw-panel">
      <aside className="tw-overview-character">
        <div className="tw-overview-art">
          <img src={member.catalog.portraitSourceUrl || member.catalog.iconSourceUrl} alt=""/>
          <EchoWaveform element={member.catalog.element}/>
          <div><span>{member.catalog.element} · {member.catalog.weaponType}</span><h1>{member.catalog.name}</h1><p>{member.catalog.title}</p><strong>Lv. {member.character.level} · S{member.character.sequence}</strong></div>
        </div>
        <section className="tw-overview-skills">
          <header><span>Skills</span><b>Levels</b></header>
          <div>{Object.entries(member.catalog.skillIcons).map(([key, skill], index) => <button type="button" key={key} title={skill.name} onClick={() => onOpenForteTarget(`skill-${key}`)}><img src={skill.iconSourceUrl} alt=""/><small>{showcase.skillLevels[index]}</small><b>{({ normalAttack: 'Normal ATK', resonanceSkill: 'Res. Skill', forteCircuit: 'Forte Circuit', resonanceLiberation: 'Res. Liberation', introSkill: 'Intro Skill' } as Record<string, string>)[key] ?? skill.name}</b></button>)}</div>
        </section>
        <section className="tw-overview-sequences">
          <header><span>Sequences</span><b>S{member.character.sequence}</b></header>
          <div>{member.catalog.sequenceIcons.slice(0, 6).map((sequence) => <button type="button" className={member.character!.sequence >= sequence.sequence ? 'unlocked' : ''} key={sequence.sequence} title={sequence.name} aria-label={`View sequence ${sequence.sequence}: ${sequence.name}`} onClick={() => onOpenForteTarget(`sequence-${sequence.sequence}`)}><img src={sequence.iconSourceUrl} alt=""/><b>S{sequence.sequence}</b></button>)}</div>
        </section>
        <section className="tw-overview-loadout-card tw-overview-weapon-card">
          <section className="tw-overview-left-weapon">
          <header className="tw-overview-loadout-heading"><span>Weapon</span>{showcase.weapon && <small>R{showcase.weapon.owned.rank}</small>}</header>
          {showcase.weapon ? <article className="tw-overview-weapon-compact">
            <img className="tw-overview-weapon-image" src={showcase.weapon.catalog.iconSourceUrl} alt=""/><div className="tw-overview-weapon-info"><div className="tw-overview-weapon-identity"><strong>{showcase.weapon.catalog.name}</strong><small>Lv. {showcase.weapon.owned.level} · {'★'.repeat(showcase.weapon.catalog.rarity)}</small></div>
            <dl><div><dt><img className="weapon-stat-icon" src={statIconSource('atk')} alt="" aria-hidden="true"/>ATK</dt><dd>{showcase.weapon.levelStats.baseAtk}</dd></div><div><dt><img className="weapon-stat-icon" src={weaponStatIconSource(showcase.weapon.catalog.secondaryStat)} alt="" aria-hidden="true"/>{showcase.weapon.catalog.secondaryStat}</dt><dd>{showcase.weapon.levelStats.secondaryStatValue}</dd></div></dl></div>
          </article> : <p className="tw-overview-loadout-empty">No weapon equipped.</p>}
        </section>
        <article className="tw-overview-weapon-passive">
          <header><span>Passive</span></header>
          <h2>{showcase.weapon?.catalog.passiveName ?? 'No weapon passive'}</h2>
          {weaponPassive && <details open={weaponDetailsOpen} onToggle={(event) => setWeaponDetailsOpen(event.currentTarget.open)}><summary>Effect details</summary><p>{weaponPassive}</p></details>}
          <ReviewedEffectList effects={weaponEffects} values={values} updateInputs={updateInputs}/>
        </article>
        </section>
      </aside>
        <section className="tw-overview-loadout-card tw-overview-sonata-card">
          <section className="tw-overview-sonatas">
          <header className="tw-overview-loadout-heading"><span>Sonata</span><small>{showcase.sonatas.length} {showcase.sonatas.length === 1 ? 'set' : 'sets'}</small></header>
          {showcase.sonatas.length ? <div className="tw-overview-sonata-list">{showcase.sonatas.map((sonata) => <article key={sonata.name}>
            <header>{sonata.iconSourceUrl && <img src={sonata.iconSourceUrl} alt=""/>}<strong>{sonata.name}</strong><b>{sonata.count}/5</b></header>
            <ReviewedEffectList effects={sonataEffects.filter((effect) => effect.sourceLabel === sonata.name)} values={values} updateInputs={updateInputs}/>
          </article>)}</div> : <p className="tw-overview-loadout-empty">No Sonata coverage.</p>}
        </section>
        <MainEchoOverviewCard member={member} effects={echoEffects} values={values} updateInputs={updateInputs}/>
        </section>

      <div className="tw-overview-right">
        <div className="tw-overview-formulas"><FormulaResultSheet member={member} model={model} updateTeam={updateTeam}/></div>
        <section className="tw-overview-equipment" aria-label="Equipped Echoes">
          <div className="tw-overview-equipment-grid">
        {showcase.echoSlots.map((echo, index) => <div className="cs-echo-tab-card" key={echo?.id ?? index}>{echo ? <TeamEchoCard echo={echo} ownerName={catalog.name} onChange={() => onChangeEcho(index)} onEdit={() => onEditEcho(echo, index)}/> : <article className="detail-empty"><span>+</span><small>Empty Echo slot {index + 1}</small><button type="button" className="tw-echo-slot-add" onClick={() => onChangeEcho(index)}>Choose Echo</button></article>}</div>)}
          </div>
        </section>
      </div>
    </section>
  </>
}

function MemberWorkspace({ member, model, section, setSection, backToFormation, updateTeam, echoes, builds, equippedLoadouts, theorycraftBuilds, characters, weapons, openScanner, refresh, roverGender }: { member: TeamMemberModel; model: TeamWorkspaceModel; section: MemberSection; setSection: (section: MemberSection) => void; backToFormation: () => void; updateTeam: (patch: Partial<Team>) => Promise<void>; echoes: Echo[]; builds: Build[]; equippedLoadouts: EquippedLoadout[]; theorycraftBuilds: TheorycraftBuild[]; characters: OwnedCharacter[]; weapons: OwnedWeapon[]; openScanner: () => void; refresh: () => Promise<void>; roverGender: 'male' | 'female' }) {
  const [echoSlot, setEchoSlot] = useState<number>()
  const [editingEcho, setEditingEcho] = useState<Echo | null>(null)
  const [forteTarget, setForteTarget] = useState<string>()
  useEffect(() => setEchoSlot(undefined), [member.build?.id, member.source?.type, section])
  useEffect(() => {
    if (section !== 'forte' || !forteTarget) return
    const frame = requestAnimationFrame(() => {
      document.querySelector(`[data-forte-target="${forteTarget}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    const timer = window.setTimeout(() => setForteTarget(undefined), 1800)
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer) }
  }, [section, forteTarget])
  if (!member.build || !member.catalog || !member.character || !member.showcase) return <section className="tw-member-empty tw-panel"><MemberAvatar member={member}/><h2>Slot {member.slot + 1} is empty</h2><p>Choose a character in Formation to get started.</p><button type="button" className="primary" onClick={backToFormation}>Go to Formation</button></section>
  const showcase = member.showcase
  const weaponPassive = showcase.weapon?.catalog.passiveEffects[Math.max(0, (showcase.weapon?.owned.rank ?? 1) - 1)] ?? showcase.weapon?.catalog.passiveEffects[0]
  const scenario = model.team.scenario ?? { resultMode: 'expected' as const, memberConditions: {}, enemyConditions: {}, selectedTargetByBuild: {} }
  const reviewedEffects = combatEffectDefinitions(member.character.catalogId, showcase.weapon?.owned.catalogId ?? '', member.character.sequence, showcase.weapon?.owned.rank ?? 1, member.resolvedEchoes)
  const effectValues = scenario.memberConditions[member.build.id] ?? {}
  const updateEffectInputs = (patch: Record<string, ScenarioValue>) => void updateTeam({ scenario:{ ...scenario, memberConditions:{ ...scenario.memberConditions, [member.build!.id]:{ ...effectValues, ...patch } } } })
  const optimizerEchoes = [...echoes, ...member.resolvedEchoes.filter((echo) => !echoes.some((owned) => owned.id === echo.id))]
  const optimizerBuilds = [...builds.filter((build) => build.id !== member.build!.id), member.build]
  const optimizerWeapons = member.resolvedWeapon && !weapons.some((weapon) => weapon.id === member.resolvedWeapon?.id) ? [...weapons, member.resolvedWeapon] : weapons
  const optimizerRotationInput: TeamWorkspaceInput = { team: model.team, builds: optimizerBuilds, characters, weapons: optimizerWeapons, echoes: optimizerEchoes, equippedLoadouts, theorycraftBuilds, roverGender }
  const theorycraftSource = member.source?.type === 'theorycraft' ? member.source : undefined
  const theorycraftToEdit = theorycraftSource ? theorycraftBuilds.find((build) => build.id === theorycraftSource.theorycraftBuildId) : undefined
  const editEcho = (echo: Echo, slot: number) => {
    if (member.source?.type === 'theorycraft') setEchoSlot(slot)
    else setEditingEcho(echo)
  }
  const selectEcho = async (echoIds: string[]) => {
    const selected = echoIds.map((id) => echoes.find((echo) => echo.id === id))
    if (selected.some((echo) => !echo) || new Set(echoIds).size !== echoIds.length || selected.reduce((total, echo) => total + (echo?.cost ?? 0), 0) > 12) throw new Error('This Echo combination is not valid for the loadout.')
    if (member.source?.type === 'equipped') {
      await setEquippedEchoIds(member.character!.id, echoIds)
    } else if (member.source?.type === 'saved') {
      if (!await db.builds.update(member.source.buildId, { echoIds, updatedAt: Date.now() })) throw new Error('The saved build no longer exists.')
    } else return false
  }
  if (echoSlot !== undefined && theorycraftToEdit) return <div className="tw-member-page"><TheorycraftEditor value={theorycraftToEdit} ownedCharacter={member.character} onClose={() => setEchoSlot(undefined)} onSaved={refresh} backLabel="Back to overview"/></div>
  return <div className={`tw-member-page section-${section}`} style={{ '--tw-member-accent': ELEMENT_COLORS[member.catalog.element] ?? '#c8d0ce' } as CSSProperties}>
    {section === 'overview' ? <CharacterOverviewWorkspace member={member} model={model} updateTeam={updateTeam} weaponPassive={weaponPassive} onChangeEcho={setEchoSlot} onEditEcho={editEcho} onOpenForteTarget={(target) => { setForteTarget(target); setSection('forte') }} effects={reviewedEffects} values={effectValues} updateInputs={updateEffectInputs}/>
      : section === 'rotation' ? <RotationWorkspace key={member.build.id} model={model} updateTeam={updateTeam} focusBuildId={member.build.id}/>
      : section === 'optimizer' ? <OptimizerView key={member.build.id} echoes={optimizerEchoes} builds={optimizerBuilds} characters={characters} ownedWeapons={optimizerWeapons} refresh={refresh} openScanner={openScanner} buildId={member.build.id} teamBuildIds={model.members.flatMap((entry) => entry.character ? [entry.character.id] : [])} initialEnemy={model.team.enemy} damageMode={scenario.resultMode} scenario={scenario} rotation={{ input: optimizerRotationInput, memberSlot: member.slot, model }} accent={ELEMENT_COLORS[member.catalog.element]}/>
      : section === 'theorizer' ? <TheorizerWorkspace member={member} model={model} echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} roverGender={roverGender} refresh={refresh} accent={ELEMENT_COLORS[member.catalog.element]}/>
      : <section className="tw-member-hero tw-panel forte-mode" style={{ '--tw-element': member.catalog.element.toLowerCase() } as CSSProperties}>
      <div className="tw-member-art"><img src={member.catalog.portraitSourceUrl || member.catalog.iconSourceUrl} alt=""/><div className="tw-sequence-rail">{member.catalog.sequenceIcons.slice(0, 6).map((sequence) => <span className={member.character && member.character.sequence >= sequence.sequence ? 'unlocked' : ''} key={sequence.sequence} title={sequence.name}><img src={sequence.iconSourceUrl} alt=""/><b>S{sequence.sequence}</b></span>)}</div><div><span>{member.catalog.element} · {member.catalog.weaponType}</span><h1>{member.catalog.name}</h1><p>{member.catalog.title}</p><strong>Lv. {member.character.level} · Sequence {member.character.sequence}</strong></div><EchoWaveform element={member.catalog.element}/></div>
      <div className="tw-member-summary">
        <ForteWorkspace member={member} model={model} refresh={refresh} focusTarget={forteTarget} effects={reviewedEffects} values={effectValues} updateInputs={updateEffectInputs}/>
      </div>
    </section>}
    <WarningList warnings={section === 'rotation' ? model.warnings : member.warnings}/>
    {echoSlot !== undefined && member.source && member.source.type !== 'theorycraft' && <CharacterSubstatProfileContext.Provider value={resolveCharacterSubstatProfile(member.catalog)}><EchoPicker slot={echoSlot} characterId={member.character.id} currentIds={member.build.echoIds} echoes={echoes} accentClass={`cs-element-${member.catalog.element.toLowerCase()}`} refresh={refresh} onClose={() => setEchoSlot(undefined)} onSelect={selectEcho}/></CharacterSubstatProfileContext.Provider>}
    {editingEcho && <EchoEditModal echo={editingEcho} onClose={() => setEditingEcho(null)} onSave={async (updated) => { await db.echoes.put(updated); setEditingEcho(null); await refresh() }}/>}
  </div>
}

export function TeamsView({ echoes, builds, equippedLoadouts, theorycraftBuilds, teams, characters, weapons, refresh, openScanner, galleryRequest, roverGender, route, onRouteChange }: TeamsViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(teams[0]?.id ?? null)
  const [showGallery, setShowGallery] = useState(true)
  const [tab, setTab] = useState<WorkspaceTab>('settings')
  const [memberSection, setMemberSection] = useState<MemberSection>('overview')
  const team = teams.find((entry) => entry.id === selectedId) ?? teams[0]
  const model = useMemo(() => team ? resolveTeamWorkspace({ team, builds, equippedLoadouts, theorycraftBuilds, characters, weapons, echoes, roverGender }) : undefined, [team, builds, equippedLoadouts, theorycraftBuilds, characters, weapons, echoes, roverGender])

  useEffect(() => { if (!team && teams[0]) setSelectedId(teams[0].id) }, [team, teams])
  useEffect(() => {
    setShowGallery(true)
    setTab('settings')
    window.scrollTo({ top: 0 })
  }, [galleryRequest])
  useEffect(() => {
    if (!route?.team) {
      setShowGallery(true)
      setTab('settings')
      return
    }
    const numbered = /^team_(\d+)$/i.exec(route.team)
    const target = numbered
      ? teams[Number(numbered[1]) - 1]
      : teams.find((entry) => entry.id === route.team || routeKey(entry.name) === routeKey(route.team!))
    if (!target) return
    const targetIndex = teams.findIndex((entry) => entry.id === target.id)
    const canonicalTeamRoute = targetIndex >= 0 ? `team_${targetIndex + 1}` : route.team
    setShowGallery(false)
    if (route.team !== canonicalTeamRoute) {
      onRouteChange?.({ team: canonicalTeamRoute, character: route.character, section: route.section })
    }
    if (selectedId !== target.id) {
      setSelectedId(target.id)
      return
    }
    if (!route.character) {
      setTab('settings')
      return
    }
    const characterKey = routeKey(route.character)
    const slot = model?.members.findIndex((member) => member.catalog?.id === route.character || (member.catalog ? routeKey(member.catalog.name) === characterKey : false)) ?? -1
    if (slot < 0 || slot > 2) {
      setTab('settings')
      return
    }
    setTab(slot as 0 | 1 | 2)
    setMemberSection(memberSectionFromRoute(route.section))
  }, [model, onRouteChange, route?.character, route?.section, route?.team, selectedId, teams])

  const updateTeamById = async (teamId: string, patch: Partial<Team>) => {
    await db.teams.update(teamId, patch)
    await refresh()
  }
  const updateTeam = async (patch: Partial<Team>) => {
    if (!team) return
    await updateTeamById(team.id, patch)
  }
  const createTeam = async () => {
    const next: Team = { id: createLocalId(), name: `Team ${teams.length + 1}`, members: [], buildIds: [], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 25, actions: [], buffs: [], scenario: { resultMode: 'expected', memberConditions: {}, enemyConditions: {}, selectedTargetByBuild: {} } }
    await db.teams.add(next); await refresh(); setSelectedId(next.id); setTab('settings'); setShowGallery(false)
    onRouteChange?.({ team: next.id })
  }

  const deleteGalleryTeam = async (target: Team) => {
    if (!confirm(`Delete ${target.name}? This removes its local rotation and authored buffs.`)) return
    await db.teams.delete(target.id)
    await refresh()
    if (selectedId === target.id) setSelectedId(teams.find((entry) => entry.id !== target.id)?.id ?? null)
  }

  const teamIndex = team ? teams.findIndex((entry) => entry.id === team.id) : -1
  const teamRouteId = teamIndex >= 0 ? `team_${teamIndex + 1}` : undefined
  const openTeam = (teamId: string) => {
    const index = teams.findIndex((entry) => entry.id === teamId)
    setSelectedId(teamId)
    setTab('settings')
    setShowGallery(false)
    onRouteChange?.({ team: index >= 0 ? `team_${index + 1}` : teamId })
  }
  const backToGallery = () => {
    setShowGallery(true)
    setTab('settings')
    onRouteChange?.({})
  }
  const deleteCurrentTeam = async () => {
    if (!team || !confirm(`Delete ${team.name}? This removes its local rotation and authored buffs.`)) return
    await db.teams.delete(team.id)
    await refresh()
    setSelectedId(teams.find((entry) => entry.id !== team.id)?.id ?? null)
    backToGallery()
  }
  const openMemberRoute = (slot: 0 | 1 | 2, section: MemberSection = 'overview') => {
    const member = model?.members[slot]
    setTab(slot)
    setMemberSection(section)
    onRouteChange?.({
      team: teamRouteId,
      character: member?.catalog ? routeKey(member.catalog.name) : undefined,
      section: member?.catalog ? memberSectionToRoute(section) : undefined
    })
  }
  const setMemberSectionRoute = (section: MemberSection) => {
    if (typeof tab !== 'number') return
    openMemberRoute(tab, section)
  }
  const openFormation = () => {
    setTab('settings')
    onRouteChange?.({ team: teamRouteId })
  }

  if (showGallery) return <main className="team-workspace team-gallery-original"><TeamGallery teams={teams} builds={builds} characters={characters} weapons={weapons} echoes={echoes} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} onCreate={createTeam} onOpen={openTeam} onRename={(teamId, name) => updateTeamById(teamId, { name })} onDelete={deleteGalleryTeam}/></main>

  return <main className="team-workspace">
    {model && team && <TeamWorkspaceHeader team={team} model={model} onBack={backToGallery} onRename={(name) => updateTeam({ name })} onDelete={deleteCurrentTeam}/>}
    <div className="tw-sticky-navigation" style={typeof tab === 'number' && model?.members[tab]?.catalog ? { '--tw-member-accent': ELEMENT_COLORS[model.members[tab].catalog?.element ?? ''] ?? '#c8d0ce' } as CSSProperties : undefined}>
      <nav className="tw-primary-tabs" aria-label="Formation" role="tablist">
        <button role="tab" className={tab === 'settings' ? 'active' : ''} aria-selected={tab === 'settings'} onClick={openFormation}><span>Formation</span><small>Team setup</small></button>
        {Array.from({ length: 3 }, (_, slot) => { const member = model?.members[slot]; return <button role="tab" className={tab === slot ? 'active' : ''} aria-selected={tab === slot} key={slot} style={member?.catalog ? { '--tw-member-accent': ELEMENT_COLORS[member.catalog.element] ?? '#c8d0ce' } as CSSProperties : undefined} onClick={() => openMemberRoute(slot as 0 | 1 | 2)}><MemberAvatar member={member ?? { slot, attacks: [], contribution: 0, contributionPercent: 0, byType: {}, appliedBuffs: [], receivedBuffs: [], roles: [], warnings: [], resolvedEchoes: [] }} compact/><span>{member?.catalog?.name ?? `Slot ${slot + 1}`}</span><small>{member?.build?.name ?? 'Empty'}</small></button> })}
      </nav>
      {model && typeof tab === 'number' && model.members[tab]?.catalog && <nav className="tw-subnav" aria-label={`${model.members[tab].catalog?.name ?? 'Character'} sections`} role="tablist">
        {MEMBER_SECTIONS.map((item) => <button key={item.id} role="tab" className={memberSection === item.id ? 'active' : ''} aria-selected={memberSection === item.id} onClick={() => setMemberSectionRoute(item.id)}>{item.label}</button>)}
        <div className="tw-nav-result-modes" role="group" aria-label="Damage result mode">
          {DAMAGE_RESULT_MODES.map((mode) => <button type="button" aria-pressed={(model.team.scenario?.resultMode ?? 'expected') === mode.id} className={(model.team.scenario?.resultMode ?? 'expected') === mode.id ? 'active' : ''} key={mode.id} onClick={() => void updateTeam({ scenario: { ...(model.team.scenario ?? { memberConditions: {}, enemyConditions: {}, selectedTargetByBuild: {} }), resultMode: mode.id } })}>{mode.label}</button>)}
        </div>
      </nav>}
    </div>
    {!model ? <section className="tw-first-team tw-panel"><span className="eyebrow">No teams yet</span><h1>Start a team workspace</h1><p>Create a local team, assign up to three saved builds, and author its rotation without leaving this page.</p><button className="primary" onClick={() => void createTeam()}><Icon name="plus"/>Create team</button></section>
      : tab === 'settings' ? <TeamOverview key={team?.id} model={model} echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} refresh={refresh} updateTeam={updateTeam}/>
        : <MemberWorkspace key={`${team?.id}:${tab}`} member={model.members[tab]} model={model} section={memberSection} setSection={setMemberSectionRoute} backToFormation={openFormation} updateTeam={updateTeam} echoes={echoes} builds={builds} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} characters={characters} weapons={weapons} openScanner={openScanner} refresh={refresh} roverGender={roverGender}/>}
  </main>
}
