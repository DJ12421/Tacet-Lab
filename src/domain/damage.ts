import type { AggregatedStats, AttackDefinition, BuffEffect, Build, DamageResult, Echo, EnemyConfig, Resonator, RotationResult, StatKey, StatLine, Team, Weapon } from './types'
import { echoStatLines } from '../game-data/echo-main-stats'

export const floorGameValue = (value: number) => Math.floor(value + 1e-9)

export const emptyStats = (): AggregatedStats => ({
  baseHp: 0, baseAtk: 0, baseDef: 0,
  hp: 0, atk: 0, def: 0, critRate: 0, critDamage: 0, energyRegen: 100,
  basicDamage: 0, heavyDamage: 0, skillDamage: 0, liberationDamage: 0,
  spectroDamage: 0, fusionDamage: 0, glacioDamage: 0, electroDamage: 0, aeroDamage: 0, havocDamage: 0, healingBonus: 0
})

function addStat(stats: AggregatedStats, key: StatKey, value: number) {
  if (key in stats) stats[key as keyof AggregatedStats] += value
}

export function aggregateStats(resonator: Resonator, weapon: Weapon, echoes: Echo[], bonusLines: StatLine[] = [], includeLegacySonatas = true): AggregatedStats {
  const stats = emptyStats()
  const percent = { hp: 0, atk: 0, def: 0 }
  const flat = { hp: 0, atk: 0, def: 0 }
  const base = {
    hp: floorGameValue(resonator.baseStats.hp),
    atk: floorGameValue(resonator.baseStats.atk) + floorGameValue(weapon.baseAtk),
    def: floorGameValue(resonator.baseStats.def)
  }
  stats.baseHp = base.hp
  stats.baseAtk = base.atk
  stats.baseDef = base.def
  stats.critRate = resonator.baseStats.critRate
  stats.critDamage = resonator.baseStats.critDamage

  const lines = [...echoes.flatMap(echoStatLines), ...bonusLines]

  if (weapon.stat) lines.push(weapon.stat)
  for (const line of lines) {
    if (line.key === 'hpPercent') percent.hp += line.value
    else if (line.key === 'atkPercent') percent.atk += line.value
    else if (line.key === 'defPercent') percent.def += line.value
    else if (line.key === 'hp' || line.key === 'atk' || line.key === 'def') flat[line.key] += line.value
    else addStat(stats, line.key, line.value)
  }

  if (includeLegacySonatas) {
    const sonatas = echoes.reduce<Record<string, number>>((sets, echo) => {
      sets[echo.sonata] = (sets[echo.sonata] ?? 0) + 1
      return sets
    }, {})
    if ((sonatas['Celestial Light'] ?? 0) >= 5) stats.spectroDamage += 30
    if ((sonatas['Molten Rift'] ?? 0) >= 5) stats.fusionDamage += 30
    if ((sonatas['Freezing Frost'] ?? 0) >= 5) stats.glacioDamage += 30
    if ((sonatas['Lingering Tunes'] ?? 0) >= 5) percent.atk += 20
    if ((sonatas['Rejuvenating Glow'] ?? 0) >= 5) stats.healingBonus += 10
  }

  stats.hp = floorGameValue(base.hp * (1 + percent.hp / 100) + flat.hp)
  stats.atk = floorGameValue(base.atk * (1 + percent.atk / 100) + flat.atk)
  stats.def = floorGameValue(base.def * (1 + percent.def / 100) + flat.def)
  return stats
}

export function defenseMultiplier(characterLevel: number, enemyLevel: number, defenseIgnorePercent = 0, defenseReductionPercent = 0): number {
  const safeCharacterLevel = Math.max(1, characterLevel)
  const safeEnemyLevel = Math.max(1, enemyLevel)
  const ignore = Math.max(0, Math.min(1, defenseIgnorePercent / 100))
  const reduction = Math.max(0, Math.min(1, defenseReductionPercent / 100))
  const characterDefenseTerm = 800 + 8 * safeCharacterLevel
  const enemyDefenseTerm = (8 * safeEnemyLevel + 792) * (1 - ignore) * (1 - reduction)
  return characterDefenseTerm / (characterDefenseTerm + enemyDefenseTerm)
}

export function resistanceMultiplier(resistancePercent: number, resistanceReductionPercent = 0, resistanceIgnorePercent = 0): number {
  const resistance = (resistancePercent - resistanceReductionPercent - resistanceIgnorePercent) / 100
  if (resistance < 0) return 1 - resistance / 2
  if (resistance < 0.8) return 1 - resistance
  return 1 / (1 + 5 * resistance)
}

function damageBonus(stats: AggregatedStats, attack: AttackDefinition): number {
  const typeBonus = attack.type === 'basic' ? stats.basicDamage
    : attack.type === 'heavy' ? stats.heavyDamage
      : attack.type === 'skill' ? stats.skillDamage
        : attack.type === 'liberation' ? stats.liberationDamage : 0
  const elementBonus = attack.element === 'spectro' ? stats.spectroDamage
    : attack.element === 'fusion' ? stats.fusionDamage
      : attack.element === 'glacio' ? stats.glacioDamage
        : attack.element === 'electro' ? stats.electroDamage
          : attack.element === 'aero' ? stats.aeroDamage : stats.havocDamage
  return typeBonus + elementBonus
}

export function applyBuffEffects(stats: AggregatedStats, effects: BuffEffect[]): { stats: AggregatedStats; amplify: number } {
  const next = { ...stats }
  let amplify = 0
  const strongest = new Map<string, BuffEffect>()
  for (const effect of effects) {
    const key = `${effect.stackingGroup}:${effect.stat}`
    const current = strongest.get(key)
    if (!current || Math.abs(effect.value) > Math.abs(current.value)) strongest.set(key, effect)
  }
  for (const effect of strongest.values()) {
    if (effect.stat === 'amplify') amplify += effect.value
    else if (effect.stat === 'hpPercent') next.hp += next.baseHp * effect.value / 100
    else if (effect.stat === 'atkPercent') next.atk += next.baseAtk * effect.value / 100
    else if (effect.stat === 'defPercent') next.def += next.baseDef * effect.value / 100
    else if (effect.stat in next) next[effect.stat as keyof AggregatedStats] += effect.value
  }
  next.hp = floorGameValue(next.hp)
  next.atk = floorGameValue(next.atk)
  next.def = floorGameValue(next.def)
  return { stats: next, amplify }
}

export function calculateDamage(stats: AggregatedStats, attack: AttackDefinition, enemy: EnemyConfig, characterLevel = 90, amplifyPercent = 0): DamageResult {
  if (attack.type === 'healing') {
    const total = floorGameValue(stats.hp * attack.multiplier * attack.hits * Math.max(0, 1 + stats.healingBonus / 100))
    return { normal: total, critical: total, expected: total, hits: attack.hits, attackId: attack.id }
  }
  const scaling = attack.scalesWith === 'hp' ? stats.hp : attack.scalesWith === 'def' ? stats.def : stats.atk
  const raw = scaling * attack.multiplier * attack.hits
  const normal = floorGameValue(raw * Math.max(0, 1 + damageBonus(stats, attack) / 100)
    * defenseMultiplier(characterLevel, enemy.level, enemy.defenseIgnore, enemy.defenseReduction)
    * resistanceMultiplier(enemy.resistance, enemy.resistanceReduction, enemy.resistanceIgnore)
    * Math.max(0, 1 - enemy.damageReduction / 100)
    * Math.max(0, 1 + amplifyPercent / 100)
    * Math.max(0, 1 + (enemy.specialMultiplier ?? 0) / 100))
  const critical = floorGameValue(normal * Math.max(1, stats.critDamage / 100))
  const critRate = Math.min(1, Math.max(0, stats.critRate / 100))
  const expected = floorGameValue(normal * (1 + critRate * (Math.max(1, stats.critDamage / 100) - 1)))
  return { normal, critical, expected, hits: attack.hits, attackId: attack.id }
}

export function calculateBuild(build: Build, resonator: Resonator, weapon: Weapon, echoes: Echo[], attack: AttackDefinition, enemy: EnemyConfig) {
  const equipped = build.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo))
  const stats = aggregateStats(resonator, weapon, equipped)
  return { stats, damage: calculateDamage(stats, attack, enemy, build.level) }
}

export function formatDamage(value: number) {
  return floorGameValue(value).toLocaleString('en-US')
}

export function calculateRotation(team: Team, builds: Build[], resonators: Resonator[], weapons: Weapon[], echoes: Echo[]): RotationResult {
  const result: RotationResult = { total: 0, dps: 0, actions: [], byBuild: {}, byType: {} }
  const active: Array<{ effect: BuffEffect; activatedAt: number }> = []
  const sortedActions = [...team.actions].sort((a, b) => a.timestamp - b.timestamp)
  for (let groupStart = 0; groupStart < sortedActions.length;) {
    const timestamp = sortedActions[groupStart].timestamp
    let groupEnd = groupStart + 1
    while (groupEnd < sortedActions.length && sortedActions[groupEnd].timestamp === timestamp) groupEnd += 1
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (timestamp > active[index].activatedAt + active[index].effect.duration) active.splice(index, 1)
    }
    const group = sortedActions.slice(groupStart, groupEnd)
    for (const action of group) {
      const build = builds.find((item) => item.id === action.buildId)
      if (!build) continue
      const resonator = resonators.find((item) => item.id === build.resonatorId)
      const weapon = weapons.find((item) => item.id === build.weaponId)
      const attack = resonator?.attacks.find((item) => item.id === action.attackId)
      if (!resonator || !weapon || !attack) continue
      const applicable = active.filter(({ effect }) => effect.target === 'team'
        || (effect.target === 'self' && effect.sourceBuildId === build.id)
        || (effect.target === 'next' && effect.sourceBuildId !== build.id)
        || (effect.target === 'character' && effect.recipientBuildId === build.id))
      const equipped = build.echoIds.map((id) => echoes.find((echo) => echo.id === id)).filter((echo): echo is Echo => Boolean(echo))
      const baseStats = aggregateStats(resonator, weapon, equipped)
      const buffed = applyBuffEffects(baseStats, applicable.map(({ effect }) => effect))
      const calculated = calculateDamage(buffed.stats, attack, team.enemy, build.level, buffed.amplify)
      const multiplier = Math.max(1, Math.min(99, Math.floor(action.multiplier ?? 1)))
      const scaled = {
        ...calculated,
        normal: calculated.normal * multiplier,
        critical: calculated.critical * multiplier,
        expected: calculated.expected * multiplier
      }
      result.actions.push({ ...scaled, timestamp: action.timestamp, buildId: build.id })
      result.total += scaled.expected
      result.byBuild[build.id] = (result.byBuild[build.id] ?? 0) + scaled.expected
      result.byType[attack.type] = (result.byType[attack.type] ?? 0) + scaled.expected
    }
    const incomingBuildIds = new Set(group.map((action) => action.buildId))
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].effect.target === 'next' && [...incomingBuildIds].some((buildId) => active[index].effect.sourceBuildId !== buildId)) active.splice(index, 1)
    }
    for (const action of group) {
      for (const effect of team.buffs ?? []) {
        if (effect.sourceBuildId === action.buildId && effect.triggerAttackId === action.attackId) active.push({ effect, activatedAt: timestamp })
      }
    }
    groupStart = groupEnd
  }
  result.dps = result.total / Math.max(1, team.rotationDuration)
  return result
}
