import { describe, expect, it } from 'vitest'
import {
  createCalculator,
  type ActionTag,
  type ActionMechanics,
  type CombatMember,
  type EffectMechanics,
  type MechanicsRegistry
} from './index'
import { mechanicsRegistry } from '../../game-data/combat/registry'
import { calculateBuildStats } from './runtime'

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
  actorCharacterId?: string
} = {}) {
  const actorCharacterId = options.actorCharacterId ?? 'actor'
  const registry: MechanicsRegistry = {
    dataVersion: 'effects-v1',
    characters: {
      [actorCharacterId]: {
        id: actorCharacterId, sourceId: 'fixture:actor', reviewFingerprint: 'actor-reviewed',
        levelStats: [{ level: 90, hp: 1, atk: 1000, def: 1, critRate: 0.25, critDamage: 1.5, energyRegen: 1 }],
        actions: { skill: { ...action, damageType:options.actionDamageType ?? action.damageType, element:options.actionElement ?? action.element, tags: options.actionTags } }, effects: options.characterEffects
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
      enemy: { level: 90, resistance: {}, damageReduction: 0 },
      selections: options.selections ?? {}
    },
    actorId: actor.memberId,
    actionId: action.id,
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
  it('applies sequence, weapon rank, and stack-gated stat operations', () => {
    const result = valueOf(fixture({
      sequence: 1,
      rank: 2,
      selections: { stacks: 2 },
      characterEffects: [effect('sequence', { minimumSequence: 1, operations: [{ kind: 'add-percent-stat', stat: 'atk', value: 0.1 }] })],
      weaponEffects: [effect('weapon', { minimumRank: 2, activation: { kind: 'stacks', input: 'stacks', minimum: 1, maximum: 3 }, operations: [{ kind: 'add-percent-stat', stat: 'atk', value: 0.05 }] })]
    }))
    expect(result.stats.atk).toBe(1200)
    expectClose(result.selected, 1200 * D90)
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
    expectClose(valueOf(fixture({ selections:{ 'panorama-stacks':3 }, weaponEffects:[stacked,consumed] })).selected, 1360 * D90)
    expectClose(valueOf(fixture({ selections:{ 'panorama-stacks':3, 'panorama-consumed':true }, weaponEffects:[stacked,consumed] })).selected, 1520 * D90)
    expect(fixture({ selections:{ 'panorama-stacks':2, 'panorama-consumed':true }, weaponEffects:[stacked,consumed] }).ok).toBe(false)
  })

  it("limits Bloodpact's Pledge special effect to either Aero Rover ID", () => {
    const special = effect('bloodpact-pledge-aero-rover', {
      sourceId: 'weapon:21020046:weapon:21020046:effect:1',
      operations: [{ kind:'add-damage-bonus', value:0.2 }]
    })
    expectClose(valueOf(fixture({ weaponEffects:[special] })).selected, 1000 * D90)
    expectClose(valueOf(fixture({ actorCharacterId:'1406', weaponEffects:[special] })).selected, 1200 * D90)
    expectClose(valueOf(fixture({ actorCharacterId:'1408', weaponEffects:[special] })).selected, 1200 * D90)
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
    expectClose(result.selected, 1200 * D90)
    expect(result.appliedEffects).toEqual(['team'])
  })

  it('applies Coordinated Attack bonuses only to tagged actions', () => {
    const coordinatedBonus = effect('coordinated-bonus', {
      operations: [{ kind: 'add-damage-bonus', value: 0.2, filter: { tags: ['coordinated'] } }]
    })
    expectClose(valueOf(fixture({ actionTags: ['coordinated'], characterEffects: [coordinatedBonus] })).selected, 1200 * D90)
    expectClose(valueOf(fixture({ characterEffects: [coordinatedBonus] })).selected, 1000 * D90)
  })

  it('applies DEF Ignore only to damage families that accept it', () => {
    const generic = effect('generic-def-ignore', { operations:[{ kind:'ignore-defense', value:0.2 }] })
    const spectro = effect('spectro-def-ignore', { operations:[{ kind:'ignore-defense', value:0.2, filter:{ elements:['spectro'] } }] })
    const ignoredDefense = 1000 * 1520 / (1520 + 1512 * 0.8)

    expectClose(valueOf(fixture({ characterEffects:[generic] })).selected, ignoredDefense)
    expectClose(valueOf(fixture({ characterEffects:[generic], actionDamageType:'status' })).selected, 1000 * D90)
    expectClose(valueOf(fixture({ characterEffects:[generic], actionDamageType:'tune-break' })).selected, ignoredDefense)
    expectClose(valueOf(fixture({ characterEffects:[spectro], actionDamageType:'tune-break' })).selected, 1000 * D90)
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

    expectClose(inactive.selected, 1000 * D90)
    expectClose(active.selected, 1000 * 1.3 * 1520 / (1520 + 1512 * 0.9))
    expect(active.appliedEffects).toEqual([rankOne?.id])
    expectClose(basicAttack.selected, 1000 * 1520 / (1520 + 1512 * 0.9))
    expect(basicAttack.appliedEffects).toEqual([rankOne?.id])
  })

  it('scopes reviewed Hecate damage bonus to Coordinated Attacks', () => {
    const hecateEffects = mechanicsRegistry.echoes?.['6000085']?.effects
    expect(hecateEffects).toBeDefined()
    expectClose(valueOf(fixture({ echoes: 1, echoEffects: hecateEffects, actionTags: ['coordinated'] })).selected, 1400 * D90)
    expectClose(valueOf(fixture({ echoes: 1, echoEffects: hecateEffects })).selected, 1000 * D90)
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

  it('removes parser-created global damage bonuses and restores typed filters', () => {
    const rebeccaReduction = mechanicsRegistry.characters['1308']?.effects?.find((effect) => effect.id.endsWith('1308:3:effect:8'))
    const lucyReduction = mechanicsRegistry.characters['1511']?.effects?.find((effect) => effect.id.endsWith('1511:8:effect:3'))
    const camellyaBasic = mechanicsRegistry.characters['1603']?.effects?.find((effect) => effect.id.endsWith('1603:5:effect:0'))
    const phrolovaTeam = mechanicsRegistry.characters['1608']?.effects?.find((effect) => effect.id.endsWith('1608:sequence:4:0'))
    const mornyeTuneBreak = mechanicsRegistry.characters['1209']?.effects?.find((effect) => effect.id.endsWith('1209:17:effect:4'))
    expect(rebeccaReduction?.operations.some((operation) => operation.kind === 'add-damage-bonus')).toBe(false)
    expect(lucyReduction?.operations.some((operation) => operation.kind === 'add-damage-bonus')).toBe(false)
    expect(camellyaBasic?.operations).toContainEqual(expect.objectContaining({ kind:'add-damage-bonus', filter:{ damageTypes:['basic'] } }))
    expect(phrolovaTeam?.operations.filter((operation) => operation.kind === 'add-damage-bonus')).toEqual([
      expect.objectContaining({ recipient:'team', value:0.2 })
    ])
    expect(mornyeTuneBreak?.activation).toEqual(expect.objectContaining({ kind:'conditional-value', stat:'tuneBreakBoost' }))
    expect(mornyeTuneBreak?.operations).toEqual([expect.objectContaining({ kind:'add-damage-bonus', value:0.0012, stacking:'per-stack' })])
    expect(mechanicsRegistry.characters['1105']?.effects?.some((effect) => /^(?:ATK|Crit\. Rate)\+$/.test(effect.name ?? ''))).toBe(false)
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

  it('keeps rotation damage-type buffs in their stat bucket', () => {
    const shared = {
      build:{ id:'build', name:'Build', resonatorId:'1105', weaponId:'weapon', echoIds:[], level:90, skillLevel:10 },
      character:{ id:'character', catalogId:'1105', level:90, sequence:0, skillLevels:[10,10,10,10,10], enabledSkillTreeBonusIds:[], locked:false, createdAt:0 },
      weapon:{ id:'weapon', catalogId:'21050011', level:90, rank:1, locked:false, createdAt:0 },
      echoes:[],
      enemy:{ level:90, resistance:10, damageReduction:0 }
    }
    const base = calculateBuildStats(shared, false)
    const buffed = calculateBuildStats({
      ...shared,
      buffs:[{ id:'basic-buff', name:'Basic only', sourceBuildId:'build', target:'self', triggerAttackId:'', duration:10, stat:'basicDamage', value:20, stackingGroup:'basic-buff' }]
    }, false)
    expect(base.ok).toBe(true)
    expect(buffed.ok).toBe(true)
    if (!base.ok || !buffed.ok) return
    expect(buffed.stats.basicDamage - base.stats.basicDamage).toBeCloseTo(20, 10)
    expect(buffed.stats.skillDamage).toBeCloseTo(base.stats.skillDamage, 10)
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
    expectClose(valueOf(fixture({ selections: { shared: true }, characterEffects: [shared] })).selected, 1300 * D90)
    expectClose(valueOf(fixture({ selections: { shared: true }, providerEffects: [shared] })).selected, 1100 * D90)
  })

  it('applies reviewed main Echo and Sonata thresholds', () => {
    const result = valueOf(fixture({
      echoes: 2,
      echoEffects: [effect('main-echo', { operations: [{ kind: 'amplify-damage', value: 0.1 }] })],
      sonataEffects: [effect('sonata-2', { minimumPieces: 2, operations: [{ kind: 'add-damage-bonus', value: 0.2 }] })]
    }))
    expectClose(result.selected, 1320 * D90)
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
    expectClose(valueOf(fixture({ selections: { 'shared-stacks': 2 }, characterEffects: [threshold] })).selected, 1000 * D90)
    expectClose(valueOf(fixture({ selections: { 'shared-stacks': 3 }, characterEffects: [threshold] })).selected, 1400 * D90)
  })

  it('activates a linked effect only when every required input is active', () => {
    const linked = effect('linked', {
      activation: { kind: 'all', inputs: ['echo-hit', 'heavy-hit'] },
      operations: [{ kind: 'add-damage-bonus', value: 0.16 }]
    })
    expectClose(valueOf(fixture({ selections: { 'echo-hit': true }, characterEffects: [linked] })).selected, 1000 * D90)
    expectClose(valueOf(fixture({ selections: { 'echo-hit': true, 'heavy-hit': true }, characterEffects: [linked] })).selected, 1160 * D90)
  })

  it('supports explicit crit overrides without a second formula path', () => {
    const result = valueOf(fixture({ characterEffects: [effect('forced-crit', { operations: [{ kind: 'override-crit', mode: 'always' }] })] }))
    expectClose(result.totals.normal, 1000 * D90)
    expectClose(result.totals.critical, 1500 * D90)
    expectClose(result.totals.expected, 1500 * D90)
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
