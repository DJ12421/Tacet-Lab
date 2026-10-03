import type {
  ActionMechanics,
  ActionRequest,
  ActionResult,
  AggregatedStats,
  CalculationDiagnostic,
  CalculationOutcome,
  CalculationTrace,
  Calculator,
  CombatMember,
  CombatSetup,
  DamageFormula,
  DamageBonusStat,
  DamageValues,
  EnemyInput,
  MechanicsRegistry,
  NegativeStatusFormula,
  ResultMode,
  RotationRequest,
  RotationResult,
  ScalingStat,
  StatValue,
  SupportFormula,
  TriggeredActionMechanics,
  TriggeredActionResult
} from './contract'
import { EffectResolutionFailure, resolveEffects, type ResolvedEffects } from './effects'
import { negativeStatusLevels, negativeStatusMotionValues } from '../../game-data/combat/negative-status'

class CombatFailure extends Error {
  constructor(readonly diagnostic: CalculationDiagnostic) {
    super(diagnostic.message)
  }
}

const success = <T>(value: T): CalculationOutcome<T> => ({ ok: true, value, warnings: [] })
const failure = <T>(diagnostic: CalculationDiagnostic): CalculationOutcome<T> => ({ ok: false, errors: [diagnostic], warnings: [] })
const gameplayFloor = (value: number) => Math.floor(value)

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new CombatFailure({ code: 'invalid-input', message: `${label} must be finite.` })
  return value
}

function positiveInteger(value: number, label: string): number {
  finite(value, label)
  if (!Number.isInteger(value) || value <= 0) throw new CombatFailure({ code: 'invalid-input', message: `${label} must be a positive integer.` })
  return value
}

function nonNegativeInteger(value: number, label: string): number {
  finite(value, label)
  if (!Number.isInteger(value) || value < 0) throw new CombatFailure({ code: 'invalid-input', message: `${label} must be a non-negative integer.` })
  return value
}

function havocBaneReduction(enemy: EnemyInput) {
  const stacks = nonNegativeInteger(enemy.havocBaneStacks ?? 0, 'Havoc Bane stacks')
  if (stacks > 3) throw new CombatFailure({ code:'invalid-input', message:'Havoc Bane supports at most 3 stacks.' })
  return stacks * 0.02
}

function sum(values: readonly number[] | undefined, label: string) {
  return values?.reduce((total, value) => total + finite(value, label), 0) ?? 0
}

function unsupported(message: string, sourceId: string, actorId?: string, actionId?: string): never {
  throw new CombatFailure({ code: 'unsupported-mechanic', message, sourceId, actorId, actionId })
}

function rotationFinite(value: number, label: string, actorId?: string, actionId?: string) {
  if (!Number.isFinite(value)) throw new CombatFailure({ code: 'invalid-rotation', message: `${label} must be finite.`, actorId, actionId })
  return value
}

function requireReviewed(sourceId: string, reviewFingerprint: string, actorId?: string, actionId?: string) {
  if (typeof sourceId !== 'string' || !sourceId.trim() || typeof reviewFingerprint !== 'string' || !reviewFingerprint.trim()) throw new CombatFailure({
    code: 'stale-data',
    message: 'Executable mechanics require a source ID and review fingerprint.',
    sourceId: typeof sourceId === 'string' && sourceId ? sourceId : undefined,
    actorId,
    actionId
  })
}

function addStatLine(
  line: StatValue,
  percent: Record<'hp' | 'atk' | 'def', number>,
  flat: Record<'hp' | 'atk' | 'def', number>,
  secondary: Record<Exclude<StatValue['stat'], 'hp' | 'atk' | 'def'>, number>
) {
  finite(line.value, `${line.stat} stat value`)
  if (line.stat === 'hp' || line.stat === 'atk' || line.stat === 'def') {
    if (line.mode === 'percent') percent[line.stat] += line.value
    else flat[line.stat] += line.value
    return
  }
  if (line.mode !== 'flat') throw new CombatFailure({ code: 'invalid-input', message: `${line.stat} must use flat ratio units.` })
  secondary[line.stat] += line.value
}

function materializeStats(registry: MechanicsRegistry, member: CombatMember, effectStatLines: readonly StatValue[]): AggregatedStats {
  const character = registry.characters[member.character.id]
  if (!character) throw new CombatFailure({ code: 'missing-mechanic', message: `Character ${member.character.id} is not in the registry.`, actorId: member.memberId })
  const weapon = registry.weapons[member.weapon.id]
  if (!weapon) throw new CombatFailure({ code: 'missing-mechanic', message: `Weapon ${member.weapon.id} is not in the registry.`, actorId: member.memberId })
  requireReviewed(character.sourceId, character.reviewFingerprint, member.memberId)
  requireReviewed(weapon.sourceId, weapon.reviewFingerprint, member.memberId)
  if (character.id !== member.character.id || weapon.id !== member.weapon.id) throw new CombatFailure({ code: 'invalid-input', message: 'Registry keys must match their mechanic IDs.', actorId: member.memberId })

  positiveInteger(member.character.level, 'Character level')
  nonNegativeInteger(member.character.sequence, 'Character sequence')
  positiveInteger(member.weapon.level, 'Weapon level')
  positiveInteger(member.weapon.rank, 'Weapon rank')
  const characterLevelRows = character.levelStats.filter((entry) => entry.level === member.character.level)
  if (characterLevelRows.length !== 1) throw new CombatFailure({ code: characterLevelRows.length ? 'invalid-input' : 'missing-mechanic', message: `Character level ${member.character.level} must have exactly one registry row.`, sourceId: character.sourceId, actorId: member.memberId })
  const weaponLevelRows = weapon.levelStats.filter((entry) => entry.level === member.weapon.level)
  if (weaponLevelRows.length !== 1) throw new CombatFailure({ code: weaponLevelRows.length ? 'invalid-input' : 'missing-mechanic', message: `Weapon level ${member.weapon.level} must have exactly one registry row.`, sourceId: weapon.sourceId, actorId: member.memberId })
  const characterStats = characterLevelRows[0]
  const weaponStats = weaponLevelRows[0]

  const baseHp = gameplayFloor(finite(characterStats.hp, 'Character HP'))
  const baseAtk = gameplayFloor(finite(characterStats.atk, 'Character ATK')) + gameplayFloor(finite(weaponStats.atk, 'Weapon ATK'))
  const baseDef = gameplayFloor(finite(characterStats.def, 'Character DEF'))
  const percent = { hp: 0, atk: 0, def: 0 }
  const flat = { hp: 0, atk: 0, def: 0 }
  const secondary: Record<Exclude<StatValue['stat'], 'hp' | 'atk' | 'def'>, number> = {
    critRate:0, critDamage:0, energyRegen:0, healingBonus:0, shieldBonus:0,
    basicDamage:0, heavyDamage:0, skillDamage:0, liberationDamage:0, introDamage:0, outroDamage:0,
    echoDamage:0, tuneBreakDamage:0, spectroDamage:0, fusionDamage:0, glacioDamage:0,
    electroDamage:0, aeroDamage:0, havocDamage:0, physicalDamage:0
  }

  for (const line of [...(weapon.stats ?? []), ...(weaponStats.stats ?? [])]) addStatLine(line, percent, flat, secondary)
  for (const echo of member.echoes) {
    nonNegativeInteger(echo.level, 'Echo level')
    positiveInteger(echo.rarity, 'Echo rarity')
    addStatLine(echo.mainStat, percent, flat, secondary)
    for (const line of echo.substats) addStatLine(line, percent, flat, secondary)
  }
  for (const line of effectStatLines) addStatLine(line, percent, flat, secondary)

  const stats: AggregatedStats = {
    baseHp,
    baseAtk,
    baseDef,
    hp: baseHp * (1 + percent.hp) + flat.hp,
    atk: baseAtk * (1 + percent.atk) + flat.atk,
    def: baseDef * (1 + percent.def) + flat.def,
    critRate: finite(characterStats.critRate, 'Crit. Rate') + secondary.critRate,
    critDamage: finite(characterStats.critDamage, 'Crit. DMG') + secondary.critDamage,
    energyRegen: finite(characterStats.energyRegen, 'Energy Regen') + secondary.energyRegen,
    healingBonus: secondary.healingBonus,
    shieldBonus: secondary.shieldBonus,
    basicDamage:secondary.basicDamage, heavyDamage:secondary.heavyDamage, skillDamage:secondary.skillDamage,
    liberationDamage:secondary.liberationDamage, introDamage:secondary.introDamage, outroDamage:secondary.outroDamage,
    echoDamage:secondary.echoDamage, tuneBreakDamage:secondary.tuneBreakDamage,
    spectroDamage:secondary.spectroDamage, fusionDamage:secondary.fusionDamage, glacioDamage:secondary.glacioDamage,
    electroDamage:secondary.electroDamage, aeroDamage:secondary.aeroDamage, havocDamage:secondary.havocDamage,
    physicalDamage:secondary.physicalDamage
  }
  if (stats.hp < 0 || stats.atk < 0 || stats.def < 0) throw new CombatFailure({ code: 'invalid-input', message: 'Final HP, ATK, and DEF cannot be negative.', actorId: member.memberId })
  if (stats.critDamage < 0 || stats.energyRegen < 0) throw new CombatFailure({ code: 'invalid-input', message: 'Crit. DMG and Energy Regen cannot be negative.', actorId: member.memberId })
  for (const [key, value] of Object.entries(stats)) finite(value, key)
  return stats
}

const STAT_TRACE_LABELS: Record<ScalingStat | 'critRate' | 'critDamage', string> = {
  hp:'HP', atk:'ATK', def:'DEF', energyRegen:'Energy Regen', critRate:'Crit. Rate', critDamage:'Crit. DMG'
}

function statTrace(registry: MechanicsRegistry, member: CombatMember, effects: ResolvedEffects, stats: AggregatedStats, stat: ScalingStat | 'critRate' | 'critDamage'): CalculationTrace {
  const character = registry.characters[member.character.id]!
  const weapon = registry.weapons[member.weapon.id]!
  const characterStats = character.levelStats.find((entry) => entry.level === member.character.level)!
  const weaponStats = weapon.levelStats.find((entry) => entry.level === member.weapon.level)!
  const sources = [
    ...(weapon.stats ?? []).map((value) => ({ label:'Weapon passive stat', value })),
    ...(weaponStats.stats ?? []).map((value) => ({ label:'Weapon secondary stat', value })),
    ...member.echoes.flatMap((echo, echoIndex) => {
      const echoLabel = registry.echoes?.[echo.catalogId]?.name ?? `Echo ${echoIndex + 1}`
      return [
        { label:`${echoLabel} main stat`, value:echo.mainStat },
        ...echo.substats.map((value) => ({ label:`${echoLabel} substat`, value }))
      ]
    }),
    ...effects.contributions.statLines
  ].filter((entry) => entry.value.stat === stat)
  const label = STAT_TRACE_LABELS[stat]
  if (stat === 'hp' || stat === 'atk' || stat === 'def') {
    const characterBase = gameplayFloor(characterStats[stat])
    const weaponBase = stat === 'atk' ? gameplayFloor(weaponStats.atk) : 0
    const percentSources = sources.filter((entry) => entry.value.mode === 'percent')
    const flatSources = sources.filter((entry) => entry.value.mode === 'flat')
    return {
      stage:`stat-total:${label}`, value:stats[stat], children:[
        { stage:`number:Base ${label}`, value:characterBase + weaponBase, children:[
          { stage:`number:Character base ${label}`, value:characterBase, children:[] },
          ...(weaponBase ? [{ stage:'number:Weapon base ATK', value:weaponBase, children:[] }] : [])
        ] },
        { stage:`percent:Total ${label} bonus`, value:percentSources.reduce((total, entry) => total + entry.value.value, 0), children:percentSources.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value.value, children:[] })) },
        { stage:`number:Flat ${label}`, value:flatSources.reduce((total, entry) => total + entry.value.value, 0), children:flatSources.map((entry) => ({ stage:`number:${entry.label}`, value:entry.value.value, children:[] })) }
      ]
    }
  }
  const base = characterStats[stat]
  return {
    stage:`percent:Total ${label}`, value:stats[stat], children:[
      { stage:`percent:Character base ${label}`, value:base, children:[] },
      ...sources.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value.value, children:[] }))
    ]
  }
}

function scalingPower(stats: AggregatedStats, scaling: Readonly<Partial<Record<ScalingStat, number>>>) {
  let total = 0
  for (const [stat, rawRatio] of Object.entries(scaling) as Array<[ScalingStat, number]>) {
    const ratio = finite(rawRatio, `${stat} scaling ratio`)
    if (ratio < 0) throw new CombatFailure({ code: 'invalid-input', message: `${stat} scaling ratio cannot be negative.` })
    total += (stat === 'energyRegen' ? stats.energyRegen * 100 : stats[stat]) * ratio
  }
  return total
}

function defenseMultiplier(attackerLevel: number, enemy: EnemyInput, reduction: number, ignore: number) {
  const attackerTerm = 800 + 8 * attackerLevel
  const enemyTerm = (792 + 8 * enemy.level) * (1 - reduction) * (1 - ignore)
  const denominator = attackerTerm + enemyTerm
  if (!Number.isFinite(denominator) || denominator === 0) throw new CombatFailure({ code: 'invalid-input', message: 'Defence inputs produce an invalid denominator.' })
  return attackerTerm / denominator
}

function resistanceMultiplier(base: number, reduction: number, ignore: number) {
  const totalReduction = reduction + ignore
  if (totalReduction === 0) return 1 - base
  if (base <= 0) return 1 - (base - totalReduction / 2)
  const excess = totalReduction - base
  return excess <= 0 ? 1 - (base - totalReduction) : 1 + excess / 2
}

function critValues(preCrit: number, stats: AggregatedStats, canCrit: boolean, override: ResolvedEffects['critOverride']): DamageValues {
  const normal = finite(preCrit, 'Pre-crit damage')
  if (override === 'never' || (!canCrit && override !== 'always')) return { normal, critical: normal, expected: normal }
  const rate = override === 'always' ? 1 : Math.min(1, Math.max(0, stats.critRate))
  return {
    normal,
    critical: finite(preCrit * stats.critDamage, 'Critical damage'),
    expected: finite(preCrit * (1 + rate * (stats.critDamage - 1)), 'Expected damage')
  }
}

function calculateDamage(
  registry: MechanicsRegistry,
  request: ActionRequest,
  member: CombatMember,
  action: ActionMechanics,
  formula: DamageFormula,
  stats: AggregatedStats,
  attackerLevel: number,
  effects: ResolvedEffects
) {
  const enemy = request.setup.enemy
  if (!action.element) throw new CombatFailure({ code: 'invalid-input', message: 'A damage action must declare an element.', sourceId: action.sourceId, actorId: request.actorId, actionId: request.actionId })
  if (formula.hits.length === 0) throw new CombatFailure({ code: 'invalid-input', message: 'A damage action must contain at least one hit.', sourceId: action.sourceId, actorId: request.actorId, actionId: request.actionId })

  const power = scalingPower(stats, formula.scaling)
  const scalingSources = (Object.entries(formula.scaling) as Array<[ScalingStat, number]>).map(([stat, ratio]) => ({
    stage:`scaling:${STAT_TRACE_LABELS[stat]}`,
    value:(stat === 'energyRegen' ? stats.energyRegen * 100 : stats[stat]) * ratio,
    children:[statTrace(registry, member, effects, stats, stat), { stage:'percent:Scaling ratio', value:ratio, children:[] }]
  }))
  const typeBonusKey = action.damageType === 'status'
    ? undefined
    : `${action.damageType === 'tune-break' ? 'tuneBreak' : action.damageType}Damage` as DamageBonusStat
  const elementBonusKey = `${action.element}Damage` as DamageBonusStat
  const statDamageBonus = (typeBonusKey ? stats[typeBonusKey] : 0) + (stats[elementBonusKey] ?? 0)
  const bonusFactor = Math.max(0, 1 + statDamageBonus + sum(formula.damageBonuses, 'Damage bonus') + sum(effects.damageBonuses, 'Effect damage bonus'))
  const motionValueFactor = Math.max(0, 1 + sum(effects.motionValueBonuses, 'Effect motion-value increase'))
  const amplifyFactor = Math.max(0, 1 + sum(formula.amplifications, 'Amplification') + sum(effects.amplifications, 'Effect amplification'))
  const vulnerabilityFactor = Math.max(0, 1 + sum(formula.vulnerabilities, 'Vulnerability') + sum(effects.vulnerabilities, 'Effect vulnerability'))
  const strainStacks = nonNegativeInteger(enemy.strainStacks ?? 0, 'Tune Strain stacks')
  if (strainStacks > 4) throw new CombatFailure({ code:'invalid-input', message:'Tune Strain supports at most 4 stacks.' })
  const strainBonus = action.damageType === 'status' ? 0 : strainStacks * finite(member.conditionStats?.tuneBreakBoost ?? 0, 'Tune Break Boost') / 100 * 0.12
  const finalDamageFactor = Math.max(0, 1 + sum(formula.finalDamageBonuses, 'Final damage bonus') + sum(effects.finalDamageBonuses, 'Effect final damage bonus') + strainBonus)
  const baneReduction = havocBaneReduction(enemy)
  const coreOfCollapseFactor = action.id === 'echo:6000167:skill:2' && baneReduction > 0 ? 2 : 1
  const specialFactor = coreOfCollapseFactor * effects.specialMultipliers.reduce((factor, value) => factor * Math.max(0, 1 + finite(value, 'Special multiplier')), 1)
  const damageReductionFactor = Math.max(0, 1 - finite(enemy.damageReduction, 'Damage reduction'))
  const defenseReduction = finite(enemy.defenseReduction ?? 0, 'Defence reduction') + effects.defenseReduction + baneReduction
  const defenseIgnore = action.damageType === 'status' ? 0 : finite(enemy.defenseIgnore ?? 0, 'Defence ignore') + effects.defenseIgnore
  const defense = defenseMultiplier(attackerLevel, enemy, defenseReduction, defenseIgnore)
  const baseResistance = finite(enemy.resistance[action.element] ?? 0, `${action.element} resistance`)
  const resistance = resistanceMultiplier(
    baseResistance,
    finite(enemy.resistanceReduction ?? 0, 'Resistance reduction') + effects.resistanceReduction,
    finite(enemy.resistanceIgnore ?? 0, 'Resistance ignore') + effects.resistanceIgnore
  )
  if (formula.flatHits && formula.flatHits.length !== formula.hits.length) throw new CombatFailure({ code: 'invalid-input', message: 'Flat damage values must align with damage hits.', sourceId: action.sourceId, actorId: request.actorId, actionId: request.actionId })
  const hits = formula.hits.map((motionValue, index) => {
    finite(motionValue, 'Hit motion value')
    if (motionValue < 0) throw new CombatFailure({ code: 'invalid-input', message: 'Hit motion values cannot be negative.', sourceId: action.sourceId, actorId: request.actorId, actionId: request.actionId })
    const flatValue = finite(formula.flatHits?.[index] ?? 0, 'Flat damage')
    if (flatValue < 0) throw new CombatFailure({ code: 'invalid-input', message: 'Flat damage cannot be negative.', sourceId: action.sourceId, actorId: request.actorId, actionId: request.actionId })
    const effectiveMotionValue = motionValue * motionValueFactor
    const preCrit = (power * effectiveMotionValue + flatValue) * bonusFactor * amplifyFactor * vulnerabilityFactor * finalDamageFactor * specialFactor * defense * resistance * damageReductionFactor
    const boundedPreCrit = Math.max(0, finite(preCrit, 'Pre-crit damage'))
    const values = critValues(boundedPreCrit, stats, formula.canCrit, effects.critOverride)
    return {
      values,
      trace: {
        stage: `hit-${index + 1}`,
        children: [
          { stage: 'motion-value', value: motionValue, children: [] },
          { stage: 'motion-value-factor', value: motionValueFactor, children:effects.contributions.motionValueBonuses.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value, children:[] })) },
          ...(flatValue ? [{ stage: 'flat-damage', value: flatValue, children: [] }] : []),
          { stage: 'pre-crit', value: boundedPreCrit, children: [] },
          { stage: 'result-normal', value: values.normal, children: [] },
          { stage: 'result-critical', value: values.critical, children: [] },
          { stage: 'result-expected', value: values.expected, children: [] }
        ]
      } satisfies CalculationTrace
    }
  })
  return {
    hitValues: hits.map((hit) => hit.values),
    trace: {
      stage: 'damage',
      children: [
        { stage: 'scaling-power', value: power, children:scalingSources },
        { stage: 'bonus-factor', value: bonusFactor, children:[
          ...(typeBonusKey && stats[typeBonusKey] ? [{ stage:`percent:${typeBonusKey}`, value:stats[typeBonusKey], children:[] }] : []),
          ...(stats[elementBonusKey] ? [{ stage:`percent:${elementBonusKey}`, value:stats[elementBonusKey], children:[] }] : []),
          ...(formula.damageBonuses ?? []).map((value, index) => ({ stage:`percent:Action DMG bonus ${index + 1}`, value, children:[] })),
          ...effects.contributions.damageBonuses.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value, children:[] }))
        ] },
        { stage: 'amplification-factor', value: amplifyFactor, children:[
          ...(formula.amplifications ?? []).map((value, index) => ({ stage:`percent:Action amplify ${index + 1}`, value, children:[] })),
          ...effects.contributions.amplifications.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value, children:[] }))
        ] },
        { stage: 'vulnerability-factor', value: vulnerabilityFactor, children:[
          ...(formula.vulnerabilities ?? []).map((value, index) => ({ stage:`percent:Action vulnerability ${index + 1}`, value, children:[] })),
          ...effects.contributions.vulnerabilities.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value, children:[] }))
        ] },
        { stage: 'final-damage-factor', value: finalDamageFactor, children:[
          ...(formula.finalDamageBonuses ?? []).map((value, index) => ({ stage:`percent:Action final DMG ${index + 1}`, value, children:[] })),
          ...effects.contributions.finalDamageBonuses.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value, children:[] })),
          ...(strainBonus ? [{ stage:'percent:Tune Strain', value:strainBonus, children:[] }] : [])
        ] },
        { stage: 'special-multiplier', value: specialFactor, children:[...effects.contributions.specialMultipliers.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value, children:[] })), ...(coreOfCollapseFactor > 1 ? [{ stage:'percent:Havoc Bane Core of Collapse', value:1, children:[] }] : [])] },
        { stage: 'damage-reduction-factor', value: damageReductionFactor, children:[{ stage:'percent:Enemy DMG reduction', value:enemy.damageReduction, children:[] }] },
        { stage: 'defence-multiplier', value: defense, children:[
          { stage:'number:Character level', value:attackerLevel, children:[] },
          { stage:'number:Enemy level', value:enemy.level, children:[] },
          { stage:'percent:DEF reduction', value:defenseReduction, children:[
            ...(enemy.defenseReduction ? [{ stage:'percent:Enemy setting', value:enemy.defenseReduction, children:[] }] : []),
            ...(baneReduction ? [{ stage:'percent:Havoc Bane', value:baneReduction, children:[] }] : []),
            ...effects.contributions.defenseReduction.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value, children:[] }))
          ] },
          { stage:'percent:DEF ignore', value:defenseIgnore, children:[
            ...(action.damageType !== 'status' && enemy.defenseIgnore ? [{ stage:'percent:Enemy setting', value:enemy.defenseIgnore, children:[] }] : []),
            ...effects.contributions.defenseIgnore.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value, children:[] }))
          ] }
        ] },
        { stage: 'resistance-multiplier', value: resistance, children:[
          { stage:`percent:Base ${action.element} RES`, value:baseResistance, children:[] },
          { stage:'percent:RES reduction', value:(enemy.resistanceReduction ?? 0) + effects.resistanceReduction, children:effects.contributions.resistanceReduction.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value, children:[] })) },
          { stage:'percent:RES ignore', value:(enemy.resistanceIgnore ?? 0) + effects.resistanceIgnore, children:effects.contributions.resistanceIgnore.map((entry) => ({ stage:`percent:${entry.label}`, value:entry.value, children:[] })) }
        ] },
        { stage:'crit-rate', value:effects.critOverride === 'always' ? 1 : effects.critOverride === 'never' ? 0 : Math.min(1, Math.max(0, stats.critRate)), children:[statTrace(registry, member, effects, stats, 'critRate')] },
        { stage:'crit-damage', value:stats.critDamage, children:[statTrace(registry, member, effects, stats, 'critDamage')] },
        ...hits.map((hit) => hit.trace)
      ]
    } satisfies CalculationTrace
  }
}

function resolveAction(registry: MechanicsRegistry, member: CombatMember, actionId: string): ActionMechanics {
  const character = registry.characters[member.character.id]
  const characterAction = character?.actions[actionId]
  if (characterAction) {
    requireReviewed(characterAction.sourceId, characterAction.reviewFingerprint, member.memberId, actionId)
    if (!('formulas' in characterAction)) return characterAction
    const requestedLevel = member.character.skillLevels[characterAction.skillLevelIndex] ?? 1
    const formula = characterAction.formulas[requestedLevel]
      ?? (Object.keys(characterAction.formulas).length === 1 ? Object.values(characterAction.formulas)[0] : undefined)
    if (!formula) throw new CombatFailure({ code:'missing-mechanic', message:`${characterAction.name} has no reviewed skill level ${requestedLevel} formula.`, sourceId:characterAction.sourceId, actorId:member.memberId, actionId })
    const { formulas: _formulas, name: _name, group: _group, skillLevelIndex: _skillLevelIndex, ...action } = characterAction
    return { ...action, formula }
  }
  if (!member.mainEchoId) throw new CombatFailure({ code: 'missing-mechanic', message: `Action ${actionId} is not in the registry.`, sourceId: character?.sourceId, actorId: member.memberId, actionId })
  const equipped = member.echoes.find((echo) => echo.instanceId === member.mainEchoId)
  if (!equipped) throw new CombatFailure({ code: 'invalid-input', message: `Main Echo ${member.mainEchoId} is not equipped.`, sourceId: member.mainEchoId, actorId: member.memberId, actionId })
  const echo = registry.echoes?.[equipped.catalogId]
  const rankedAction = echo?.actions[actionId]
  if (!echo || !rankedAction) throw new CombatFailure({ code: 'missing-mechanic', message: `Action ${actionId} is not in the registry.`, sourceId: echo?.sourceId ?? equipped.catalogId, actorId: member.memberId, actionId })
  requireReviewed(echo.sourceId, echo.reviewFingerprint, member.memberId, actionId)
  requireReviewed(rankedAction.sourceId, rankedAction.reviewFingerprint, member.memberId, actionId)
  const formula = rankedAction.formulas[equipped.rarity]
  if (!formula) throw new CombatFailure({ code: 'missing-mechanic', message: `${echo.name} has no reviewed rank ${equipped.rarity} formula.`, sourceId: rankedAction.sourceId, actorId: member.memberId, actionId })
  const { formulas: _formulas, name: _name, description: _description, ...action } = rankedAction
  return { ...action, formula, ...(echo.cooldownSeconds === undefined ? {} : { cooldownSeconds:echo.cooldownSeconds }) }
}

function cooldownKey(registry: MechanicsRegistry, member: CombatMember, actionId: string) {
  if (registry.characters[member.character.id]?.actions[actionId]) return `${member.memberId}:${actionId}`
  const equipped = member.echoes.find((echo) => echo.instanceId === member.mainEchoId)
  const echo = equipped ? registry.echoes?.[equipped.catalogId] : undefined
  return echo?.actions[actionId] ? `${member.memberId}:echo:${equipped?.catalogId}` : `${member.memberId}:${actionId}`
}

const tuneBreakLevelBases: Readonly<Record<number, number>> = { 1:2.215, 20:5.932, 40:29.357, 50:60.934, 60:130.868, 70:249.715, 80:437.085, 90:716.22 }

function calculateTuneBreak(request: ActionRequest, member: CombatMember, stats: AggregatedStats, effects: ResolvedEffects) {
  const cost = request.setup.enemy.cost
  if (cost !== 1 && cost !== 3 && cost !== 4) throw new CombatFailure({ code:'invalid-input', message:'Tune Break requires enemy Cost 1, 3, or 4.', actorId:request.actorId, actionId:request.actionId })
  const levelBase = tuneBreakLevelBases[member.character.level]
  if (levelBase === undefined) unsupported(`Tune Break has no reviewed level value for character level ${member.character.level}.`, 'tune-break', request.actorId, request.actionId)
  const base = levelBase * (cost === 1 ? 1 : cost === 3 ? 3 : 14)
  const boost = finite(member.conditionStats?.tuneBreakBoost ?? 0, 'Tune Break Boost')
  const enemy = request.setup.enemy
  const defense = defenseMultiplier(member.character.level, enemy, finite(enemy.defenseReduction ?? 0, 'Defence reduction') + effects.defenseReduction + havocBaneReduction(enemy), finite(enemy.defenseIgnore ?? 0, 'Defence ignore') + effects.defenseIgnore)
  const resistance = resistanceMultiplier(finite(enemy.resistance.physical ?? 0, 'Physical resistance'), 0, 0)
  const bonus = Math.max(0, 1 + stats.tuneBreakDamage + sum(effects.damageBonuses, 'Tune Break damage bonus'))
  const special = effects.specialMultipliers.reduce((factor, value) => factor * Math.max(0, 1 + finite(value, 'Special multiplier')), 1)
  const vulnerability = Math.max(0, 1 + sum(effects.vulnerabilities, 'Vulnerability'))
  const finalDamage = Math.max(0, 1 + sum(effects.finalDamageBonuses, 'Final damage bonus'))
  const reduction = Math.max(0, 1 - finite(enemy.damageReduction, 'Damage reduction'))
  const value = Math.max(0, finite(base * 12.8 * (1 + boost / 100) * bonus * special * defense * resistance * vulnerability * finalDamage * reduction, 'Tune Break damage'))
  const values = critValues(value, stats, false, 'never')
  return {
    hitValues:[values],
    trace:{ stage:'tune-break', children:[
      { stage:'number:Enemy Cost', value:cost, children:[] },
      { stage:'number:Tune base value', value:base, children:[] },
      { stage:'number:Base multiplier', value:12.8, children:[] },
      { stage:'percent:Tune Break Boost', value:boost / 100, children:[] },
      { stage:'bonus-factor', value:bonus, children:[] },
      { stage:'special-multiplier', value:special, children:[] },
      { stage:'defence-multiplier', value:defense, children:[] },
      { stage:'resistance-multiplier', value:resistance, children:[] },
      { stage:'vulnerability-factor', value:vulnerability, children:[] },
      { stage:'final-damage-factor', value:finalDamage, children:[] },
      { stage:'damage-reduction-factor', value:reduction, children:[] },
      { stage:'result', value, children:[] }
    ] } satisfies CalculationTrace
  }
}

function calculateNegativeStatus(request: ActionRequest, member: CombatMember, action: ActionMechanics, formula: NegativeStatusFormula, effects: ResolvedEffects) {
  const enemy = request.setup.enemy
  if (!action.element || action.element === 'none' || action.element === 'physical') throw new CombatFailure({ code:'invalid-input', message:'Negative status damage requires an elemental type.', sourceId:action.sourceId, actorId:request.actorId, actionId:request.actionId })
  const table = negativeStatusMotionValues[formula.status]
  const stacks = nonNegativeInteger(enemy.statusStacks?.[formula.status] ?? 0, `${formula.status} stacks`)
  if (stacks >= table.length) throw new CombatFailure({ code:'invalid-input', message:`${formula.status} supports at most ${table.length - 1} stacks.`, actorId:request.actorId, actionId:request.actionId })
  const rage = formula.status === 'electro-flare' ? nonNegativeInteger(enemy.electroRageStacks ?? 0, 'Electro Rage stacks') : 0
  if (rage >= negativeStatusMotionValues['electro-flare'].length) throw new CombatFailure({ code:'invalid-input', message:'Electro Rage supports at most 13 stacks.', actorId:request.actorId, actionId:request.actionId })
  const levelValue = negativeStatusLevels[member.character.level]
  if (levelValue === undefined && stacks > 0) unsupported(`Negative status damage has no estimated level value for character level ${member.character.level}.`, action.sourceId, request.actorId, request.actionId)
  const defenseReduction = finite(enemy.defenseReduction ?? 0, 'Defence reduction') + effects.defenseReduction + havocBaneReduction(enemy)
  const defense = defenseMultiplier(member.character.level, enemy, defenseReduction, 0)
  const resistance = resistanceMultiplier(finite(enemy.resistance[action.element ?? 'none'] ?? 0, 'Status resistance'), finite(enemy.resistanceReduction ?? 0, 'Resistance reduction') + effects.resistanceReduction, 0)
  const motionValue = stacks > 0 ? (table[stacks] + (formula.status === 'electro-flare' ? negativeStatusMotionValues['electro-flare'][rage] : 0)) / 10000 : 0
  const amplify = Math.max(0, 1 + sum(effects.amplifications, 'Status amplification'))
  const value = Math.max(0, finite((levelValue ?? 0) * motionValue * defense * resistance * amplify, 'Negative status damage'))
  return {
    hitValues:[{ normal:value, critical:value, expected:value }],
    trace:{ stage:'negative-status', children:[
      { stage:'number:Status stacks', value:stacks, children:[] },
      ...(formula.status === 'electro-flare' ? [{ stage:'number:Electro Rage stacks', value:rage, children:[] }] : []),
      { stage:'number:Level constant', value:levelValue ?? 0, children:[] },
      { stage:'motion-value', value:motionValue, children:[] },
      { stage:'defence-multiplier', value:defense, children:[] },
      { stage:'resistance-multiplier', value:resistance, children:[] },
      { stage:'amplification-factor', value:amplify, children:[] },
      { stage:'result', value, children:[] }
    ] } satisfies CalculationTrace
  }
}

function calculateSupport(formula: SupportFormula, stats: AggregatedStats, effects: ResolvedEffects) {
  const power = scalingPower(stats, formula.scaling)
  const motionValueFactor = Math.max(0, 1 + sum(effects.motionValueBonuses, 'Effect motion-value increase'))
  const motionValue = finite(formula.motionValue * motionValueFactor, 'Support motion value')
  const flatValue = finite(formula.flatValue, 'Support flat value')
  if (motionValue < 0 || flatValue < 0) throw new CombatFailure({ code: 'invalid-input', message: 'Support motion and flat values cannot be negative.' })
  const nativeBonus = formula.kind === 'healing' ? stats.healingBonus : stats.shieldBonus
  const bonusFactor = Math.max(0, 1 + nativeBonus + sum(formula.bonuses, 'Support bonus'))
  const rawValue = finite((power * motionValue + flatValue) * bonusFactor, 'Support value')
  const value = gameplayFloor(rawValue)
  return {
    hitValues: [{ normal: value, critical: value, expected: value }],
    trace: {
      stage: formula.kind,
      children: [
        { stage: 'scaling-power', value: power, children: [] },
        { stage: 'motion-value-factor', value: motionValueFactor, children: [] },
        { stage: 'flat-value', value: flatValue, children: [] },
        { stage: 'support-bonus-factor', value: bonusFactor, children: [] },
        { stage: 'result', value, children: [] }
      ]
    } satisfies CalculationTrace
  }
}

function triggeredExpressionFormula(trigger: TriggeredActionMechanics): DamageFormula | SupportFormula {
  const parts = String(trigger.expression ?? '').split('+').map((part) => part.trim()).filter(Boolean)
  const hits: number[] = []
  let flatValue = 0
  for (const part of parts) {
    const percent = part.match(/^(\d+(?:\.\d+)?)%\s*(?:[*x]\s*(\d+))?$/i)
    if (percent) for (let index = 0; index < Number(percent[2] ?? 1); index += 1) hits.push(Number(percent[1]) / 100)
    else if (Number.isFinite(Number(part))) flatValue += Number(part)
  }
  if (trigger.kind === 'healing' || trigger.kind === 'shield') return { kind:trigger.kind, scaling:{ [trigger.scaling ?? 'atk']:1 }, motionValue:hits.reduce((sum, hit) => sum + hit, 0), flatValue }
  return { kind:'damage', scaling:{ [trigger.scaling ?? 'atk']:1 }, hits:hits.length ? hits : [0], flatHits:hits.map((_, index) => index === 0 ? flatValue : 0), canCrit:trigger.critMode !== 'never' }
}

function calculateTriggeredActions(registry: MechanicsRegistry, request: ActionRequest, member: CombatMember, stats: AggregatedStats, effects: ResolvedEffects): TriggeredActionResult[] {
  return effects.triggeredActions.map((trigger) => {
    const repetitions = Math.min(trigger.count, trigger.maximumTriggers ?? Number.POSITIVE_INFINITY)
    let calculated: { hitValues: readonly DamageValues[] }
    if (trigger.referenceActionId) {
      const referenced = resolveAction(registry, member, trigger.referenceActionId)
      if (referenced.formula.kind === 'unsupported') unsupported(`Triggered action ${trigger.name} references an unsupported formula.`, referenced.sourceId, request.actorId, request.actionId)
      if (referenced.formula.kind === 'damage') calculated = calculateDamage(registry, request, member, referenced, referenced.formula, stats, member.character.level, effects)
      else if (referenced.formula.kind === 'tune-break') calculated = calculateTuneBreak(request, member, stats, effects)
      else if (referenced.formula.kind === 'negative-status') calculated = calculateNegativeStatus(request, member, referenced, referenced.formula, effects)
      else if (referenced.formula.kind === 'fixed-damage') calculated = { hitValues:referenced.formula.hits.map((value) => ({ normal:value, critical:value, expected:value })) }
      else calculated = calculateSupport(referenced.formula, stats, effects)
    } else {
      const formula = triggeredExpressionFormula(trigger)
      if (formula.kind === 'damage') {
        const action: ActionMechanics = { id:trigger.id, sourceId:trigger.id, reviewFingerprint:'triggered-reviewed-action', kind:'damage', damageType:trigger.damageType ?? 'skill', element:trigger.element ?? 'none', formula }
        const triggerEffects = trigger.critMode ? { ...effects, critOverride:trigger.critMode === 'normal' ? effects.critOverride : trigger.critMode } : effects
        calculated = calculateDamage(registry, request, member, action, formula, stats, member.character.level, triggerEffects)
      } else calculated = calculateSupport(formula, stats, effects)
    }
    const multiplier = (trigger.referenceMultiplier ?? 1) * repetitions
    const totals = totalHitValues(calculated.hitValues)
    const scaled = { normal:totals.normal * multiplier, critical:totals.critical * multiplier, expected:totals.expected * multiplier }
    return { id:trigger.id, name:trigger.name, kind:trigger.kind, damageType:trigger.damageType, totals:scaled, selected:scaled[request.resultMode] }
  })
}

function totalHitValues(hitValues: readonly DamageValues[]): DamageValues {
  return hitValues.reduce<DamageValues>((totals, hit) => ({
    normal: totals.normal + hit.normal,
    critical: totals.critical + hit.critical,
    expected: totals.expected + hit.expected
  }), { normal: 0, critical: 0, expected: 0 })
}

function selectedHits(hitValues: readonly DamageValues[], mode: ResultMode) {
  return hitValues.map((hit) => hit[mode])
}

function calculateAction(registry: MechanicsRegistry, request: ActionRequest): CalculationOutcome<ActionResult> {
  try {
    if (typeof registry.dataVersion !== 'string' || !registry.dataVersion.trim()) throw new CombatFailure({ code: 'stale-data', message: 'The mechanics registry requires a data version.', actorId: request.actorId, actionId: request.actionId })
    if (request.setup.dataVersion !== registry.dataVersion) throw new CombatFailure({ code: 'stale-data', message: `Expected data version ${registry.dataVersion}, received ${request.setup.dataVersion}.`, actorId: request.actorId, actionId: request.actionId })
    if (request.resultMode !== 'normal' && request.resultMode !== 'critical' && request.resultMode !== 'expected') throw new CombatFailure({ code: 'invalid-input', message: `Unknown result mode ${String(request.resultMode)}.`, actorId: request.actorId, actionId: request.actionId })
    positiveInteger(request.setup.enemy.level, 'Enemy level')
    finite(request.setup.enemy.damageReduction, 'Enemy damage reduction')
    const members = request.setup.members.filter((member) => member.memberId === request.actorId)
    if (members.length !== 1) throw new CombatFailure({ code: 'invalid-input', message: `Actor ${request.actorId} must identify exactly one member.`, actorId: request.actorId, actionId: request.actionId })
    const member = members[0]
    const character = registry.characters[member.character.id]
    if (!character) throw new CombatFailure({ code: 'missing-mechanic', message: `Character ${member.character.id} is not in the registry.`, actorId: member.memberId, actionId: request.actionId })
    const action = resolveAction(registry, member, request.actionId)
    requireReviewed(action.sourceId, action.reviewFingerprint, member.memberId, request.actionId)
    if (action.id !== request.actionId) throw new CombatFailure({ code: 'invalid-input', message: `Action registry key ${request.actionId} does not match ${action.id}.`, sourceId: action.sourceId, actorId: member.memberId, actionId: request.actionId })
    const resolvedEffects = resolveEffects(registry, request, action)
    const runtimeBonuses = request.setup.memberBonuses?.[request.actorId]
    const effects: ResolvedEffects = runtimeBonuses ? {
      ...resolvedEffects,
      statLines:[...resolvedEffects.statLines, ...(runtimeBonuses.statLines ?? [])],
      damageBonuses:[...resolvedEffects.damageBonuses, ...(runtimeBonuses.damageBonuses ?? [])],
      amplifications:[...resolvedEffects.amplifications, ...(runtimeBonuses.amplifications ?? [])],
      specialMultipliers:[...resolvedEffects.specialMultipliers, ...(runtimeBonuses.specialMultipliers ?? [])],
      contributions:{
        ...resolvedEffects.contributions,
        statLines:[...resolvedEffects.contributions.statLines, ...(runtimeBonuses.contributions?.statLines ?? [])],
        damageBonuses:[...resolvedEffects.contributions.damageBonuses, ...(runtimeBonuses.contributions?.damageBonuses ?? [])],
        amplifications:[...resolvedEffects.contributions.amplifications, ...(runtimeBonuses.contributions?.amplifications ?? [])],
        specialMultipliers:[...resolvedEffects.contributions.specialMultipliers, ...(runtimeBonuses.contributions?.specialMultipliers ?? [])]
      }
    } : resolvedEffects
    const stats = materializeStats(registry, member, effects.statLines)

    if (action.formula.kind === 'unsupported') unsupported(`Formula family ${action.formula.family} is unsupported.`, action.sourceId, request.actorId, request.actionId)
    let calculated: { hitValues: readonly DamageValues[]; trace: CalculationTrace }
    if (action.formula.kind === 'damage') {
      if (action.kind !== 'damage') throw new CombatFailure({ code: 'invalid-input', message: 'Damage formula/result kind mismatch.', sourceId: action.sourceId, actorId: request.actorId, actionId: request.actionId })
      calculated = calculateDamage(registry, request, member, action, action.formula, stats, member.character.level, effects)
    } else if (action.formula.kind === 'tune-break') {
      if (action.kind !== 'damage' || action.damageType !== 'tune-break') throw new CombatFailure({ code:'invalid-input', message:'Tune Break formula/result kind mismatch.', sourceId:action.sourceId, actorId:request.actorId, actionId:request.actionId })
      calculated = calculateTuneBreak(request, member, stats, effects)
    } else if (action.formula.kind === 'negative-status') {
      if (action.kind !== 'damage' || action.damageType !== 'status') throw new CombatFailure({ code:'invalid-input', message:'Negative status formula/result kind mismatch.', sourceId:action.sourceId, actorId:request.actorId, actionId:request.actionId })
      calculated = calculateNegativeStatus(request, member, action, action.formula, effects)
    } else if (action.formula.kind === 'fixed-damage') {
      if (action.kind !== 'damage' || action.formula.hits.length === 0) throw new CombatFailure({ code: 'invalid-input', message: 'Fixed damage must declare one or more damage hits.', sourceId: action.sourceId, actorId: request.actorId, actionId: request.actionId })
      const fixedHits = action.formula.hits.map((value, index) => {
        finite(value, 'Fixed damage')
        if (value < 0) throw new CombatFailure({ code: 'invalid-input', message: 'Fixed damage cannot be negative.', sourceId: action.sourceId, actorId: request.actorId, actionId: request.actionId })
        return {
          values: { normal: value, critical: value, expected: value },
          trace: { stage: `hit-${index + 1}`, children: [{ stage: 'result', value, children: [] }] } satisfies CalculationTrace
        }
      })
      calculated = { hitValues: fixedHits.map((hit) => hit.values), trace: { stage: 'fixed-damage', children: fixedHits.map((hit) => hit.trace) } }
    } else {
      if (action.kind !== action.formula.kind) throw new CombatFailure({ code: 'invalid-input', message: 'Support formula/result kind mismatch.', sourceId: action.sourceId, actorId: request.actorId, actionId: request.actionId })
      calculated = calculateSupport(action.formula, stats, effects)
    }

    const triggeredActions = calculateTriggeredActions(registry, request, member, stats, effects)
    const ownTotals = totalHitValues(calculated.hitValues)
    const contributingTriggers = triggeredActions.filter((trigger) => trigger.kind === action.kind)
    const totals = contributingTriggers.reduce<DamageValues>((sum, trigger) => ({ normal:sum.normal + trigger.totals.normal, critical:sum.critical + trigger.totals.critical, expected:sum.expected + trigger.totals.expected }), ownTotals)
    const result: ActionResult = {
      actionId: action.id,
      actorId: request.actorId,
      kind: action.kind,
      recipient: action.recipient,
      damageType: action.damageType,
      stats,
      hits: selectedHits(calculated.hitValues, request.resultMode),
      totals,
      selected: totals[request.resultMode],
      appliedEffects: effects.appliedEffects,
      triggeredActions,
      actionUseAdjustments:effects.actionUseAdjustments,
      ...(request.trace ? { trace: {
        stage: calculated.trace.stage,
        children: [
          { stage: 'applied-effects', value: effects.appliedEffects.length, children: effects.appliedEffects.map((id) => ({ stage: id, children: [] })) },
          ...(contributingTriggers.length ? [{ stage:'triggered-actions', value:contributingTriggers.reduce((total, trigger) => total + trigger.selected, 0), children:contributingTriggers.map((trigger) => ({ stage:`number:${trigger.name}`, value:trigger.selected, children:[] })) }] : []),
          ...calculated.trace.children
        ]
      } } : {})
    }
    return action.formula.kind === 'tune-break' || (action.formula.kind === 'negative-status' && (request.setup.enemy.statusStacks?.[action.formula.status] ?? 0) > 0)
      ? { ok:true, value:result, warnings:[{ code:'unverified-data', message:`${action.formula.kind === 'tune-break' ? 'Base Tune Break' : 'Negative status'} damage is an unverified estimate; confirm it against the current English in-game UI.`, sourceId:action.sourceId, actorId:request.actorId, actionId:request.actionId }] }
      : success(result)
  } catch (error) {
    if (error instanceof CombatFailure) return failure(error.diagnostic)
    if (error instanceof EffectResolutionFailure) return failure(error.diagnostic)
    throw error
  }
}

export function calculateMemberStats(
  registry: MechanicsRegistry,
  setup: CombatSetup,
  actorId: string,
  includeReviewedEffects = true
): CalculationOutcome<AggregatedStats> {
  try {
    if (setup.dataVersion !== registry.dataVersion) throw new CombatFailure({ code:'stale-data', message:`Expected data version ${registry.dataVersion}, received ${setup.dataVersion}.` })
    const members = setup.members.filter((member) => member.memberId === actorId)
    if (members.length !== 1) throw new CombatFailure({ code:'invalid-input', message:`Actor ${actorId} must identify exactly one member.`, actorId })
    const member = members[0]
    const previewAction: ActionMechanics = {
      id:'runtime:stat-preview',
      sourceId:'runtime:stat-preview',
      reviewFingerprint:'runtime:stat-preview',
      kind:'utility',
      formula:{ kind:'unsupported', family:'stat preview' }
    }
    const resolved = includeReviewedEffects
      ? resolveEffects(registry, { setup, actorId, actionId:previewAction.id, resultMode:'expected' }, previewAction)
      : undefined
    const runtimeLines = includeReviewedEffects ? setup.memberBonuses?.[actorId]?.statLines ?? [] : []
    return success(materializeStats(registry, member, [...(resolved?.statLines ?? []), ...runtimeLines]))
  } catch (error) {
    if (error instanceof CombatFailure) return failure(error.diagnostic)
    if (error instanceof EffectResolutionFailure) return failure(error.diagnostic)
    throw error
  }
}

function calculateRotation(registry: MechanicsRegistry, request: RotationRequest): CalculationOutcome<RotationResult> {
  try {
    if (typeof registry.dataVersion !== 'string' || !registry.dataVersion.trim()) throw new CombatFailure({ code: 'stale-data', message: 'The mechanics registry requires a data version.' })
    if (request.setup.dataVersion !== registry.dataVersion) throw new CombatFailure({ code: 'stale-data', message: `Expected data version ${registry.dataVersion}, received ${request.setup.dataVersion}.` })
    if (request.resultMode !== 'normal' && request.resultMode !== 'critical' && request.resultMode !== 'expected') throw new CombatFailure({ code: 'invalid-rotation', message: `Unknown result mode ${String(request.resultMode)}.` })
    rotationFinite(request.duration, 'Rotation duration')
    if (request.duration <= 0) throw new CombatFailure({ code: 'invalid-rotation', message: 'Rotation duration must be greater than zero.' })

    const commandIds = new Set<string>()
    const ordered = request.actions.map((command, index) => {
      if (typeof command.id !== 'string' || !command.id.trim()) throw new CombatFailure({ code: 'invalid-rotation', message: 'Every rotation command requires an ID.', actorId: command.actorId, actionId: command.actionId })
      if (commandIds.has(command.id)) throw new CombatFailure({ code: 'invalid-rotation', message: `Rotation command ID ${command.id} is duplicated.`, actorId: command.actorId, actionId: command.actionId })
      commandIds.add(command.id)
      rotationFinite(command.timestamp, `Timestamp for ${command.id}`, command.actorId, command.actionId)
      if (command.timestamp < 0 || command.timestamp > request.duration) throw new CombatFailure({ code: 'invalid-rotation', message: `Command ${command.id} must occur within the rotation duration.`, actorId: command.actorId, actionId: command.actionId })
      const duration = command.duration ?? 0
      rotationFinite(duration, `Duration for ${command.id}`, command.actorId, command.actionId)
      if ((command.duration !== undefined && duration <= 0) || command.timestamp + duration > request.duration) throw new CombatFailure({ code: 'invalid-rotation', message: `Command ${command.id} duration must be positive and remain within the rotation.`, actorId: command.actorId, actionId: command.actionId })
      const repetitions = command.repetitions ?? 1
      if (!Number.isInteger(repetitions) || repetitions <= 0) throw new CombatFailure({ code: 'invalid-rotation', message: `Repetitions for ${command.id} must be a positive integer.`, actorId: command.actorId, actionId: command.actionId })
      return { command, index, repetitions }
    }).sort((left, right) => left.command.timestamp - right.command.timestamp || left.index - right.index)

    const actions: RotationResult['actions'][number][] = []
    const byActor: Record<string, number> = {}
    const byDamageType: Partial<Record<NonNullable<ActionResult['damageType']>, number>> = {}
    const warnings: CalculationDiagnostic[] = []
    const traceChildren: CalculationTrace[] = []
    const lastUse = new Map<string, number>()
    let total = 0

    for (const { command, repetitions } of ordered) {
      const member = request.setup.members.find((entry) => entry.memberId === command.actorId)
      if (!member) throw new CombatFailure({ code: 'invalid-rotation', message: `Actor ${command.actorId} is not in the combat setup.`, actorId: command.actorId, actionId: command.actionId })
      const action = resolveAction(registry, member, command.actionId)
      if (action.cooldownSeconds !== undefined) {
        const cooldown = finite(action.cooldownSeconds, `Cooldown for ${command.actionId}`)
        if (cooldown < 0) throw new CombatFailure({ code: 'invalid-rotation', message: `Cooldown for ${command.actionId} cannot be negative.`, actorId:command.actorId, actionId:command.actionId })
        const key = cooldownKey(registry, member, command.actionId)
        const previous = lastUse.get(key)
        if (previous !== undefined && command.timestamp - previous < cooldown) throw new CombatFailure({ code: 'invalid-rotation', message: `${command.actionId} is still on cooldown.`, actorId:command.actorId, actionId:command.actionId })
        lastUse.set(key, command.timestamp)
      }
      const outcome = calculateAction(registry, {
        setup: request.setup,
        actorId: command.actorId,
        actionId: command.actionId,
        resultMode: request.resultMode,
        inputs: command.inputs,
        trace: request.trace
      })
      warnings.push(...outcome.warnings)
      if (!outcome.ok) return { ok: false, errors: outcome.errors, warnings }
      const additionalUses = outcome.value.actionUseAdjustments.filter((adjustment) => adjustment.actionId === command.actionId).reduce((sum, adjustment) => sum + adjustment.additionalUses, 0)
      if (action.cooldownSeconds && repetitions > 1 + additionalUses) throw new CombatFailure({ code:'invalid-rotation', message:`Command ${command.id} exceeds the reviewed use count for a cooldown action.`, actorId:command.actorId, actionId:command.actionId })
      const selected = finite(outcome.value.selected * repetitions, `Rotation result for ${command.id}`)
      actions.push({ commandId: command.id, actorId: command.actorId, actionId: command.actionId, timestamp: command.timestamp, selected })
      const triggeredDamage = outcome.value.triggeredActions.filter((trigger) => trigger.kind === 'damage')
      const triggeredSelected = triggeredDamage.reduce((sum, trigger) => sum + trigger.selected * repetitions, 0)
      const ownSelected = outcome.value.kind === 'damage' ? selected - triggeredSelected : 0
      const damageSelected = ownSelected + triggeredSelected
      if (damageSelected) {
        total += damageSelected
        byActor[command.actorId] = (byActor[command.actorId] ?? 0) + damageSelected
        if (outcome.value.damageType && ownSelected) byDamageType[outcome.value.damageType] = (byDamageType[outcome.value.damageType] ?? 0) + ownSelected
        for (const trigger of triggeredDamage) if (trigger.damageType) byDamageType[trigger.damageType] = (byDamageType[trigger.damageType] ?? 0) + trigger.selected * repetitions
      }
      if (request.trace) traceChildren.push({
        stage: command.id,
        value: selected,
        children: [
          { stage: 'timestamp', value: command.timestamp, children: [] },
          { stage: 'repetitions', value: repetitions, children: [] },
          ...(outcome.value.trace ? [outcome.value.trace] : [])
        ]
      })
    }

    const dps = finite(total / request.duration, 'Rotation DPS')
    return {
      ok: true,
      value: {
        total,
        dps,
        actions,
        byActor,
        byDamageType,
        ...(request.trace ? { trace: { stage: 'rotation', value: total, children: traceChildren } } : {})
      },
      warnings
    }
  } catch (error) {
    if (error instanceof CombatFailure) return failure(error.diagnostic)
    throw error
  }
}

export function createCalculator(registry: MechanicsRegistry): Calculator {
  return {
    calculateAction: (request) => calculateAction(registry, request),
    calculateRotation: (request) => calculateRotation(registry, request)
  }
}
