import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { formatDamage } from '../domain/damage'
import { resolveCharacterSubstatProfile } from '../domain/character-substat-score'
import { echoRollRating } from '../domain/echo-grade'
import { createLocalId } from '../domain/id'
import { aggregateRotationCharts } from '../domain/team-scenario/charts'
import type { Build, DamageType, Echo, EquippedLoadout, FormulaResultMode, LoadoutSourceRef, OwnedCharacter, OwnedWeapon, RotationAction, StatKey, Team, TheorycraftBuild } from '../domain/types'
import { characterCatalog, statLabels, weaponCatalog } from '../game-data'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import type { CalculationTrace } from '../domain/calculation'
import { emptyCalculationScenarioV2, type CalculationEffectDefinition, type CalculationTraceV2 } from '../domain/calculation-v2'
import { db } from '../storage/database'
import { EchoWaveform } from './EchoWaveform'
import { richSkillDescription } from './CharacterShowcase'
import { CharacterSubstatProfileContext, EchoMiniCard, ElementFilterIcon, EquippedCharacterLabel, FilterChips, Icon } from './components'
import { Picker as CharacterPicker } from './CharacterInventoryView'
import { CalculatedValue, traceCalculationDetail } from './CalculationDetails'
import { showcaseStatDetail, sumDetail } from './calculation-detail-model'
import { RotationPresetControls } from './teams/RotationPresetControls'
import { CalculationEffectControls, CalculationStanceControl } from './teams/BuffEffectControls'
import { BuffsWorkspace } from './teams/BuffsWorkspace'
import { BuildManagementModal } from './teams/BuildManagementModal'
import { TheorizerWorkspace } from './teams/TheorizerWorkspace'
import { OptimizerView } from './OptimizerView'
import {
  echoArtwork, formatWorkspaceStat, resolveTeamWorkspace, teamBuffLabel,
  type TeamActionModel, type TeamAttackGroup, type TeamMemberModel, type TeamWorkspaceModel
} from './team-workspace-model'
import { defaultEnabledSkillTreeBonusIds, inherentSkillBonusId, skillTreeBonusId } from './character-showcase-model'
import './team-workspace.css'

type WorkspaceTab = 'settings' | 'buffs' | 'theorizer' | 'rotation' | 0 | 1 | 2
type MemberSection = 'overview' | 'forte' | 'optimizer' | 'rotation'
type TeamRouteSection = 'overview' | 'buffs' | 'theorizer' | 'forte' | 'optimize' | 'rotation'

const MEMBER_SECTIONS: Array<{ id: MemberSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'forte', label: 'Forte' },
  { id: 'optimizer', label: 'Optimize' },
  { id: 'rotation', label: 'Rotation' }
]

const DAMAGE_RESULT_MODES: Array<{ id: FormulaResultMode; label: string }> = [
  { id: 'normal', label: 'Non-crit hit DMG' },
  { id: 'expected', label: 'Avg DMG' },
  { id: 'critical', label: 'Crit hit DMG' }
]

const TEAM_TBA_CHARACTER_IDS = new Set(['1212', '1413'])

const ROTATION_ATTACK_GROUPS: Array<{ id: TeamAttackGroup; label: string }> = [
  { id: 'basic', label: 'Basic' },
  { id: 'skill', label: 'Skill' },
  { id: 'forte', label: 'Forte Circuit' },
  { id: 'liberation', label: 'Liberation' },
  { id: 'intro', label: 'Intro' },
  { id: 'outro', label: 'Outro' },
  { id: 'echo', label: 'Echo Skill' },
  { id: 'tuneBreak', label: 'TuneBreak' }
]

const CORE_STATS: Array<[StatKey, string]> = [
  ['hp', 'HP'], ['atk', 'ATK'], ['def', 'DEF'], ['critRate', 'Crit. Rate'],
  ['critDamage', 'Crit. DMG'], ['energyRegen', 'Energy Regen']
]

const DAMAGE_STATS: Array<[StatKey, string]> = [
  ['basicDamage', 'Basic Attack'], ['heavyDamage', 'Heavy Attack'], ['skillDamage', 'Resonance Skill'],
  ['liberationDamage', 'Resonance Liberation'], ['healingBonus', 'Healing Bonus']
]

function resolvedMemberStat(member: TeamMemberModel, key: StatKey) {
  const fallback = member.conditionedStats?.[key]
    ?? (member.showcase ? member.showcase.finalStats[key as keyof typeof member.showcase.finalStats] : 0)
  const stats = member.resolvedStatsV2
  if (!stats) return fallback
  if (key === 'basicDamage') return stats.typeDamage.basic ?? 0
  if (key === 'heavyDamage') return stats.typeDamage.heavy ?? 0
  if (key === 'skillDamage') return stats.typeDamage.skill ?? 0
  if (key === 'liberationDamage') return stats.typeDamage.liberation ?? 0
  const direct = stats[key as keyof typeof stats]
  return typeof direct === 'number' ? direct : fallback
}

function resolvedMemberStatDetail(member: TeamMemberModel, key: StatKey, label: string) {
  if (!member.showcase) return sumDetail(label, 0, [])
  const baseDetail = showcaseStatDetail(member.showcase, key, label)
  const resolved = Number(resolvedMemberStat(member, key) ?? 0)
  const base = Number(member.conditionedStats?.[key]
    ?? member.showcase.finalStats[key as keyof typeof member.showcase.finalStats]
    ?? 0)
  if (!member.resolvedStatsV2 || Math.abs(resolved - base) < 1e-9) return baseDetail
  return sumDetail(`${label} with active team effects`, resolved, [
    { label: 'Equipment, skills, and self effects', value: base },
    { label: 'Active team effects', value: resolved - base }
  ])
}

const ELEMENT_COLORS: Record<string, string> = {
  Aero: '#73d9c6', Electro: '#a98bf5', Fusion: '#ef7662', Glacio: '#78bde8', Havoc: '#c06ddb', Spectro: '#e6c96b'
}

const ROTATION_CHART_COLORS = ['#8de4d4', '#e4bb5e', '#e78674', '#9d87de', '#69b9d7', '#c7d0cd', '#72b98c', '#d28db3']
const DAMAGE_TYPE_ORDER: DamageType[] = ['basic', 'heavy', 'skill', 'liberation', 'intro', 'outro', 'echo', 'healing']
const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  basic: 'Basic', heavy: 'Heavy', skill: 'Skill', liberation: 'Liberation',
  intro: 'Intro', outro: 'Outro', echo: 'Echo', healing: 'Healing'
}

const STAT_ICON_NAMES: Partial<Record<StatKey, string>> = {
  hp: 'Icon_Attribute_Health.webp',
  hpPercent: 'Icon_Attribute_Health.webp',
  atk: 'Icon_Attribute_Attack.webp',
  atkPercent: 'Icon_Attribute_Attack.webp',
  def: 'Icon_Attribute_Defense.webp',
  defPercent: 'Icon_Attribute_Defense.webp',
  critRate: 'Icon_Attribute_Crit_Rate.webp',
  critDamage: 'Icon_Attribute_Crit_DMG.webp',
  energyRegen: 'Icon_Attribute_Energy_Regen.webp',
  healingBonus: 'Icon_Attribute_Healing.webp',
  basicDamage: 'Icon_Basic_Attack_DMG_Amplification.webp',
  heavyDamage: 'Icon_Heavy_Attack_DMG_Amplification.webp',
  skillDamage: 'Icon_Resonance_Skill_DMG_Amplification.webp',
  liberationDamage: 'Icon_Resonance_Liberation_DMG_Amplification.webp',
  glacioDamage: 'Icon_Glacio_DMG_Bonus.webp',
  fusionDamage: 'Icon_Fusion_DMG_Bonus.webp',
  electroDamage: 'Icon_Electro_DMG_Bonus.webp',
  aeroDamage: 'Icon_Aero_DMG_Bonus.webp',
  spectroDamage: 'Icon_Spectro_DMG_Bonus.webp',
  havocDamage: 'Icon_Havoc_DMG_Bonus.webp'
}

function statIconSource(stat: StatKey) {
  return `https://wuwa-optimizer.com/images/icons/${STAT_ICON_NAMES[stat] ?? 'Icon_Attribute_Attack.webp'}`
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
const memberSectionFromRoute = (section?: TeamRouteSection): MemberSection => section === 'optimize' ? 'optimizer' : section === 'forte' || section === 'rotation' ? section : 'overview'
const memberSectionToRoute = (section: MemberSection): TeamRouteSection => section === 'optimizer' ? 'optimize' : section === 'forte' || section === 'rotation' ? section : 'overview'

function percent(value: number, total: number) {
  return total > 0 ? `${(value / total * 100).toFixed(1)}%` : '0.0%'
}

function teamMemberName(member: TeamMemberModel) {
  return member.catalog?.name ?? member.build?.name ?? `Member ${member.slot + 1}`
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
      <div><strong>Disclaimer</strong></div>
      <b>{warnings.length}</b>
    </header>}
    <div className="tw-warning-items">{warnings.map((warning) => <p key={warning}><i aria-hidden="true">!</i>{warning}</p>)}</div>
  </aside>
}

function SonataChips({ member }: { member: TeamMemberModel }) {
  return <div className="tw-chip-list">{member.showcase?.sonatas.length ? member.showcase.sonatas.map((sonata) =>
    <span className="tw-chip" key={sonata.name}>{sonata.iconSourceUrl && <img src={sonata.iconSourceUrl} alt=""/>}<b>{sonata.name}</b><small>{sonata.count}</small></span>
  ) : <span className="tw-chip muted">No Sonata coverage</span>}</div>
}

function TeamMemberColumn({ member, model, loadoutOptions, onOpen, onChooseCharacter, onAssign, onManage }: {
  member: TeamMemberModel
  model: TeamWorkspaceModel
  loadoutOptions: Array<{ value: string; label: string }>
  onOpen: () => void
  onChooseCharacter: () => void
  onAssign: (buildId: string) => Promise<void>
  onManage: () => void
}) {
  const buffs = [...member.receivedBuffs, ...member.appliedBuffs]
  const resultMode = model.team.calculationV2?.resultMode ?? model.team.scenario?.resultMode ?? 'expected'
  const currentSource = member.source ? (member.source.type === 'equipped' ? `equipped:${member.source.characterId}` : member.source.type === 'saved' ? `saved:${member.source.buildId}` : `theorycraft:${member.source.theorycraftBuildId}`) : ''
  const currentBuildLabel = loadoutOptions.find((option) => option.value === currentSource)?.label ?? 'Choose Build'
  return <article className={`tw-member-column ${member.build ? '' : 'is-empty'}`} style={member.catalog ? { '--tw-member-accent': ELEMENT_COLORS[member.catalog.element] ?? '#c8d0ce' } as CSSProperties : undefined}>
    {member.build
      ? <header className="tw-member-open" role="button" tabIndex={0} onClick={onChooseCharacter} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onChooseCharacter()
        }
      }} aria-label={`Open ${teamMemberName(member)}`}>
        {member.catalog?.iconSourceUrl && <img className="tw-member-heading-icon" src={member.catalog.iconSourceUrl} alt=""/>}
        <div><h3>{member.catalog?.name ?? 'Empty slot'}</h3></div>
        <button type="button" aria-label={`Remove ${member.catalog?.name ?? 'member'}`} onClick={(event) => { event.stopPropagation(); void onAssign('') }}>×</button>
      </header>
      : <label className="tw-empty-member-picker">
        <MemberAvatar member={member}/><div><span className="eyebrow">Member {member.slot + 1}</span><h3>Empty slot</h3><p>{loadoutOptions.length ? 'Choose a character and build' : 'Add an owned character first'}</p></div>
        <select value="" disabled={!loadoutOptions.length} onChange={(event) => void onAssign(event.target.value)} aria-label={`Add member ${member.slot + 1}`}>
          <option value="" disabled>{loadoutOptions.length ? 'Choose a build' : 'No builds available'}</option>
          {loadoutOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
      </label>}
    {member.build ? <>
      <button type="button" className="tw-member-build-row" onClick={onManage}><Icon name="build"/><b>{currentBuildLabel}</b><i aria-hidden="true">⌄</i></button>
      <section className="tw-member-showcase" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen() } }} aria-label={`Open ${teamMemberName(member)} character tab`}>
        {member.catalog?.portraitSourceUrl && <img src={member.catalog.portraitSourceUrl} alt=""/>}
        <div className="tw-member-showcase-copy">
          <span>{member.catalog?.element} · {member.catalog?.role}</span>
          <h3>{member.catalog?.name}</h3>
          <strong>Lv. {member.character?.level ?? member.build.level} / 90 <b>S{member.character?.sequence ?? 0}</b></strong>
        </div>
        <dl>
          {([
            ['atk', 'ATK'],
            ['critRate', 'Crit. Rate'],
            ['critDamage', 'Crit. DMG'],
            ['energyRegen', 'Energy Regen']
          ] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{formatWorkspaceStat(key, member.showcase?.finalStats[key] ?? 0)}</dd></div>)}
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
      <details className="tw-member-buffs">
        <summary><span>Team buffs</span><b>{buffs.length}</b><i aria-hidden="true">⌄</i></summary>
        <div>{buffs.length ? buffs.map((buff, index) => <div key={`${buff.id}-${index}`}>
          <span><small>{index < member.receivedBuffs.length ? 'Received' : 'Applied'}</small><strong>{buff.name}</strong></span>
          <b>{buff.stat === 'amplify' ? 'Amplify' : statLabels[buff.stat]} {buff.value}%</b>
        </div>) : <p>No active team buffs.</p>}</div>
      </details>
      <dl className="tw-mini-facts"><div><dt>Applied buffs</dt><dd>{member.appliedBuffs.length}</dd></div><div><dt>Received buffs</dt><dd>{member.receivedBuffs.length}</dd></div><div><dt>Rotation</dt><dd><CalculatedValue detail={sumDetail(`${teamMemberName(member)} rotation`, member.contribution, model.actions.filter((row) => row.member?.slot === member.slot).map((row) => ({ label: row.attack?.name ?? 'Action', value: row[resultMode] })))}>{formatDamage(member.contribution)}</CalculatedValue></dd></div><div><dt>Share</dt><dd><CalculatedValue detail={sumDetail(`${teamMemberName(member)} rotation share`, member.contributionPercent, [{ label: 'Member contribution', value: member.contribution }, { label: 'Team rotation', value: model.total }], 'Member contribution ÷ team rotation × 100')}>{percent(member.contribution, model.total)}</CalculatedValue></dd></div></dl>
      <div className="tw-progress"><span style={{ width: `${member.contributionPercent}%` }}/></div>
      <WarningList warnings={member.warnings} compact/>
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
  const members = workspace.members.map((member) => ({ slot: member.slot, build: member.build, character: member.character, catalog: member.catalog, weapon: member.showcase?.weapon?.owned, weaponEntry: member.showcase?.weapon?.catalog, equippedEchoes: member.showcase?.equippedEchoes ?? [] }))

  return <article className="tw-gallery-card">
    <header>
      <input aria-label={`Team name for ${team.name}`} value={name} onClick={(event) => event.stopPropagation()} onChange={(event) => setName(event.target.value)} onBlur={commitName} onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') { setName(team.name); event.currentTarget.blur() }
      }}/>
      <button className="tw-gallery-delete" aria-label={`Delete ${team.name}`} onClick={() => void onDelete()}><Icon name="trash"/></button>
    </header>
    <button type="button" className="tw-gallery-open" onClick={onOpen} aria-label={`Open ${team.name}`}>
      <span className="tw-gallery-members">{members.map(({ slot, build, character, catalog, weapon, weaponEntry, equippedEchoes }) => <span className={`tw-gallery-member ${catalog ? '' : 'empty'}`} key={slot} style={catalog ? { '--tw-card-element': ELEMENT_COLORS[catalog.element] ?? '#8de4d4' } as CSSProperties : undefined}>
        {catalog?.portraitSourceUrl && <img className="tw-gallery-portrait" src={catalog.portraitSourceUrl} alt=""/>}
        {catalog ? <>
          <span className="tw-gallery-character"><span><strong>{catalog.name}</strong><small>{build?.name ?? 'Saved build'}</small><em>Lv. {character?.level ?? build?.level ?? 1} · S{character?.sequence ?? 0}</em></span></span>
          <span className="tw-gallery-loadout">
            <span className="weapon">{weaponEntry?.iconSourceUrl && <img src={weaponEntry.iconSourceUrl} alt=""/>}<b>{weapon ? `${weapon.level}/90` : '—'}</b><small>{weapon ? `R${weapon.rank}` : 'No weapon'}</small></span>
            {Array.from({ length: 5 }, (_, index) => { const echo = equippedEchoes[index]; return <span key={echo?.id ?? index} className={echo ? '' : 'empty'}>{echo && echoArtwork(echo) && <img src={echoArtwork(echo)} alt=""/>}<b>{echo ? `+${echo.level}` : '+'}</b><small>{echo?.cost ?? '—'}</small></span> })}
          </span>
        </> : <span className="tw-gallery-empty-member"><span>+</span><strong>Empty member slot</strong></span>}
      </span>)}</span>
      <span className="tw-gallery-footer"><span>{team.buildIds.length}/3 members</span><span>{team.actions.length} rotation actions</span><b>Open team →</b></span>
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
  const [characterFilter, setCharacterFilter] = useState('all')
  const [query, setQuery] = useState('')
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
      <div><span className="eyebrow">Team archive</span><h1>Your teams</h1><p>Choose a team to open its full composition, member sheets, buffs, and rotation workspace.</p></div>
      <label><span>Character filter</span><CharacterFilterPicker value={characterFilter} options={characterOptions} onChange={setCharacterFilter}/></label>
      <label><span>Team name</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teams..."/></label>
      <button className="primary tw-gallery-create" onClick={() => void onCreate()}><Icon name="plus"/>Add team</button>
      <strong className="tw-gallery-count">Showing {visibleTeams.length} of {teams.length} teams</strong>
    </section>
    {visibleTeams.length ? <div className="tw-gallery-grid">{visibleTeams.map((team) => <TeamGalleryCard team={team} builds={builds} characters={characters} weapons={weapons} echoes={echoes} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} onOpen={() => onOpen(team.id)} onRename={(name) => onRename(team.id, name)} onDelete={() => onDelete(team)} key={team.id}/>)}</div>
      : <section className="tw-gallery-empty tw-panel"><span>{teams.length ? 'No matches' : 'No teams yet'}</span><h2>{teams.length ? 'Try another character or team name.' : 'Create your first team.'}</h2>{!teams.length && <button className="primary" onClick={() => void onCreate()}><Icon name="plus"/>Add team</button>}</section>}
  </div>
}

function TeamWorkspaceHeader({ team, teams, model, onBack, onSelect, onRename, onDelete }: {
  team: Team
  teams: Team[]
  model: TeamWorkspaceModel
  onBack: () => void
  onSelect: (teamId: string) => void
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
    <button type="button" className="tw-back-to-gallery" onClick={onBack}><span aria-hidden="true">←</span> All teams</button>
    <label className="tw-workspace-team-picker"><span>Workspace</span><select aria-label="Current team" value={team.id} onChange={(event) => onSelect(event.target.value)}>{teams.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
    <label className="tw-workspace-name"><span>Team name</span><input value={name} onChange={(event) => setName(event.target.value)} onBlur={commitName} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setName(team.name); event.currentTarget.blur() } }}/></label>
    <div className="tw-workspace-status" aria-label="Team status">
      <span><small>Ready</small><b>{readyMembers}/3</b></span>
      <span><small>Actions</small><b>{team.actions.length}</b></span>
      <span><small>Rotation</small><b>{formatDamage(model.total)}</b></span>
      <span><small>DPS</small><b>{formatDamage(model.dps)}</b></span>
      <span className={model.warnings.length ? 'has-warnings' : ''}><small>Warnings</small><b>{model.warnings.length}</b></span>
    </div>
    <button type="button" className="tw-workspace-delete" onClick={() => void onDelete()} aria-label={`Delete ${team.name}`}><Icon name="trash"/></button>
  </header>
}

const SKILL_SOURCE_LABELS: Record<TeamAttackGroup, string> = {
  basic: 'Basic Attack', skill: 'Resonance Skill', forte: 'Forte Circuit', liberation: 'Resonance Liberation',
  intro: 'Intro Skill', outro: 'Outro Skill', echo: 'Echo Skill', tuneBreak: 'Tune Break'
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

function TeamOverview({ model, echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds, refresh, updateTeam, openMember }: {
  model: TeamWorkspaceModel
  echoes: Echo[]
  builds: Build[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  equippedLoadouts: EquippedLoadout[]
  theorycraftBuilds: TheorycraftBuild[]
  refresh: () => Promise<void>
  updateTeam: (patch: Partial<Team>) => Promise<void>
  openMember: (slot: number) => void
}) {
  const [managingMemberSlot, setManagingMemberSlot] = useState<number>()
  const [choosingMemberSlot, setChoosingMemberSlot] = useState<number>()
  const resultMode = model.team.calculationV2?.resultMode ?? model.team.scenario?.resultMode ?? 'expected'
  const resultModeLabel = resultMode === 'expected' ? 'Average' : resultMode === 'normal' ? 'Non-crit' : 'Critical'
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
    const calculationV2 = model.team.calculationV2
    const keepBuildRecords = <T,>(records: Record<string, T> = {}) => Object.fromEntries(Object.entries(records).filter(([buildId]) => buildIds.includes(buildId)))
    await updateTeam({
      members, buildIds,
      actions: model.team.actions.filter((action) => buildIds.includes(action.buildId)),
      buffs: (model.team.buffs ?? []).filter((buff) => buildIds.includes(buff.sourceBuildId)),
      ...(scenario ? { scenario: { ...scenario, memberConditions: keepBuildRecords(scenario.memberConditions), selectedTargetByBuild: keepBuildRecords(scenario.selectedTargetByBuild), ...(scenario.compareBuildId && buildIds.includes(scenario.compareBuildId) ? {} : { compareBuildId: undefined }) } } : {}),
      ...(calculationV2 ? { calculationV2: { ...calculationV2, memberEffects: keepBuildRecords(calculationV2.memberEffects), partyEffects: keepBuildRecords(calculationV2.partyEffects), selectedAttackByBuild: keepBuildRecords(calculationV2.selectedAttackByBuild) } } : {})
    })
  }
  return <div className="tw-settings-page">
    <section className="tw-settings-intro tw-panel"><div><span className="eyebrow">Team configuration</span><h1>Composition and combat scenario</h1><p>Assign three saved builds, confirm their equipment, then define the enemy and rotation window used by Overview, Forte, Optimize and Rotation.</p></div><div><span><b>{model.team.buildIds.length}/3</b><small>members</small></span><span><b>{model.actions.length}</b><small>actions</small></span><span className={model.warnings.length ? 'has-warnings' : ''}><b>{model.warnings.length}</b><small>warnings</small></span></div></section>
    <details className="tw-environment-details tw-panel">
      <summary>
        <span className="tw-environment-summary">
          <strong className="tw-environment-title">Combat scenario</strong>
          <b className="rotation">{resultModeLabel} {formatDamage(model.total)}</b>
          <b className="dps">DPS {formatDamage(model.dps)}</b>
          <span>Enemy <strong>{model.team.enemy.level}</strong></span>
          <span>RES <strong>{model.team.enemy.resistance}%</strong></span>
          <span>DMG Red. <strong>{model.team.enemy.damageReduction}%</strong></span>
          <span>DEF Ignore <strong>{model.team.enemy.defenseIgnore ?? 0}%</strong></span>
          <span>DEF Red. <strong>{model.team.enemy.defenseReduction ?? 0}%</strong></span>
          <span>RES Ignore <strong>{model.team.enemy.resistanceIgnore ?? 0}%</strong></span>
          <span>RES Red. <strong>{model.team.enemy.resistanceReduction ?? 0}%</strong></span>
          <span>Special <strong>{model.team.enemy.specialMultiplier ?? 0}%</strong></span>
          <span>Duration <strong>{model.team.rotationDuration.toFixed(1)}s</strong></span>
        </span>
        <i aria-hidden="true">⌄</i>
      </summary>
      <section className="tw-metrics">
        <div><span>{resultModeLabel} rotation</span><CalculatedValue detail={sumDetail(`${resultModeLabel} rotation`, model.total, model.actions.map((row) => ({ label: `${row.action.timestamp.toFixed(1)}s · ${row.attack?.name ?? 'Missing attack'}`, value: row[resultMode] })))}><strong>{formatDamage(model.total)}</strong></CalculatedValue><small>Current supported formula</small></div>
        <div><span>Rotation DPS</span><CalculatedValue detail={sumDetail('Rotation DPS', model.dps, [{ label: `${resultModeLabel} rotation total`, value: model.total }, { label: 'Rotation duration', value: model.team.rotationDuration }], `${resultModeLabel} rotation ÷ rotation duration`)}><strong>{formatDamage(model.dps)}</strong></CalculatedValue><small>{model.team.rotationDuration.toFixed(1)} second window</small></div>
        <label><span>Enemy level</span><input type="number" min="1" max="200" value={model.team.enemy.level} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, level: Math.max(1, Math.min(200, Number(event.target.value))) } })}/></label>
        <label><span>Resistance %</span><input type="number" min="-100" max="100" value={model.team.enemy.resistance} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, resistance: Math.max(-100, Math.min(100, Number(event.target.value))) } })}/></label>
        <label><span>DMG reduction %</span><input type="number" min="0" max="100" value={model.team.enemy.damageReduction} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, damageReduction: Math.max(0, Math.min(100, Number(event.target.value))) } })}/></label>
        <label><span>DEF ignore %</span><input type="number" min="0" max="100" value={model.team.enemy.defenseIgnore ?? 0} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, defenseIgnore: Math.max(0, Math.min(100, Number(event.target.value))) } })}/></label>
        <label><span>DEF reduction %</span><input type="number" min="0" max="100" value={model.team.enemy.defenseReduction ?? 0} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, defenseReduction: Math.max(0, Math.min(100, Number(event.target.value))) } })}/></label>
        <label><span>RES ignore %</span><input type="number" min="0" max="100" value={model.team.enemy.resistanceIgnore ?? 0} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, resistanceIgnore: Math.max(0, Math.min(100, Number(event.target.value))) } })}/></label>
        <label><span>RES reduction %</span><input type="number" min="0" max="100" value={model.team.enemy.resistanceReduction ?? 0} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, resistanceReduction: Math.max(0, Math.min(100, Number(event.target.value))) } })}/></label>
        <label><span>Special multiplier %</span><input type="number" min="0" value={model.team.enemy.specialMultiplier ?? 0} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, specialMultiplier: Math.max(0, Number(event.target.value)) } })}/></label>
        <label><span>Duration</span><input type="number" min="1" max="600" step="0.1" value={model.team.rotationDuration} onChange={(event) => void updateTeam({ rotationDuration: Math.max(1, Math.min(600, Number(event.target.value))) })}/></label>
      </section>
    </details>

    <section className="tw-member-columns">{model.members.map((member) => { const memberOptions = member.character ? loadoutOptions.filter((option) => option.characterId === member.character?.id).map((option) => ({ ...option, label: option.shortLabel })) : loadoutOptions; return <TeamMemberColumn key={member.slot} member={member} model={model} loadoutOptions={memberOptions} onOpen={() => openMember(member.slot)} onChooseCharacter={() => setChoosingMemberSlot(member.slot)} onAssign={(source) => chooseMember(member.slot, source)} onManage={() => { if (member.character) setManagingMemberSlot(member.slot) }}/> })}</section>
    <WarningList warnings={model.warnings}/>
    {managingMemberSlot !== undefined && model.members[managingMemberSlot]?.character && <BuildManagementModal characterId={model.members[managingMemberSlot].character!.id} echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} refresh={refresh} onSelect={(source) => { const value = source.type === 'equipped' ? `equipped:${source.characterId}` : source.type === 'saved' ? `saved:${source.buildId}` : `theorycraft:${source.theorycraftBuildId}`; void chooseMember(managingMemberSlot, value); setManagingMemberSlot(undefined) }} onClose={() => setManagingMemberSlot(undefined)}/>} 
    {choosingMemberSlot !== undefined && <OwnedCharacterPicker characters={characters} onSelect={(character) => { void chooseMember(choosingMemberSlot, `equipped:${character.id}`); setChoosingMemberSlot(undefined) }} onClose={() => setChoosingMemberSlot(undefined)}/>} 
  </div>
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

function ForteDamageRows({ attacks, member, resultMode, skillName }: { attacks: ForteAttackGroup[]; member: TeamMemberModel; resultMode: 'normal' | 'expected' | 'critical'; skillName: string }) {
  if (!attacks.length) return null
  return <dl className="tw-skill-damage-rows">{attacks.map((attack) => {
    const calculationRows = attack.attackIds.flatMap((attackId) => member.calculationRowsV2.filter((row) => row.attack.id === attackId))
    const damage = calculationRows.reduce((total, row) => total + row.result[resultMode], 0)
    const detail = calculationRows.length === 1
      ? traceCalculationDetail(calculationRows[0].result.trace[resultMode], attack.name)
      : sumDetail(`${attack.name} · ${resultMode}`, damage, calculationRows.map((row, rowIndex) => ({ label: row.attack.name || String(rowIndex + 1), value: row.result[resultMode] })))
    const hitValues = calculationRows.flatMap((row) => row.result.instances.length
      ? row.result.instances.flatMap((instance) => {
          const resultScale = row.result.normal ? row.result[resultMode] / row.result.normal : 1
          return Array.from({ length: instance.count }, () => instance.normal * resultScale)
        })
      : [row.result[resultMode]])
    const label = attack.name.startsWith(`${skillName} - `) ? attack.name.slice(skillName.length + 3) : attack.name
    return <div key={`${attack.name}:${attack.type}`}><dt>{label}<small>{attack.type}{hitValues.length > 1 ? ` · ${hitValues.length}-hit sequence` : ''}</small></dt><dd><CalculatedValue detail={detail} presentation="tooltip" tooltipValues={hitValues.map(formatDamage)}><b>{calculationRows.length ? formatDamage(damage) : '—'}</b></CalculatedValue><small>{resultMode}</small></dd></div>
  })}</dl>
}

function normalizedEffectTarget(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function effectTargetsAttacks(effect: CalculationEffectDefinition, attacks: NonNullable<TeamMemberModel['calculationMechanicsV2']>['attacks']) {
  const attackTargets = attacks.flatMap((attack) => [attack.id, attack.key, attack.name]).map(normalizedEffectTarget).filter(Boolean)
  const effectTargets = [effect.key, effect.name].map(normalizedEffectTarget).filter((target) => target.length > 4)
  if (effectTargets.some((target) => attackTargets.some((attack) => target === attack || attack.includes(target)))) return true
  return effect.modifiers.some((modifier) => {
    const modifierTargets = [
      ...(modifier.modifySpecificTalents ?? []),
      ...(modifier.modifierTalentKey ? [modifier.modifierTalentKey] : [])
    ].map(normalizedEffectTarget).filter(Boolean)
    return modifierTargets.some((target) => attackTargets.some((attack) => target === attack || target.endsWith(attack) || attack.endsWith(target)))
  })
}

function effectMatchesPassive(effect: CalculationEffectDefinition, passiveName: string) {
  const passive = normalizedEffectTarget(passiveName)
  if (!passive) return false
  return normalizedEffectTarget(effect.name).includes(passive) || normalizedEffectTarget(effect.key).includes(passive)
}

function ForteWorkspace({ member, model, refresh, updateTeam }: { member: TeamMemberModel; model: TeamWorkspaceModel; refresh: () => Promise<void>; updateTeam: (patch: Partial<Team>) => Promise<void> }) {
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
  const resultMode = model.team.calculationV2?.resultMode ?? 'expected'
  const characterEffects = member.calculationEffectsV2.filter((effect) => effect.sourceKind === 'character' || effect.sourceKind === 'inherent')
  const skillEffects = new Map(skillEntries.map(({ key }) => [key, [] as CalculationEffectDefinition[]]))
  const assignedEffectIds = new Set<string>()
  skillEntries.forEach(({ key }) => {
    const group = key === 'normalAttack' ? 'Basic Attack'
      : key === 'resonanceSkill' ? 'Resonance Skill'
        : key === 'forteCircuit' ? 'Forte Circuit'
          : key === 'resonanceLiberation' ? 'Resonance Liberation'
            : key === 'introSkill' ? 'Intro Skill'
              : 'Outro Skill'
    const attacks = member.calculationMechanicsV2?.attacks.filter((attack) => attack.group === group) ?? []
    const matches = characterEffects.filter((effect) => !assignedEffectIds.has(effect.id) && effectTargetsAttacks(effect, attacks))
    matches.forEach((effect) => assignedEffectIds.add(effect.id))
    skillEffects.set(key, matches)
  })
  const passiveEffects = new Map(passiveCards.map((passive) => {
    const matches = characterEffects.filter((effect) => !assignedEffectIds.has(effect.id) && effectMatchesPassive(effect, passive.name))
    matches.forEach((effect) => assignedEffectIds.add(effect.id))
    return [`${passive.eyebrow}-${passive.name}`, matches] as const
  }))
  const generalEffects = characterEffects.filter((effect) => !assignedEffectIds.has(effect.id) && !/^Stat Bonus:/i.test(effect.name))
  const statBonusEffects = characterEffects.filter((effect) => !assignedEffectIds.has(effect.id) && /^Stat Bonus:/i.test(effect.name))
  const mainEcho = member.showcase.echoSlots[0]
  const mainEchoAttacks = member.attacks.filter((attack) => attack.group === 'echo')
  const mainEchoAttackGroups = [...mainEchoAttacks.reduce((groups, attack) => {
    const groupKey = `${attack.name}:${attack.type}`
    const existing = groups.get(groupKey)
    if (existing) {
      existing.multipliers.push(attack.multiplier)
      existing.attackIds.push(attack.id)
    } else groups.set(groupKey, { name: attack.name, type: attack.type, multipliers: [attack.multiplier], attackIds: [attack.id] })
    return groups
  }, new Map<string, ForteAttackGroup>()).values()]
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

  return <section className="tw-forte-workspace">
    <aside className="tw-sequence-column">
      <header><span>Sequence</span><b>S{member.character.sequence}</b></header>
      {member.catalog.sequenceIcons.slice(0, 6).map((sequence) => { const active = member.character!.sequence >= sequence.sequence; const sequenceEffects = member.calculationEffectsV2.filter((effect) => effect.sourceKind === 'sequence' && effect.sequence === sequence.sequence); return <article className={active ? 'unlocked' : ''} key={sequence.sequence}>
        <button type="button" className="tw-node-header" aria-pressed={active} onClick={() => void updateCharacter({ sequence: active ? sequence.sequence - 1 : sequence.sequence })}><img src={sequence.iconSourceUrl} alt=""/><span><strong>{sequence.name}</strong><small>Sequence Node {sequence.sequence}</small></span></button>
        <GameDescription value={sequence.description}/>
        <CalculationEffectControls effects={sequenceEffects} member={member} model={model} updateTeam={updateTeam} disabled={!active}/>
      </article>})}
    </aside>
    <div className="tw-skill-board">
      <CalculationStanceControl member={member} model={model} updateTeam={updateTeam}/>
      {generalEffects.length > 0 && <section className="tw-v2-character-effects"><header><span className="eyebrow">Character mechanics</span><h3>General skill effects</h3></header><CalculationEffectControls effects={generalEffects} member={member} model={model} updateTeam={updateTeam}/></section>}
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
        return <article className={`tw-skill-card skill-${key}`} key={key}>
          <header><span>{level === undefined ? 'Outro Skill' : `Skill Lv. ${level}`}</span></header>
          <div className="tw-skill-title"><img src={skill.iconSourceUrl} alt=""/><div><strong>{skill.name}</strong><small>{key.replace(/([A-Z])/g, ' $1')}</small></div></div>
          <CalculationEffectControls effects={skillEffects.get(key) ?? []} member={member} model={model} updateTeam={updateTeam}/>
          <div className="tw-skill-sections">{sectionBlocks.map((section, sectionIndex) => <section key={`${section.title}-${sectionIndex}`}>
            {section.title && <h3>{section.title}</h3>}
            {section.description && <GameDescription value={section.description}/>}
            {section.flatValues.length > 0 && <dl className="tw-flat-values">{section.flatValues.map((value) => {
              const valueIndex = Math.max(0, Math.min(value.values.length - 1, (level ?? 1) - 1))
              return <div key={value.id}><dt>{flatValueLabel(value.name, skill.name, section.title)}<small>Flat value</small></dt><dd>{value.values[valueIndex] ?? value.values[0] ?? '—'}</dd></div>
            })}</dl>}
            <ForteDamageRows attacks={section.attacks} member={member} resultMode={resultMode} skillName={skill.name}/>
          </section>)}</div>
        </article>
      })}</div>
      {mainEcho && <section className="tw-main-echo-attacks">
        <header><span><img src={echoArtwork(mainEcho)} alt=""/><span><small>Main Echo · Rarity {mainEcho.rarity}</small><h3>{mainEcho.name}</h3></span></span><b>Echo Skill</b></header>
        <p>Echo Skill actions are calculated from the main Echo's rarity and remain separate from the Resonator's character skills.</p>
        <ForteDamageRows attacks={mainEchoAttackGroups} member={member} resultMode={resultMode} skillName={mainEcho.name}/>
        {!mainEchoAttackGroups.length && <p className="tw-sheet-empty">No supported Echo Skill attack data is available.</p>}
      </section>}
      <div className="tw-passive-grid">{passiveCards.map((skill) => { const active = skill.id ? enabledNodeIds.includes(skill.id) : undefined; return <article className={`tw-passive-card ${active === true ? 'is-enabled' : active === false ? 'is-disabled' : ''}`} key={`${skill.eyebrow}-${skill.name}`}>
        {skill.id ? <button type="button" className="tw-skill-title tw-node-toggle" aria-pressed={active} onClick={() => void toggleNode(skill.id!)}><img src={skill.iconSourceUrl} alt=""/><span><strong>{skill.name}</strong><small>{skill.eyebrow}</small></span></button> : <div className="tw-skill-title"><img src={skill.iconSourceUrl} alt=""/><div><strong>{skill.name}</strong><small>{skill.eyebrow}</small></div></div>}
        <GameDescription value={skill.description}/>
        <CalculationEffectControls effects={passiveEffects.get(`${skill.eyebrow}-${skill.name}`) ?? []} member={member} model={model} updateTeam={updateTeam} disabled={active === false}/>
      </article>})}</div>
      {bonusNodes.length > 0 && <section className="tw-bonus-nodes"><header><span className="eyebrow">Skill tree</span><h3>Bonus stat nodes</h3></header><div>{bonusNodes.map((node) => { const active = enabledNodeIds.includes(node.id); return <article className={active ? 'is-enabled' : 'is-disabled'} key={node.id}><button type="button" className="tw-bonus-node-header" aria-pressed={active} onClick={() => void toggleNode(node.id)}><img src={node.iconSourceUrl} alt=""/><strong>{node.name}</strong></button><GameDescription value={node.description}/></article> })}</div><CalculationEffectControls effects={statBonusEffects} member={member} model={model} updateTeam={updateTeam}/></section>}
    </div>
  </section>
}

function TeamEchoCard({ echo, ownerName }: { echo: Echo; ownerName: string }) {
  const ownerCatalog = characterCatalog.find((candidate) => candidate.name === ownerName)
  const characterSubstatProfile = ownerCatalog ? resolveCharacterSubstatProfile(ownerCatalog) : undefined
  return <CharacterSubstatProfileContext.Provider value={characterSubstatProfile}>
    <EchoMiniCard
      echo={echo}
      rollRating={characterSubstatProfile ? undefined : echoRollRating(echo)}
      equipment={<EquippedCharacterLabel name={ownerName}/>}
    />
  </CharacterSubstatProfileContext.Provider>
}

function TraceBranch({ trace, depth = 0 }: { trace: CalculationTrace | CalculationTraceV2; depth?: number }) {
  return <li style={{ '--trace-depth': depth } as CSSProperties}><span>{trace.label}</span><b>{typeof trace.value === 'number' ? (depth === 0 ? Math.floor(trace.value + 1e-9).toLocaleString('en-US') : Number(trace.value).toLocaleString('en-US', { maximumFractionDigits: 3 })) : String(trace.value)}</b>{trace.children.length > 0 && <ul>{trace.children.map((child, index) => <TraceBranch trace={child} depth={depth + 1} key={`${'id' in child ? child.id : child.entryId ?? child.label}-${index}`}/>)}</ul>}</li>
}

function FormulaResultSheet({ member, model, updateTeam }: { member: TeamMemberModel; model: TeamWorkspaceModel; updateTeam: (patch: Partial<Team>) => Promise<void> }) {
  const [trace, setTrace] = useState<CalculationTraceV2 | null>(null)
  const scenario = model.team.calculationV2 ?? emptyCalculationScenarioV2()
  const mode = scenario.resultMode
  const buildId = member.build?.id ?? ''
  const echoRows = member.calculationRowsV2.filter((row) => row.attack.group === 'Echo Skill')
  const characterRows = member.calculationRowsV2.filter((row) => !echoRows.includes(row))
  const groups = [...new Set(characterRows.map((row) => row.attack.group))]
  const rowsByGroup = new Map(groups.map((group) => [group, characterRows.filter((row) => row.attack.group === group)]))
  const leftGroups = ['Basic Attack', 'Resonance Skill', 'Intro Skill'].filter((group) => rowsByGroup.has(group))
  const rightGroups = ['Forte Circuit', 'Resonance Liberation', 'Outro Skill'].filter((group) => rowsByGroup.has(group))
  const assignedGroups = new Set([...leftGroups, ...rightGroups, 'Tune Break'])
  const columnLength = (column: string[]) => column.reduce((total, group) => total + (rowsByGroup.get(group)?.length ?? 0) + 1, 0)
  for (const group of groups.filter((group) => !assignedGroups.has(group))) {
    (columnLength(leftGroups) <= columnLength(rightGroups) ? leftGroups : rightGroups).push(group)
  }
  if (rowsByGroup.has('Tune Break')) {
    (columnLength(leftGroups) <= columnLength(rightGroups) ? leftGroups : rightGroups).push('Tune Break')
  }
  const updateScenario = (patch: Partial<typeof scenario>) => updateTeam({ calculationV2: { ...scenario, ...patch } })
  const selectRow = (row: TeamMemberModel['calculationRowsV2'][number]) => {
    if (buildId) void updateScenario({ selectedAttackByBuild: { ...scenario.selectedAttackByBuild, [buildId]: row.attack.id } })
    setTrace(row.result.trace[mode])
  }
  const renderGroup = (group: string) => <article className="tw-sheet-column" key={group}>
    <header><span>{group}</span><small>{mode}</small></header>
    {rowsByGroup.get(group)?.map((row) => <button className={scenario.selectedAttackByBuild[buildId] === row.attack.id ? 'selected' : ''} onClick={() => selectRow(row)} key={row.attack.id}><span>{row.attack.name}<small>{row.attack.type}{row.attack.subtype ? ` · ${row.attack.subtype}` : ''}</small></span><b>{formatDamage(row.result[mode])}</b></button>)}
  </article>
  const partyEffects = member.calculationEffectsV2.filter((effect) => effect.sourceKind === 'party')
  return <>
    <section className="tw-formula-grid">
      <article className="tw-sheet-column tw-sheet-stats"><header><span>Basic Stats</span></header><dl>{CORE_STATS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{member.showcase ? <CalculatedValue detail={resolvedMemberStatDetail(member, key, label)}>{formatWorkspaceStat(key, resolvedMemberStat(member, key))}</CalculatedValue> : '—'}</dd></div>)}</dl><header><span>Bonus Stats</span></header><dl>{DAMAGE_STATS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{member.showcase ? <CalculatedValue detail={resolvedMemberStatDetail(member, key, label)}>{formatWorkspaceStat(key, resolvedMemberStat(member, key))}</CalculatedValue> : '—'}</dd></div>)}</dl></article>
      <div className="tw-sheet-results">
        <div className="tw-sheet-result-stack">{leftGroups.map(renderGroup)}</div>
        <div className="tw-sheet-result-stack">{rightGroups.map(renderGroup)}</div>
      </div>
      <aside className="tw-sheet-side"><article className="tw-sheet-column"><header><span>Received Team Buffs</span><small>Calculation V2</small></header><CalculationEffectControls effects={partyEffects} member={member} model={model} updateTeam={updateTeam}/>{!partyEffects.length && <p className="tw-sheet-empty">No teammate buffs are available for this member.</p>}</article><article className="tw-sheet-column"><header><span>Enemy</span><small title="Calculation V2 uses the imported GPL mechanics catalog.">V2 mechanics</small></header><label>Level<input type="number" min="1" max="200" value={model.team.enemy.level} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, level: Number(event.target.value) } })}/></label><label>Resistance %<input type="number" min="-100" max="100" value={model.team.enemy.resistance} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, resistance: Number(event.target.value) } })}/></label><label>Reduction %<input type="number" min="0" max="100" value={model.team.enemy.damageReduction} onChange={(event) => void updateTeam({ enemy: { ...model.team.enemy, damageReduction: Number(event.target.value) } })}/></label></article></aside>
    </section>
    {echoRows.length > 0 && <section className="tw-sheet-echo-attacks">
      <header><span><small>Main Echo attacks</small><strong>{member.showcase?.echoSlots[0]?.name ?? 'Echo Skill'}</strong></span><b>{mode}</b></header>
      <div>{echoRows.map((row) => <button className={scenario.selectedAttackByBuild[buildId] === row.attack.id ? 'selected' : ''} onClick={() => selectRow(row)} key={row.attack.id}><span><strong>{row.attack.name}</strong><small>Echo Skill · Rarity {member.showcase?.echoSlots[0]?.rarity ?? 1} · {row.attack.attribute.toUpperCase()} scaling</small></span><b>{formatDamage(row.result[mode])}</b></button>)}</div>
    </section>}
    {trace && <div className="tw-trace-backdrop" onMouseDown={() => setTrace(null)}><article className="tw-trace tw-panel" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">Calculation trace</span><h2>{trace.label}</h2></div><button className="close" onClick={() => setTrace(null)}>×</button></header><ul><TraceBranch trace={trace}/></ul></article></div>}
  </>
}

function MainEchoOverviewCard({ member, model, updateTeam }: { member: TeamMemberModel; model: TeamWorkspaceModel; updateTeam: (patch: Partial<Team>) => Promise<void> }) {
  const mainEcho = member.showcase?.echoSlots[0]
  const mechanics = member.mainEchoMechanicsV2
  const effects = member.calculationEffectsV2.filter((effect) => effect.sourceKind === 'echo')
  const rows = member.calculationRowsV2.filter((row) => row.attack.group === 'Echo Skill')
  const mode = model.team.calculationV2?.resultMode ?? 'expected'
  if (!mainEcho) return <article className="tw-main-echo-overview is-empty"><header><span className="eyebrow">Main Echo</span><h2>No main Echo</h2></header><p>Equip an Echo in slot 1 to add its active skill, damage and buffs.</p></article>
  return <article className="tw-main-echo-overview">
    <header className="tw-main-echo-identity"><img src={echoArtwork(mainEcho)} alt=""/><span><span className="eyebrow">Main Echo mechanics</span><h2>{mainEcho.name}</h2><small>Rarity {mainEcho.rarity} · Cost {mainEcho.cost} · +{mainEcho.level}{mechanics?.cooldown ? ` · ${mechanics.cooldown}s cooldown` : ''}</small></span></header>
    <section className="tw-main-echo-details"><header><h3>Details</h3><b>Echo Skill</b></header>
      {mechanics?.description ? <GameDescription value={mechanics.description}/> : <p>Structured description data is unavailable for this Echo; supported actions are shown below.</p>}
      <div className="tw-main-echo-damage-list">{rows.map((row) => <CalculatedValue detail={traceCalculationDetail(row.result.trace[mode], `${mainEcho.name} · ${row.attack.name}`)} key={row.attack.id}><span><span><strong>{row.attack.name}</strong><small>{row.attack.talents[String(mainEcho.rarity)] ?? row.attack.talents['1'] ?? 'Multiplier unavailable'} · {row.attack.attribute.toUpperCase()} scaling</small></span><b>{formatDamage(row.result[mode])}<small>{mode} DMG</small></b></span></CalculatedValue>)}</div>
      {!rows.length && <p>No supported Echo Skill damage action is available.</p>}
    </section>
    <section className="tw-main-echo-buffs"><header><h3>Stat boosts and buffs</h3><b>{effects.length}</b></header>
      <CalculationEffectControls effects={effects} member={member} model={model} updateTeam={updateTeam}/>
      {!effects.length && <p>No supported main-slot stat boost or cast buff is available.</p>}
    </section>
  </article>
}

function CharacterOverviewWorkspace({ member, model, updateTeam, weaponPassive }: {
  member: TeamMemberModel
  model: TeamWorkspaceModel
  updateTeam: (patch: Partial<Team>) => Promise<void>
  weaponPassive?: string
}) {
  if (!member.build || !member.catalog || !member.character || !member.showcase) return null
  const catalog = member.catalog
  const showcase = member.showcase

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
          <div>{Object.entries(member.catalog.skillIcons).map(([key, skill], index) => <span key={key}><img src={skill.iconSourceUrl} alt=""/><small>{showcase.skillLevels[index]}</small><b>{skill.name}</b></span>)}</div>
        </section>
        <section className="tw-overview-sequences">
          <header><span>Sequences</span><b>S{member.character.sequence}</b></header>
          <div>{member.catalog.sequenceIcons.slice(0, 6).map((sequence) => <span className={member.character!.sequence >= sequence.sequence ? 'unlocked' : ''} key={sequence.sequence} title={sequence.name}><img src={sequence.iconSourceUrl} alt=""/><b>S{sequence.sequence}</b></span>)}</div>
        </section>
        <section className="tw-overview-left-weapon">
          {showcase.weapon ? <article id="tw-overview-equipped-weapon" className={`owned-card weapon-owned rarity-${showcase.weapon.catalog.rarity}`}>
            <div className="owned-art"><div className="weapon-image-frame"><img src={showcase.weapon.catalog.iconSourceUrl} alt=""/><span className="weapon-level-rank">Lv. {showcase.weapon.owned.level} · R{showcase.weapon.owned.rank}</span><span className="weapon-rarity">{'★'.repeat(showcase.weapon.catalog.rarity)}</span></div></div>
            <div className="owned-copy weapon-owned-copy"><div className="weapon-card-heading"><h2>{showcase.weapon.catalog.name}</h2></div><div className="weapon-card-stats"><p><span>ATK</span><strong>{showcase.weapon.levelStats.baseAtk}</strong></p><p><span>{showcase.weapon.catalog.secondaryStat}</span><strong>{showcase.weapon.levelStats.secondaryStatValue}</strong></p></div><div className="weapon-card-equip"><span>Equipped by</span><strong>{member.catalog.name}</strong></div></div>
          </article> : <article id="tw-overview-equipped-weapon" className="tw-overview-gear-card"><p>No weapon equipped.</p></article>}
        </section>
        <article className="tw-overview-weapon-passive">
          <header><span className="eyebrow">Weapon passive</span><h2>{showcase.weapon?.catalog.passiveName ?? 'No weapon passive'}</h2></header>
          <p>{weaponPassive ?? 'Equip a supported weapon to display its generated passive text.'}</p>
          <CalculationEffectControls effects={member.calculationEffectsV2.filter((effect) => effect.sourceKind === 'weapon')} member={member} model={model} updateTeam={updateTeam}/>
        </article>
      </aside>

      <div className="tw-overview-right">
        <section className="tw-overview-loadout-strip">
          <a className="tw-overview-strip-weapon" href="#tw-overview-equipped-weapon">{showcase.weapon ? <><img src={showcase.weapon.catalog.iconSourceUrl} alt=""/><span><strong>{showcase.weapon.catalog.name}</strong><small>Lv. {showcase.weapon.owned.level} · R{showcase.weapon.owned.rank}</small><b>{showcase.weapon.levelStats.baseAtk} Base ATK</b></span></> : <p>No weapon equipped.</p>}</a>
          <div className="tw-overview-top-echoes">{showcase.echoSlots.map((echo, index) => <a className={echo ? '' : 'empty'} href={`#tw-overview-equipped-echo-${index}`} key={echo?.id ?? index}>
            {echo ? <><span className="tw-overview-top-echo-art"><img src={echoArtwork(echo)} alt=""/><b>{echo.cost}</b></span><span className="tw-overview-top-echo-copy"><span className="tw-overview-top-echo-identity"><b>{echo.name}</b><strong>+{echo.level}</strong></span><small className="tw-overview-top-echo-main">{statLabels[echo.mainStat.key]} <b>{formatWorkspaceStat(echo.mainStat.key, echo.mainStat.value)}</b></small><span className="tw-overview-top-echo-stats">{echo.subStats.slice(0, 3).map((stat, statIndex) => <small key={`${stat.key}-${statIndex}`}>{statLabels[stat.key]} <b>{formatWorkspaceStat(stat.key, stat.value)}</b></small>)}</span></span></> : <span className="tw-overview-top-echo-empty"><strong>+</strong><b>Empty Echo</b><small>Slot {index + 1}</small></span>}
          </a>)}</div>
        </section>
        <div className="tw-overview-formulas"><FormulaResultSheet member={member} model={model} updateTeam={updateTeam}/></div>
      </div>
    </section>

    <section className="tw-overview-equipment tw-panel">
      <aside>
        <article className="tw-overview-sonatas">
          <header><span className="eyebrow">Sonata effects</span><h2>Equipped sets</h2></header>
          <SonataChips member={member}/>
          <CalculationEffectControls effects={member.calculationEffectsV2.filter((effect) => effect.sourceKind === 'sonata')} member={member} model={model} updateTeam={updateTeam}/>
        </article>
        <MainEchoOverviewCard member={member} model={model} updateTeam={updateTeam}/>
      </aside>
      <div className="tw-overview-equipment-grid">
        {showcase.echoSlots.map((echo, index) => <div id={`tw-overview-equipped-echo-${index}`} className="cs-echo-tab-card" key={echo?.id ?? index}>{echo ? <TeamEchoCard echo={echo} ownerName={catalog.name}/> : <article className="detail-empty"><span>+</span><small>Empty Echo slot {index + 1}</small></article>}</div>)}
      </div>
    </section>
  </>
}

function MemberWorkspace({ member, model, section, setSection, updateTeam, echoes, builds, characters, weapons, openScanner, refresh, roverGender }: { member: TeamMemberModel; model: TeamWorkspaceModel; section: MemberSection; setSection: (section: MemberSection) => void; updateTeam: (patch: Partial<Team>) => Promise<void>; echoes: Echo[]; builds: Build[]; characters: OwnedCharacter[]; weapons: OwnedWeapon[]; openScanner: () => void; refresh: () => Promise<void>; roverGender: 'male' | 'female' }) {
  if (!member.build || !member.catalog || !member.character || !member.showcase) return <section className="tw-member-empty tw-panel"><MemberAvatar member={member}/><h2>Member {member.slot + 1} is empty</h2><p>Return to Team Settings and click the empty member card to add a saved build.</p></section>
  const isTeamTba = TEAM_TBA_CHARACTER_IDS.has(member.catalog.id)
  const showcase = member.showcase
  const weaponPassive = showcase.weapon?.catalog.passiveEffects[Math.max(0, (showcase.weapon?.owned.rank ?? 1) - 1)] ?? showcase.weapon?.catalog.passiveEffects[0]
  const scenario = model.team.scenario ?? { resultMode: 'expected' as const, memberConditions: {}, enemyConditions: {}, selectedTargetByBuild: {} }
  const calculationV2 = model.team.calculationV2 ?? emptyCalculationScenarioV2()
  const setResultMode = (resultMode: FormulaResultMode) => updateTeam({
    scenario: { ...scenario, resultMode },
    calculationV2: { ...calculationV2, resultMode }
  })
  return <div className={`tw-member-page section-${section}`} style={{ '--tw-member-accent': ELEMENT_COLORS[member.catalog.element] ?? '#c8d0ce' } as CSSProperties}>
    <nav className="tw-subnav" aria-label={`${member.catalog.name} sections`} role="tablist">
      {MEMBER_SECTIONS.map((item) => <button key={item.id} role="tab" className={section === item.id ? 'active' : ''} aria-selected={section === item.id} onClick={() => setSection(item.id)}>{item.label}</button>)}
      {!isTeamTba && <div className="tw-nav-result-modes" role="group" aria-label="Damage result mode">
        {DAMAGE_RESULT_MODES.map((mode) => <button type="button" aria-pressed={calculationV2.resultMode === mode.id} className={calculationV2.resultMode === mode.id ? 'active' : ''} key={mode.id} onClick={() => void setResultMode(mode.id)}>{mode.label}</button>)}
      </div>}
    </nav>
    {isTeamTba ? <section className="tw-member-empty tw-panel"><h2>TBA</h2></section>
      : section === 'overview' ? <CharacterOverviewWorkspace member={member} model={model} updateTeam={updateTeam} weaponPassive={weaponPassive}/>
      : section === 'rotation' ? <RotationWorkspace model={model} updateTeam={updateTeam} focusBuildId={member.build.id}/>
      : section === 'optimizer' ? <OptimizerView echoes={[...echoes, ...member.resolvedEchoes.filter((echo) => !echoes.some((owned) => owned.id === echo.id))]} builds={[...builds.filter((build) => build.id !== member.build!.id), member.build]} characters={characters} ownedWeapons={member.resolvedWeapon && !weapons.some((weapon) => weapon.id === member.resolvedWeapon?.id) ? [...weapons, member.resolvedWeapon] : weapons} refresh={refresh} openScanner={openScanner} buildId={member.build.id} teamBuildIds={model.members.flatMap((entry) => entry.character ? [entry.character.id] : [])} initialEnemy={model.team.enemy} damageMode={calculationV2.resultMode} scenario={scenario} calculationScenarioV2={calculationV2} calculationAttacksV2={member.calculationMechanicsV2?.attacks} partyEffectsV2={member.calculationEffectsV2.filter((effect) => effect.sourceKind === 'party')} partyEffectSourceStatsV2={model.sourceStatsV2} roverGender={roverGender}/>
      : <section className="tw-member-hero tw-panel forte-mode" style={{ '--tw-element': member.catalog.element.toLowerCase() } as CSSProperties}>
      <div className="tw-member-art"><img src={member.catalog.portraitSourceUrl || member.catalog.iconSourceUrl} alt=""/><div className="tw-sequence-rail">{member.catalog.sequenceIcons.slice(0, 6).map((sequence) => <span className={member.character && member.character.sequence >= sequence.sequence ? 'unlocked' : ''} key={sequence.sequence} title={sequence.name}><img src={sequence.iconSourceUrl} alt=""/><b>S{sequence.sequence}</b></span>)}</div><div><span>{member.catalog.element} · {member.catalog.weaponType}</span><h1>{member.catalog.name}</h1><p>{member.catalog.title}</p><strong>Lv. {member.character.level} · Sequence {member.character.sequence}</strong></div><EchoWaveform element={member.catalog.element}/></div>
      <div className="tw-member-summary">
        <ForteWorkspace member={member} model={model} refresh={refresh} updateTeam={updateTeam}/>
      </div>
    </section>}
    {!isTeamTba && <WarningList warnings={section === 'rotation' ? model.warnings : member.warnings}/>}
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
    const canonicalTeamRoute = target.id
    setShowGallery(false)
    if (route.team !== canonicalTeamRoute) {
      onRouteChange?.({ team: canonicalTeamRoute, character: route.character, section: route.section })
    }
    if (selectedId !== target.id) {
      setSelectedId(target.id)
      return
    }
    if (!route.character) {
      if (route.section === 'buffs' || route.section === 'theorizer' || route.section === 'rotation') setTab(route.section)
      else if (route.section === 'optimize') {
        const slot = (model?.members.find((member) => member.build)?.slot ?? 0) as 0 | 1 | 2
        setTab(slot)
        setMemberSection('optimizer')
      } else setTab('settings')
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
    const next: Team = { id: createLocalId(), name: `Team ${teams.length + 1}`, members: [], buildIds: [], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 20, actions: [], buffs: [], scenario: { resultMode: 'expected', memberConditions: {}, enemyConditions: {}, selectedTargetByBuild: {} }, calculationV2: emptyCalculationScenarioV2() }
    await db.teams.add(next); await refresh(); setSelectedId(next.id); setTab('settings'); setShowGallery(false)
    onRouteChange?.({ team: next.id })
  }

  const deleteGalleryTeam = async (target: Team) => {
    if (!confirm(`Delete ${target.name}? This removes its local rotation and authored buffs.`)) return
    await db.teams.delete(target.id)
    await refresh()
    if (selectedId === target.id) setSelectedId(teams.find((entry) => entry.id !== target.id)?.id ?? null)
  }

  const teamRouteId = team?.id
  const openTeam = (teamId: string) => {
    setSelectedId(teamId)
    setTab('settings')
    setShowGallery(false)
    onRouteChange?.({ team: teamId })
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

  if (showGallery) return <main className="team-workspace"><TeamGallery teams={teams} builds={builds} characters={characters} weapons={weapons} echoes={echoes} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} onCreate={createTeam} onOpen={openTeam} onRename={(teamId, name) => updateTeamById(teamId, { name })} onDelete={deleteGalleryTeam}/></main>

  return <main className="team-workspace">
    {model && team && <TeamWorkspaceHeader team={team} teams={teams} model={model} onBack={backToGallery} onSelect={openTeam} onRename={(name) => updateTeam({ name })} onDelete={deleteCurrentTeam}/>}
    <nav className="tw-primary-tabs" aria-label="Team workspace pages" role="tablist">
      <button role="tab" className={tab === 'settings' ? 'active' : ''} aria-selected={tab === 'settings'} onClick={() => { setTab('settings'); onRouteChange?.({ team: teamRouteId }) }}><span>Overview</span><small>Composition, builds and enemy</small></button>
      <button role="tab" className={tab === 'buffs' ? 'active' : ''} aria-selected={tab === 'buffs'} onClick={() => { setTab('buffs'); onRouteChange?.({ team: teamRouteId, section: 'buffs' }) }}><span>Buffs</span><small>Inputs, outputs and recipients</small></button>
      <button role="tab" className={tab === 'theorizer' ? 'active' : ''} aria-selected={tab === 'theorizer'} onClick={() => { setTab('theorizer'); onRouteChange?.({ team: teamRouteId, section: 'theorizer' }) }}><span>Theorizer</span><small>Constant-context what-if</small></button>
      <button role="tab" className={typeof tab === 'number' && memberSection === 'optimizer' ? 'active' : ''} aria-selected={typeof tab === 'number' && memberSection === 'optimizer'} onClick={() => { const slot = (model?.members.find((member) => member.build)?.slot ?? 0) as 0 | 1 | 2; setTab(slot); setMemberSection('optimizer'); onRouteChange?.({ team: teamRouteId, section: 'optimize' }) }}><span>Optimize</span><small>Search the selected member</small></button>
      <button role="tab" className={tab === 'rotation' ? 'active' : ''} aria-selected={tab === 'rotation'} onClick={() => { setTab('rotation'); onRouteChange?.({ team: teamRouteId, section: 'rotation' }) }}><span>Rotation</span><small>Presets, timeline and charts</small></button>
    </nav>
    {model && <nav className="tw-member-tabs" aria-label="Team members">{Array.from({ length: 3 }, (_, slot) => { const member = model.members[slot]; return <button type="button" className={tab === slot && memberSection !== 'optimizer' ? 'active' : ''} key={slot} onClick={() => openMemberRoute(slot as 0 | 1 | 2)}><MemberAvatar member={member} compact/><span><b>{member.catalog?.name ?? `Member ${slot + 1}`}</b><small>{member.build ? 'Character details' : 'Empty slot'}</small></span></button> })}</nav>}
    {!model ? <section className="tw-first-team tw-panel"><span className="eyebrow">No teams yet</span><h1>Start a team workspace</h1><p>Create a local team, assign up to three saved builds, and author its rotation without leaving this page.</p><button className="primary" onClick={() => void createTeam()}><Icon name="plus"/>Create team</button></section>
      : tab === 'settings' ? <TeamOverview model={model} echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} refresh={refresh} updateTeam={updateTeam} openMember={(slot) => openMemberRoute(slot as 0 | 1 | 2)}/>
        : tab === 'buffs' ? <BuffsWorkspace model={model} updateTeam={updateTeam}/>
          : tab === 'theorizer' ? <TheorizerWorkspace model={model} echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} roverGender={roverGender} refresh={refresh} updateTeam={updateTeam}/>
            : tab === 'rotation' ? <RotationWorkspace model={model} updateTeam={updateTeam}/>
        : <MemberWorkspace member={model.members[tab]} model={model} section={memberSection} setSection={setMemberSectionRoute} updateTeam={updateTeam} echoes={echoes} builds={builds} characters={characters} weapons={weapons} openScanner={openScanner} refresh={refresh} roverGender={roverGender}/>}
  </main>
}
