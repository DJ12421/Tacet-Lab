import { calculateRotation } from '../domain/damage'
import { createBuildCalculationContext, FormulaCalculator, characterFormulaSheets, resolveFormulaTarget, type CalculationTrace, type FormulaTarget } from '../domain/calculation'
import {
  calculateBuildAttackV2, calculateBuildStatsV2, createBuildCalculationV2Context, enemyV2, outgoingPartyEffectsV2,
  resolveCharacterMechanicsV2, resolveEchoMechanicsV2, skillLevelForAttackV2
} from '../domain/calculation-v2'
import type {
  CalculationAttackDefinition, CalculationEffectDefinition, CalculationResultV2,
  CalculationSourceStats, CalculationStatsV2, CalculationTraceV2, CharacterCalculationMechanics, EchoCalculationMechanics
} from '../domain/calculation-v2'
import type {
  AttackDefinition, BuffEffect, Build, DamageType, Echo, Element, EquippedLoadout, LoadoutSourceRef, OwnedCharacter,
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
const normalizedCatalogName = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
export type TeamAttackGroup = 'basic' | 'skill' | 'forte' | 'liberation' | 'intro' | 'outro' | 'echo' | 'tuneBreak'

export interface TeamWorkspaceInput {
  team: Team
  builds: Build[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  echoes: Echo[]
  equippedLoadouts?: EquippedLoadout[]
  theorycraftBuilds?: TheorycraftBuild[]
  neutralMainEchoSlots?: number[]
  focusedAttack?: { slot: number; attackId: string }
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
  calculationMechanicsV2?: CharacterCalculationMechanics
  mainEchoMechanicsV2?: EchoCalculationMechanics
  calculationEffectsV2: CalculationEffectDefinition[]
  outgoingEffectsV2: CalculationEffectDefinition[]
  calculationRowsV2: TeamCalculationRowV2[]
  resolvedStatsV2?: CalculationStatsV2
  conditionedStats?: Record<string, number>
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

export interface TeamCalculationRowV2 {
  attack: CalculationAttackDefinition
  result: CalculationResultV2
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
  activePartyEffectsV2: CalculationEffectDefinition[]
  activeSelfEffectsV2: CalculationEffectDefinition[]
  activatesSelfEffectsV2: CalculationEffectDefinition[]
  warnings: string[]
  trace?: CalculationTrace
  traces?: Record<'normal' | 'critical' | 'expected', CalculationTrace>
  traceV2?: CalculationTraceV2
  tracesV2?: CalculationResultV2['trace']
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
  sourceStatsV2: CalculationSourceStats
}

export function resolvedOutgoingPartyEffects(member: TeamMemberModel, includeMainEchoEffects = true) {
  if (!member.build) return []
  const sourceRank = member.showcase?.weapon?.owned.rank ?? 1
  return outgoingPartyEffectsV2(
    member.catalog,
    member.showcase?.weapon?.catalog,
    member.showcase?.echoSlots[0],
    member.showcase?.sonatas ?? [],
    member.calculationMechanicsV2?.key,
    includeMainEchoEffects
  ).filter((effect) => !effect.sequence || effect.sequence <= (member.character?.sequence ?? 0))
    .map((effect): CalculationEffectDefinition => ({
      ...effect,
      definitionId: effect.definitionId ?? effect.id,
      id: `${effect.id}:provider:${member.build!.id}`,
      sourceKind: 'party',
      sourceBuildId: member.build!.id,
      modifiers: effect.modifiers.map((modifier) => modifier.modifierByRefinement
        ? {
            ...modifier,
            modifierValue: modifier.modifierByRefinement[String(sourceRank)] ?? 0,
            modifierByRefinement: undefined
          }
        : modifier)
    }))
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

function v2DamageType(attack: CalculationAttackDefinition): DamageType {
  if (attack.type === 'basic' || attack.type === 'heavy' || attack.type === 'skill' || attack.type === 'liberation'
    || attack.type === 'intro' || attack.type === 'outro' || attack.type === 'echo' || attack.type === 'healing') return attack.type
  return attack.type === 'shield' ? 'healing' : 'skill'
}

function v2AttackGroup(attack: CalculationAttackDefinition): TeamAttackGroup {
  const group = attack.group.toLowerCase()
  if (group.includes('echo skill')) return 'echo'
  if (group.includes('tune break')) return 'tuneBreak'
  if (group.includes('outro')) return 'outro'
  if (group.includes('intro')) return 'intro'
  if (group.includes('liberation')) return 'liberation'
  if (group.includes('forte')) return 'forte'
  if (group.includes('resonance skill')) return 'skill'
  if (group.includes('basic')) return 'basic'
  if (attack.type === 'tuneBreak') return 'tuneBreak'
  if (attack.type === 'outro') return 'outro'
  if (attack.type === 'intro') return 'intro'
  if (attack.type === 'liberation') return 'liberation'
  if (attack.type === 'forte') return 'forte'
  if (attack.type === 'basic' || attack.type === 'heavy') return 'basic'
  return 'skill'
}

function v2AttackModels(catalog: CharacterCatalogEntry, character: OwnedCharacter, mechanics: CharacterCalculationMechanics, mainEcho?: Echo): TeamAttackModel[] {
  return mechanics.attacks.filter((attack) => attack.type !== 'utility').map((attack) => {
    const level = skillLevelForAttackV2(character, attack, mainEcho?.rarity)
    const talent = attack.talents[String(level)] ?? attack.talents['1'] ?? '0%'
    const multiplier = Number.parseFloat(talent) / 100
    const group = v2AttackGroup(attack)
    const skillIndex = group === 'basic' ? 0 : group === 'skill' ? 1 : group === 'forte' ? 2 : group === 'liberation' ? 3 : 4
    const mainEchoCatalog = mainEcho ? echoCatalog.find((entry) => normalizedCatalogName(entry.name) === normalizedCatalogName(mainEcho.name)) : undefined
    const skill = group === 'echo' ? { name: mainEcho?.name ?? 'Main Echo', iconSourceUrl: mainEchoCatalog?.iconSourceUrl ?? '' }
      : group === 'outro' ? catalog.skillTreeExtras.outroSkill
      : group === 'tuneBreak' ? catalog.skillTreeExtras.tuneBreakSkill
        : catalog.skillIcons[SKILL_KEYS[skillIndex] ?? 'forteCircuit']
    return {
      id: attack.id,
      name: attack.name,
      type: v2DamageType(attack),
      multiplier: Number.isFinite(multiplier) ? multiplier : 0,
      multiplierLabel: talent,
      hitMultipliers: [Number.isFinite(multiplier) ? multiplier : 0],
      scalesWith: attack.attribute === 'hp' ? 'hp' : attack.attribute === 'defense' ? 'def' : 'atk',
      skillLevel: level,
      skillName: skill.name,
      iconSourceUrl: skill.iconSourceUrl,
      group
    }
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
    const characterMechanicsV2 = catalog && character ? resolveCharacterMechanicsV2(catalog, character, input.roverGender) : undefined
    const mainEchoMechanicsV2 = resolveEchoMechanicsV2(showcase?.echoSlots[0])
    const calculationMechanicsV2 = characterMechanicsV2 ? {
      ...characterMechanicsV2,
      attacks: [...characterMechanicsV2.attacks, ...(mainEchoMechanicsV2?.attacks ?? [])]
    } : undefined
    const attacks = catalog && character && calculationMechanicsV2
      ? v2AttackModels(catalog, character, calculationMechanicsV2, showcase?.echoSlots[0])
      : catalog && character ? attackModels(catalog, character) : []
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
      byType: {}, appliedBuffs: [], receivedBuffs: [], roles: inferRoles(catalog, attacks), warnings, formulaRows: [],
      calculationMechanicsV2, mainEchoMechanicsV2, calculationEffectsV2: [], outgoingEffectsV2: [], calculationRowsV2: []
    }
  }) as [TeamMemberModel, TeamMemberModel, TeamMemberModel]

  const resonators = baseMembers.flatMap((member) => member.catalog && member.character
    ? [runtimeResonator(member.catalog, member.character)] : [])
  const runtimeWeapons = baseMembers.flatMap((member) => member.build
    ? [runtimeWeapon(member.build, runtimeOwnedWeapons)].filter((entry): entry is Weapon => Boolean(entry)) : [])
  const runtimeTeam = { ...input.team, buildIds: runtimeBuilds.map((entry) => entry.id) }
  const rotation: ReturnType<typeof calculateRotation> = input.focusedAttack
    ? { byBuild: {}, byType: {}, total: 0, dps: 0, actions: [] }
    : calculateRotation(runtimeTeam, runtimeBuilds, resonators, runtimeWeapons, runtimeEchoes)

  for (const member of baseMembers) {
    if (!member.build) continue
    member.contribution = rotation.byBuild[member.build.id] ?? 0
    member.contributionPercent = rotation.total > 0 ? member.contribution / rotation.total * 100 : 0
    member.appliedBuffs = (input.team.buffs ?? []).filter((effect) => effect.sourceBuildId === member.build?.id)
    member.receivedBuffs = (input.team.buffs ?? []).filter((effect) => buffAppliesTo(effect, member))
    member.outgoingEffectsV2 = resolvedOutgoingPartyEffects(member, !input.neutralMainEchoSlots?.includes(member.slot))
    const ownedWeapon = member.showcase?.weapon?.owned
    if (!input.focusedAttack && member.character && member.build && ownedWeapon) {
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

  const baseSourceStats: CalculationSourceStats = {}
  for (const member of baseMembers) {
    if (!member.build || !member.character || !member.catalog || !member.showcase) continue
    const stats = calculateBuildStatsV2({
      build: member.build,
      character: member.character,
      characterCatalog: member.catalog,
      weapon: member.showcase.weapon?.owned,
      weaponCatalog: member.showcase.weapon?.catalog,
      showcase: member.showcase,
      scenario: input.team.calculationV2,
      activeCustomBuffs: input.focusedAttack ? member.receivedBuffs : undefined,
      includeMainEchoEffects: !input.neutralMainEchoSlots?.includes(member.slot),
      roverGender: input.roverGender
    })
    if (stats) baseSourceStats[member.build.id] = stats
  }

  const receivedPartyEffectsFor = (recipient: TeamMemberModel, temporal = false) => baseMembers.flatMap((source) => {
    if (!source.build || !recipient.build || (source.build.id === recipient.build.id && !source.outgoingEffectsV2.some((effect) => effect.scope === 'team' || effect.scope === 'enemy'))) return []
    const sourceRank = source.showcase?.weapon?.owned.rank ?? 1
    return source.outgoingEffectsV2
      .filter((effect) => {
        if (source.build?.id === recipient.build?.id) return effect.scope === 'team' || effect.scope === 'enemy'
        if (effect.scope !== 'next' || temporal) return true
        const selection = input.team.calculationV2?.partyEffects[source.build!.id]?.[effect.id]
          ?? (effect.definitionId ? input.team.calculationV2?.partyEffects[source.build!.id]?.[effect.definitionId] : undefined)
        const fallbackRecipient = baseMembers.find((member) => member.build && member.build.id !== source.build!.id)?.build?.id
        return (selection?.recipientBuildId ?? fallbackRecipient) === recipient.build!.id
      })
      .map((effect): CalculationEffectDefinition => ({
        ...effect,
        sourceKind: 'party',
        modifiers: effect.modifiers.map((modifier) => modifier.modifierByRefinement
          ? {
              ...modifier,
              modifierValue: modifier.modifierByRefinement[String(sourceRank)] ?? 0,
              modifierByRefinement: undefined
            }
          : modifier)
      }))
  })
  const sourceStatsV2: CalculationSourceStats = { ...baseSourceStats }
  for (const member of baseMembers) {
    if (!member.build || !member.character || !member.catalog || !member.showcase) continue
    const stats = calculateBuildStatsV2({
      build: member.build,
      character: member.character,
      characterCatalog: member.catalog,
      weapon: member.showcase.weapon?.owned,
      weaponCatalog: member.showcase.weapon?.catalog,
      showcase: member.showcase,
      scenario: input.team.calculationV2,
      partyEffects: receivedPartyEffectsFor(member),
      sourceStats: baseSourceStats,
      activeCustomBuffs: input.focusedAttack ? member.receivedBuffs : undefined,
      includeMainEchoEffects: !input.neutralMainEchoSlots?.includes(member.slot),
      roverGender: input.roverGender
    })
    if (stats) sourceStatsV2[member.build.id] = stats
  }
  const calculationEnemy = enemyV2(input.team.enemy, input.team.calculationV2)
  for (const member of baseMembers) {
    if (!member.build || !member.character || !member.catalog || !member.showcase || !member.calculationMechanicsV2) continue
    const ownedWeapon = member.showcase.weapon?.owned
    const receivedPartyEffects = receivedPartyEffectsFor(member)
    const source = {
      build: member.build,
      character: member.character,
      characterCatalog: member.catalog,
      weapon: ownedWeapon,
      weaponCatalog: member.showcase.weapon?.catalog,
      showcase: member.showcase,
      scenario: input.team.calculationV2,
      partyEffects: receivedPartyEffects,
      sourceStats: sourceStatsV2,
      activeCustomBuffs: input.focusedAttack ? member.receivedBuffs : undefined,
      includeMainEchoEffects: !input.neutralMainEchoSlots?.includes(member.slot),
      roverGender: input.roverGender
    }
    member.calculationEffectsV2 = createBuildCalculationV2Context(source)?.effects ?? []
    member.resolvedStatsV2 = calculateBuildStatsV2(source)
    const calculationAttacks = input.focusedAttack
      ? member.slot === input.focusedAttack.slot ? member.calculationMechanicsV2.attacks.filter((attack) => attack.id === input.focusedAttack!.attackId) : []
      : member.calculationMechanicsV2.attacks
    member.calculationRowsV2 = calculationAttacks.flatMap((attack) => {
      const result = calculateBuildAttackV2(source, attack, calculationEnemy)
      return result ? [{ attack, result }] : []
    })
    member.warnings.push(...member.calculationRowsV2.flatMap((row) => row.result.warnings))
  }

  const sortedActions = input.focusedAttack ? [] : [...input.team.actions].sort((left, right) => left.timestamp - right.timestamp)
  const normalizedTrigger = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const actionMatchesTrigger = (member: TeamMemberModel, action: RotationAction, trigger: string) => {
    const calculationAttack = member.calculationMechanicsV2?.attacks.find((attack) => attack.id === action.attackId || attack.key === action.attackId)
    const attack = member.attacks.find((candidate) => candidate.id === action.attackId || candidate.id === calculationAttack?.id)
    const keys = [action.attackId, calculationAttack?.id ?? '', calculationAttack?.key ?? '', calculationAttack?.name ?? '', attack?.name ?? '', attack?.skillName ?? '']
      .map(normalizedTrigger).filter(Boolean)
    const normalizedEffectTrigger = normalizedTrigger(trigger)
    return keys.some((key) => key === normalizedEffectTrigger || key.includes(normalizedEffectTrigger) || normalizedEffectTrigger.includes(key))
  }
  const partyEffectIsActive = (effect: CalculationEffectDefinition, recipient: TeamMemberModel, currentIndex: number) => {
    const source = baseMembers.find((member) => member.outgoingEffectsV2.some((candidate) => candidate.id === effect.id))
    if (!source?.build || !recipient.build) return false
    if (!effect.trigger) {
      if (effect.scope !== 'next') return true
      const selection = input.team.calculationV2?.partyEffects[source.build.id]?.[effect.id]
        ?? (effect.definitionId ? input.team.calculationV2?.partyEffects[source.build.id]?.[effect.definitionId] : undefined)
      const fallbackRecipient = baseMembers.find((member) => member.build && member.build.id !== source.build?.id)?.build?.id
      return (selection?.recipientBuildId ?? fallbackRecipient) === recipient.build.id
    }
    const trigger = normalizedTrigger(effect.trigger)
    if (!trigger) return true
    const currentTime = sortedActions[currentIndex].timestamp
    let activationIndex = -1
    for (let index = 0; index < currentIndex; index += 1) {
      const action = sortedActions[index]
      if (action.timestamp >= currentTime) continue
      if (action.buildId !== source.build.id) continue
      const attack = source.attacks.find((candidate) => candidate.id === action.attackId)
      const attackKeys = [action.attackId, attack?.id ?? '', attack?.name ?? '', attack?.skillName ?? ''].map(normalizedTrigger).filter(Boolean)
      if (attackKeys.some((key) => key === trigger || key.includes(trigger) || trigger.includes(key))) activationIndex = index
    }
    if (activationIndex < 0) return false
    const activationTime = sortedActions[activationIndex].timestamp
    if (effect.duration !== undefined && currentTime > activationTime + effect.duration) return false
    if (effect.scope !== 'next') return true
    const firstIncomingTime = sortedActions.find((action) => action.timestamp > activationTime && action.buildId !== source.build?.id)?.timestamp
    if (firstIncomingTime === undefined || currentTime !== firstIncomingTime) return false
    return sortedActions.some((action) => action.timestamp === firstIncomingTime && action.buildId === recipient.build?.id)
  }
  let resultIndex = 0
  const actions = sortedActions.map((action, index): TeamActionModel => {
    const member = baseMembers.find((entry) => entry.build?.id === action.buildId)
    const calculationAttack = member?.calculationMechanicsV2?.attacks.find((entry) =>
      entry.id === action.attackId || entry.key === action.attackId || entry.id.endsWith(`:${action.attackId}`)
    )
    const attack = member?.attacks.find((entry) => entry.id === action.attackId || entry.id === calculationAttack?.id)
      ?? (member?.catalog && member.character ? attackModels(member.catalog, member.character).find((entry) => entry.id === action.attackId) : undefined)
    const warnings: string[] = []
    if (!member?.build) warnings.push('Character is not assigned to this team.')
    if (!attack) warnings.push('Calculation V2 attack data is missing for this action.')
    if (!member?.showcase?.weapon) warnings.push('Damage skipped because no weapon is equipped.')
    if (action.timestamp < 0 || action.timestamp > input.team.rotationDuration) warnings.push('Timestamp is outside the rotation duration.')
    if (action.duration !== undefined && action.timestamp + action.duration > input.team.rotationDuration) warnings.push('Clip extends past the rotation duration.')
    if (calculationAttack?.group === 'Echo Skill' && member?.mainEchoMechanicsV2?.cooldown) {
      const previousEchoAction = sortedActions.slice(0, index).reverse().find((candidate) => {
        if (candidate.buildId !== action.buildId || candidate.timestamp >= action.timestamp) return false
        const previousAttack = member.calculationMechanicsV2?.attacks.find((entry) => entry.id === candidate.attackId || entry.key === candidate.attackId)
        return previousAttack?.group === 'Echo Skill'
      })
      if (previousEchoAction && action.timestamp - previousEchoAction.timestamp < member.mainEchoMechanicsV2.cooldown) {
        warnings.push(`Main Echo is still on cooldown (${member.mainEchoMechanicsV2.cooldown}s).`)
      }
    }
    const valid = Boolean(member?.build && member.showcase?.weapon && attack)
    const result = valid ? rotation.actions[resultIndex++] : undefined
    const activeBuffs = activeBuffsAt(input.team, sortedActions, index).filter((effect) => member ? buffAppliesTo(effect, member) : false)
    const activates = (input.team.buffs ?? []).filter((effect) => effect.sourceBuildId === action.buildId && effect.triggerAttackId === action.attackId)
    const formulaTargetId = action.formulaTargetId ?? (member?.catalog && attack ? `${member.catalog.id}:${attack.id}` : undefined)
    const target = formulaTargetId && member?.catalog ? resolveFormulaTarget(member.catalog.id, formulaTargetId) : undefined
    let formulaResult: { normal: number; critical: number; expected: number; trace?: CalculationTrace; traces?: Record<'normal' | 'critical' | 'expected', CalculationTrace> } | undefined
    let calculationResultV2: CalculationResultV2 | undefined
    const ownedWeapon = member?.showcase?.weapon?.owned
    const activePartyEffectsV2 = member ? receivedPartyEffectsFor(member, true).filter((effect) => partyEffectIsActive(effect, member, index)) : []
    const effectActivationOverrides = member ? Object.fromEntries(member.calculationEffectsV2.flatMap((effect) => {
      if (effect.sourceKind !== 'echo' || effect.alwaysEnabled || !effect.trigger || effect.duration === undefined) return []
      const activations = sortedActions.slice(0, index).filter((candidate) => candidate.buildId === member.build?.id
        && candidate.timestamp < action.timestamp && actionMatchesTrigger(member, candidate, effect.trigger!))
      const activation = activations[activations.length - 1]
      return [[effect.id, Boolean(activation && action.timestamp <= activation.timestamp + effect.duration)] as const]
    })) : undefined
    const activeSelfEffectsV2 = member?.calculationEffectsV2.filter((effect) => effectActivationOverrides?.[effect.id]) ?? []
    const activatesSelfEffectsV2 = member?.calculationEffectsV2.filter((effect) => effect.sourceKind === 'echo' && !effect.alwaysEnabled
      && Boolean(effect.trigger) && actionMatchesTrigger(member, action, effect.trigger!)) ?? []
    if (calculationAttack && member?.build && member.character && member.catalog && member.showcase) {
      calculationResultV2 = calculateBuildAttackV2({
        build: member.build,
        character: member.character,
        characterCatalog: member.catalog,
        weapon: ownedWeapon,
        weaponCatalog: member.showcase.weapon?.catalog,
        showcase: member.showcase,
        scenario: input.team.calculationV2,
        partyEffects: activePartyEffectsV2,
        sourceStats: sourceStatsV2,
        activeCustomBuffs: activeBuffs,
        effectActivationOverrides,
        includeMainEchoEffects: !input.neutralMainEchoSlots?.includes(member.slot),
        roverGender: input.roverGender
      }, calculationAttack, calculationEnemy)
    }
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
    const mode = input.team.calculationV2?.resultMode ?? input.team.scenario?.resultMode ?? 'expected'
    const multiplier = Math.max(1, Math.min(99, Math.floor(action.multiplier ?? 1)))
    const repeatedValue = (v2: number | undefined, formula: number | undefined, legacy: number | undefined) =>
      v2 !== undefined ? v2 * multiplier : formula !== undefined ? formula * multiplier : legacy ?? 0
    return {
      action, member, attack, normal: repeatedValue(calculationResultV2?.normal, formulaResult?.normal, result?.normal),
      critical: repeatedValue(calculationResultV2?.critical, formulaResult?.critical, result?.critical),
      expected: repeatedValue(calculationResultV2?.expected, formulaResult?.expected, result?.expected),
      activeBuffs, activates, activePartyEffectsV2, activeSelfEffectsV2, activatesSelfEffectsV2,
      warnings: [...warnings, ...(calculationResultV2?.warnings ?? [])],
      trace: formulaResult?.trace, traces: formulaResult?.traces,
      traceV2: calculationResultV2?.trace[mode], tracesV2: calculationResultV2?.trace,
      formulaTargetId
    }
  })

  const formulaByType: Partial<Record<DamageType, number>> = {}
  let formulaTotal = 0
  const resultMode = input.team.calculationV2?.resultMode ?? input.team.scenario?.resultMode ?? 'expected'
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
    warnings,
    sourceStatsV2
  }
}

export function echoArtwork(echo: Echo | undefined) {
  return echo ? echoCatalog.find((entry) => entry.name === echo.name)?.iconSourceUrl ?? '' : ''
}
