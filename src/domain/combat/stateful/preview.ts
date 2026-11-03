import type { AggregatedStats, BuffEffect, Team } from '../../types'
import { characterCatalog, echoCatalog, weaponCatalog } from '../../../game-data'
import { importedAbilityForAction } from '../../../game-data/combat/imported-actions'
import { negativeStatusLevels } from '../../../game-data/combat/negative-status'
import { tuneBreakLevelBases } from '../../../game-data/tune-break'
import { calculateBuildStats, type CombatBuildMember } from '../runtime'
import { addEnemyStat, applyCurrent, applyTeam, currentCast, currentMember, equip, equipEnemy, menuStats, panelStats, revokeTeam, runningAction, runningAnyOf, triggeredAction, withTeam } from './engine/context.js'
import { Buff, Gear, Mainslot, Sonata, Sonata1pc, Sonata2pc, Sonata3pc, Weapon, type Loadout, type StatLine } from './engine/gear.js'
import { ActionGroup, CancelledStep, type Action } from './engine/rotation.js'
import { Attribute, Cast, EnemyStat, Scaling, Stat, Type, splitStat } from './engine/stats.js'
import { State } from './engine/state.js'
import { YANGYANG, YANGYANG_ACTIONS } from './resonators/aero/yangyang.js'
import { YINLIN, YINLIN_ACTIONS } from './resonators/electro/yinlin.js'
import { XUANLING_CASTS } from './resonators/havoc/xuanling.js'
import { CHISA_CASTS } from './resonators/havoc/chisa.js'
import { SUISUI_CASTS } from './resonators/glacio/suisui.js'
import { ALL_TEAMS } from './resonators/teams.js'
import { ACTION_HERON, ACTION_NM_TEMPEST_MEPHIS } from './echoes/jinzhou.js'
import { ACTION_FORBIDDEN_BASTION, ACTION_THOUSAND_PUPPET_PAVILION } from './echoes/mengzhou.js'
import * as standardWeapons from './weapons/standard.js'
import * as battlepassWeapons from './weapons/battlepass.js'
import * as broadbladeWeapons from './weapons/broadblade.js'
import * as gauntletWeapons from './weapons/gauntlet.js'
import * as pistolWeapons from './weapons/pistol.js'
import * as rectifierWeapons from './weapons/rectifier.js'
import * as swordWeapons from './weapons/sword.js'
import * as jinzhouEchoes from './echoes/jinzhou.js'
import * as rinascitaEchoes from './echoes/rinascita.js'
import * as septimontEchoes from './echoes/septimont.js'
import * as lahairoiEchoes from './echoes/lahairoi.js'
import * as mengzhouEchoes from './echoes/mengzhou.js'
import { AERO_EROSION, ELECTRO_FLARE, ELECTRO_RAGE, FUSION_BURST, GLACIO_CHAFE, HAVOC_BANE, SPECTRO_FRAZZLE } from './shared/status.js'
import { runTimeline, TimelineError, type ScheduledCast } from './timeline'
import type { ResolvedSnapshot } from './engine/evaluate.js'

const LOADOUTS = new Map<string, Loadout[]>()
for (const team of ALL_TEAMS) for (const loadout of team.loadouts) {
  const id = String(loadout.resonator.id)
  const found = LOADOUTS.get(id) ?? []
  if (!found.includes(loadout)) found.push(loadout)
  LOADOUTS.set(id, found)
}
for (const loadout of [YANGYANG, YINLIN]) {
  const id = String(loadout.resonator.id)
  const found = LOADOUTS.get(id) ?? []
  if (!found.includes(loadout)) found.push(loadout)
  LOADOUTS.set(id, found)
}
const EXPLICIT_ACTIONS: Record<string, Record<string, Action>> = { '1402': YANGYANG_ACTIONS, '1302': YINLIN_ACTIONS }
const KIT_CASTS: Record<string, Action[]> = { '1610': XUANLING_CASTS, '1508': CHISA_CASTS, '1110': SUISUI_CASTS }
const STATUS_GEAR = {
  'aero-erosion': AERO_EROSION, 'electro-flare': ELECTRO_FLARE, 'fusion-burst': FUSION_BURST,
  'glacio-chafe': GLACIO_CHAFE, 'spectro-frazzle': SPECTRO_FRAZZLE
} as const
const exportedPieces = (modules: ReadonlyArray<Record<string, unknown>>) => [...new Set(modules.flatMap((module) =>
  Object.values(module).flatMap((value) => Array.isArray(value) ? value : [value])))]
const ALL_WEAPONS = exportedPieces([standardWeapons, battlepassWeapons, broadbladeWeapons, gauntletWeapons, pistolWeapons, rectifierWeapons, swordWeapons])
  .filter((piece): piece is Weapon => piece instanceof Weapon)
const ALL_ECHO_GEAR = exportedPieces([jinzhouEchoes, rinascitaEchoes, septimontEchoes, lahairoiEchoes, mengzhouEchoes])
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const baseAction = (action: Action): Action => action instanceof CancelledStep ? baseAction(action.of)
  : action.cancelOf || action.formOf ? baseAction(action.cancelOf ?? action.formOf!) : action
const ELEMENTS: Record<string, Attribute> = {
  aero: Attribute.Aero, electro: Attribute.Electro, fusion: Attribute.Fusion,
  glacio: Attribute.Glacio, spectro: Attribute.Spectro, havoc: Attribute.Havoc, physical: Attribute.Physical
}
const DAMAGE_TYPES: Record<string, Type> = {
  basic_attack: Type.Basic, heavy_attack: Type.Heavy, resonance_skill: Type.Skill,
  resonance_liberation: Type.Liberation, intro: Type.Intro, outro: Type.Outro,
  echo_skill: Type.Echo
}
const SCALINGS: Record<string, Scaling> = { attack: Scaling.Atk, hp: Scaling.Hp, defense: Scaling.Def, fixed: Scaling.Fixed }

function authoredCasts(loadout: Loadout, sequence: number): Action[] {
  const casts = new Set<Action>()
  const add = (entry: Action): void => {
    const action = baseAction(entry)
    if (action instanceof ActionGroup) action.actions.forEach(add)
    else if (action.mv || action.cast) casts.add(action)
  }
  loadout.rotationAt(sequence).authored.forEach(add)
  KIT_CASTS[String(loadout.resonator.id)]?.forEach(add)
  return [...casts]
}

function mappedAction(characterId: string, actionId: string, loadout: Loadout, sequence: number, label?: string): Action | undefined {
  const direct = EXPLICIT_ACTIONS[characterId]?.[actionId]
  if (direct) return direct
  const ability = importedAbilityForAction(characterId, actionId)
  const authored = authoredCasts(loadout, sequence).filter((action) => !action.formOf && !action.cancelOf)
  if (!ability) {
    // shortcut: catalog-only matches cannot verify hit frames; upgrade when reviewed timing data exists.
    const catalog = characterCatalog.find((entry) => entry.id === characterId)
    const attack = catalog?.attacks.find((entry) => entry.id === actionId)
    if (!attack?.hitMultipliers.length) {
      const named = authored.filter((action) => normalize(action.name) === normalize(label ?? attack?.name ?? ''))
      return named.length === 1 ? named[0] : undefined
    }
    const type = ({ basic: Type.Basic, heavy: Type.Heavy, skill: Type.Skill, liberation: Type.Liberation,
      intro: Type.Intro, outro: Type.Outro } as Partial<Record<typeof attack.type, Type>>)[attack.type]
    const scaling = SCALINGS[attack.scalesWith === 'atk' ? 'attack' : attack.scalesWith === 'def' ? 'defense' : 'hp']
    const candidates = authored.filter((action) => action.animFrames > 0 && action.bullets.every((hit) => hit.hitFrame > 0)
      && action.bullets.filter((hit) => hit.mv > 0).length === attack.hitMultipliers.length
      && action.scaling === scaling && action.bullets.filter((hit) => hit.mv > 0).every((hit, index) =>
        hit.mv === Math.round(attack.hitMultipliers[index][9] * 10000)
        && (type === undefined || hit.type === type)))
    const named = candidates.filter((action) => normalize(action.name) === normalize(attack.name))
    return named.length === 1 ? named[0] : candidates.length === 1 ? candidates[0] : undefined
  }
  if (!ability.hits.length) {
    const utility = authored.filter((action) => action.mv === 0
      && normalize(action.name) === normalize(ability.name)
      && action.animFrames === ability.total_frames
      && (ability.genre !== 'outro' || action.cast === Cast.Outro))
    return utility.length === 1 ? utility[0] : undefined
  }
  const candidates = authored.filter((action) => !action.formOf && !action.cancelOf
    && action.bullets.filter((hit) => hit.mv > 0).length === ability.hits.length
    && action.bullets.filter((hit) => hit.mv > 0).every((hit, index) => hit.mv === ability.hits[index].motion_value
      && hit.hitFrame === ability.hits[index].frame
      && (ELEMENTS[ability.hits[index].attribute] === undefined || hit.element === ELEMENTS[ability.hits[index].attribute])
      && (DAMAGE_TYPES[ability.hits[index].damage_type] === undefined || hit.type === DAMAGE_TYPES[ability.hits[index].damage_type])
      && (SCALINGS[ability.hits[index].motion_value_scaling] === undefined || action.scaling === SCALINGS[ability.hits[index].motion_value_scaling])))
  const named = candidates.filter((action) => normalize(action.name) === normalize(ability.name))
  return named.length === 1 ? named[0] : candidates.length === 1 ? candidates[0] : undefined
}

export interface StatefulPreview {
  method: 'partial-stateful'
  expected: number
  normal: number
  critical: number
  coveredActions: number
  totalActions: number
  complete: boolean
  warnings: string[]
}

type PreviewAction = { action: Team['actions'][number]; attack?: { id: string; group: string } }

const sonataName = (name: string) => name.replace(/ \dpc$/, '')

function availableEquipment(weaponName: string | undefined, rank: number, mainName: string | undefined, counts: ReadonlyMap<string, number>): { weapon: Weapon; pieces: Gear[] } | undefined {
  const weapons = ALL_WEAPONS.filter((entry) => entry.name.replace(/ R\d$/, '') === weaponName && entry.refinement === rank)
  const mains = ALL_ECHO_GEAR.filter((entry): entry is Mainslot => entry instanceof Mainslot && entry.name === mainName)
  if (weapons.length !== 1 || mains.length !== 1) return undefined
  const pieces: Gear[] = [mains[0]!]
  for (const [name, count] of counts) {
    const sets = ALL_ECHO_GEAR.filter((entry): entry is Sonata | Sonata1pc | Sonata2pc | Sonata3pc =>
      (entry instanceof Sonata || entry instanceof Sonata1pc || entry instanceof Sonata2pc || entry instanceof Sonata3pc)
      && sonataName(entry.name) === name)
    const five = sets.find((entry): entry is Sonata => entry instanceof Sonata)
    const three = sets.find((entry): entry is Sonata3pc => entry instanceof Sonata3pc)
    const two = sets.find((entry): entry is Sonata2pc => entry instanceof Sonata2pc)
    const one = sets.find((entry): entry is Sonata1pc => entry instanceof Sonata1pc)
    if (count >= 5 && five) pieces.push(five, five.sonata2pc)
    else {
      if (count >= 3 && three) pieces.push(three)
      if (count >= 2 && two) pieces.push(two)
      if (count >= 1 && one) pieces.push(one)
    }
    if (!sets.length) return undefined
  }
  return { weapon: weapons[0]!, pieces }
}

function statBridge(pieces: Gear[], target: AggregatedStats, bases: { characterBase: [number, number, number]; weaponBase: [number, number, number] }): Gear {
  const entries = menuStats(pieces)
  const staticTotal = (stat: Stat, tag: Attribute | Type | null = null) => entries.reduce((sum, entry) => {
    const [key, scope] = splitStat(entry.stat)
    return key === stat && scope === tag ? sum + entry.value : sum
  }, 0)
  const diff = (stat: Stat, value: number, tag: Attribute | Type | null = null): StatLine => tag === null
    ? [stat, value - staticTotal(stat)] : [stat, value - staticTotal(stat, tag), tag]
  const baseLines: StatLine[] = [
    diff(Stat.BaseAtk, target.baseAtk), diff(Stat.BaseHp, target.baseHp), diff(Stat.BaseDef, target.baseDef)
  ]
  const panel = panelStats([...pieces, new Gear({ stats: baseLines })], bases)
  const elementalBonuses: Array<[Attribute, number]> = [
    [Attribute.Aero, target.aeroDamage], [Attribute.Electro, target.electroDamage],
    [Attribute.Fusion, target.fusionDamage], [Attribute.Glacio, target.glacioDamage],
    [Attribute.Spectro, target.spectroDamage], [Attribute.Havoc, target.havocDamage]
  ]
  const lines: StatLine[] = [
    ...baseLines,
    [Stat.FlatAtk, target.atk - panel.atk],
    [Stat.FlatHp, target.hp - panel.hp],
    [Stat.FlatDef, target.def - panel.def],
    diff(Stat.CritRate, target.critRate), diff(Stat.CritDmg, target.critDamage), diff(Stat.ER, target.energyRegen),
    diff(Stat.DmgBonus, target.basicDamage, Type.Basic),
    diff(Stat.DmgBonus, target.heavyDamage, Type.Heavy),
    diff(Stat.DmgBonus, target.skillDamage, Type.Skill),
    diff(Stat.DmgBonus, target.liberationDamage, Type.Liberation),
    ...elementalBonuses.map(([element, value]) => diff(Stat.DmgBonus, value, element))
  ]
  return new Gear({ name: 'Owned equipment stats', stats: lines.filter(([, value]) => value !== 0) })
}

type PreparedGear = { loadout: Loadout; pieces: Gear[]; characterBase: [number, number, number]; weaponBase: [number, number, number] } | { reason: string }

function gearFor(member: CombatBuildMember, team: Team): PreparedGear {
  const loadouts = LOADOUTS.get(member.character.catalogId)
  if (!loadouts?.length) return { reason: 'Kit has no stateful loadout.' }
  const characterData = characterCatalog.find((entry) => entry.id === member.character.catalogId)
  const characterLevel = characterData?.levelStats.find((entry) => entry.level === member.character.level)
  const weaponData = weaponCatalog.find((entry) => entry.id === member.weapon.catalogId)
  const weaponLevel = weaponData?.levelStats.find((entry) => entry.level === member.weapon.level)
  if (!characterLevel || !weaponLevel) return { reason: 'Owned character or weapon level has no catalog base stats.' }
  const weaponName = weaponData?.name
  const main = member.echoes[0]
  const validEchoes = member.echoes.every((echo, index) => {
    const catalog = echoCatalog.find((entry) => entry.name === echo.name)
    // shortcut: generated theorycraft subslots have no Echo identity; validate their costs and set counts instead.
    return catalog ? catalog.cost === echo.cost && catalog.sonatas.includes(echo.sonata)
      : index > 0 && echo.id.startsWith('theorycraft:')
  })
  if (member.echoes.length !== 5 || member.echoes.reduce((cost, echo) => cost + echo.cost, 0) > 12
    || !validEchoes) {
    return { reason: 'Equipped Echoes or main Echo do not form a valid local loadout.' }
  }
  const counts = new Map<string, number>()
  member.echoes.forEach((echo) => counts.set(echo.sonata, (counts.get(echo.sonata) ?? 0) + 1))
  const choices = loadouts.flatMap((loadout) => {
    const weapon = loadout.refinements.flat().find((entry) => entry.name.replace(/ R\d$/, '') === weaponName && entry.refinement === member.weapon.rank)
    if (!weapon) return []
    return loadout.echoLoadouts.flatMap((entry) => {
      const expected = new Map<string, number>()
      entry.sets.forEach((sonata) => expected.set(sonataName(sonata.name), (expected.get(sonataName(sonata.name)) ?? 0) + sonata.size))
      return entry.mainslot.name === main?.name && member.echoes.length === 5
        && expected.size === counts.size && [...expected].every(([name, pieces]) => counts.get(name) === pieces)
        ? [{ loadout, weapon, set: entry }] : []
    })
  })
  const choice = choices[0]
  if (choice && choices.some((entry) => entry.loadout !== choice.loadout)) {
    return { reason: 'Several kit modes match this equipment; select a supported mode before stateful scoring.' }
  }
  const generic = !choice && loadouts.length === 1 ? availableEquipment(weaponName, member.weapon.rank, main?.name, counts) : undefined
  if (!choice && !generic) return { reason: 'Equipped weapon, main Echo, or Sonata combination is not covered by this kit.' }
  const loadout = choice?.loadout ?? loadouts[0]!
  const weapon = choice?.weapon ?? generic!.weapon
  if (member.character.sequence > loadout.sequences.length) return { reason: 'Sequence nodes are not covered by this kit.' }
  const stats = calculateBuildStats({ ...member, enemy: team.enemy, scenario: team.scenario })
  if (!stats.ok) return { reason: 'Owned build stats could not be resolved.' } as const
  const r = loadout.resonator
  const pieces = [r, r.talent!, r.inherent1!, r.inherent2!, weapon, ...(choice ? choice.set.pieces() : generic!.pieces), ...loadout.sequences.slice(0, member.character.sequence), loadout.mode].filter((piece): piece is Gear => piece !== undefined)
  const bases = {
    characterBase: [characterLevel.atk, characterLevel.hp, characterLevel.def] as [number, number, number],
    weaponBase: [weaponLevel.baseAtk, 0, 0] as [number, number, number]
  }
  return { loadout, pieces: [...pieces, statBridge(pieces, stats.stats, bases)], ...bases }
}

function manualBuffLine(effect: BuffEffect): StatLine | undefined {
  const plain: Partial<Record<BuffEffect['stat'], Stat>> = {
    atk: Stat.FlatAtk, hp: Stat.FlatHp, def: Stat.FlatDef,
    atkPercent: Stat.BonusAtk, hpPercent: Stat.BonusHp, defPercent: Stat.BonusDef,
    critRate: Stat.CritRate, critDamage: Stat.CritDmg, energyRegen: Stat.ER,
    healingBonus: Stat.HealingBonus, amplify: Stat.Amp
  }
  const typed: Partial<Record<BuffEffect['stat'], Type>> = {
    basicDamage: Type.Basic, heavyDamage: Type.Heavy,
    skillDamage: Type.Skill, liberationDamage: Type.Liberation
  }
  const elemental: Partial<Record<BuffEffect['stat'], Attribute>> = {
    aeroDamage: Attribute.Aero, electroDamage: Attribute.Electro, fusionDamage: Attribute.Fusion,
    glacioDamage: Attribute.Glacio, spectroDamage: Attribute.Spectro, havocDamage: Attribute.Havoc
  }
  const stat = plain[effect.stat]
  if (stat !== undefined) return [stat, effect.value]
  const type = typed[effect.stat]
  if (type !== undefined) return [Stat.DmgBonus, effect.value, type]
  const element = elemental[effect.stat]
  return element !== undefined ? [Stat.DmgBonus, effect.value, element] : undefined
}

const skillLevels = (member: CombatBuildMember) => member.character.skillLevels?.length === 5
  ? member.character.skillLevels : Array(5).fill(member.build.skillLevel || 1) as number[]

function configureMotionValues(state: State, member: CombatBuildMember, loadout: Loadout): void {
  const catalog = characterCatalog.find((entry) => entry.id === member.character.catalogId)
  const levels = skillLevels(member)
  for (const attack of catalog?.attacks ?? []) {
    const action = mappedAction(member.character.catalogId, attack.id, loadout, member.character.sequence)
    const level = levels[attack.skillLevelIndex] ?? 1
    if (!action?.def.bullets || !action.bullets.length || level === 10) continue
    const curves = attack.hitMultipliers
    const damaging = action.bullets.filter((hit) => hit.mv > 0)
    if (curves?.length !== damaging.length || curves.some((curve, index) => curve[level - 1] === undefined
      || Math.abs(Math.round(curve[9] * 10000) - damaging[index].mv) > 1)) continue
    let hitIndex = 0
    const variant = action.variant(action.name, { bullets: action.def.bullets.map((hit) =>
      (hit.mv ?? 0) > 0 ? { ...hit, mv: Math.round(curves[hitIndex++][level - 1] * 10000) } : hit) })
    variant.formOf = action
    state.actionVariants.set(action, variant)
  }
}

function calculatePreview(team: Team, members: readonly CombatBuildMember[], rows: readonly PreviewAction[]): StatefulPreview {
  const warnings: string[] = []
  const statuses = Object.entries(team.enemy.statusStacks ?? {})
  const invalidStatus = statuses.some(([name, count]) => {
    const gear = STATUS_GEAR[name as keyof typeof STATUS_GEAR]
    return !gear || !Number.isInteger(count) || count < 0 || count > gear.maxStacks
  })
  if ((team.enemy.cost ?? 4) !== 4 || invalidStatus || team.enemy.strainStacks
    || !Number.isInteger(team.enemy.havocBaneStacks ?? 0) || (team.enemy.havocBaneStacks ?? 0) < 0
    || (team.enemy.havocBaneStacks ?? 0) > HAVOC_BANE.maxStacks
    || !Number.isInteger(team.enemy.electroRageStacks ?? 0) || (team.enemy.electroRageStacks ?? 0) < 0
    || (team.enemy.electroRageStacks ?? 0) > ELECTRO_RAGE.maxStacks) {
    return { method: 'partial-stateful', expected: 0, normal: 0, critical: 0, coveredActions: 0, totalActions: rows.length, complete: false, warnings: ['Enemy modifiers in this scenario are not fully mapped.'] }
  }
  if (Object.values(team.scenario?.memberConditions ?? {}).some((conditions) => Object.keys(conditions).length)
    || Object.keys(team.scenario?.enemyConditions ?? {}).length
    || Object.keys(team.scenario?.selectedTargetByBuild ?? {}).length
    || rows.some((row) => Object.keys(row.action.inputs ?? {}).length)) {
    return { method: 'partial-stateful', expected: 0, normal: 0, critical: 0, coveredActions: 0, totalActions: rows.length, complete: false, warnings: ['Manual combat conditions are not mapped into the stateful preview.'] }
  }
  const selected = members.flatMap((member) => {
    const gear = gearFor(member, team)
    if ('pieces' in gear) return [{ member, gear }]
    warnings.push(`${member.character.catalogId}: ${gear.reason}`)
    return []
  })
  if (!selected.length) return { method: 'partial-stateful', expected: 0, normal: 0, critical: 0, coveredActions: 0, totalActions: rows.length, complete: false, warnings }
  const state = new State(selected.map(({ member }) => member.build.id))
  state.enemyLevel = team.enemy.level
  state.enemyResistance = team.enemy.resistance
  state.enemyDamageReduction = team.enemy.damageReduction
  if (team.enemy.havocBaneStacks) withTeam(state, () => equipEnemy(HAVOC_BANE, team.enemy.havocBaneStacks))
  for (const [name, count] of statuses) if (count) withTeam(state, () => equipEnemy(STATUS_GEAR[name as keyof typeof STATUS_GEAR], count))
  if (team.enemy.electroRageStacks) withTeam(state, () => equipEnemy(ELECTRO_RAGE, team.enemy.electroRageStacks))
  if (team.enemy.defenseReduction) withTeam(state, () => equipEnemy(new Gear({
    name: 'Enemy settings', constantStats: () => addEnemyStat(EnemyStat.DefReduce, team.enemy.defenseReduction ?? 0)
  })))
  const penetration: StatLine[] = []
  if (team.enemy.defenseIgnore) penetration.push([Stat.DefIgnoreNew, team.enemy.defenseIgnore])
  if (team.enemy.resistanceIgnore) penetration.push([Stat.ResIgnore, team.enemy.resistanceIgnore])
  const penetrationGear = penetration.length ? new Gear({ name: 'Enemy settings', stats: penetration }) : undefined
  selected.forEach(({ member, gear }, index) => {
    state.active = index
    state.slots[index]!.level = member.character.level
    withTeam(state, () => [...gear.pieces, ...(penetrationGear ? [penetrationGear] : [])].forEach((piece) => equip(piece)))
    state.slots[index]!.charBase = gear.characterBase
    state.slots[index]!.weaponBase = gear.weaponBase
    configureMotionValues(state, member, gear.loadout)
  })
  state.active = 0
  const casts: ScheduledCast[] = []
  for (const row of rows) {
    const index = selected.findIndex(({ member }) => member.build.id === row.action.buildId)
    if (index < 0) continue
    const characterId = selected[index]!.member.character.catalogId
    const action = mappedAction(characterId, row.attack?.id ?? row.action.attackId, selected[index]!.gear.loadout, selected[index]!.member.character.sequence, row.action.label)
      ?? (row.attack?.group === 'outro' ? EXPLICIT_ACTIONS[characterId]?.__outro : undefined)
      ?? (row.attack?.group === 'echo' && selected[index]!.member.echoes[0]?.name === 'Impermanence Heron' ? ACTION_HERON : undefined)
      ?? (row.attack?.group === 'echo' && selected[index]!.member.echoes[0]?.name === 'Nightmare: Tempest Mephis' ? ACTION_NM_TEMPEST_MEPHIS : undefined)
      ?? (row.attack?.group === 'echo' && selected[index]!.member.echoes[0]?.name === 'Forbidden Bastion' ? ACTION_FORBIDDEN_BASTION : undefined)
      ?? (row.attack?.group === 'echo' && selected[index]!.member.echoes[0]?.name === 'Thousand-Puppet Pavilion' ? ACTION_THOUSAND_PUPPET_PAVILION : undefined)
    if (!action) {
      warnings.push(`${row.action.label ?? row.attack?.id ?? 'Action'} has no compatible stateful cast.`)
      continue
    }
    if ((row.action.multiplier ?? 1) !== 1) {
      warnings.push(`${row.action.label ?? action.name} uses an unsupported repeat multiplier.`)
      continue
    }
    // shortcut: authored cancel and swap frames are not replayed; upgrade when the scheduler can honor their exact timing.
    if (row.action.cancel !== undefined || row.action.swapFrame !== undefined) {
      warnings.push(`${row.action.label ?? action.name} has cancel or swap timing that the automatic simulator cannot replay yet.`)
      continue
    }
    // shortcut: clips shorter than paid animation need explicit cancel forms; upgrade before scoring those edits.
    if (row.action.duration !== undefined && row.action.duration * 60 + 1 < action.cost(null).total) {
      warnings.push(`${row.action.label ?? action.name} ends before its authored animation.`)
      continue
    }
    if (skillLevels(selected[index]!.member).some((level) => level !== 10)
      && action.mv > 0 && !state.actionVariants.has(action)) {
      warnings.push(`${row.action.label ?? action.name} has no reviewed motion values at the owned skill level.`)
      continue
    }
    casts.push({ id: row.action.id, member: index, action, timestamp: row.action.timestamp })
  }
  if (!casts.length) return { method: 'partial-stateful', expected: 0, normal: 0, critical: 0, coveredActions: 0, totalActions: rows.length, complete: false, warnings: [...warnings, 'No saved cast is mapped for the equipped kits.'] }
  for (const effect of team.buffs ?? []) {
    const triggerIds = new Set(rows.filter((row) => row.action.buildId === effect.sourceBuildId
      && row.action.attackId === effect.triggerAttackId).map((row) => row.action.id))
    const triggers = new Set(casts.filter((cast) => triggerIds.has(cast.id)).map((cast) => cast.action))
    if (!triggers.size) continue
    if (effect.duration >= 0 && Math.round(effect.duration * 60) === 0) continue
    const sourceIndex = selected.findIndex(({ member }) => member.build.id === effect.sourceBuildId)
    const line = manualBuffLine(effect)
    if (sourceIndex < 0 || !line || !Number.isFinite(effect.value)
      || !Number.isFinite(effect.duration) || effect.duration < 0) {
      warnings.push(`${effect.name} has no compatible stateful buff.`)
      continue
    }
    const sourceName = selected[sourceIndex]!.member.build.id
    let receiver: Action | undefined
    let receiverName: string | undefined
    const buff = new Buff({ name: effect.name, duration: Math.round(effect.duration * 60), stats: [line],
      ...(effect.target === 'next' ? {
        updateBuffs: () => {
          if (!receiver && currentMember().name !== sourceName && !triggeredAction()) {
            receiver = baseAction(currentCast() as Action)
            receiverName = currentMember().name
          }
        },
        when: () => receiver !== undefined && currentMember().name === receiverName && runningAction(receiver),
        afterAction: () => {
          if (receiver && currentMember().name === receiverName && runningAction(receiver)) revokeTeam(buff)
        }
      } : {}) })
    const watcher = new Gear({ name: `${effect.name} trigger`, afterAction: () => {
      if (!triggeredAction() && runningAnyOf(triggers)) {
        if (effect.target === 'next') { receiver = undefined; receiverName = undefined; applyTeam(buff) }
        else if (effect.target === 'team') applyTeam(buff)
        else applyCurrent(buff)
      }
    } })
    state.active = sourceIndex
    withTeam(state, () => equip(watcher))
  }
  state.active = 0
  try {
    const result = runTimeline(state, casts, team.rotationDuration)
    if (result.hits.some((hit) => !Number.isFinite(hit.avg) || hit.avg < 0)) {
      throw new TimelineError('Damage', 'The stateful result contains an invalid hit.')
    }
    const unmet = result.rows.find((entry) => {
      const row = entry as ResolvedSnapshot
      return row.castUnmet?.some(Boolean) || row.buffUnmet?.length || row.buffForbidden?.length
    })
    if (unmet) throw new TimelineError(unmet.action.name, 'A required gauge or kit state was unavailable for this cast.')
    const unscaled = result.rows.find((row) => row.avg > 0 && selected.some(({ member }) => member.build.id === row.member
      && skillLevels(member).some((level) => level !== 10))
      && !state.actionVariants.has(baseAction(row.action)))
    if (unscaled) throw new TimelineError(unscaled.action.name, 'A triggered hit has no owned skill-level motion value.')
    const levelBased = result.rows.find((row) => selected.some(({ member }) => member.build.id === row.member
      && ((row.action.scaling === Scaling.Dot && negativeStatusLevels[member.character.level] === undefined)
        || (row.action.scaling === Scaling.Tune && tuneBreakLevelBases[member.character.level] === undefined))))
    if (levelBased) throw new TimelineError(levelBased.action.name, 'This level-based hit needs a reviewed scaling table for the owned character level.')
    return {
      method: 'partial-stateful',
      expected: result.hits.reduce((sum, hit) => sum + hit.avg, 0),
      normal: result.hits.reduce((sum, hit) => sum + hit.normal, 0),
      critical: result.hits.reduce((sum, hit) => sum + hit.critical, 0),
      coveredActions: casts.length,
      totalActions: rows.length,
      complete: casts.length === rows.length && selected.length === members.length && warnings.length === 0,
      warnings
    }
  } catch (error) {
    warnings.push(error instanceof TimelineError ? `${error.castId}: ${error.message}` : error instanceof Error ? error.message : 'Stateful rotation could not resolve.')
    return { method: 'partial-stateful', expected: 0, normal: 0, critical: 0, coveredActions: 0, totalActions: rows.length, complete: false, warnings }
  }
}

export function statefulPreview(team: Team, members: readonly CombatBuildMember[], rows: readonly PreviewAction[]): StatefulPreview | undefined {
  if (!rows.length || !members.some((member) => LOADOUTS.has(member.character.catalogId))) return undefined
  try {
    return calculatePreview(team, members, rows)
  } catch (error) {
    return {
      method: 'partial-stateful', expected: 0, normal: 0, critical: 0, coveredActions: 0, totalActions: rows.length, complete: false,
      warnings: [error instanceof Error ? error.message : 'Stateful kit setup could not resolve.']
    }
  }
}
