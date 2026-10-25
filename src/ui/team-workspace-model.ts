import { calculateBuildModes, calculateBuildStats, combatTargets, resolveCombatTarget, type CombatTarget } from '../domain/combat/runtime'
import type { CalculationTrace, ResultKind } from '../domain/combat'
import type {
  AggregatedStats, BuffEffect, Build, DamageType, Echo, EquippedLoadout, LoadoutSourceRef, OwnedCharacter,
  OwnedWeapon, RotationAction, StatKey, Team, TheorycraftBuild
} from '../domain/types'
import { resolveLoadout } from '../domain/loadouts'
import {
  characterCatalog, echoCatalog, isFixedSkillValueName, sonataCatalog, statLabels, weaponCatalog,
  type CharacterCatalogEntry
} from '../game-data'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { applicableTeamStatusEffects, negativeStatusActions } from '../game-data/combat/negative-status'
import { pendingMechanics } from '../game-data/review-status.generated'
import { mechanicsRegistry } from '../game-data/combat/registry'
import { importedAbilityForAction } from '../game-data/combat/imported-actions'
import { resolveRotationActionId } from '../game-data/combat/rotation-action-mapping'
import { resolveCharacterShowcaseModel, type CharacterShowcaseModel } from './character-showcase-model'

const SKILL_KEYS = ['normalAttack', 'resonanceSkill', 'forteCircuit', 'resonanceLiberation', 'introSkill'] as const
export type TeamAttackGroup = 'basic' | 'skill' | 'forte' | 'liberation' | 'intro' | 'outro' | 'echo' | 'tuneBreak' | 'status'
export const TEAM_ROTATION_TARGET_ID = 'team:rotation'
export const TEAM_LOOP_TARGET_ID = 'team:loop'

export function compactAttackLabel(label: string) {
  const separator = label.indexOf(' - ')
  return (separator < 0 ? label : label.slice(separator + 3)).replaceAll('Resonance Skill', 'Res. Skill').replaceAll('Resonance Liberation', 'Res. Liberation')
}

export interface TeamWorkspaceInput {
  team: Team
  includeTraces?: boolean
  formulaTargetIds?: readonly string[]
  disabledEffectIdsByMember?: Record<string, string[]>
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
  scalesWith: 'atk' | 'hp' | 'def' | 'level'
  skillLevel: number
  skillName: string
  iconSourceUrl: string
  group: TeamAttackGroup
  timing?: { totalFrames:number; cancelFrame:number; noSwapFrame:number; timeStopFrames:number; motionStopFrames:number; hitFrames:number[]; hitCommitFrames:number[]; sourceAbilityId:number }
}

function importedTiming(characterId: string, actionId: string): TeamAttackModel['timing'] {
  const ability = importedAbilityForAction(characterId, actionId)
  return ability && (ability.total_frames || ability.hits.length) ? {
    totalFrames:ability.total_frames, cancelFrame:ability.earliest_frame_cancel,
    noSwapFrame:ability.no_swap, timeStopFrames:ability.time_stop, motionStopFrames:ability.motion_stop,
    hitFrames:ability.hits.map((hit) => hit.frame), hitCommitFrames:ability.hits.map((hit) => hit.commit_frame), sourceAbilityId:ability.id
  } : undefined
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
  target: CombatTarget
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
  resultKind?: ResultKind
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

export function rotationActionsForTarget(model: Pick<TeamWorkspaceModel, 'team' | 'actions'>, targetId = TEAM_ROTATION_TARGET_ID) {
  const loop = targetId === TEAM_LOOP_TARGET_ID ? model.team.loop : undefined
  if (!loop) return targetId === TEAM_LOOP_TARGET_ID ? [] : model.actions
  return model.actions.filter(({ action }) => action.timestamp >= loop.start && action.timestamp + Math.min(action.duration ?? 0.8, model.team.rotationDuration - action.timestamp) <= loop.end + 0.000001)
}

export function rotationDamageByMode(model: Pick<TeamWorkspaceModel, 'team' | 'actions'>, targetId = TEAM_ROTATION_TARGET_ID) {
  return rotationActionsForTarget(model, targetId).reduce((totals, row) => {
    if (row.resultKind === 'damage') {
      totals.normal += row.normal
      totals.critical += row.critical
      totals.expected += row.expected
    }
    return totals
  }, { normal: 0, critical: 0, expected: 0 })
}

function attackModels(catalog: CharacterCatalogEntry, character: OwnedCharacter, echoes: readonly Echo[] = []): TeamAttackModel[] {
  const characterAttacks = catalog.attacks.flatMap((attack): TeamAttackModel[] => {
    if (isFixedSkillValueName(attack.name)) return []
    const target = resolveCombatTarget(catalog.id, attack.id, echoes)
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
      type:target?.kind === 'healing' ? 'healing' : target?.damageType === 'tune-break' ? 'tuneBreak' : target?.damageType ?? attack.type,
      multiplier: attack.multipliers[level - 1] ?? 0,
      multiplierLabel: `${((attack.multipliers[level - 1] ?? 0) * 100).toFixed(2)}%`,
      hitMultipliers: attack.hitMultipliers?.map((hit) => hit[level - 1] ?? 0) ?? [attack.multipliers[level - 1] ?? 0],
      scalesWith: attack.scalesWith,
      skillLevel: level,
      skillName: skill.name,
      iconSourceUrl: skill.iconSourceUrl,
      group, timing:importedTiming(catalog.id, attack.id)
    }]
  })
  const matchedTargetIds = new Set(catalog.attacks.flatMap((attack) => {
    const target = resolveCombatTarget(catalog.id, attack.id, echoes)
    return target ? [target.id] : []
  }))
  const reviewedExtras = combatTargets(catalog.id, echoes).filter((target) => {
    const action = mechanicsRegistry.characters[catalog.id]?.actions[target.id]
    return !matchedTargetIds.has(target.id) && (target.kind !== 'utility' || target.group === 'Outro Skill' || target.group === 'Echo Skill')
      && (!action || !('minimumSequence' in action) || action.minimumSequence === undefined || character.sequence >= action.minimumSequence)
  }).map((target): TeamAttackModel => {
    const group: TeamAttackGroup = target.group === 'Echo Skill' ? 'echo' : target.group === 'Outro Skill' || target.damageType === 'outro' ? 'outro' : target.damageType === 'tune-break' ? 'tuneBreak' : target.damageType === 'status' ? 'status'
      : target.group === 'Normal Attack' ? 'basic' : target.group === 'Resonance Skill' ? 'skill' : target.group === 'Resonance Liberation' ? 'liberation' : target.group === 'Intro Skill' ? 'intro' : 'forte'
    const type: DamageType = target.kind === 'damage' ? (target.damageType === 'tune-break' ? 'tuneBreak' : target.damageType ?? 'skill') : target.kind === 'utility' ? group === 'echo' ? 'echo' : 'outro' : 'healing'
    const skill = group === 'basic' ? catalog.skillIcons.normalAttack : group === 'skill' ? catalog.skillIcons.resonanceSkill : group === 'liberation' ? catalog.skillIcons.resonanceLiberation : group === 'intro' ? catalog.skillIcons.introSkill : group === 'outro' ? catalog.skillTreeExtras.outroSkill : group === 'tuneBreak' ? catalog.skillTreeExtras.tuneBreakSkill : catalog.skillIcons.forteCircuit
    const action = mechanicsRegistry.characters[catalog.id]?.actions[target.id]
    const levelIndex = action && 'skillLevelIndex' in action ? action.skillLevelIndex : 4
    const level = group === 'tuneBreak' || group === 'status' ? character.level : group === 'echo' ? echoes[0]?.rarity ?? 1 : character.skillLevels?.[levelIndex] ?? 1
    const formula = action && 'formulas' in action ? action.formulas[level] ?? (Object.keys(action.formulas).length === 1 ? Object.values(action.formulas)[0] : undefined) : undefined
    const formulaHits = formula?.kind === 'damage' ? formula.hits : []
    const multiplier = formulaHits.reduce((total, hit) => total + hit, 0)
    return {
      id:target.id, name:target.label, type,
      multiplier, multiplierLabel:target.kind === 'utility' ? 'No damage' : formulaHits.length ? `${(multiplier * 100).toFixed(2)}%` : formula?.kind === 'unsupported' && formula.family.includes('skill level 10 only') ? 'Lv. 10 only' : action?.sourceId.startsWith('imported:') ? 'Unsupported formula' : group === 'status' || group === 'tuneBreak' ? 'Estimated formula' : 'Reviewed formula', hitMultipliers:[...formulaHits], scalesWith:group === 'status' || group === 'tuneBreak' ? 'level' : formula?.kind === 'damage' && formula.scaling.hp ? 'hp' : formula?.kind === 'damage' && formula.scaling.def ? 'def' : 'atk', skillLevel:level,
      skillName:group === 'echo' ? target.group : skill.name, iconSourceUrl:group === 'echo' ? echoCatalog.find((entry) => entry.name === echoes[0]?.name)?.iconSourceUrl ?? '' : skill.iconSourceUrl, group,
      timing:importedTiming(catalog.id, target.id)
    }
  })
  return [...characterAttacks, ...reviewedExtras]
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
      if (action.timestamp >= active[activeIndex].activatedAt + active[activeIndex].effect.duration) active.splice(activeIndex, 1)
    }
    for (const effect of team.buffs ?? []) {
      if (effect.sourceBuildId === action.buildId && effect.triggerAttackId === action.attackId) {
        const previous = active.findIndex((entry) => entry.effect.id === effect.id)
        if (previous >= 0) active.splice(previous, 1)
        active.push({ effect, activatedAt: action.timestamp })
      }
    }
    for (let activeIndex = active.length - 1; activeIndex >= 0; activeIndex -= 1) {
      if (active[activeIndex].effect.target === 'next' && active[activeIndex].effect.sourceBuildId !== action.buildId) active.splice(activeIndex, 1)
    }
  }
  return active.filter((entry) => currentTimestamp < entry.activatedAt + entry.effect.duration).map((entry) => entry.effect)
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
    const attacks = catalog && character ? attackModels(catalog, character, resolved?.echoes ?? []) : []
    const warnings: string[] = [...(resolved?.warnings ?? [])]
    const characterPending = catalog ? pendingMechanics.character?.[catalog.id] : undefined
    if (characterPending?.length) warnings.push(`TBA: ${catalog!.name} ${characterPending.join(', ')} mechanics are not included in calculations.`)
    const weaponPending = resolved?.weapon ? pendingMechanics.weapon?.[resolved.weapon.catalogId] : undefined
    if (weaponPending?.length) warnings.push('TBA: equipped weapon passive mechanics are not included in calculations.')
    const mainEcho = echoCatalog.find((entry) => entry.name === resolved?.echoes[0]?.name)
    const echoPending = mainEcho?.id ? pendingMechanics.echo?.[mainEcho.id] : undefined
    if (echoPending?.length) warnings.push(`TBA: ${mainEcho!.name} ${echoPending.join(', ')} mechanics are not included in calculations.`)
    if (!build) warnings.push('No build assigned to this slot.')
    else {
      if (!catalog || !character) warnings.push('Owned character or game catalog data is missing.')
      if (!showcase?.weapon) warnings.push('No compatible owned weapon is equipped; rotation actions cannot be calculated.')
      if ((showcase?.equippedEchoes.length ?? 0) < 5) warnings.push(`${showcase?.equippedEchoes.length ?? 0}/5 Echoes equipped.`)
      if ((showcase?.totalEchoCost ?? 0) > 12) warnings.push('Echo cost exceeds the 12-cost limit.')
    }
    return {
      slot, source: resolved?.source, comparisonSource: comparison?.source, comparisonShowcase, build, character, catalog, showcase, resolvedEchoes: resolved?.echoes ?? [], resolvedWeapon: resolved?.weapon, attacks, contribution: 0, contributionPercent: 0,
      byType: {}, appliedBuffs: [], receivedBuffs: [], roles: inferRoles(catalog, attacks), warnings, formulaRows: []
    }
  }) as [TeamMemberModel, TeamMemberModel, TeamMemberModel]

  const applicableStatuses = applicableTeamStatusEffects(baseMembers.flatMap((member) => member.character ? [member.character.catalogId] : []))
  const effectiveEnemy = {
    ...input.team.enemy,
    strainStacks:applicableStatuses.has('tune-strain') ? input.team.enemy.strainStacks : 0,
    havocBaneStacks:applicableStatuses.has('havoc-bane') ? input.team.enemy.havocBaneStacks : 0,
    electroRageStacks:applicableStatuses.has('electro-rage') ? input.team.enemy.electroRageStacks : 0,
    statusStacks:Object.fromEntries(negativeStatusActions.map(({ status }) => [status, applicableStatuses.has(status) ? input.team.enemy.statusStacks?.[status] ?? 0 : 0]))
  }

  const combatTeamMembers = baseMembers.flatMap((member) => member.build && member.character && member.showcase?.weapon
    ? [{ build:member.build, character:member.character, weapon:member.showcase.weapon.owned, echoes:member.build.echoIds.map((id) => runtimeEchoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)) }]
    : [])

  for (const member of baseMembers) {
    if (!member.build) continue
    member.appliedBuffs = (input.team.buffs ?? []).filter((effect) => effect.sourceBuildId === member.build?.id)
    member.receivedBuffs = (input.team.buffs ?? []).filter((effect) => buffAppliesTo(effect, member))
    const ownedWeapon = member.showcase?.weapon?.owned
    if (member.character && member.build && ownedWeapon) {
      const statResult = calculateBuildStats({
        build:member.build, character:member.character, weapon:ownedWeapon,
        echoes:member.build.echoIds.map((id) => runtimeEchoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)),
        enemy:effectiveEnemy, scenario:input.team.scenario, buffs:member.receivedBuffs, teamMembers:combatTeamMembers, disabledEffectIdsByMember:input.disabledEffectIdsByMember
      })
      if (statResult.ok) member.conditionedStats = statResult.stats
      else member.warnings.push(...statResult.errors.map((error) => error.message))
      member.warnings.push(...statResult.warnings.map((warning) => warning.message))
      const formulaTargets = input.formulaTargetIds?.length === 0 ? [] : combatTargets(member.character.catalogId, member.resolvedEchoes)
      member.formulaRows = formulaTargets.filter((target) => target.kind !== 'utility' && (input.formulaTargetIds === undefined || input.formulaTargetIds.includes(target.id))).map((target) => {
        const result = calculateBuildModes({
          build: member.build!, character: member.character!, weapon: ownedWeapon,
          echoes: member.build!.echoIds.map((id) => runtimeEchoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)),
          enemy: effectiveEnemy, scenario: input.team.scenario, buffs: member.receivedBuffs, targetId: target.id, trace:input.includeTraces !== false, teamMembers:combatTeamMembers, disabledEffectIdsByMember:input.disabledEffectIdsByMember
        })
        member.warnings.push(...result.warnings)
        const fallback: CalculationTrace = { stage:'unavailable', value:0, children:[] }
        return { target, ...result.values, traces:{ normal:result.traces.normal ?? fallback, critical:result.traces.critical ?? fallback, expected:result.traces.expected ?? fallback } }
      })
      member.warnings = [...new Set(member.warnings)]
    }
  }

  const sortedActions = [...input.team.actions].sort((left, right) => left.timestamp - right.timestamp)
  const actionCalculations = new Map<string, ReturnType<typeof calculateBuildModes>>()
  const actions = sortedActions.map((action, index): TeamActionModel => {
    const member = baseMembers.find((entry) => entry.build?.id === action.buildId)
    const directAttack = member?.attacks.find((entry) => entry.id === action.attackId)
    const mappedId = !directAttack && member?.catalog && action.label
      ? resolveRotationActionId(member.catalog.id, action.attackId, action.label, member.resolvedEchoes[0]?.name) : undefined
    const attack = directAttack ?? member?.attacks.find((entry) => entry.id === mappedId)
    const warnings: string[] = []
    if (!member?.build) warnings.push('Character is not assigned to this team.')
    if (!attack) warnings.push(action.label ? `${action.label} is not in Tacet Lab's attack data.` : 'Character attack data is missing for this action.')
    if (action.timestamp < 0 || action.timestamp > input.team.rotationDuration) warnings.push('Timestamp is outside the rotation duration.')
    if (action.duration !== undefined && action.timestamp + action.duration > input.team.rotationDuration) warnings.push('Clip extends past the rotation duration.')
    const activeBuffs = activeBuffsAt(input.team, sortedActions, index).filter((effect) => member ? buffAppliesTo(effect, member) : false)
    const activates = (input.team.buffs ?? []).filter((effect) => effect.sourceBuildId === action.buildId && effect.triggerAttackId === action.attackId)
    const formulaTargetId = mappedId && attack && member?.catalog ? `${member.catalog.id}:${attack.id}`
      : action.formulaTargetId ?? (member?.catalog && attack ? `${member.catalog.id}:${attack.id}` : undefined)
    const target = formulaTargetId && member?.catalog ? resolveCombatTarget(member.catalog.id, formulaTargetId, member.resolvedEchoes) : undefined
    if (!member?.showcase?.weapon && target?.kind !== 'utility') warnings.push('Damage skipped because no weapon is equipped.')
    let formulaResult: { normal: number; critical: number; expected: number; trace?: CalculationTrace; traces?: Record<'normal' | 'critical' | 'expected', CalculationTrace> } | undefined
    const ownedWeapon = member?.showcase?.weapon?.owned
    if (target && target.kind !== 'utility' && member?.build && member.character && ownedWeapon) {
      const calculationKey = JSON.stringify([member.build.id, target.id, activeBuffs, action.inputs])
      let calculated = actionCalculations.get(calculationKey)
      if (!calculated) {
        calculated = calculateBuildModes({
          build: member.build, character: member.character, weapon: ownedWeapon,
          echoes: member.build.echoIds.map((id) => runtimeEchoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo)),
          enemy: effectiveEnemy, scenario: input.team.scenario, buffs: activeBuffs, actionInputs: action.inputs, targetId: target.id, trace:input.includeTraces !== false, teamMembers:combatTeamMembers, disabledEffectIdsByMember:input.disabledEffectIdsByMember
        })
        actionCalculations.set(calculationKey, calculated)
      }
      warnings.push(...calculated.warnings)
      const mode = input.team.scenario?.resultMode ?? 'expected'
      const fallback: CalculationTrace = { stage:'unavailable', value:0, children:[] }
      const traces = { normal:calculated.traces.normal ?? fallback, critical:calculated.traces.critical ?? fallback, expected:calculated.traces.expected ?? fallback }
      formulaResult = { ...calculated.values, trace:traces[mode], traces }
    }
    const multiplier = Math.max(1, Math.min(99, Math.floor(action.multiplier ?? 1)))
    const repeatedValue = (formula: number | undefined) => (formula ?? 0) * multiplier
    return {
      action, member, attack, normal: repeatedValue(formulaResult?.normal),
      critical: repeatedValue(formulaResult?.critical),
      expected: repeatedValue(formulaResult?.expected),
      activeBuffs, activates, warnings,
      trace: formulaResult?.trace, traces: formulaResult?.traces,
      formulaTargetId, resultKind:target?.kind
    }
  })

  const formulaByType: Partial<Record<DamageType, number>> = {}
  let formulaTotal = 0
  const resultMode = input.team.scenario?.resultMode ?? 'expected'
  for (const member of baseMembers) { member.byType = {}; member.contribution = 0 }
  for (const row of actions) {
    if (!row.member || !row.attack || row.resultKind !== 'damage') continue
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
