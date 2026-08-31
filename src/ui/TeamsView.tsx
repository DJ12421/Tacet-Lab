import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { formatDamage } from '../domain/damage'
import { resolveCharacterSubstatProfile } from '../domain/character-substat-score'
import { echoRollRating } from '../domain/echo-grade'
import { createLocalId } from '../domain/id'
import type { BuffEffect, Build, DamageType, Echo, EquippedLoadout, FormulaResultMode, LoadoutSourceRef, OwnedCharacter, OwnedWeapon, RotationAction, StatKey, Team, TheorycraftBuild } from '../domain/types'
import { characterCatalog, statLabels, weaponCatalog } from '../game-data'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import type { CalculationTrace } from '../domain/calculation'
import { emptyCalculationScenarioV2, resolveSourceScaledModifierValue, type CalculationEffectDefinition, type CalculationEffectSelection, type CalculationModifier, type CalculationSourceStats, type CalculationTraceV2 } from '../domain/calculation-v2'
import { db } from '../storage/database'
import { EchoWaveform } from './EchoWaveform'
import { richSkillDescription } from './CharacterShowcase'
import { CharacterSubstatProfileContext, EchoMiniCard, ElementFilterIcon, EquippedCharacterLabel, FilterChips, Icon } from './components'
import { Picker as CharacterPicker } from './CharacterInventoryView'
import { CalculatedValue, traceCalculationDetail } from './CalculationDetails'
import { showcaseStatDetail, sumDetail } from './calculation-detail-model'
import { OptimizerView } from './OptimizerView'
import { BuildsView } from './BuildsView'
import { TheorizerWorkspace } from './teams/TheorizerWorkspace'
import {
  echoArtwork, formatWorkspaceStat, resolveTeamWorkspace, teamBuffLabel,
  type TeamActionModel, type TeamAttackGroup, type TeamMemberModel, type TeamWorkspaceModel
} from './team-workspace-model'
import { defaultEnabledSkillTreeBonusIds, inherentSkillBonusId, skillTreeBonusId } from './character-showcase-model'
import './team-workspace.css'

type WorkspaceTab = 'settings' | 0 | 1 | 2
type MemberSection = 'overview' | 'forte' | 'optimizer' | 'theorizer' | 'rotation'
type TeamRouteSection = 'overview' | 'forte' | 'optimize' | 'theorizer' | 'rotation'

const MEMBER_SECTIONS: Array<{ id: MemberSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'forte', label: 'Forte' },
  { id: 'optimizer', label: 'Optimize' },
  { id: 'theorizer', label: 'Theorizer' },
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
const memberSectionFromRoute = (section?: TeamRouteSection): MemberSection => section === 'optimize' ? 'optimizer' : section ?? 'overview'
const memberSectionToRoute = (section: MemberSection): TeamRouteSection => section === 'optimizer' ? 'optimize' : section === 'forte' || section === 'theorizer' || section === 'rotation' ? section : 'overview'

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

function BuildManagementModal({ characterId, echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds, refresh, onSelect, onClose }: {
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
}) {
  return <div className="modal-backdrop tw-build-management-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="tw-build-management-modal" role="dialog" aria-modal="true" aria-label="Build Management">
      <header><div><Icon name="build"/><h2>Build Management</h2></div><button type="button" aria-label="Close build management" onClick={onClose}>×</button></header>
      <div className="tw-build-management-info"><b>ⓘ</b><span>This is the build currently equipped to your character. It represents in-game equipment and remains independent from saved and theorycraft builds.</span></div>
      <div className="tw-build-management-body"><BuildsView echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} refresh={refresh} embedded management characterId={characterId} onSelectSource={onSelect}/></div>
    </section>
  </div>
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
    <TeamBuffWorkspace model={model} updateTeam={updateTeam}/>
    <BuffWorkspace model={model} updateTeam={updateTeam}/>
    <WarningList warnings={model.warnings}/>
    {managingMemberSlot !== undefined && model.members[managingMemberSlot]?.character && <BuildManagementModal characterId={model.members[managingMemberSlot].character!.id} echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} refresh={refresh} onSelect={(source) => { const value = source.type === 'equipped' ? `equipped:${source.characterId}` : source.type === 'saved' ? `saved:${source.buildId}` : `theorycraft:${source.theorycraftBuildId}`; void chooseMember(managingMemberSlot, value); setManagingMemberSlot(undefined) }} onClose={() => setManagingMemberSlot(undefined)}/>} 
    {choosingMemberSlot !== undefined && <OwnedCharacterPicker characters={characters} onSelect={(character) => { void chooseMember(choosingMemberSlot, `equipped:${character.id}`); setChoosingMemberSlot(undefined) }} onClose={() => setChoosingMemberSlot(undefined)}/>} 
  </div>
}

function BuffWorkspace({ model, updateTeam }: { model: TeamWorkspaceModel; updateTeam: (patch: Partial<Team>) => Promise<void> }) {
  const buffs = model.team.buffs ?? []
  const updateBuff = (id: string, patch: Partial<BuffEffect>) => updateTeam({ buffs: buffs.map((buff) => buff.id === id ? { ...buff, ...patch } : buff) })
  const addBuff = async () => {
    const member = model.members.find((entry) => entry.build && entry.attacks.length)
    const attack = member?.attacks[0]
    if (!member?.build || !attack) return
    await updateTeam({ buffs: [...buffs, { id: createLocalId(), name: 'Team buff', sourceBuildId: member.build.id, target: 'team', triggerAttackId: attack.id, duration: 10, stat: 'atkPercent', value: 10, stackingGroup: createLocalId() }] })
  }
  return <details className="tw-panel tw-buff-workspace tw-advanced-modifiers">
    <summary><span><small>Advanced scenario tools</small><strong>Manual buffs and amplification</strong></span><b>{buffs.length} authored</b><i aria-hidden="true">⌄</i></summary>
    <div className="tw-advanced-modifiers-body"><header><div><span className="eyebrow">Advanced custom modifiers</span><h2>Manual buffs and amplification</h2><p>Built-in Calculation V2 effects are controlled beside their source. Add a row here only when you need to model a custom scenario that is not covered by the imported mechanics.</p></div><button className="secondary" onClick={() => void addBuff()} disabled={!model.members.some((member) => member.build && member.attacks.length)}><Icon name="plus"/>Add modifier</button></header>
    <div className="tw-buff-list">{buffs.map((buff) => {
      const source = model.members.find((member) => member.build?.id === buff.sourceBuildId)
      const attacks = source?.attacks ?? []
      return <div className="tw-buff-row" key={buff.id}>
        <label><span>Name</span><input value={buff.name} onChange={(event) => void updateBuff(buff.id, { name: event.target.value })}/></label>
        <label><span>Source</span><select value={buff.sourceBuildId} onChange={(event) => { const member = model.members.find((entry) => entry.build?.id === event.target.value); void updateBuff(buff.id, { sourceBuildId: event.target.value, triggerAttackId: member?.attacks[0]?.id ?? '' }) }}>{model.members.flatMap((member) => member.build ? [<option value={member.build.id} key={member.build.id}>{teamMemberName(member)}</option>] : [])}</select></label>
        <label><span>Trigger</span><select value={buff.triggerAttackId} onChange={(event) => void updateBuff(buff.id, { triggerAttackId: event.target.value })}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{attack.name}</option>)}</select></label>
        <label><span>Target</span><select value={buff.target} onChange={(event) => void updateBuff(buff.id, { target: event.target.value as BuffEffect['target'] })}><option value="self">Self</option><option value="next">Next member</option><option value="team">Team</option></select></label>
        <label><span>Effect</span><select value={buff.stat} onChange={(event) => void updateBuff(buff.id, { stat: event.target.value as BuffEffect['stat'] })}><option value="amplify">Amplification</option><option value="atkPercent">ATK %</option><option value="hpPercent">HP %</option><option value="defPercent">DEF %</option><option value="critRate">Crit. Rate</option><option value="critDamage">Crit. DMG</option><option value="basicDamage">Basic DMG</option><option value="heavyDamage">Heavy DMG</option><option value="skillDamage">Skill DMG</option><option value="liberationDamage">Liberation DMG</option><option value="healingBonus">Healing Bonus</option></select></label>
        <label><span>Value %</span><input type="number" value={buff.value} onChange={(event) => void updateBuff(buff.id, { value: Number(event.target.value) })}/></label>
        <label><span>Duration</span><input type="number" min="0" step="0.1" value={buff.duration} onChange={(event) => void updateBuff(buff.id, { duration: Math.max(0, Number(event.target.value)) })}/></label>
        <button className="tw-remove" aria-label={`Remove ${buff.name}`} onClick={() => void updateTeam({ buffs: buffs.filter((entry) => entry.id !== buff.id) })}><Icon name="trash"/></button>
      </div>
    })}{!buffs.length && <p className="tw-empty-state">No authored modifiers. The supported weapon, character, sequence, Sonata, Echo and teammate effects remain automatic or are controlled in their relevant member sections.</p>}</div>
    </div>
  </details>
}

function TeamBuffWorkspace({ model, updateTeam }: { model: TeamWorkspaceModel; updateTeam: (patch: Partial<Team>) => Promise<void> }) {
  const providers = model.members.filter((member) => member.build && member.outgoingEffectsV2.length)
  const effectCount = providers.reduce((total, member) => total + member.outgoingEffectsV2.length, 0)
  const setProviderEffects = (member: TeamMemberModel, enabled: boolean) => {
    if (!member.build) return
    const scenario = model.team.calculationV2 ?? emptyCalculationScenarioV2()
    const current = scenario.partyEffects[member.build.id] ?? {}
    const next = Object.fromEntries(member.outgoingEffectsV2.map((effect) => [effect.id, {
      ...current[effect.id],
      enabled: effect.alwaysEnabled || enabled,
      ...(effect.hasStacks && enabled ? { stacks: effect.maxStacks } : {}),
      ...(effect.scope === 'next' && !current[effect.id]?.recipientBuildId ? { recipientBuildId: model.members.find((entry) => entry.build && entry.build.id !== member.build!.id)?.build?.id } : {})
    }]))
    void updateTeam({ calculationV2: { ...scenario, partyEffects: { ...scenario.partyEffects, [member.build.id]: { ...current, ...next } } } })
  }
  return <section className="tw-panel tw-team-buffs">
    <header><div><span className="eyebrow">Team mechanics</span><h2>Team Buffs</h2><p>Configure every supported outgoing character, sequence, weapon, Sonata and Echo effect once at its source. The same state feeds Overview, Forte, Rotation and Optimize.</p></div><b>{effectCount} effects</b></header>
    <div className="tw-team-buff-providers">{providers.map((member) => {
      const buildId = member.build!.id
      const stats = model.sourceStatsV2[buildId]
      return <article className="tw-team-buff-provider" style={{ '--tw-member-accent': member.catalog ? ELEMENT_COLORS[member.catalog.element] ?? '#c8d0ce' : '#c8d0ce' } as CSSProperties} key={buildId}>
        <header><span>{member.catalog?.iconSourceUrl && <img src={member.catalog.iconSourceUrl} alt=""/>}<span><strong>{teamMemberName(member)}</strong><small>{member.outgoingEffectsV2.length} outgoing effects</small></span></span><div className="tw-team-buff-provider-tools">{stats && <dl><div><dt>ER</dt><dd>{stats.energyRegen.toFixed(1)}%</dd></div><div><dt>ATK</dt><dd>{Math.floor(stats.atk).toLocaleString('en-US')}</dd></div><div><dt>HP</dt><dd>{Math.floor(stats.hp).toLocaleString('en-US')}</dd></div></dl>}<span><button type="button" onClick={() => setProviderEffects(member, true)}>Enable all</button><button type="button" onClick={() => setProviderEffects(member, false)}>Clear</button></span></div></header>
        <CalculationEffectControls effects={member.outgoingEffectsV2} member={member} model={model} updateTeam={updateTeam}/>
      </article>
    })}{!providers.length && <p className="tw-empty-state">Assign supported builds to discover their outgoing team effects.</p>}</div>
  </section>
}

const ROTATION_DEFAULT_CLIP_DURATION = 0.8
const ROTATION_MIN_CLIP_DURATION = 0.1
const ROTATION_SNAP = 0.1

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
              : type === 'echo' ? 'Echo DMG' : 'Healing'
  const firstMember = model.members.find((entry) => entry.build && entry.attacks.length)
  const [draftBuildId, setDraftBuildId] = useState(focusBuildId ?? firstMember?.build?.id ?? '')
  const draftMember = model.members.find((entry) => entry.build?.id === draftBuildId) ?? firstMember
  const [draftAttackId, setDraftAttackId] = useState(draftMember?.attacks[0]?.id ?? '')
  const [draftTimestamp, setDraftTimestamp] = useState(Math.min(model.team.rotationDuration, Math.ceil((model.team.actions.at(-1)?.timestamp ?? -1) + 1)))
  const [draftDuration, setDraftDuration] = useState(ROTATION_DEFAULT_CLIP_DURATION)
  const [analysisMode, setAnalysisMode] = useState<'character' | 'type'>('character')
  const [timelineActions, setTimelineActions] = useState<RotationAction[]>(model.team.actions)
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([])
  const [timelineScale, setTimelineScale] = useState(56)
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
  const resultMode = model.team.calculationV2?.resultMode ?? model.team.scenario?.resultMode ?? 'expected'
  useEffect(() => { setTimelineActions(model.team.actions) }, [model.team.actions])
  useEffect(() => {
    if (!focusBuildId || !model.members.some((entry) => entry.build?.id === focusBuildId)) return
    setDraftBuildId(focusBuildId)
  }, [focusBuildId, model.members])
  useEffect(() => {
    if (!draftMember?.attacks.some((attack) => attack.id === draftAttackId)) setDraftAttackId(draftMember?.attacks[0]?.id ?? '')
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
    const next: RotationAction = { id: createLocalId(), timestamp: quickCreate.timestamp, duration: timelineClamp(ROTATION_DEFAULT_CLIP_DURATION, ROTATION_MIN_CLIP_DURATION, model.team.rotationDuration - quickCreate.timestamp), buildId: member.build.id, attackId: attack.id, formulaTargetId: member.catalog ? `${member.catalog.id}:${attack.id}` : undefined }
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
    if (!draftMember?.build || !attack) return
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
  const activeEffectCount = activeRows.reduce((total, row) => total + row.activeBuffs.length + row.activePartyEffectsV2.length + row.activeSelfEffectsV2.length + row.activates.length + row.activatesSelfEffectsV2.length, 0)
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
      const interval = { start, end, damage, stackBottom, memberIndex, actionIds: sources.map((source) => source.row.action.id), attackNames: sources.map((source) => source.row.attack?.name ?? 'Missing attack') }
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

  return <section className="tw-panel tw-rotation"><header><div><span className="eyebrow">Calculation V2 mechanics</span><h2>Rotation workspace</h2><p>Edit timing in the full-width timeline, then refine mechanics and review calculated damage below.</p></div></header>
    <section className="tw-sequencer" aria-label="Interactive rotation timeline">
      <header className="tw-sequencer-toolbar">
        <div className="tw-transport" role="group" aria-label="Playback controls">
          <button type="button" onClick={() => { setIsPlaying(false); setPlayhead(0) }} title="Return to start">|◀</button>
          <button type="button" className={isPlaying ? 'is-active' : ''} onClick={() => { if (playhead >= model.team.rotationDuration) setPlayhead(0); setIsPlaying((current) => !current) }} aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
          <span><b>{playhead.toFixed(2)}s</b><small>/ {model.team.rotationDuration.toFixed(1)}s</small></span>
        </div>
        <div className="tw-playback-readout" aria-live="polite"><span><small>Now</small><b>{activeRows.length ? activeRows.map((row) => row.attack?.name ?? 'Missing attack').join(' + ') : 'Ready'}</b></span><span><small>Active effects</small><b>{activeEffectCount}</b></span><span><small>Current DMG</small><b>{formatDamage(currentDamage)}</b></span></div>
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
            const laneHeight = Math.max(50, rowEnds.length * 34 + 12)
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
      <footer className="tw-sequencer-help"><span>Double-click empty track space to add an action.</span><span>Drag clips horizontally · trim either edge · Alt bypasses 0.1s snapping · drag-select across character tracks</span></footer>
      {quickCreate && (() => { const member = model.members.find((entry) => entry.build?.id === quickCreate.buildId); return <div className="tw-quick-create" role="dialog" aria-label="Add timeline action"><span><b>Add at {quickCreate.timestamp.toFixed(1)}s</b><small>{member ? teamMemberName(member) : 'Character'}</small></span><select autoFocus value={quickCreate.attackId} onChange={(event) => setQuickCreate({ ...quickCreate, attackId: event.target.value })}>{ROTATION_ATTACK_GROUPS.map((group) => { const attacks = member?.attacks.filter((attack) => attack.group === group.id) ?? []; return attacks.length ? <optgroup label={group.label} key={group.id}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{attack.name}</option>)}</optgroup> : null })}</select><button type="button" className="primary" disabled={!quickCreate.attackId} onClick={addQuickAction}>Add clip</button><button type="button" onClick={() => setQuickCreate(null)}>Cancel</button></div> })()}
      {timelineMenu && <div className="tw-timeline-menu" style={{ left: timelineMenu.x, top: timelineMenu.y }} role="menu"><button type="button" onClick={() => { copySelected(selectedActionIds.includes(timelineMenu.actionId) ? selectedActionIds : [timelineMenu.actionId]); setTimelineMenu(null) }}>Copy selection</button><button type="button" onClick={() => { duplicateSelected(selectedActionIds.includes(timelineMenu.actionId) ? selectedActionIds : [timelineMenu.actionId]); setTimelineMenu(null) }}>Duplicate</button><button type="button" onClick={() => { const ids = selectedActionIds.includes(timelineMenu.actionId) ? selectedActionIds : [timelineMenu.actionId]; commitActions(timelineActions.filter((action) => !ids.includes(action.id))); setSelectedActionIds([]); setTimelineMenu(null) }}>Delete</button></div>}
    </section>
    <div className="tw-rotation-layout">
      <section className="tw-rotation-editor" aria-label="Rotation editor">
        <div className="tw-rotation-sequence-head"><span>Play order</span><b>{model.actions.length} {model.actions.length === 1 ? 'action' : 'actions'}</b></div>
        <div className="tw-rotation-timeline">{model.actions.map((row, index) => {
          const value = row[resultMode]
          const trace = row.tracesV2?.[resultMode] ?? row.traces?.[resultMode]
          const partySelections = row.member?.build ? model.team.calculationV2?.partyEffects[row.member.build.id] ?? {} : {}
          const selectedPartyEffects = row.activePartyEffectsV2.filter((effect) => effect.alwaysEnabled || partySelections[effect.id]?.enabled)
          const effectCount = selectedPartyEffects.length + row.activeSelfEffectsV2.length + row.activeBuffs.length + row.activates.length + row.activatesSelfEffectsV2.length
          const multiplier = actionMultiplier(row.action)
          const dragTarget = cardDropTarget?.actionId === row.action.id
          return <article id={`rotation-action-${row.action.id}`} draggable className={`tw-rotation-card ${row.warnings.length ? 'is-invalid' : ''} ${selectedActionIds.includes(row.action.id) ? 'is-selected' : ''} ${activeActionIds.has(row.action.id) ? 'is-playing' : ''} ${draggedCardId === row.action.id ? 'is-dragging' : ''} ${dragTarget ? cardDropTarget.after ? 'drop-after' : 'drop-before' : ''}`} key={row.action.id} onClick={() => setSelectedActionIds([row.action.id])} onDragStart={(event: ReactDragEvent<HTMLElement>) => { setDraggedCardId(row.action.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', row.action.id) }} onDragOver={(event) => { event.preventDefault(); if (draggedCardId === row.action.id) return; const rect = event.currentTarget.getBoundingClientRect(); setCardDropTarget({ actionId: row.action.id, after: event.clientY >= rect.top + rect.height / 2 }) }} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedCardId; const rect = event.currentTarget.getBoundingClientRect(); if (sourceId) reorderActionCard(sourceId, row.action.id, event.clientY >= rect.top + rect.height / 2); setDraggedCardId(null); setCardDropTarget(null) }} onDragEnd={() => { setDraggedCardId(null); setCardDropTarget(null) }}>
            <div className="tw-rotation-marker"><b>{index + 1}</b><span>{row.action.timestamp.toFixed(1)}s</span></div>
            <div className="tw-rotation-card-main">
              <div className="tw-rotation-action-summary"><div><small>{row.member ? teamMemberName(row.member) : 'Unassigned'}</small><strong>{row.attack?.name ?? 'Missing attack'}</strong><span className="tw-action-tags">{row.attack && <><em className="forte">{forteGroupLabel(row.attack.group)}</em><em className="damage">{damageSourceLabel(row.attack.type)}</em></>}</span></div><label className="tw-action-multiplier" title="Repeat this action without adding duplicate cards" onClick={(event) => event.stopPropagation()}><b>×</b><input aria-label={`Action ${index + 1} repeat multiplier`} type="number" min="1" max="99" step="1" value={multiplier} onChange={(event) => void updateAction(row.action.id, { multiplier: Math.max(1, Math.min(99, Math.round(Number(event.target.value) || 1))) })}/></label><CalculatedValue detail={multiplier > 1 ? sumDetail(`${row.attack?.name ?? 'Action'} · ${resultMode}`, value, [{ label: `One action × ${multiplier}`, value: value / multiplier }]) : trace ? traceCalculationDetail(trace, `${row.attack?.name ?? 'Action'} · ${resultMode}`) : sumDetail(`${resultMode} damage`, value, [{ label: 'Calculated action', value }])}><strong className="tw-rotation-result"><small>{resultMode === 'expected' ? 'Avg DMG' : resultMode === 'normal' ? 'Non-crit' : 'Crit DMG'}</small>{formatDamage(value)}</strong></CalculatedValue></div>
              <details className="tw-rotation-action-editor"><summary>Edit action and mechanics <span>{effectCount ? `${effectCount} active effects` : 'No additional effects'}</span></summary><div>
                <div className="tw-rotation-action-fields"><label><span>Character</span><select aria-label={`Action ${index + 1} character`} value={row.action.buildId} onChange={(event) => { const member = model.members.find((entry) => entry.build?.id === event.target.value); const attackId = member?.attacks[0]?.id ?? ''; void updateAction(row.action.id, { buildId: event.target.value, attackId, formulaTargetId: member?.catalog ? `${member.catalog.id}:${attackId}` : undefined }) }}>{model.members.flatMap((member) => member.build ? [<option value={member.build.id} key={member.build.id}>{teamMemberName(member)}</option>] : [])}</select></label><label><span>Attack</span><select aria-label={`Action ${index + 1} attack`} value={row.attack?.id ?? row.action.attackId} onChange={(event) => void updateAction(row.action.id, { attackId: event.target.value, formulaTargetId: row.member?.catalog ? `${row.member.catalog.id}:${event.target.value}` : undefined })}>{ROTATION_ATTACK_GROUPS.map((group) => { const attacks = row.member?.attacks.filter((attack) => attack.group === group.id) ?? []; return attacks.length ? <optgroup label={group.label} key={group.id}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{attack.name}</option>)}</optgroup> : null })}</select></label><label><span>Time</span><input aria-label={`Action ${index + 1} timestamp`} type="number" min="0" max={model.team.rotationDuration} step="0.1" value={row.action.timestamp} onChange={(event) => void updateAction(row.action.id, { timestamp: Number(event.target.value) })}/></label><label><span>Duration</span><input aria-label={`Action ${index + 1} duration`} type="number" min={ROTATION_MIN_CLIP_DURATION} max={Math.max(ROTATION_MIN_CLIP_DURATION, model.team.rotationDuration - row.action.timestamp)} step="0.1" value={actionDuration(row.action, model.team.rotationDuration)} onChange={(event) => void updateAction(row.action.id, { duration: Number(event.target.value) })}/></label></div>
                <div className="tw-rotation-mechanics"><span className="tw-buff-state"><b>{row.activeSelfEffectsV2.length ? 'Active Main Echo buffs' : row.activeBuffs.length ? 'Active authored buffs' : selectedPartyEffects.length ? 'Selected team conditions' : 'No additional effects'}</b>{selectedPartyEffects.map((effect) => <small key={effect.id}>Selected: {effect.name}</small>)}{row.activeSelfEffectsV2.map((effect) => <small key={effect.id}>Main Echo: {effect.name}{effect.duration ? ` · ${effect.duration}s window` : ''}</small>)}{row.activeBuffs.map((buff) => <small key={buff.id}>{teamBuffLabel(buff)}</small>)}{row.activatesSelfEffectsV2.map((effect) => <small className="activates" key={effect.id}>Activates Main Echo buff{effect.duration ? ` until ${(row.action.timestamp + effect.duration).toFixed(1)}s` : ''}</small>)}{row.activates.map((buff) => <small className="activates" key={buff.id}>Activates {buff.name} until {(row.action.timestamp + buff.duration).toFixed(1)}s</small>)}</span><span className="tw-rotation-level">{row.attack?.group === 'echo' ? `Rarity ${row.attack.skillLevel}` : `Lv. ${row.attack?.skillLevel ?? '—'}`}<small>{row.attack?.scalesWith.toUpperCase() ?? '—'} scaling</small></span></div>
                <div className="tw-action-breakdown"><div><span>Non-crit <b>{formatDamage(row.normal)}</b></span><span>Average <b>{formatDamage(row.expected)}</b></span><span>Critical <b>{formatDamage(row.critical)}</b></span><span>Multiplier <b>{row.attack?.multiplierLabel ?? 'Missing'}</b></span></div></div>
              </div></details>
              {row.warnings.length > 0 && <p className="tw-action-warning">{row.warnings.join(' ')}</p>}
            </div>
            <div className="tw-rotation-card-actions"><button type="button" title="Move earlier" aria-label={`Move action ${index + 1} earlier`} disabled={index === 0} onClick={() => void moveAction(index, -1)}>↑</button><button type="button" title="Move later" aria-label={`Move action ${index + 1} later`} disabled={index === model.actions.length - 1} onClick={() => void moveAction(index, 1)}>↓</button><button type="button" title="Duplicate" aria-label={`Duplicate action ${index + 1}`} onClick={() => void duplicateAction(row)}>⧉</button><button type="button" title="Remove" className="tw-remove" aria-label={`Remove action ${index + 1}`} onClick={() => commitActions(timelineActions.filter((action) => action.id !== row.action.id))}><Icon name="trash"/></button></div>
          </article>
        })}{!model.actions.length && <p className="tw-empty-state">Choose the first action below to begin the rotation and populate the analysis.</p>}</div>
        <div className="tw-rotation-composer">
          <label><span>Character</span><select value={draftMember?.build?.id ?? ''} onChange={(event) => setDraftBuildId(event.target.value)}>{model.members.flatMap((member) => member.build ? [<option value={member.build.id} key={member.build.id}>{teamMemberName(member)}</option>] : [])}</select></label>
          <label><span>Attack</span><select value={draftAttackId} onChange={(event) => setDraftAttackId(event.target.value)}>{ROTATION_ATTACK_GROUPS.map((group) => { const attacks = draftMember?.attacks.filter((attack) => attack.group === group.id) ?? []; return attacks.length ? <optgroup label={group.label} key={group.id}>{attacks.map((attack) => <option value={attack.id} key={attack.id}>{attack.name}</option>)}</optgroup> : null })}</select></label>
          <label><span>Time</span><input type="number" min="0" max={model.team.rotationDuration} step="0.1" value={draftTimestamp} onChange={(event) => setDraftTimestamp(Number(event.target.value))}/></label>
          <label><span>Duration</span><input type="number" min={ROTATION_MIN_CLIP_DURATION} max={model.team.rotationDuration} step="0.1" value={draftDuration} onChange={(event) => setDraftDuration(Number(event.target.value))}/></label>
          <button className="primary" onClick={() => void addAction()} disabled={!draftMember?.build || !draftAttackId}><Icon name="plus"/>Add</button>
        </div>
      </section>

      <aside className="tw-rotation-analysis" aria-label="Rotation analysis">
        <div className="tw-rotation-kpis"><div><span>{resultMode === 'expected' ? 'Average rotation' : resultMode === 'normal' ? 'Non-crit rotation' : 'Critical rotation'}</span><CalculatedValue detail={sumDetail('Rotation total', rotationTotal, model.actions.map((row) => ({ label: `${row.action.timestamp.toFixed(1)}s · ${row.attack?.name ?? 'Missing attack'}`, value: row[resultMode] })))}><strong>{formatDamage(rotationTotal)}</strong></CalculatedValue></div><div><span>DPS</span><strong>{formatDamage(rotationTotal / Math.max(1, model.team.rotationDuration))}</strong></div><div><span>Window</span><strong>{model.team.rotationDuration.toFixed(1)}s</strong></div></div>
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

const EFFECT_MODIFIER_LABELS: Record<string, string> = {
  ATK: 'ATK', HP: 'HP', DEF: 'DEF', ATK_FLAT: 'ATK', ATK_FLAT2: 'ATK',
  Aero: 'Aero DMG', Electro: 'Electro DMG', Fusion: 'Fusion DMG', Glacio: 'Glacio DMG', Havoc: 'Havoc DMG', Spectro: 'Spectro DMG',
  AllElementAttributeBonus: 'All DMG', DMGBonus: 'DMG Bonus', CritRate: 'Crit Rate', CritDMG: 'Crit DMG', EnergyRegen: 'Energy Regen', HealingBonus: 'Healing Bonus',
  BasicAttackDMGBonus: 'Basic Attack DMG', HeavyAttackDMGBonus: 'Heavy Attack DMG', ResonanceSkillDMGBonus: 'Resonance Skill DMG',
  ResonanceLiberationDMGBonus: 'Resonance Liberation DMG', IntroSkillDMGBonus: 'Intro Skill DMG', OutroSkillDMGBonus: 'Outro Skill DMG',
  EchoDMGBonus: 'Echo DMG', CoordinatedDMGBonus: 'Coordinated Attack DMG', CounterAttackDMGBonus: 'Counterattack DMG',
  DEFIgnore: 'DEF Ignore', DefReduction: 'DEF Reduction', tuneBreakBoost: 'Tune Break DMG'
}

const HIDDEN_EFFECT_MODIFIERS = new Set([
  '', '(empty)', 'AppendAnotherTalent', 'EnableAttack', 'MultiplySelfBuff', 'Talent', 'talentModifierMultiply', 'talentModifierMultiplyAdd',
  'talentModifierMultiplySetValue', 'talentModifierSpecialMultiply', 'talentReplace', 'talentTypeOverride'
])

function readableEffectText(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\b(Song|Heart|Shadow|Reel|Wishes|Lamp)of\b/g, '$1 of')
    .replace(/\s+/g, ' ')
    .trim()
}

function effectModifierLabel(modifier: string) {
  const key = modifier.replace(/:AdditionalBase$/, '')
  if (HIDDEN_EFFECT_MODIFIERS.has(key)) return ''
  if (EFFECT_MODIFIER_LABELS[key]) return EFFECT_MODIFIER_LABELS[key]
  const [kind, ...scopeParts] = key.split(':')
  const scope = scopeParts.join(' ')
    .replace(/Basic\b/g, 'Basic Attack')
    .replace(/Heavy\b/g, 'Heavy Attack')
    .replace(/Skill\b/g, 'Resonance Skill')
    .replace(/Liberation\b/g, 'Resonance Liberation')
  if (kind === 'DMGDeepen') return scope ? `${scope} DMG Amplification` : 'DMG Amplification'
  if (kind === 'DEFIgnore') return scope ? `${scope} DEF Ignore` : 'DEF Ignore'
  if (kind === 'ResistIgnore') return scope ? `${scope} RES Ignore` : 'RES Ignore'
  if (kind === 'ResistShred') return scope ? `${scope} RES Reduction` : 'RES Reduction'
  if (kind === 'specialMultiplier') return scope ? `${scope} DMG Multiplier` : 'DMG Multiplier'
  if (kind === 'CritRate') return scope ? `${scope} Crit Rate` : 'Crit Rate'
  if (kind === 'CritDMG') return scope ? `${scope} Crit DMG` : 'Crit DMG'
  if (kind === 'CritOverflow') return 'Crit DMG from excess Crit Rate'
  if (kind === 'ForteBased') return `${scope || 'Forte'} DMG`
  return readableEffectText(key.replace(/:/g, ' '))
}

function effectModifierValue(modifier: CalculationModifier, selection: CalculationEffectSelection) {
  if (modifier.modifierByRefinement) return modifier.modifierByRefinement[String(Math.max(1, Math.min(5, selection.refinement ?? 1)))]
  if (typeof modifier.modifierValue === 'number' || typeof modifier.modifierValue === 'string') return Number(modifier.modifierValue)
  if (Array.isArray(modifier.modifierValue)) return Number(modifier.modifierValue[0])
  if (modifier.modifierValue && typeof modifier.modifierValue === 'object') return Number(Object.values(modifier.modifierValue)[0])
  return undefined
}

function conciseEffectRows(effect: CalculationEffectDefinition, selection: CalculationEffectSelection, sourceStats: CalculationSourceStats) {
  const stacks = effect.hasStacks ? Math.max(1, selection.stacks ?? effect.maxStacks) : 1
  const rows = effect.modifiers.flatMap((modifier, index) => {
    const key = modifier.modifier ?? ''
    const label = effectModifierLabel(key)
    const rawValue = effectModifierValue(modifier, selection)
    if (!label) return []
    if (rawValue === undefined || !Number.isFinite(rawValue)) return [{ key: `${key}-${index}`, label, value: '' }]
    const isFlat = effect.valueUnit === 'flat' || /^(?:ATK|HP|DEF)_FLAT/.test(key)
    const maximum = modifier.maximumValue
    const resolvedSourceValue = resolveSourceScaledModifierValue(effect, modifier, selection, sourceStats)
    const scaled = resolvedSourceValue !== undefined
      ? resolvedSourceValue
      : maximum !== undefined ? Math.min(rawValue * stacks, maximum) : rawValue * stacks
    const value = isFlat ? scaled : effect.valueUnit === 'decimal' ? scaled * 100 : scaled
    const rounded = Math.round(value * 100) / 100
    return [{
      key: `${key}-${index}`,
      label: `${modifier.modifierBasedOn && resolvedSourceValue === undefined && maximum !== undefined ? 'Up to ' : ''}${label}`,
      value: `${rounded >= 0 ? '+' : ''}${rounded}${isFlat ? '' : '%'}`
    }]
  })
  return effect.duration ? [...rows, { key: 'duration', label: 'Duration', value: `${effect.duration}s` }] : rows
}

function conciseEffectTitle(effect: CalculationEffectDefinition) {
  if (effect.sourceKind === 'sonata') return readableEffectText(effect.sourceId).replace(/\s+\d+\s+Set$/i, '')
  const rawName = effect.name.startsWith(effect.sourceId) ? effect.name.slice(effect.sourceId.length) : effect.name
  return readableEffectText(rawName)
    .replace(/^Stat Bonus:\s*/i, '')
    .replace(/^Sequence Node (\d+):\s*/i, '')
    .replace(/^Inherent Skill:\s*/i, '') || readableEffectText(effect.sourceId)
}

function conciseEffectBadge(effect: CalculationEffectDefinition) {
  if (effect.sourceKind === 'sonata') {
    const pieces = effect.sourceId.match(/(\d+)Set/i)?.[1]
    return pieces ? `${pieces}-Set` : 'Set'
  }
  if (effect.sourceKind === 'sequence' && effect.sequence) return `S${effect.sequence}`
  if (effect.sourceKind === 'party') return 'Team'
  if (effect.sourceKind === 'weapon') return 'Weapon'
  return ''
}

function conciseEffectCondition(effect: CalculationEffectDefinition) {
  if (effect.trigger) return `After ${readableEffectText(effect.trigger)}`
  return 'Apply this buff'
}

function conciseEffectContext(effect: CalculationEffectDefinition) {
  const setPieces = effect.sourceKind === 'sonata' ? effect.sourceId.match(/(\d+)Set/i)?.[1] : undefined
  return setPieces ? `${setPieces}-piece set` : ''
}

function CalculationEffectControls({ effects, member, model, updateTeam, disabled = false }: {
  effects: CalculationEffectDefinition[]
  member: TeamMemberModel
  model: TeamWorkspaceModel
  updateTeam: (patch: Partial<Team>) => Promise<void>
  disabled?: boolean
}) {
  const buildId = member.build?.id
  if (!buildId || !effects.length) return null
  const scenario = model.team.calculationV2 ?? emptyCalculationScenarioV2()
  const selectionFor = (effect: CalculationEffectDefinition): CalculationEffectSelection => {
    const isPartyEffect = effect.sourceKind === 'party' || Boolean(effect.sourceBuildId)
    const bucket = isPartyEffect ? scenario.partyEffects : scenario.memberEffects
    const ownerBuildId = isPartyEffect ? effect.sourceBuildId ?? buildId : buildId
    const defaults: CalculationEffectSelection = {
      enabled: effect.alwaysEnabled || /^Stat Bonus:/i.test(effect.name),
      ...(effect.hasStacks ? { stacks: effect.minStacks } : {}),
      ...(effect.scope === 'next' ? { recipientBuildId: model.members.find((entry) => entry.build && entry.build.id !== ownerBuildId)?.build?.id } : {}),
      ...(effect.sourceKind === 'weapon' ? { refinement: member.showcase?.weapon?.owned.rank ?? 1 } : {})
    }
    return {
      ...defaults,
      ...(bucket[ownerBuildId]?.[effect.id]
        ?? (effect.definitionId ? bucket[ownerBuildId]?.[effect.definitionId] : undefined)
        ?? bucket[buildId]?.[effect.id]
        ?? (effect.definitionId ? bucket[buildId]?.[effect.definitionId] : undefined)
        ?? {})
    }
  }
  const setEffect = (effect: CalculationEffectDefinition, patch: Partial<CalculationEffectSelection>) => {
    const isPartyEffect = effect.sourceKind === 'party' || Boolean(effect.sourceBuildId)
    const bucketKey = isPartyEffect ? 'partyEffects' : 'memberEffects'
    const bucket = scenario[bucketKey]
    const ownerBuildId = isPartyEffect ? effect.sourceBuildId ?? buildId : buildId
    void updateTeam({
      calculationV2: {
        ...scenario,
        [bucketKey]: {
          ...bucket,
          [ownerBuildId]: {
            ...bucket[ownerBuildId],
            [effect.id]: { ...selectionFor(effect), ...patch }
          }
        }
      }
    })
  }
  return <div className={`tw-v2-effect-list ${disabled ? 'is-disabled' : ''}`}>
    {effects.map((effect) => {
      const selection = selectionFor(effect)
      const fixed = effect.alwaysEnabled || /^Stat Bonus:/i.test(effect.name)
      const active = fixed || selection.enabled
      const context = conciseEffectContext(effect)
      const rows = conciseEffectRows(effect, selection, model.sourceStatsV2)
      const title = conciseEffectTitle(effect)
      const badge = conciseEffectBadge(effect)
      const condition = conciseEffectCondition(effect)
      const inlineToggle = !fixed && !effect.trigger
      const toggleEffect = () => setEffect(effect, {
        enabled: !active,
        ...(!active && effect.hasStacks && !(selection.stacks ?? 0) ? { stacks: effect.maxStacks } : {})
      })
      return <article className={fixed ? 'is-fixed' : active ? 'is-active' : 'is-inactive'} key={effect.id} title={effect.description || undefined}>
        <header className="tw-effect-copy"><span>{inlineToggle ? <button type="button" className="tw-effect-title-toggle" disabled={disabled} aria-label={`Toggle ${title}`} aria-pressed={active} onClick={toggleEffect}><i aria-hidden="true"/><strong>{title}</strong></button> : <strong>{title}</strong>}{context && <small>{context}</small>}</span>{badge && <b>{badge}</b>}</header>
        {((!fixed && Boolean(effect.trigger)) || (effect.hasStacks && active) || (effect.scope === 'next' && active)) && <div className="tw-effect-condition">
          {!fixed && !inlineToggle && <button type="button" className="tw-condition-toggle" disabled={disabled} aria-pressed={active} onClick={toggleEffect}><i aria-hidden="true"/><strong>{condition}</strong></button>}
          {effect.hasStacks && active && <label><span>Stacks</span><select disabled={disabled} value={selection.stacks ?? effect.minStacks} onChange={(event) => setEffect(effect, { enabled: true, stacks: Number(event.target.value) })}>{Array.from({ length: Math.max(1, effect.maxStacks - effect.minStacks + 1) }, (_, index) => effect.minStacks + index).map((stack) => <option value={stack} key={stack}>{stack}</option>)}</select><small>/{effect.maxStacks}</small></label>}
          {effect.scope === 'next' && active && <label><span>Recipient</span><select disabled={disabled} value={selection.recipientBuildId ?? ''} onChange={(event) => setEffect(effect, { enabled: true, recipientBuildId: event.target.value })}>{model.members.flatMap((entry) => entry.build && entry.build.id !== (effect.sourceBuildId ?? buildId) ? [<option value={entry.build.id} key={entry.build.id}>{teamMemberName(entry)}</option>] : [])}</select></label>}
        </div>}
        {active && rows.length > 0 && <dl className="tw-effect-results">{rows.map((row) => <div key={row.key}><dt className={member.catalog?.element && row.label.toLowerCase().includes(member.catalog.element.toLowerCase()) ? 'is-character-element' : ''}>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
      </article>
    })}
  </div>
}

function CalculationStanceControl({ member, model, updateTeam }: {
  member: TeamMemberModel
  model: TeamWorkspaceModel
  updateTeam: (patch: Partial<Team>) => Promise<void>
}) {
  const buildId = member.build?.id
  const mechanics = member.calculationMechanicsV2
  if (!buildId || !mechanics || mechanics.stances.length < 2) return null
  const scenario = model.team.calculationV2 ?? emptyCalculationScenarioV2()
  const effectId = `character:${mechanics.key}:stance`
  const current = String(scenario.memberEffects[buildId]?.[effectId]?.value ?? mechanics.stances[0])
  return <label className="tw-v2-stance"><span>Calculation stance</span><select value={current} onChange={(event) => void updateTeam({
    calculationV2: {
      ...scenario,
      memberEffects: {
        ...scenario.memberEffects,
        [buildId]: {
          ...scenario.memberEffects[buildId],
          [effectId]: { enabled: true, value: event.target.value }
        }
      }
    }
  })}>{mechanics.stances.map((stance) => <option value={stance} key={stance}>{stance}</option>)}</select></label>
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

function MemberWorkspace({ member, model, section, setSection, updateTeam, echoes, builds, equippedLoadouts, theorycraftBuilds, characters, weapons, openScanner, refresh, roverGender }: { member: TeamMemberModel; model: TeamWorkspaceModel; section: MemberSection; setSection: (section: MemberSection) => void; updateTeam: (patch: Partial<Team>) => Promise<void>; echoes: Echo[]; builds: Build[]; equippedLoadouts: EquippedLoadout[]; theorycraftBuilds: TheorycraftBuild[]; characters: OwnedCharacter[]; weapons: OwnedWeapon[]; openScanner: () => void; refresh: () => Promise<void>; roverGender: 'male' | 'female' }) {
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
      : section === 'theorizer' ? <TheorizerWorkspace member={member} model={model} echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} roverGender={roverGender} refresh={refresh}/>
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
    const next: Team = { id: createLocalId(), name: `Team ${teams.length + 1}`, members: [], buildIds: [], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 20, actions: [], buffs: [], scenario: { resultMode: 'expected', memberConditions: {}, enemyConditions: {}, selectedTargetByBuild: {} }, calculationV2: emptyCalculationScenarioV2() }
    await db.teams.add(next); await refresh(); setSelectedId(next.id); setTab('settings'); setShowGallery(false)
    onRouteChange?.({ team: `team_${teams.length + 1}` })
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

  if (showGallery) return <main className="team-workspace"><TeamGallery teams={teams} builds={builds} characters={characters} weapons={weapons} echoes={echoes} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} onCreate={createTeam} onOpen={openTeam} onRename={(teamId, name) => updateTeamById(teamId, { name })} onDelete={deleteGalleryTeam}/></main>

  return <main className="team-workspace">
    {model && team && <TeamWorkspaceHeader team={team} teams={teams} model={model} onBack={backToGallery} onSelect={openTeam} onRename={(name) => updateTeam({ name })} onDelete={deleteCurrentTeam}/>}
    <nav className="tw-primary-tabs" aria-label="Team workspace pages" role="tablist">
      <button role="tab" className={tab === 'settings' ? 'active' : ''} aria-selected={tab === 'settings'} onClick={() => { setTab('settings'); onRouteChange?.({ team: teamRouteId }) }}><span>Overview</span><small>Composition, builds and enemy</small></button>
      {Array.from({ length: 3 }, (_, slot) => { const member = model?.members[slot]; return <button role="tab" className={tab === slot ? 'active' : ''} aria-selected={tab === slot} key={slot} onClick={() => openMemberRoute(slot as 0 | 1 | 2)}><MemberAvatar member={member ?? { slot, attacks: [], contribution: 0, contributionPercent: 0, byType: {}, appliedBuffs: [], receivedBuffs: [], roles: [], warnings: [], resolvedEchoes: [] }} compact/><span>Member {slot + 1}</span><small>{member?.catalog?.name ?? 'Empty slot'}</small></button> })}
    </nav>
    {!model ? <section className="tw-first-team tw-panel"><span className="eyebrow">No teams yet</span><h1>Start a team workspace</h1><p>Create a local team, assign up to three saved builds, and author its rotation without leaving this page.</p><button className="primary" onClick={() => void createTeam()}><Icon name="plus"/>Create team</button></section>
      : tab === 'settings' ? <TeamOverview model={model} echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} refresh={refresh} updateTeam={updateTeam} openMember={(slot) => openMemberRoute(slot as 0 | 1 | 2)}/>
        : <MemberWorkspace member={model.members[tab]} model={model} section={memberSection} setSection={setMemberSectionRoute} updateTeam={updateTeam} echoes={echoes} builds={builds} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} characters={characters} weapons={weapons} openScanner={openScanner} refresh={refresh} roverGender={roverGender}/>}
  </main>
}
