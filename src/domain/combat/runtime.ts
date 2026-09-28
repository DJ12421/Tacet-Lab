import { baseTuneBreakBoost, characterCatalog, echoCatalog, sonataCatalog, weaponCatalog } from '../../game-data'
import { mechanicsRegistry } from '../../game-data/combat/registry'
import { echoStatLines } from '../../game-data/echo-main-stats'
import { skillTreeStatLine } from '../../game-data/passive-stats'
import type {
  AggregatedStats as LegacyStats, BuffEffect, Build, Echo, EnemyConfig, OwnedCharacter, OwnedWeapon,
  Resonator, ScenarioValue, StatKey, StatLine, TeamScenario, Weapon
} from '../types'
import { calculateMemberStats, createCalculator } from './engine'
import type {
  ActionResult, CalculationOutcome, CalculationTrace, CombatMember, CombatSetup, DamageType, MechanicInputValue,
  EffectMechanics, EffectOperation, MechanicsRegistry, ResultKind, ResultMode, Stat, StatValue
} from './contract'

const EMPTY_WEAPON_ID = 'runtime:empty-weapon'
const runtimeRegistry: MechanicsRegistry = {
  ...mechanicsRegistry,
  weapons:{
    ...mechanicsRegistry.weapons,
    [EMPTY_WEAPON_ID]:{
      id:EMPTY_WEAPON_ID,
      sourceId:EMPTY_WEAPON_ID,
      reviewFingerprint:EMPTY_WEAPON_ID,
      levelStats:[{ level:1, atk:0 }]
    }
  }
}
const calculator = createCalculator(runtimeRegistry)

export interface CombatTarget {
  id: string
  label: string
  group: string
  kind: ResultKind
  damageType?: DamageType
  normal: 'normal'
  critical: 'critical'
  expected: 'expected'
}

export interface CombatInputDefinition {
  id: string
  label: string
  description?: string
  kind: 'boolean' | 'number'
  minimum?: number
  maximum?: number
}

export interface CombatEffectResult {
  label: string
  value: number | 'Always' | 'Never'
  percent: boolean
  perActivation?: boolean
}

export interface CombatEffectDefinition {
  id: string
  label: string
  description?: string
  sourceKind: 'character' | 'weapon' | 'sonata' | 'echo'
  sourceLabel: string
  badge: string
  minimumSequence?: number
  activationKind: EffectMechanics['activation']['kind']
  inputs: CombatInputDefinition[]
  results: CombatEffectResult[]
}

export interface RuntimeBuild {
  character: OwnedCharacter
  weapon: OwnedWeapon
  resonator: Resonator
  runtimeWeapon: Weapon
}

export interface CombatBuildMember {
  build: Build
  character: OwnedCharacter
  weapon: OwnedWeapon
  echoes: Echo[]
}

export interface BuildCombatInput extends CombatBuildMember {
  enemy: EnemyConfig
  scenario?: TeamScenario
  buffs?: BuffEffect[]
  bonusStatLines?: StatLine[]
  actionInputs?: Record<string, ScenarioValue>
  targetId: string
  trace?: boolean
  teamMembers?: readonly CombatBuildMember[]
}

export type BuildStatsInput = Omit<BuildCombatInput, 'targetId' | 'trace'>

const percentStats = new Set<StatKey>([
  'hpPercent','atkPercent','defPercent','critRate','critDamage','energyRegen','basicDamage','heavyDamage','skillDamage',
  'liberationDamage','spectroDamage','fusionDamage','glacioDamage','electroDamage','aeroDamage','havocDamage','healingBonus'
])

const combatStat = (line: StatLine): StatValue => {
  const stat = line.key === 'hpPercent' ? 'hp' : line.key === 'atkPercent' ? 'atk' : line.key === 'defPercent' ? 'def' : line.key as Stat
  return { stat, mode:line.key === 'hpPercent' || line.key === 'atkPercent' || line.key === 'defPercent' ? 'percent' : 'flat', value:percentStats.has(line.key) ? line.value / 100 : line.value }
}

const legacyStats = (stats: ActionResult['stats']): LegacyStats => ({
  baseHp:stats.baseHp, baseAtk:stats.baseAtk, baseDef:stats.baseDef,
  hp:stats.hp, atk:stats.atk, def:stats.def,
  critRate:stats.critRate * 100, critDamage:stats.critDamage * 100, energyRegen:stats.energyRegen * 100,
  basicDamage:stats.basicDamage * 100, heavyDamage:stats.heavyDamage * 100, skillDamage:stats.skillDamage * 100,
  liberationDamage:stats.liberationDamage * 100, spectroDamage:stats.spectroDamage * 100, fusionDamage:stats.fusionDamage * 100,
  glacioDamage:stats.glacioDamage * 100, electroDamage:stats.electroDamage * 100, aeroDamage:stats.aeroDamage * 100,
  havocDamage:stats.havocDamage * 100, healingBonus:stats.healingBonus * 100
})

const actionIdFor = (characterId: string, targetId: string) => targetId.startsWith(`${characterId}:`) && targetId.slice(characterId.length + 1).startsWith(`${characterId}:`)
  ? targetId.slice(characterId.length + 1) : targetId

const selectedInputs = (build: Build, scenario?: TeamScenario, actionInputs?: Record<string, ScenarioValue>): Record<string, MechanicInputValue> => ({
  ...(scenario?.memberConditions[build.id] ?? {}),
  ...(scenario?.enemyConditions ?? {}),
  ...(actionInputs ?? {})
})

const memberFor = (input: Pick<BuildCombatInput, 'build' | 'character' | 'weapon' | 'echoes'>): CombatMember => {
  const skillLevel = Math.max(1, input.build.skillLevel || 1)
  const character = characterCatalog.find((entry) => entry.id === input.character.catalogId)
  const sonataIds = new Map(sonataCatalog.map((sonata) => [sonata.name, sonata.id]))
  const echoIds = new Map(echoCatalog.map((echo) => [echo.name, echo.id]))
  const echoEnergyRegen = input.echoes.flatMap(echoStatLines).filter((line) => line.key === 'energyRegen').reduce((total, line) => total + line.value, 0)
  const weaponEnergyRegen = mechanicsRegistry.weapons[input.weapon.catalogId]?.levelStats.find((entry) => entry.level === input.weapon.level)?.stats?.filter((line) => line.stat === 'energyRegen').reduce((total, line) => total + line.value * 100, 0) ?? 0
  const skillTreeEnergyRegen = skillTreeStatLines(input.character).filter((entry) => entry.value.stat === 'energyRegen').reduce((total, entry) => total + entry.value.value * 100, 0)
  return {
    memberId:input.build.id,
    character:{ id:input.character.catalogId, level:input.character.level, sequence:input.character.sequence, skillLevels:input.character.skillLevels ?? Array(5).fill(skillLevel) },
    weapon:{ id:input.weapon.catalogId, level:input.weapon.level, rank:input.weapon.rank },
    conditionStats:{
      tuneBreakBoost:character ? baseTuneBreakBoost(character) : 0,
      offTuneBuildupRate:100,
      energyRegen:100 + echoEnergyRegen + weaponEnergyRegen + skillTreeEnergyRegen
    },
    echoes:input.echoes.map((echo) => {
      const lines = echoStatLines(echo).map(combatStat)
      return {
        instanceId:echo.id,
        catalogId:echoIds.get(echo.name) ?? echo.name,
        rarity:echo.rarity,
        level:echo.level,
        sonataId:String(sonataIds.get(echo.sonata) ?? echo.sonata),
        mainStat:lines[0],
        substats:lines.slice(1)
      }
    }),
    mainEchoId:input.echoes[0]?.id
  }
}

const skillTreeStatLines = (character: OwnedCharacter): Array<{ label: string; value: StatValue }> => {
  const catalog = characterCatalog.find((entry) => entry.id === character.catalogId)
  if (!catalog) return []
  const enabled = new Set(character.enabledSkillTreeBonusIds ?? Object.entries(catalog.skillTreeExtras.bonusStatBranches).flatMap(([branch, nodes]) => nodes.map((_, sourceIndex) => `${branch}:${sourceIndex}`)))
  return Object.entries(catalog.skillTreeExtras.bonusStatBranches).flatMap(([branch, nodes]) => nodes.flatMap((node, sourceIndex) => {
    if (!enabled.has(`${branch}:${sourceIndex}`)) return []
    const line = skillTreeStatLine(node.name, node.description)
    return line ? [{ label:node.name, value:combatStat(line) }] : []
  }))
}

const runtimeBonuses = (character: OwnedCharacter, buffs: readonly BuffEffect[] = [], bonusStatLines: readonly StatLine[] = [], specialMultiplier = 0) => {
  const statContributions = [...skillTreeStatLines(character), ...bonusStatLines.map((line) => ({ label:'Build bonus', value:combatStat(line) }))]
  const statLines: StatValue[] = statContributions.map((entry) => entry.value)
  const damageBonuses: number[] = []
  const amplifications: number[] = []
  const damageBonusContributions: Array<{ label: string; value: number }> = []
  const amplificationContributions: Array<{ label: string; value: number }> = []
  for (const effect of buffs) {
    if (effect.stat === 'amplify') { const value = effect.value / 100; amplifications.push(value); amplificationContributions.push({ label:effect.name, value }) }
    else { const value = combatStat({ key:effect.stat, value:effect.value }); statLines.push(value); statContributions.push({ label:effect.name, value }) }
  }
  const specialMultipliers = specialMultiplier ? [specialMultiplier / 100] : []
  return {
    statLines, damageBonuses, amplifications, specialMultipliers,
    contributions:{
      statLines:statContributions,
      damageBonuses:damageBonusContributions,
      amplifications:amplificationContributions,
      specialMultipliers:specialMultiplier ? [{ label:'Enemy special multiplier', value:specialMultiplier / 100 }] : []
    }
  }
}

export function combatTargets(characterId: string, echoes: readonly Echo[] = []): CombatTarget[] {
  const character = mechanicsRegistry.characters[characterId]
  if (!character) return []
  const characterTargets: CombatTarget[] = Object.values(character.actions).map((action) => ({
    id:action.id,
    label:'name' in action ? action.name : action.id,
    group:'group' in action ? action.group : 'Other',
    kind:action.kind,
    damageType:action.damageType,
    normal:'normal', critical:'critical', expected:'expected'
  }))
  const mainEchoCatalogId = echoes[0] ? echoCatalog.find((entry) => entry.name === echoes[0].name)?.id : undefined
  const echo = mainEchoCatalogId ? mechanicsRegistry.echoes?.[mainEchoCatalogId] : undefined
  const echoTargets: CombatTarget[] = echo ? Object.values(echo.actions).map((action) => ({
    id:action.id, label:action.name, group:'Echo Skill', kind:action.kind, damageType:action.damageType,
    normal:'normal', critical:'critical', expected:'expected'
  })) : []
  return [...characterTargets, ...echoTargets]
}

const comparableActionId = (value: string) => value.replaceAll('-', ':')

export function resolveCombatTarget(characterId: string, targetId: string, echoes: readonly Echo[] = []): CombatTarget | undefined {
  const targets = combatTargets(characterId, echoes)
  const direct = targets.find((target) => target.id === targetId || comparableActionId(target.id) === comparableActionId(targetId))
  if (direct) return direct
  if (!targetId.startsWith(`${characterId}:`)) return undefined
  const unprefixed = targetId.slice(characterId.length + 1)
  return targets.find((target) => target.id === unprefixed || comparableActionId(target.id) === comparableActionId(unprefixed))
}

const titleCase = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const effectStatLabel = (stat: Stat) => ({
  atk:'ATK', hp:'HP', def:'DEF', critRate:'Crit. Rate', critDamage:'Crit. DMG', energyRegen:'Energy Regen',
  basicDamage:'Basic Attack DMG Bonus', heavyDamage:'Heavy Attack DMG Bonus', skillDamage:'Resonance Skill DMG Bonus',
  liberationDamage:'Resonance Liberation DMG Bonus', introDamage:'Intro Skill DMG Bonus', outroDamage:'Outro Skill DMG Bonus',
  echoDamage:'Echo Skill DMG Bonus', tuneBreakDamage:'Tune Break DMG Bonus', spectroDamage:'Spectro DMG Bonus',
  fusionDamage:'Fusion DMG Bonus', glacioDamage:'Glacio DMG Bonus', electroDamage:'Electro DMG Bonus', aeroDamage:'Aero DMG Bonus',
  havocDamage:'Havoc DMG Bonus', physicalDamage:'Physical DMG Bonus', healingBonus:'Healing Bonus', shieldBonus:'Shield Bonus'
} satisfies Record<Stat, string>)[stat]

const operationLabel = (operation: EffectOperation, effect: EffectMechanics) => {
  if (operation.kind === 'add-flat-stat' || operation.kind === 'add-percent-stat') return effectStatLabel(operation.stat)
  if (operation.kind === 'override-crit') return 'Critical Hits'
  if (operation.kind === 'reduce-damage-taken') return 'DMG Reduction'
  if (operation.kind === 'reduce-defense') return 'Enemy DEF Reduction'
  if (operation.kind === 'ignore-defense') return 'Enemy DEF Ignore'
  if (operation.kind === 'reduce-resistance') return 'Enemy RES Reduction'
  if (operation.kind === 'ignore-resistance') return 'Enemy RES Ignore'
  const filter = operation.filter ?? effect.filter
  const scope = filter?.elements?.length === 1 ? titleCase(filter.elements[0])
    : filter?.damageTypes?.length === 1 ? `${titleCase(filter.damageTypes[0])}${filter.damageTypes[0] === 'basic' || filter.damageTypes[0] === 'heavy' ? ' Attack' : ''}`
      : filter?.tags?.length === 1 ? titleCase(filter.tags[0]) : ''
  if (operation.kind === 'increase-motion-value') return `${scope ? `${scope} ` : ''}DMG Multiplier`
  if (operation.kind === 'amplify-damage') return `${scope ? `${scope} ` : ''}DMG Amplify`
  if (operation.kind === 'add-vulnerability') return `${scope ? `${scope} ` : ''}DMG Taken Amplify`
  if (operation.kind === 'add-final-damage') return `${scope ? `${scope} ` : ''}Final DMG Bonus`
  return `${scope ? `${scope} ` : ''}DMG Bonus`
}

const effectResults = (effect: EffectMechanics): CombatEffectResult[] => [
  ...effect.operations.map((operation): CombatEffectResult => operation.kind === 'override-crit'
  ? { label:operationLabel(operation, effect), value:operation.mode === 'always' ? 'Always' : 'Never', percent:false }
  : {
      label:operationLabel(operation, effect),
      value:operation.value,
      percent:operation.kind !== 'add-flat-stat' || !['atk','hp','def'].includes(operation.stat),
      perActivation:operation.stacking === 'per-stack' || ((effect.activation.kind === 'stacks' || effect.activation.kind === 'value' || effect.activation.kind === 'conditional-value') && operation.stacking !== 'once')
    }),
  ...(effect.triggeredActions ?? []).map((action) => ({ label:action.name, value:action.count, percent:false })),
  ...(effect.actionUseAdjustments ?? []).map((adjustment) => ({ label:'Additional action uses', value:adjustment.additionalUses, percent:false }))
]

export function combatEffectDefinitions(characterId: string, weaponId: string, sequence: number, rank: number, echoes: readonly Echo[]): CombatEffectDefinition[] {
  const character = mechanicsRegistry.characters[characterId]
  const weapon = mechanicsRegistry.weapons[weaponId]
  const sonataIds = new Map(sonataCatalog.map((sonata) => [sonata.name, String(sonata.id)]))
  const counts = echoes.reduce<Record<string, number>>((result, echo) => {
    const id = sonataIds.get(echo.sonata) ?? echo.sonata
    result[id] = (result[id] ?? 0) + 1
    return result
  }, {})
  const effects: Array<{ effect: EffectMechanics; sourceKind: CombatEffectDefinition['sourceKind']; sourceLabel: string; sourceBadge: string }> = [
    ...(character?.effects ?? []).filter((effect) => sequence >= (effect.minimumSequence ?? 0)).map((effect) => ({ effect, sourceKind:'character' as const, sourceLabel:characterCatalog.find((entry) => entry.id === characterId)?.name ?? 'Character', sourceBadge:effect.minimumSequence ? `S${effect.minimumSequence}` : 'Character' })),
    ...(weapon?.effects ?? []).filter((effect) => rank >= (effect.minimumRank ?? 1) && rank <= (effect.maximumRank ?? Number.POSITIVE_INFINITY)).map((effect) => ({ effect, sourceKind:'weapon' as const, sourceLabel:weaponCatalog.find((entry) => entry.id === weaponId)?.name ?? 'Weapon', sourceBadge:(effect.minimumRank ?? 1) > 1 ? `R${effect.minimumRank}` : 'Weapon' })),
    ...Object.entries(counts).flatMap(([id, pieces]) => (mechanicsRegistry.sonatas?.[id]?.effects ?? []).filter((effect) => pieces >= (effect.minimumPieces ?? 2)).map((effect) => ({ effect, sourceKind:'sonata' as const, sourceLabel:sonataCatalog.find((entry) => String(entry.id) === id)?.name ?? 'Sonata', sourceBadge:`${effect.minimumPieces ?? 2}-Set` }))),
    ...(echoes[0] ? (mechanicsRegistry.echoes?.[echoCatalog.find((entry) => entry.name === echoes[0].name)?.id ?? '']?.effects ?? []).map((effect) => ({ effect, sourceKind:'echo' as const, sourceLabel:echoes[0].name, sourceBadge:'Echo' })) : [])
  ]
  return effects.map(({ effect, sourceKind, sourceLabel, sourceBadge }) => {
    const common = { label:effect.name ?? effect.id, description:effect.description }
    const inputs: CombatInputDefinition[] = effect.activation.kind === 'always' ? []
      : effect.activation.kind === 'all' ? effect.activation.inputs.map((id) => ({ id, ...common, kind:'boolean' }))
        : effect.activation.kind === 'conditional-value' ? [{ id:effect.activation.toggleInput, ...common, kind:'boolean' }]
          : effect.activation.kind === 'toggle' ? [{ id:effect.activation.input, ...common, kind:'boolean' }]
            : [{ id:effect.activation.input, ...common, kind:'number', minimum:effect.activation.minimum, maximum:effect.activation.maximum }]
    return {
      id:effect.id,
      label:effect.name ?? sourceLabel,
      description:effect.description,
      sourceKind,
      sourceLabel,
      badge:effect.activation.kind === 'always' ? sourceBadge : sourceBadge === 'Character' || sourceBadge === 'Weapon' || sourceBadge === 'Echo' ? 'Conditional' : sourceBadge,
      minimumSequence:effect.minimumSequence,
      activationKind:effect.activation.kind,
      inputs,
      results:effectResults(effect)
    }
  })
}

export function combatInputDefinitions(characterId: string, weaponId: string, sequence: number, rank: number, echoes: readonly Echo[]): CombatInputDefinition[] {
  const definitions = combatEffectDefinitions(characterId, weaponId, sequence, rank, echoes).flatMap((effect) => effect.inputs)
  return [...new Map(definitions.map((definition) => [definition.id, definition])).values()]
}

function combatSetup(input: BuildStatsInput, member: CombatMember): CombatSetup {
  const sourceMembers = input.teamMembers?.length ? input.teamMembers : [input]
  const members = sourceMembers.map(memberFor)
  if (!members.some((entry) => entry.memberId === member.memberId)) members.push(member)
  const allowedInputs = new Set(sourceMembers.flatMap((entry) => combatInputDefinitions(entry.character.catalogId, entry.weapon.catalogId, entry.character.sequence, entry.weapon.rank, entry.echoes).map((definition) => definition.id)))
  const selections = Object.fromEntries(sourceMembers.flatMap((entry) => Object.entries(selectedInputs(
    entry.build,
    input.scenario,
    entry.build.id === input.build.id ? input.actionInputs : undefined
  )).filter(([id]) => allowedInputs.has(id)).map(([id, value]) => [`${entry.build.id}:${id}`, value])))
  return {
    dataVersion:mechanicsRegistry.dataVersion,
    members,
    enemy:{
      level:input.enemy.level,
      resistance:{ spectro:input.enemy.resistance / 100, fusion:input.enemy.resistance / 100, glacio:input.enemy.resistance / 100, electro:input.enemy.resistance / 100, aero:input.enemy.resistance / 100, havoc:input.enemy.resistance / 100, physical:input.enemy.resistance / 100 },
      damageReduction:input.enemy.damageReduction / 100,
      defenseIgnore:(input.enemy.defenseIgnore ?? 0) / 100,
      defenseReduction:(input.enemy.defenseReduction ?? 0) / 100,
      resistanceIgnore:(input.enemy.resistanceIgnore ?? 0) / 100,
      resistanceReduction:(input.enemy.resistanceReduction ?? 0) / 100
    },
    selections,
    memberBonuses:Object.fromEntries(sourceMembers.map((entry) => [entry.build.id, runtimeBonuses(
      entry.character,
      entry.build.id === input.build.id ? input.buffs : [],
      entry.build.id === input.build.id ? input.bonusStatLines : [],
      entry.build.id === input.build.id ? input.enemy.specialMultiplier : 0
    )]))
  }
}

export function calculateBuildStats(input: BuildStatsInput, includeReviewedEffects = true) {
  const member = memberFor(input)
  const outcome = calculateMemberStats(runtimeRegistry, combatSetup(input, member), member.memberId, includeReviewedEffects)
  return outcome.ok ? { ok:true as const, stats:legacyStats(outcome.value), warnings:outcome.warnings } : outcome
}

export function calculateShowcaseStats(input: {
  character: OwnedCharacter
  weapon?: OwnedWeapon
  echoes: Echo[]
  build?: Build
}, includeReviewedEffects = true) {
  const weapon = input.weapon ?? {
    id:`${EMPTY_WEAPON_ID}:${input.character.id}`,
    catalogId:EMPTY_WEAPON_ID,
    level:1,
    rank:1,
    locked:false,
    createdAt:0
  }
  const build = input.build ? { ...input.build, weaponId:weapon.id } : {
    id:`runtime:showcase:${input.character.id}`,
    name:'Stat preview',
    resonatorId:input.character.catalogId,
    weaponId:weapon.id,
    echoIds:input.echoes.map((echo) => echo.id),
    level:input.character.level,
    skillLevel:input.character.skillLevels?.[0] ?? 1
  }
  return calculateBuildStats({
    build,
    character:input.character,
    weapon,
    echoes:input.echoes,
    enemy:{ level:1, resistance:0, damageReduction:0 }
  }, includeReviewedEffects)
}

export function calculateBuildCombat(input: BuildCombatInput, mode: ResultMode): CalculationOutcome<ActionResult> {
  const member = memberFor(input)
  const setup = combatSetup(input, member)
  const actionId = resolveCombatTarget(input.character.catalogId, input.targetId, input.echoes)?.id ?? actionIdFor(input.character.catalogId, input.targetId)
  return calculator.calculateAction({ setup, actorId:member.memberId, actionId, resultMode:mode, trace:input.trace })
}

export function calculateBuildModes(input: BuildCombatInput) {
  const modes = ['normal','critical','expected'] as const
  const outcomes = Object.fromEntries(modes.map((mode) => [mode, calculateBuildCombat(input, mode)])) as Record<ResultMode, CalculationOutcome<ActionResult>>
  const first = outcomes.expected.ok ? outcomes.expected.value : outcomes.normal.ok ? outcomes.normal.value : undefined
  const values = {} as Record<ResultMode, number>
  const traces: Partial<Record<ResultMode, CalculationTrace>> = {}
  const messages: string[] = []
  for (const mode of modes) {
    const outcome = outcomes[mode]
    if (outcome.ok) {
      values[mode] = outcome.value.selected
      if (outcome.value.trace) traces[mode] = outcome.value.trace
      messages.push(...outcome.warnings.map((warning) => warning.message))
    } else {
      values[mode] = 0
      messages.push(...outcome.errors.map((error) => error.message))
    }
  }
  return {
    outcomes,
    stats:first ? legacyStats(first.stats) : undefined,
    values,
    traces,
    warnings:[...new Set(messages)]
  }
}

export function resolveRuntimeBuild(build: Build, characters: OwnedCharacter[], weapons: OwnedWeapon[]): RuntimeBuild | undefined {
  const ownedCharacter = characters.find((entry) => entry.catalogId === build.resonatorId)
  const ownedWeapon = weapons.find((entry) => entry.id === build.weaponId)
  const character = characterCatalog.find((entry) => entry.id === ownedCharacter?.catalogId)
  const weapon = weaponCatalog.find((entry) => entry.id === ownedWeapon?.catalogId)
  if (!ownedCharacter || !ownedWeapon || !character || !weapon) return undefined
  const characterStats = character.levelStats.reduce((nearest, row) => Math.abs(row.level - ownedCharacter.level) < Math.abs(nearest.level - ownedCharacter.level) ? row : nearest)
  const weaponStats = weapon.levelStats.reduce((nearest, row) => Math.abs(row.level - ownedWeapon.level) < Math.abs(nearest.level - ownedWeapon.level) ? row : nearest)
  const element = character.element.toLowerCase() as Resonator['element']
  const targets = combatTargets(character.id)
  return {
    character:ownedCharacter,
    weapon:ownedWeapon,
    resonator:{ id:character.id, name:character.name, element, role:character.role, accent:'', baseStats:{ hp:characterStats.hp, atk:characterStats.atk, def:characterStats.def, critRate:character.baseStats.critRate, critDamage:character.baseStats.critDamage }, attacks:targets.filter((target) => target.kind === 'damage' || target.kind === 'healing').map((target) => ({ id:target.id, name:target.label, type:target.kind === 'healing' ? 'healing' : target.damageType === 'tune-break' ? 'skill' : target.damageType ?? 'skill', element, multiplier:0, hits:1, scalesWith:'atk' })) },
    runtimeWeapon:{ id:ownedWeapon.id, name:weapon.name, type:weapon.type.toLowerCase() as Weapon['type'], baseAtk:weaponStats.baseAtk }
  }
}

export const floorGameValue = (value: number) => Math.floor(value + 1e-9)
export const emptyLegacyStats = (): LegacyStats => ({
  baseHp:0, baseAtk:0, baseDef:0, hp:0, atk:0, def:0, critRate:0, critDamage:0, energyRegen:100,
  basicDamage:0, heavyDamage:0, skillDamage:0, liberationDamage:0, spectroDamage:0, fusionDamage:0,
  glacioDamage:0, electroDamage:0, aeroDamage:0, havocDamage:0, healingBonus:0
})
export function formatDamage(value: number) { return Math.ceil(value).toLocaleString('en-US') }
