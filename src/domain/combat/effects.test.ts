import { describe, expect, it } from 'vitest'
import {
  createCalculator,
  type ActionTag,
  type ActionMechanics,
  type CharacterActionMechanics,
  type CombatMember,
  type EffectMechanics,
  type MechanicsRegistry
} from './index'
import { mechanicsRegistry } from '../../game-data/combat/registry'

const action: ActionMechanics = {
  id: 'skill',
  sourceId: 'fixture:skill',
  reviewFingerprint: 'fixture:skill:reviewed',
  kind: 'damage',
  damageType: 'skill',
  element: 'spectro',
  formula: { kind: 'damage', scaling: { atk: 1 }, hits: [1], canCrit: true }
}
const D90 = 1520 / 3032
const expectClose = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 10)
const expectDamage = (actual: number, expected: number) => expect(actual).toBe(Math.floor(expected))

const effect = (id: string, overrides: Partial<EffectMechanics> = {}): EffectMechanics => ({
  id,
  sourceId: `fixture:${id}`,
  reviewFingerprint: `fixture:${id}:reviewed`,
  recipient: 'self',
  activation: { kind: 'always' },
  operations: [{ kind: 'add-damage-bonus', value: 0.2 }],
  ...overrides
})

function fixture(options: {
  characterEffects?: readonly EffectMechanics[]
  weaponEffects?: readonly EffectMechanics[]
  providerEffects?: readonly EffectMechanics[]
  actorConditionStats?: CombatMember['conditionStats']
  providerConditionStats?: CombatMember['conditionStats']
  echoEffects?: readonly EffectMechanics[]
  sonataEffects?: readonly EffectMechanics[]
  sequence?: number
  rank?: number
  selections?: Readonly<Record<string, boolean | number | string>>
  inputs?: Readonly<Record<string, boolean | number | string>>
  echoes?: number
  trace?: boolean
  actionTags?: readonly ActionTag[]
  actionDamageType?: ActionMechanics['damageType']
  actionElement?: ActionMechanics['element']
  actionFormula?: ActionMechanics['formula']
  extraActions?: readonly (ActionMechanics | CharacterActionMechanics)[]
  actionId?: string
  statusStacks?: Readonly<Record<string, number>>
  enemyCost?: 1 | 3 | 4
  actorCharacterId?: string
  disabledEffectIds?: string[]
} = {}) {
  const actorCharacterId = options.actorCharacterId ?? 'actor'
  const registry: MechanicsRegistry = {
    dataVersion: 'effects-v1',
    characters: {
      [actorCharacterId]: {
        id: actorCharacterId, sourceId: 'fixture:actor', reviewFingerprint: 'actor-reviewed',
        levelStats: [{ level: 90, hp: 1, atk: 1000, def: 1, critRate: 0.25, critDamage: 1.5, energyRegen: 1 }],
        actions: { skill: { ...action, damageType:options.actionDamageType ?? action.damageType, element:options.actionElement ?? action.element, tags: options.actionTags, formula:options.actionFormula ?? action.formula }, ...Object.fromEntries((options.extraActions ?? []).map((entry) => [entry.id, entry])) }, effects: options.characterEffects
      },
      provider: {
        id: 'provider', sourceId: 'fixture:provider', reviewFingerprint: 'provider-reviewed',
        levelStats: [{ level: 90, hp: 1, atk: 1, def: 1, critRate: 0, critDamage: 1.5, energyRegen: 1 }],
        actions: {}, effects: options.providerEffects
      }
    },
    weapons: {
      weapon: {
        id: 'weapon', sourceId: 'fixture:weapon', reviewFingerprint: 'weapon-reviewed',
        levelStats: [{ level: 90, atk: 0 }], effects: options.weaponEffects
      }
    },
    ...(options.echoEffects ? {
      echoes: { echo: { id: 'echo', name:'Echo', description:'', sourceId: 'fixture:echo', reviewFingerprint: 'echo-reviewed', actions:{}, effects: options.echoEffects } }
    } : {}),
    ...(options.sonataEffects ? {
      sonatas: { sonata: { id: 'sonata', sourceId: 'fixture:sonata', reviewFingerprint: 'sonata-reviewed', effects: options.sonataEffects } }
    } : {})
  }
  const echoCount = options.echoes ?? 0
  const actor: CombatMember = {
    memberId: 'actor-member',
    character: { id: actorCharacterId, level: 90, sequence: options.sequence ?? 0, skillLevels: [] },
    weapon: { id: 'weapon', level: 90, rank: options.rank ?? 1 },
    ...(options.actorConditionStats ? { conditionStats: options.actorConditionStats } : {}),
    echoes: Array.from({ length: echoCount }, (_, index) => ({
      instanceId: `echo-${index}`, catalogId: 'echo', rarity:5, level: 0, sonataId: 'sonata',
      mainStat: { stat: 'atk' as const, mode: 'flat' as const, value: 0 }, substats: []
    })),
    ...(options.echoEffects && echoCount ? { mainEchoId: 'echo-0' } : {})
  }
  const provider: CombatMember = {
    memberId: 'provider-member',
    character: { id: 'provider', level: 90, sequence: 0, skillLevels: [] },
    weapon: { id: 'weapon', level: 90, rank: 1 },
    ...(options.providerConditionStats ? { conditionStats: options.providerConditionStats } : {}),
    echoes: []
  }
  return createCalculator(registry).calculateAction({
    setup: {
      dataVersion: registry.dataVersion,
      members: options.providerEffects ? [actor, provider] : [actor],
      enemy: { level: 90, resistance: {}, damageReduction: 0, statusStacks:options.statusStacks, cost:options.enemyCost },
      selections: options.selections ?? {},
      disabledEffectIdsByMember:options.disabledEffectIds ? { [actor.memberId]:options.disabledEffectIds } : undefined
    },
    actorId: actor.memberId,
    actionId: options.actionId ?? action.id,
    resultMode: 'normal',
    inputs: options.inputs,
    trace: options.trace
  })
}

const valueOf = (result: ReturnType<typeof fixture>) => {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.errors[0]?.message)
  return result.value
}

describe('combat Step 4 reviewed effects', () => {
  it('allows sequence replacement actions only after their sequence unlocks', () => {
    const replacement: CharacterActionMechanics = { id:'replacement', name:'Replacement', group:'Sequence', skillLevelIndex:0, minimumSequence:3, sourceId:'fixture:replacement', reviewFingerprint:'fixture:replacement:reviewed', kind:'damage', damageType:'echo', element:'aero', formulas:{ 1:{ kind:'damage', scaling:{ atk:1 }, hits:[5], canCrit:true } } }
    const options = { actionId:'replacement', extraActions:[replacement] }
    const locked = fixture({ ...options, sequence:2 })
    expect(locked.ok).toBe(false)
    expectDamage(valueOf(fixture({ ...options, sequence:3 })).totals.normal, 5000 * D90)
  })
  it('derives a capped stat bonus from Energy Regen above a threshold', () => {
    const result = valueOf(fixture({ actorConditionStats:{ energyRegen:180 }, characterEffects:[effect('energy-scaling', {
      operations:[{ kind:'add-derived-stat', stat:'critRate', mode:'flat', sourceStat:'energyRegen', threshold:100, sourceOffset:10, value:0.005, maximumValue:0.8 }]
    })] }))
    expectClose(result.stats.critRate, 0.7)
  })

  it('uses an active damage-type override for category bonuses', () => {
    const mode = effect('echo-mode', { operations:[
      { kind:'override-damage-type', damageType:'echo', filter:{ actionIds:['skill'] } },
      { kind:'add-flat-stat', stat:'echoDamage', value:0.2 }
    ] })
    const result = valueOf(fixture({ characterEffects:[mode] }))
    expect(result.damageType).toBe('echo')
    expectDamage(result.selected, 1200 * D90)
  })

  it('limits a triggered action to its reviewed source action', () => {
    const trigger = effect('healing-on-heavy', { operations:[], filter:{ actionIds:['heavy'] }, triggeredActions:[{
      id:'heal', name:'Heal on Heavy', kind:'healing', recipient:'team', scaling:'hp', expression:'0.25%', count:1
    }] })
    expect(valueOf(fixture({ characterEffects:[trigger] })).triggeredActions).toEqual([])
    expect(valueOf(fixture({ characterEffects:[{ ...trigger, filter:{ actionIds:['skill'] } }] })).triggeredActions).toMatchObject([{ recipient:'team' }])
  })

  it('applies reviewed special multipliers after additive damage bonuses', () => {
    const result = valueOf(fixture({ characterEffects:[effect('special', { operations:[
      { kind:'add-damage-bonus', value:0.2 },
      { kind:'add-special-multiplier', value:0.4 }
    ] })] }))
    expectDamage(result.selected, 1000 * 1.2 * 1.4 * D90)
  })

  it('uses fixed critical values only for the reviewed negative status action', () => {
    const options = { actionDamageType:'status' as const, actionElement:'electro' as const, actionFormula:{ kind:'negative-status' as const, status:'electro-flare' as const }, statusStacks:{ 'electro-flare':3 } }
    const base = valueOf(fixture(options))
    const fixed = valueOf(fixture({ ...options, characterEffects:[effect('fixed-electro-flare-crit', { operations:[{ kind:'override-status-crit', rate:0.8, damage:2.3, filter:{ actionIds:['skill'] } }] })] }))
    expectClose(fixed.totals.normal, base.totals.normal)
    expectClose(fixed.totals.critical, base.totals.normal * 2.3)
    expectClose(fixed.totals.expected, base.totals.normal * 2.04)
  })

  it('adds status-specific special multipliers before fixed status crit', () => {
    const options = { actionDamageType:'status' as const, actionElement:'fusion' as const, actionFormula:{ kind:'negative-status' as const, status:'fusion-burst' as const }, statusStacks:{ 'fusion-burst':3 } }
    const base = valueOf(fixture(options))
    const boosted = valueOf(fixture({ ...options, selections:{ trail:2, stardust:true }, characterEffects:[
      effect('fusion-trail', { activation:{ kind:'stacks', input:'trail', minimum:0, maximum:30 }, operations:[{ kind:'add-special-multiplier', value:0.1 }] }),
      effect('stardust', { activation:{ kind:'toggle', input:'stardust' }, operations:[{ kind:'add-special-multiplier', value:2 }] }),
      effect('fusion-crit', { operations:[{ kind:'override-status-crit', rate:0.8, damage:2.75 }] })
    ] }))
    expectClose(boosted.totals.normal, base.totals.normal * 3.2)
    expectClose(boosted.totals.critical, boosted.totals.normal * 2.75)
  })

  it('uses the replaced status multiplier and status crit for a triggered hit', () => {
    const statusAction: ActionMechanics = { ...action, id:'status:electro-flare', damageType:'status', element:'electro', formula:{ kind:'negative-status', status:'electro-flare' } }
    const heart = effect('heart', { activation:{ kind:'stacks', input:'heart-stacks', minimum:0, maximum:100 }, maximumSequence:0, operations:[], filter:{ actionIds:['skill'] }, triggeredActions:[{ id:'heart-hit', name:'Heart hit', kind:'damage', referenceActionId:'status:electro-flare', referenceMultiplier:0.35, count:1, countPerActivation:1 }] })
    const upgraded = effect('upgraded-heart', { activation:{ kind:'stacks', input:'heart-stacks', minimum:0, maximum:100 }, minimumSequence:1, operations:[], filter:{ actionIds:['skill'] }, triggeredActions:[{ id:'upgraded-heart-hit', name:'Upgraded heart hit', kind:'damage', referenceActionId:'status:electro-flare', referenceMultiplier:0.42, count:1, countPerActivation:1 }] })
    const crit = effect('status-crit', { activation:{ kind:'toggle', input:'status-crit' }, minimumSequence:6, operations:[{ kind:'override-status-crit', rate:0.8, damage:2.3, filter:{ actionIds:['status:electro-flare'] } }] })
    const options = { extraActions:[statusAction], statusStacks:{ 'electro-flare':3 }, selections:{ 'heart-stacks':2, 'status-crit':true }, characterEffects:[heart,upgraded,crit] }
    const sequenceZero = valueOf(fixture({ ...options, sequence:0 })).triggeredActions[0]
    const sequenceSix = valueOf(fixture({ ...options, sequence:6 })).triggeredActions[0]
    expectClose(sequenceSix.totals.normal / sequenceZero.totals.normal, 0.42 / 0.35)
    expectClose(sequenceSix.totals.critical / sequenceSix.totals.normal, 2.3)
  })

  it('calculates Tune AMP from the target Cost and applies removed stacks and fixed crit', () => {
    const options = { actionDamageType:'tune-break' as const, actionElement:'fusion' as const, actionFormula:{ kind:'tune-amp' as const, amps:[0.55] }, enemyCost:3 as const, actorConditionStats:{ tuneBreakBoost:10 } }
    const base = valueOf(fixture(options))
    const changed = valueOf(fixture({ ...options, selections:{ trail:2 }, characterEffects:[
      effect('trail', { activation:{ kind:'stacks', input:'trail', minimum:0, maximum:60 }, operations:[{ kind:'add-special-multiplier', value:0.04 }] }),
      effect('fixed-tune-crit', { operations:[{ kind:'override-status-crit', rate:0.8, damage:2.75 }] })
    ] }))
    expectClose(base.totals.normal, 716.22 * 3 * 0.55 * 1.1 * D90)
    expectClose(changed.totals.normal / base.totals.normal, 1.08)
    expectClose(changed.totals.critical / changed.totals.normal, 2.75)
    const multi = valueOf(fixture({ ...options, actionFormula:{ kind:'tune-amp', amps:[0.55,0.1,0.1,0.1,0.1] } }))
    expectClose(multi.totals.normal / base.totals.normal, 0.95 / 0.55)
  })

  it('applies a teammate Tune Break Boost to Tune AMP', () => {
    const options = { actionDamageType:'tune-break' as const, actionElement:'spectro' as const, actionFormula:{ kind:'tune-amp' as const, amps:[1] }, enemyCost:3 as const,
      providerEffects:[effect('lynae-visual-impact', { activation:{ kind:'toggle', input:'lynae-boost' }, operations:[{ kind:'add-tune-break-boost', value:40, recipient:'team' }] })] }
    const base = valueOf(fixture(options))
    const buffed = valueOf(fixture({ ...options, selections:{ 'lynae-boost':true } }))
    expectClose(buffed.totals.normal / base.totals.normal, 1.4)
  })

  it('replaces five Tune AMP instances with ten during Stardust', () => {
    const ampAction: ActionMechanics = { ...action, id:'tune-amp', damageType:'tune-break', element:'fusion', formula:{ kind:'tune-amp', amps:[0.55] } }
    const base = effect('base-tune-instances', { activation:{ kind:'toggle', input:'base-tune', suppressedBy:['stardust'] }, operations:[], filter:{ actionIds:['skill'] }, triggeredActions:[{ id:'base-instances', name:'Base instances', kind:'damage', referenceActionId:'tune-amp', count:5 }] })
    const stardust = effect('stardust-tune-instances', { activation:{ kind:'toggle', input:'stardust' }, operations:[], filter:{ actionIds:['skill'] }, triggeredActions:[{ id:'stardust-instances', name:'Stardust instances', kind:'damage', referenceActionId:'tune-amp', count:10 }] })
    const sameTarget = effect('same-target-ramp', { activation:{ kind:'toggle', input:'same-target' }, minimumSequence:2, operations:[{ kind:'add-special-multiplier', value:0.4, filter:{ actionIds:['tune-amp'] } }] })
    const stardustRamp = effect('stardust-ramp', { activation:{ kind:'all', inputs:['same-target','stardust'] }, minimumSequence:2, operations:[{ kind:'add-special-multiplier', value:0.3, filter:{ actionIds:['tune-amp'] } }] })
    const options = { extraActions:[ampAction], enemyCost:3 as const, sequence:2, characterEffects:[base,stardust,sameTarget,stardustRamp] }
    const five = valueOf(fixture({ ...options, selections:{ 'base-tune':true, 'same-target':true } })).triggeredActions
    const ten = valueOf(fixture({ ...options, selections:{ 'base-tune':true, stardust:true, 'same-target':true } })).triggeredActions
    expect(five).toHaveLength(1)
    expect(ten).toHaveLength(1)
    expectClose(ten[0].totals.normal / five[0].totals.normal, 2 * 1.7 / 1.4)
  })

  it('scales a triggered hit with consumed stacks without adding extra hits', () => {
    const juque = effect('juque', { activation:{ kind:'stacks', input:'seals', minimum:0, maximum:25 }, operations:[], filter:{ actionIds:['skill'] }, triggeredActions:[{ id:'juque-hit', name:'Juque Perdition', kind:'damage', damageType:'basic', element:'aero', scaling:'atk', expression:'400%', count:1, bonusPerActivation:0.04 }] })
    const one = valueOf(fixture({ selections:{ seals:1 }, characterEffects:[juque] })).triggeredActions[0]
    const twentyFive = valueOf(fixture({ selections:{ seals:25 }, characterEffects:[juque] })).triggeredActions[0]
    expectClose(twentyFive.totals.normal / one.totals.normal, 2 / 1.04)
  })

  it('applies sequence, weapon rank, and stack-gated stat operations', () => {
    const result = valueOf(fixture({
      sequence: 1,
      rank: 2,
      selections: { stacks: 2 },
      characterEffects: [effect('sequence', { minimumSequence: 1, operations: [{ kind: 'add-percent-stat', stat: 'atk', value: 0.1 }] })],
      weaponEffects: [effect('weapon', { minimumRank: 2, activation: { kind: 'stacks', input: 'stacks', minimum: 1, maximum: 3 }, operations: [{ kind: 'add-percent-stat', stat: 'atk', value: 0.05 }] })]
    }))
    expect(result.stats.atk).toBe(1200)
    expectDamage(result.selected, 1200 * D90)
    expect(result.appliedEffects).toEqual(['sequence', 'weapon'])
  })

  it('replaces a consumed stack bonus only after its threshold is met', () => {
    const stacked = effect('panorama-stacks', {
      activation:{ kind:'stacks', input:'panorama-stacks', minimum:0, maximum:3, suppressedBy:['panorama-consumed'] },
      operations:[{ kind:'add-damage-bonus', value:0.12 }]
    })
    const consumed = effect('panorama-consumed', {
      activation:{ kind:'toggle', input:'panorama-consumed', requires:[{ input:'panorama-stacks', minimum:3 }] },
      operations:[{ kind:'add-damage-bonus', value:0.52 }]
    })
    expectDamage(valueOf(fixture({ selections:{ 'panorama-stacks':3 }, weaponEffects:[stacked,consumed] })).selected, 1360 * D90)
    expectDamage(valueOf(fixture({ selections:{ 'panorama-stacks':3, 'panorama-consumed':true }, weaponEffects:[stacked,consumed] })).selected, 1520 * D90)
    expect(fixture({ selections:{ 'panorama-stacks':2, 'panorama-consumed':true }, weaponEffects:[stacked,consumed] }).ok).toBe(false)
  })

  it("limits Bloodpact's Pledge special effect to either Aero Rover ID", () => {
    const special = effect('bloodpact-pledge-aero-rover', {
      sourceId: 'weapon:21020046:weapon:21020046:effect:1',
      operations: [{ kind:'add-damage-bonus', value:0.2 }]
    })
    expectDamage(valueOf(fixture({ weaponEffects:[special] })).selected, 1000 * D90)
    expectDamage(valueOf(fixture({ actorCharacterId:'1406', weaponEffects:[special] })).selected, 1200 * D90)
    expectDamage(valueOf(fixture({ actorCharacterId:'1408', weaponEffects:[special] })).selected, 1200 * D90)
  })

  it('routes operation filters and team recipients to the acting member', () => {
    const result = valueOf(fixture({
      providerEffects: [effect('team', {
        recipient: 'team',
        operations: [
          { kind: 'add-damage-bonus', value: 0.2, filter: { damageTypes: ['skill'] } },
          { kind: 'add-damage-bonus', value: 5, filter: { damageTypes: ['basic'] } }
        ]
      })]
    }))
    expectDamage(result.selected, 1200 * D90)
    expect(result.appliedEffects).toEqual(['team'])
  })

  it('applies Coordinated Attack bonuses only to tagged actions', () => {
    const coordinatedBonus = effect('coordinated-bonus', {
      operations: [{ kind: 'add-damage-bonus', value: 0.2, filter: { tags: ['coordinated'] } }]
    })
    expectDamage(valueOf(fixture({ actionTags: ['coordinated'], characterEffects: [coordinatedBonus] })).selected, 1200 * D90)
    expectDamage(valueOf(fixture({ characterEffects: [coordinatedBonus] })).selected, 1000 * D90)
  })

  it('applies DEF Ignore only to damage families that accept it', () => {
    const generic = effect('generic-def-ignore', { operations:[{ kind:'ignore-defense', value:0.2 }] })
    const spectro = effect('spectro-def-ignore', { operations:[{ kind:'ignore-defense', value:0.2, filter:{ elements:['spectro'] } }] })
    const ignoredDefense = 1000 * 1520 / (1520 + 1512 * 0.8)

    expectDamage(valueOf(fixture({ characterEffects:[generic] })).selected, ignoredDefense)
    expectDamage(valueOf(fixture({ characterEffects:[generic], actionDamageType:'status' })).selected, 1000 * D90)
    expectDamage(valueOf(fixture({ characterEffects:[generic], actionDamageType:'tune-break' })).selected, ignoredDefense)
    expectDamage(valueOf(fixture({ characterEffects:[spectro], actionDamageType:'tune-break' })).selected, 1000 * D90)
  })

  it('registers Spectral Trigger global DEF Ignore separately from its Heavy Attack amplification', () => {
    const spectralTrigger = mechanicsRegistry.weapons['21030056']
    const rankOne = spectralTrigger?.effects?.find((effect) => effect.minimumRank === 1 && effect.sourceId.endsWith('effect:2'))
    const rankFive = spectralTrigger?.effects?.find((effect) => effect.minimumRank === 5 && effect.sourceId.endsWith('effect:2'))
    const activation = rankOne?.activation.kind === 'toggle' ? rankOne.activation.input : ''

    expect(rankOne?.maximumRank).toBe(1)
    expect(rankFive?.maximumRank).toBe(5)
    expect(rankOne?.operations).toContainEqual(expect.objectContaining({
      kind:'ignore-defense',
      value:0.1
    }))
    expect(rankOne?.operations.find((operation) => operation.kind === 'ignore-defense')?.filter).toBeUndefined()
    expect(rankFive?.operations).toContainEqual(expect.objectContaining({
      kind:'ignore-defense',
      value:0.2
    }))

    const inactive = valueOf(fixture({ actionDamageType:'heavy', weaponEffects:rankOne ? [rankOne] : [] }))
    const active = valueOf(fixture({
      actionDamageType:'heavy',
      selections:{ [activation]:true },
      weaponEffects:rankOne ? [rankOne] : []
    }))
    const basicAttack = valueOf(fixture({
      actionDamageType:'basic',
      selections:{ [activation]:true },
      weaponEffects:rankOne ? [rankOne] : []
    }))

    expectDamage(inactive.selected, 1000 * D90)
    expectDamage(active.selected, 1000 * 1.3 * 1520 / (1520 + 1512 * 0.9))
    expect(active.appliedEffects).toEqual([rankOne?.id])
    expectDamage(basicAttack.selected, 1000 * 1520 / (1520 + 1512 * 0.9))
    expect(basicAttack.appliedEffects).toEqual([rankOne?.id])
  })

  it('scopes reviewed Hecate damage bonus to Coordinated Attacks', () => {
    const hecateEffects = mechanicsRegistry.echoes?.['6000085']?.effects
    expect(hecateEffects).toBeDefined()
    expectDamage(valueOf(fixture({ echoes: 1, echoEffects: hecateEffects, actionTags: ['coordinated'] })).selected, 1400 * D90)
    expectDamage(valueOf(fixture({ echoes: 1, echoEffects: hecateEffects })).selected, 1000 * D90)
  })

  it('uses upstream damage classifications and coordinated tags', () => {
    expect(mechanicsRegistry.characters['1105']?.actions['1105:7:1']?.damageType).toBe('basic')
    expect(mechanicsRegistry.characters['1105']?.actions['1105:3:0']?.tags).toContain('coordinated')
    expect(mechanicsRegistry.characters['1302']?.actions['1302:7:1']?.tags).toContain('coordinated')
    const correctedScaling = mechanicsRegistry.characters['1110']?.actions['1110:2:0']
    const correctedFormula = correctedScaling && 'formulas' in correctedScaling ? Object.values(correctedScaling.formulas)[0] : undefined
    expect(correctedFormula && 'scaling' in correctedFormula ? correctedFormula.scaling : undefined).toHaveProperty('atk')
    const correctedHits = mechanicsRegistry.characters['1109']?.actions['1109:1:0']
    const levelTwoFormula = correctedHits && 'formulas' in correctedHits ? correctedHits.formulas[2] : undefined
    expect(levelTwoFormula && 'hits' in levelTwoFormula ? levelTwoFormula.hits : undefined).toEqual([0.2982])
  })

  it('keeps character Forte and Sequence buffs scoped to their upstream talents', () => {
    const effects = mechanicsRegistry.characters['1205']?.effects ?? []
    const actionIds = (suffix: string) => effects.find((effect) => effect.id.endsWith(suffix))?.operations[0]?.filter?.actionIds
    const expectScope = (suffix: string, expected: string[]) => {
      const actual = actionIds(suffix)
      expect(actual).toHaveLength(expected.length)
      expect(actual).toEqual(expect.arrayContaining(expected))
    }

    expectScope('1205:3:effect:3', ['1205:7:0'])
    expectScope('1205:4:effect:0', ['1205:2:1', '1205:2:2'])
    expectScope('1205:5:effect:0', ['1205:7:0', '1205:3:0'])
    expectScope('1205:sequence:1:0', ['1205:7:0', '1205:2:0', '1205:2:1', '1205:2:2'])
    expectScope('1205:sequence:5:0', ['1205:7:0'])
    expectScope('1205:sequence:6:0', ['1205:7:0', '1205:3:0', '1205:2:0', '1205:2:1', '1205:2:2'])

    const rocciaS6 = mechanicsRegistry.characters['1606']?.effects?.find((effect) => effect.id.endsWith('1606:sequence:6:0'))
    expect(rocciaS6?.operations).toContainEqual(expect.objectContaining({
      kind:'ignore-defense',
      filter:{ actionIds:['1606:7:0', '1606:7:1', '1606:7:2'] }
    }))
  })

  it('shares one activation across team and source-only operations', () => {
    const shared = effect('shared', {
      recipient: 'team',
      activation: { kind: 'toggle', input: 'shared' },
      operations: [
        { kind: 'add-damage-bonus', value: 0.1 },
        { kind: 'add-damage-bonus', value: 0.2, recipient: 'self' }
      ]
    })
    expectDamage(valueOf(fixture({ selections: { shared: true }, characterEffects: [shared] })).selected, 1300 * D90)
    expectDamage(valueOf(fixture({ selections: { shared: true }, providerEffects: [shared] })).selected, 1100 * D90)
  })

  it('applies reviewed main Echo and Sonata thresholds', () => {
    const result = valueOf(fixture({
      echoes: 2,
      echoEffects: [effect('main-echo', { operations: [{ kind: 'amplify-damage', value: 0.1 }] })],
      sonataEffects: [effect('sonata-2', { minimumPieces: 2, operations: [{ kind: 'add-damage-bonus', value: 0.2 }] })]
    }))
    expectDamage(result.selected, 1320 * D90)
    expect(result.appliedEffects).toEqual(['main-echo', 'sonata-2'])
  })

  it('supports numeric derived inputs and once-only activation thresholds', () => {
    const derived = effect('derived', {
      activation: { kind: 'value', input: 'tune-break', minimum: 0, maximum: 50 },
      operations: [{ kind: 'add-percent-stat', stat: 'atk', value: 0.003, stacking: 'per-stack', maximumValue: 0.15 }]
    })
    expect(valueOf(fixture({ selections: { 'tune-break': 50 }, characterEffects: [derived] })).stats.atk).toBe(1150)

    const conditionalDerived = effect('conditional-derived', {
      activation: { kind: 'conditional-value', toggleInput: 'outro-cast', source: 'recipient', stat: 'tuneBreakBoost', minimum: 0, maximum: 50 },
      operations: [{ kind: 'add-percent-stat', stat: 'atk', value: 0.003, stacking: 'per-stack', maximumValue: 0.15 }]
    })
    expect(valueOf(fixture({ selections: { 'outro-cast': false }, actorConditionStats: { tuneBreakBoost: 50 }, characterEffects: [conditionalDerived] })).stats.atk).toBe(1000)
    expect(valueOf(fixture({ selections: { 'outro-cast': true }, actorConditionStats: { tuneBreakBoost: 50 }, characterEffects: [conditionalDerived] })).stats.atk).toBe(1150)

    const providerDerived = effect('provider-derived', {
      activation: { kind: 'conditional-value', toggleInput: 'glacio-chafe', source: 'provider', stat: 'energyRegen', minimum: 0, maximum: 250 },
      operations: [{ kind: 'add-percent-stat', stat: 'atk', value: 0.001, stacking: 'per-stack', recipient: 'team', maximumValue: 0.25 }]
    })
    expect(valueOf(fixture({ selections: { 'glacio-chafe': true }, actorConditionStats: { energyRegen: 50 }, providerConditionStats: { energyRegen: 200 }, providerEffects: [providerDerived] })).stats.atk).toBe(1200)

    const threshold = effect('threshold', {
      activation: { kind: 'stacks', input: 'shared-stacks', minimum: 0, maximum: 3 },
      operations: [{ kind: 'add-damage-bonus', value: 0.4, stacking: 'once', minimumActivation: 3 }]
    })
    expectDamage(valueOf(fixture({ selections: { 'shared-stacks': 2 }, characterEffects: [threshold] })).selected, 1000 * D90)
    expectDamage(valueOf(fixture({ selections: { 'shared-stacks': 3 }, characterEffects: [threshold] })).selected, 1400 * D90)
  })

  it('triggers one extra hit for each completed group of activation stacks', () => {
    const everyThird = effect('every-third', {
      activation:{ kind:'stacks', input:'spirits', minimum:0, maximum:30 },
      operations:[],
      filter:{ actionIds:['skill'] },
      triggeredActions:[{ id:'extra-spirit', name:'Extra spirit', kind:'damage', damageType:'basic', scaling:'atk', expression:'100%', count:1, countPerActivation:3 }]
    })
    expect(valueOf(fixture({ selections:{ spirits:2 }, characterEffects:[everyThird] })).triggeredActions).toHaveLength(0)
    expectDamage(valueOf(fixture({ selections:{ spirits:3 }, characterEffects:[everyThird] })).triggeredActions[0].selected, 1000 * D90)
    expectDamage(valueOf(fixture({ selections:{ spirits:7 }, characterEffects:[everyThird] })).triggeredActions[0].selected, 2000 * D90)
  })

  it('activates a linked effect only when every required input is active', () => {
    const linked = effect('linked', {
      activation: { kind: 'all', inputs: ['echo-hit', 'heavy-hit'] },
      operations: [{ kind: 'add-damage-bonus', value: 0.16 }]
    })
    expectDamage(valueOf(fixture({ selections: { 'echo-hit': true }, characterEffects: [linked] })).selected, 1000 * D90)
    expectDamage(valueOf(fixture({ selections: { 'echo-hit': true, 'heavy-hit': true }, characterEffects: [linked] })).selected, 1160 * D90)
  })

  it('excludes a disabled always-active Sonata effect', () => {
    const sonata = effect('sonata-2', { minimumPieces:2 })
    expect(valueOf(fixture({ echoes:2, sonataEffects:[sonata] })).appliedEffects).toContain('sonata-2')
    expect(valueOf(fixture({ echoes:2, sonataEffects:[sonata], disabledEffectIds:['sonata-2'] })).appliedEffects).not.toContain('sonata-2')
  })

  it('supports explicit crit overrides without a second formula path', () => {
    const result = valueOf(fixture({ characterEffects: [effect('forced-crit', { operations: [{ kind: 'override-crit', mode: 'always' }] })] }))
    expectDamage(result.totals.normal, 1000 * D90)
    expectDamage(result.totals.critical, 1500 * D90)
    expectDamage(result.totals.expected, 1500 * D90)
  })

  it('fails closed for unknown inputs, invalid stacks, and contradictory effects', () => {
    expect(fixture({ selections: { unknown: true } })).toMatchObject({ ok: false, errors: [{ code: 'missing-mechanic' }] })
    expect(fixture({ selections: { stacks: 4 }, characterEffects: [effect('stacked', { activation: { kind: 'stacks', input: 'stacks', minimum: 1, maximum: 3 } })] })).toMatchObject({ ok: false, errors: [{ code: 'invalid-input' }] })
    expect(fixture({ selections: { a: true, b: true }, characterEffects: [
      effect('a', { activation: { kind: 'toggle', input: 'a' }, exclusiveGroup: 'stance' }),
      effect('b', { activation: { kind: 'toggle', input: 'b' }, exclusiveGroup: 'stance' })
    ] })).toMatchObject({ ok: false, errors: [{ code: 'invalid-input' }] })
  })
})
