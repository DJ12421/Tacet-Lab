import { calculateRotation } from '../domain/damage'
import { createBuildCalculationContext, FormulaCalculator, characterFormulaSheets, resolveFormulaTarget, type CalculationTrace, type FormulaTarget } from '../domain/calculation'
import type {
  AggregatedStats, AttackDefinition, BuffEffect, Build, DamageType, Echo, Element, EquippedLoadout, LoadoutSourceRef, OwnedCharacter,
  OwnedWeapon, Resonator, RotationAction, StatKey, StatLine, Team, TheorycraftBuild, Weapon
} from '../domain/types'
import { resolveLoadout } from '../domain/loadouts'
import {
  characterCatalog, echoCatalog, isFixedSkillValueName, sonataCatalog, statLabels, weaponCatalog,
  type CharacterCatalogEntry
} from '../game-data'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import {
  resolveCharacterShowcaseModel, weaponSecondaryStat,
  type CharacterShowcaseModel
} from './character-showcase-model'

const ELEMENTS: Record<string, Element> = {
  aero: 'aero', electro: 'electro', fusion: 'fusion', glacio: 'glacio', havoc: 'havoc', spectro: 'spectro'
}

const SKILL_KEYS = ['normalAttack', 'resonanceSkill', 'forteCircuit', 'resonanceLiberation', 'introSkill'] as const
export type TeamAttackGroup = 'basic' | 'skill' | 'forte' | 'liberation' | 'intro' | 'outro' | 'echo' | 'tuneBreak'

export interface TeamWorkspaceInput {
  team: Team
  builds: Build[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  echoes: Echo[]
  equippedLoadouts?: EquippedLoadout[]
  theorycraftBuilds?: TheorycraftBuild[]
  roverGender?: 'male' | 'female'
}

export interface TeamAttackModel {
  id: string
  name: string
  type: DamageType
  multiplier: number
  multiplierLabel: string
  hitMultipliers: number[]
  scalesWith: 'atk' | 'hp' | 'def'
  skillLevel: number
  skillName: string
  iconSourceUrl: string
  group: TeamAttackGroup
}

export interface TeamMemberModel {
  slot: number
  source?: LoadoutSourceRef
  build?: Build
  character?: OwnedCharacter
  catalog?: CharacterCatalogEntry
  showcase?: CharacterShowcaseModel
  attacks: TeamAttackModel[]
  contribution: number
  contributionPercent: number
  byType: Partial<Record<DamageType, number>>
  appliedBuffs: BuffEffect[]
  receivedBuffs: BuffEffect[]
  roles: string[]
  warnings: string[]
  formulaRows: TeamFormulaRow[]
  conditionedStats?: AggregatedStats
  resolvedEchoes: Echo[]
  resolvedWeapon?: OwnedWeapon
  comparisonSource?: LoadoutSourceRef
  comparisonShowcase?: CharacterShowcaseModel
}

export interface TeamFormulaRow {
  target: FormulaTarget
  normal: number
  critical: number
  expected: number
  traces: Record<'normal' | 'critical' | 'expected', CalculationTrace>
}

export interface TeamActionModel {
  action: RotationAction
  member?: TeamMemberModel
  attack?: TeamAttackModel
  normal: number
  critical: number
  expected: number
  activeBuffs: BuffEffect[]
  activates: BuffEffect[]
  warnings: string[]
  trace?: CalculationTrace
  traces?: Record<'normal' | 'critical' | 'expected', CalculationTrace>
  formulaTargetId?: string
}

export interface SonataCoverageModel {
  name: string
  pieces: number
  activeThresholds: number[]
  description: string
  iconSourceUrl: string
}

export interface TeamWorkspaceModel {
  team: Team
  members: [TeamMemberModel, TeamMemberModel, TeamMemberModel]
  total: number
  dps: number
  actions: TeamActionModel[]
  byType: Partial<Record<DamageType, number>>
  sonatas: SonataCoverageModel[]
  roles: string[]
  introCount: number
  outroCount: number
  warnings: string[]
}

function elementFor(catalog: CharacterCatalogEntry): Element {
  return ELEMENTS[catalog.element.toLowerCase()] ?? 'spectro'
}

function runtimeAttack(catalog: CharacterCatalogEntry, character: OwnedCharacter, index: number): AttackDefinition {
  const attack = catalog.attacks[index]
  const skillLevel = Math.max(1, Math.min(attack.multipliers.length, character.skillLevels?.[attack.skillLevelIndex] ?? 1))
  return {
    id: attack.id,
    name: attack.name,
    type: attack.type,
    element: elementFor(catalog),
    multiplier: attack.multipliers[skillLevel - 1] ?? 0,
    hits: 1,
    scalesWith: attack.scalesWith
  }
}

function attackModels(catalog: CharacterCatalogEntry, character: OwnedCharacter): TeamAttackModel[] {
  return catalog.attacks.flatMap((attack, index) => {
    if (isFixedSkillValueName(attack.name)) return []
    const level = Math.max(1, Math.min(attack.multipliers.length, character.skillLevels?.[attack.skillLevelIndex] ?? 1))
    const isTuneBreak = Boolean(catalog.skillTreeExtras.tuneBreakSkill.name)
      && attack.name.toLowerCase().startsWith(catalog.skillTreeExtras.tuneBreakSkill.name.toLowerCase())
    const group: TeamAttackGroup = attack.type === 'outro' ? 'outro'
      : isTuneBreak ? 'tuneBreak'
        : attack.skillLevelIndex === 0 ? 'basic'
          : attack.skillLevelIndex === 1 ? 'skill'
            : attack.skillLevelIndex === 2 ? 'forte'
              : attack.skillLevelIndex === 3 ? 'liberation' : 'intro'
    const skill = group === 'outro' ? catalog.skillTreeExtras.outroSkill
      : group === 'tuneBreak' ? catalog.skillTreeExtras.tuneBreakSkill
        : catalog.skillIcons[SKILL_KEYS[attack.skillLevelIndex] ?? 'forteCircuit']
    return [{
      id: attack.id,
      name: attack.name,
      type: attack.type,
      multiplier: attack.multipliers[level - 1] ?? 0,
      multiplierLabel: `${((attack.multipliers[level - 1] ?? 0) * 100).toFixed(2)}%`,
      hitMultipliers: attack.hitMultipliers?.map((hit) => hit[level - 1] ?? 0) ?? [attack.multipliers[level - 1] ?? 0],
      scalesWith: attack.scalesWith,
      skillLevel: level,
      skillName: skill.name,
      iconSourceUrl: skill.iconSourceUrl,
      group
    }]
  })
}

function runtimeWeapon(build: Build, weapons: OwnedWeapon[]): Weapon | undefined {
  const owned = weapons.find((weapon) => weapon.id === build.weaponId)
  const catalog = weaponCatalog.find((weapon) => weapon.id === owned?.catalogId)
  if (!owned || !catalog || !catalog.levelStats.length) return undefined
  const levelStats = catalog.levelStats.reduce((nearest, row) =>
    Math.abs(row.level - owned.level) < Math.abs(nearest.level - owned.level) ? row : nearest
  )
  return {
    id: owned.id,
    name: catalog.name,
    type: catalog.type.toLowerCase() as Weapon['type'],
    baseAtk: levelStats.baseAtk,
    stat: weaponSecondaryStat(catalog, levelStats.secondaryStatValue)
  }
}

function runtimeResonator(catalog: CharacterCatalogEntry, character: OwnedCharacter): Resonator {
  const levelStats = catalog.levelStats.reduce((nearest, row) =>
    Math.abs(row.level - character.level) < Math.abs(nearest.level - character.level) ? row : nearest
  )
  return {
    id: catalog.id,
    name: catalog.name,
    element: elementFor(catalog),
    role: catalog.role,
    accent: '',
    baseStats: {
      hp: levelStats.hp,
      atk: levelStats.atk,
      def: levelStats.def,
      critRate: catalog.baseStats.critRate,
      critDamage: catalog.baseStats.critDamage
    },
    attacks: catalog.attacks.flatMap((attack, index) => isFixedSkillValueName(attack.name) ? [] : [runtimeAttack(catalog, character, index)])
  }
}

function inferRoles(catalog: CharacterCatalogEntry | undefined, attacks: TeamAttackModel[]) {
  if (!catalog) return []
  const source = `${catalog.role} ${catalog.description}`.toLowerCase()
  const roles = new Set<string>()
  if (attacks.some((attack) => attack.type !== 'healing')) roles.add('Field DPS')
  if (source.includes('coordinated')) roles.add('Coordinated damage')
  if (attacks.some((attack) => attack.type === 'healing') || source.includes('heal')) roles.add('Healing')
  if (source.includes('support') || source.includes('concerto') || source.includes('amplif')) roles.add('Support')
  return [...roles]
}

function buffAppliesTo(effect: BuffEffect, member: TeamMemberModel) {
  if (!member.build) return false
  return effect.target === 'team'
    || (effect.target === 'self' && effect.sourceBuildId === member.build.id)
    || (effect.target === 'next' && effect.sourceBuildId !== member.build.id)
}

function activeBuffsAt(team: Team, sortedActions: RotationAction[], currentIndex: number) {
  const active: Array<{ effect: BuffEffect; activatedAt: number }> = []
  const currentTimestamp = sortedActions[currentIndex]?.timestamp ?? 0
  for (let index = 0; index < currentIndex; index += 1) {
    const action = sortedActions[index]
    // Actions at one timestamp are atomic: they cannot activate or consume an
    // effect for another action in the same group.
    if (action.timestamp >= currentTimestamp) continue
    for (let activeIndex = active.length - 1; activeIndex >= 0; activeIndex -= 1) {
      if (action.timestamp > active[activeIndex].activatedAt + active[activeIndex].effect.duration) active.splice(activeIndex, 1)
    }
    for (const effect of team.buffs ?? []) {
      if (effect.sourceBuildId === action.buildId && effect.triggerAttackId === action.attackId) active.push({ effect, activatedAt: action.timestamp })
    }
    for (let activeIndex = active.length - 1; activeIndex >= 0; activeIndex -= 1) {
      if (active[activeIndex].effect.target === 'next' && active[activeIndex].effect.sourceBuildId !== action.buildId) active.splice(activeIndex, 1)
    }
  }
  return active.filter((entry) => currentTimestamp <= entry.activatedAt + entry.effect.duration).map((entry) => entry.effect)
}

export function formatWorkspaceStat(key: StatKey, value: number) {
  return key === 'hp' || key === 'atk' || key === 'def'
    ? Math.floor(value + 1e-9).toLocaleString('en-US')
    : `${value.toFixed(1)}%`
}

export function teamBuffLabel(effect: BuffEffect) {
  const stat = effect.stat === 'amplify' ? 'Amplification' : statLabels[effect.stat]
  return `${effect.name} · ${effect.value.toFixed(1)}% ${stat}`
}

export function resolveTeamWorkspace(input: TeamWorkspaceInput): TeamWorkspaceModel {
  const collections = { builds: input.builds, characters: input.characters, weapons: input.weapons, echoes: input.echoes, equippedLoadouts: input.equippedLoadouts ?? [], theorycraftBuilds: input.theorycraftBuilds ?? [] }
  const resolvedMembers = Array.from({ length: 3 }, (_, slot) => {
    const member = input.team.members?.[slot]
    const legacyBuildId = input.team.buildIds[slot]
    const source: LoadoutSourceRef | undefined = member?.loadoutSource ?? (legacyBuildId ? { type: 'saved', buildId: legacyBuildId } : undefined)
    return source ? resolveLoadout(source, collections, member?.memberId ?? legacyBuildId) : undefined
  })
  const resolvedComparisons = Array.from({ length: 3 }, (_, slot) => {
    const member = input.team.members?.[slot]
    return member?.compareSource ? resolveLoadout(member.compareSource, collections, `compare:${member.memberId}`) : undefined
  })
  const allResolved = [...resolvedMembers, ...resolvedComparisons]
  const runtimeOwnedWeapons = [...input.weapons, ...allResolved.flatMap((entry) => entry?.weapon && !input.weapons.some((weapon) => weapon.id === entry.weapon?.id) ? [entry.weapon] : [])]
  const runtimeEchoes = [...input.echoes, ...allResolved.flatMap((entry) => entry?.echoes.filter((echo) => !input.echoes.some((owned) => owned.id === echo.id)) ?? [])]
  const runtimeBuilds = resolvedMembers.flatMap((entry) => entry?.build ? [entry.build] : [])
  const baseMembers = Array.from({ length: 3 }, (_, slot): TeamMemberModel => {
    const resolved = resolvedMembers[slot]
    const build = resolved?.build
    const catalog = characterCatalog.find((entry) => entry.id === build?.resonatorId)
    const character = resolved?.character
    const showcase = character && catalog
      ? resolveCharacterShowcaseModel({ character, catalog, weapons: runtimeOwnedWeapons, echoes: runtimeEchoes, builds: build ? [build] : [] })
      : undefined
    const comparison = resolvedComparisons[slot]
    const comparisonShowcase = comparison?.build && character && catalog
      ? resolveCharacterShowcaseModel({ character, catalog, weapons: runtimeOwnedWeapons, echoes: runtimeEchoes, builds: [comparison.build] }) : undefined
    const attacks = catalog && character ? attackModels(catalog, character) : []
    const warnings: string[] = [...(resolved?.warnings ?? [])]
    if (!build) warnings.push('No build assigned to this slot.')
    else {
      if (!catalog || !character) warnings.push('Owned character or Nanoka catalog data is missing.')
      if (!showcase?.weapon) warnings.push('No compatible owned weapon is equipped; rotation actions cannot be calculated.')
      if ((showcase?.equippedEchoes.length ?? 0) < 5) warnings.push(`${showcase?.equippedEchoes.length ?? 0}/5 Echoes equipped.`)
      if ((showcase?.totalEchoCost ?? 0) > 12) warnings.push('Echo cost exceeds the 12-cost limit.')
    }
    return {
      slot, source: resolved?.source, comparisonSource: comparison?.source, comparisonShowcase, build, character, catalog, showcase, resolvedEchoes: resolved?.echoes ?? [], resolvedWeapon: resolved?.weapon, attacks, contribution: 0, contributionPercent: 0,
      byType: {}, appliedBuffs: [], receivedBuffs: [], roles: inferRoles(catalog, attacks), warnings, formulaRows: []
    }
  }) as [TeamMemberModel, TeamMemberModel, TeamMemberModel]

  const resonators = baseMembers.flatMap((member) => member.catalog && member.character
    ? [runtimeResonator(member.catalog, member.character)] : [])
  const runtimeWeapons = baseMembers.flatMap((member) => member.build
    ? [runtimeWeapon(member.build, runtimeOwnedWeapons)].filter((entry): entry is Weapon => Boolean(entry)) : [])
  const runtimeTeam = { ...input.team, buildIds: runtimeBuilds.map((entry) => entry.id) }
  const rotation = calculateRotation(runtimeTeam, runtimeBuilds, resonators, runtimeWeapons, runtimeEchoes)

  for (const member of baseMembers) {
    if (!member.build) continue
    member.contribution = rotation.byBuild[member.build.id] ?? 0
    member.contributionPercent = rotation.total > 0 ? member.contribution / rotation.total * 100 : 0
    member.appliedBuffs = (input.team.buffs ?? []).filter((effect) => effect.sourceBuildId === member.build?.id)
    member.receivedBuffs = (input.team.buffs ?? []).filter((effect) => buffAppliesTo(effect, member))
    const ownedWeapon = member.showcase?.weapon?.owned
    if (member.character && member.build && ownedWeapon) {
      const sheet = characterFormulaSheets.find((entry) => entry.id === member.character?.catalogId)
      const selectedTargetId = input.team.scenario?.selectedTargetByBuild[member.build.id]
      member.formulaRows = (sheet?.targets ?? []).map((target) => {
        const context = createBuildCalculationContext({
          build: member.build!, character: member.character!, weapon: ownedWeapon,
          echoes: member.build!.echoIds.map((id) => runtimeEchoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)),
          enemy: input.team.enemy, scenario: input.team.scenario, buffs: member.receivedBuffs, targetId: target.id
        })
        if (!member.conditionedStats || target.id === selectedTargetId) member.conditionedStats = context.stats
        const calculator = new FormulaCalculator(context)
        const normal = calculator.evaluate(target.normal), critical = calculator.evaluate(target.critical), expected = calculator.evaluate(target.expected)
        return { target, normal: Number(normal.value), critical: Number(critical.value), expected: Number(expected.value), traces: { normal: normal.trace, critical: critical.trace, expected: expected.trace } }
      })
    }
  }

  const sortedActions = [...input.team.actions].sort((left, right) => left.timestamp - right.timestamp)
  let resultIndex = 0
  const actions = sortedActions.map((action, index): TeamActionModel => {
    const member = baseMembers.find((entry) => entry.build?.id === action.buildId)
    const attack = member?.attacks.find((entry) => entry.id === action.attackId)
    const warnings: string[] = []
    if (!member?.build) warnings.push('Character is not assigned to this team.')
    if (!attack) warnings.push('Character attack data is missing for this action.')
    if (!member?.showcase?.weapon) warnings.push('Damage skipped because no weapon is equipped.')
    if (action.timestamp < 0 || action.timestamp > input.team.rotationDuration) warnings.push('Timestamp is outside the rotation duration.')
    if (action.duration !== undefined && action.timestamp + action.duration > input.team.rotationDuration) warnings.push('Clip extends past the rotation duration.')
    const valid = Boolean(member?.build && member.showcase?.weapon && attack)
    const result = valid ? rotation.actions[resultIndex++] : undefined
    const activeBuffs = activeBuffsAt(input.team, sortedActions, index).filter((effect) => member ? buffAppliesTo(effect, member) : false)
    const activates = (input.team.buffs ?? []).filter((effect) => effect.sourceBuildId === action.buildId && effect.triggerAttackId === action.attackId)
    const formulaTargetId = action.formulaTargetId ?? (member?.catalog && attack ? `${member.catalog.id}:${attack.id}` : undefined)
    const target = formulaTargetId && member?.catalog ? resolveFormulaTarget(member.catalog.id, formulaTargetId) : undefined
    let formulaResult: { normal: number; critical: number; expected: number; trace?: CalculationTrace; traces?: Record<'normal' | 'critical' | 'expected', CalculationTrace> } | undefined
    const ownedWeapon = member?.showcase?.weapon?.owned
    if (target && member?.build && member.character && ownedWeapon) {
      const calculator = new FormulaCalculator(createBuildCalculationContext({
        build: member.build, character: member.character, weapon: ownedWeapon,
        echoes: member.build.echoIds.map((id) => runtimeEchoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)),
        enemy: input.team.enemy, scenario: input.team.scenario, buffs: activeBuffs, actionInputs: action.inputs, targetId: target.id
      }))
      const normal = calculator.evaluate(target.normal), critical = calculator.evaluate(target.critical), expected = calculator.evaluate(target.expected)
      const mode = input.team.scenario?.resultMode ?? 'expected'
      const traces = { normal: normal.trace, critical: critical.trace, expected: expected.trace }
      formulaResult = { normal: Number(normal.value), critical: Number(critical.value), expected: Number(expected.value), trace: traces[mode], traces }
    }
    const multiplier = Math.max(1, Math.min(99, Math.floor(action.multiplier ?? 1)))
    const repeatedValue = (formula: number | undefined, legacy: number | undefined) => formula !== undefined ? formula * multiplier : legacy ?? 0
    return {
      action, member, attack, normal: repeatedValue(formulaResult?.normal, result?.normal),
      critical: repeatedValue(formulaResult?.critical, result?.critical),
      expected: repeatedValue(formulaResult?.expected, result?.expected),
      activeBuffs, activates, warnings,
      trace: formulaResult?.trace, traces: formulaResult?.traces,
      formulaTargetId
    }
  })

  const formulaByType: Partial<Record<DamageType, number>> = {}
  let formulaTotal = 0
  const resultMode = input.team.scenario?.resultMode ?? 'expected'
  for (const member of baseMembers) { member.byType = {}; member.contribution = 0 }
  for (const row of actions) {
    if (!row.member || !row.attack) continue
    const value = row[resultMode]
    row.member.byType[row.attack.type] = (row.member.byType[row.attack.type] ?? 0) + value
    formulaByType[row.attack.type] = (formulaByType[row.attack.type] ?? 0) + value
    row.member.contribution += value
    formulaTotal += value
  }
  for (const member of baseMembers) member.contributionPercent = formulaTotal > 0 ? member.contribution / formulaTotal * 100 : 0

  const sonataCounts = new Map<string, number>()
  for (const member of baseMembers) for (const sonata of member.showcase?.sonatas ?? []) {
    sonataCounts.set(sonata.name, (sonataCounts.get(sonata.name) ?? 0) + sonata.count)
  }
  const sonatas = [...sonataCounts].map(([name, pieces]) => {
    const entry = sonataCatalog.find((sonata) => sonata.name === name)
    const active = entry?.effects.filter((effect) => pieces >= effect.pieces) ?? []
    return {
      name, pieces, activeThresholds: active.map((effect) => effect.pieces),
      description: active.map((effect) => effect.description).join(' '),
      iconSourceUrl: generatedSonataIconSources[name] ?? ''
    }
  }).sort((left, right) => right.pieces - left.pieces || left.name.localeCompare(right.name))

  const roles = [...new Set(baseMembers.flatMap((member) => member.roles))]
  const allAttacks = baseMembers.flatMap((member) => member.attacks)
  const warnings = [...new Set([
    ...baseMembers.flatMap((member) => member.warnings),
    ...actions.flatMap((action) => action.warnings)
  ])]
  return {
    team: input.team,
    members: baseMembers,
    total: formulaTotal,
    dps: formulaTotal / Math.max(1, input.team.rotationDuration),
    actions,
    byType: formulaByType,
    sonatas,
    roles,
    introCount: allAttacks.filter((attack) => /intro/i.test(attack.name)).length,
    outroCount: allAttacks.filter((attack) => /outro/i.test(attack.name)).length,
    warnings
  }
}

export function echoArtwork(echo: Echo | undefined) {
  return echo ? echoCatalog.find((entry) => entry.name === echo.name)?.iconSourceUrl ?? '' : ''
}
