import type { AggregatedStats, Build, Echo, OwnedCharacter, OwnedWeapon, StatKey, StatLine } from '../domain/types'
import { calculateShowcaseStats, emptyLegacyStats, floorGameValue } from '../domain/combat/runtime'
import { echoStatLines } from '../game-data/echo-main-stats'
import { characterCatalog, sonataCatalog, weaponCatalog, type CharacterCatalogEntry, type WeaponCatalogEntry } from '../game-data'
import { generatedSonataIconSources } from '../game-data/sonatas.generated'
import { hasConditionalStatLines, skillTreeStatLine } from '../game-data/passive-stats'

export interface CharacterShowcaseInput {
  character: OwnedCharacter
  weapons: OwnedWeapon[]
  echoes: Echo[]
  builds: Build[]
  catalog?: CharacterCatalogEntry
  includeSequenceBonuses?: boolean
}

export interface EquippedWeaponModel {
  owned: OwnedWeapon
  catalog: WeaponCatalogEntry
  levelStats: WeaponCatalogEntry['levelStats'][number]
  secondaryStat?: StatLine
}

export interface SonataCount {
  name: string
  count: number
  iconSourceUrl: string
}

export interface CharacterStatBonusSource {
  id: string
  label: string
  description: string
  lines: StatLine[]
  hasConditionalStats: boolean
}

export interface CharacterShowcaseModel {
  character: OwnedCharacter
  catalog: CharacterCatalogEntry
  build?: Build
  characterBaseStats: CharacterCatalogEntry['levelStats'][number]
  weapon?: EquippedWeaponModel
  echoSlots: Array<Echo | undefined>
  equippedEchoes: Echo[]
  echoStatContributions: Partial<Record<StatKey, number>>
  equipmentStats: AggregatedStats
  finalStats: AggregatedStats
  sonatas: SonataCount[]
  statBonusSources: CharacterStatBonusSource[]
  skillLevels: [number, number, number, number, number]
  totalEchoCost: number
}

const nearestLevel = <T extends { level: number }>(rows: T[], level: number) => rows.reduce((nearest, row) =>
  Math.abs(row.level - level) < Math.abs(nearest.level - level) ? row : nearest
)

export function characterStatsAtLevel(catalog: CharacterCatalogEntry, level: number) {
  const stats = !catalog.levelStats.length
    ? { level, hp: catalog.baseStats.hp, atk: catalog.baseStats.atk, def: catalog.baseStats.def }
    : catalog.levelStats.find((entry) => entry.level === level) ?? nearestLevel(catalog.levelStats, level)
  return { ...stats, hp: floorGameValue(stats.hp), atk: floorGameValue(stats.atk), def: floorGameValue(stats.def) }
}

export function weaponStatsAtLevel(catalog: WeaponCatalogEntry, level: number) {
  return catalog.levelStats.find((entry) => entry.level === level) ?? nearestLevel(catalog.levelStats, level)
}

export function weaponSecondaryStat(catalog: WeaponCatalogEntry, valueText: string): StatLine | undefined {
  const value = Number.parseFloat(valueText)
  if (!Number.isFinite(value)) return undefined
  const percent = valueText.includes('%')
  const label = catalog.secondaryStat.toLowerCase()
  if (label === 'hp') return { key: percent ? 'hpPercent' : 'hp', value }
  if (label === 'atk') return { key: percent ? 'atkPercent' : 'atk', value }
  if (label === 'def') return { key: percent ? 'defPercent' : 'def', value }
  if (label.includes('crit') && label.includes('rate')) return { key: 'critRate', value }
  if (label.includes('crit')) return { key: 'critDamage', value }
  if (label.includes('energy')) return { key: 'energyRegen', value }
  return undefined
}

function totalLines(lines: StatLine[]) {
  return lines.reduce<Partial<Record<StatKey, number>>>((totals, line) => {
    totals[line.key] = (totals[line.key] ?? 0) + line.value
    return totals
  }, {})
}

function baseShowcaseStats(character: CharacterCatalogEntry, base: CharacterCatalogEntry['levelStats'][number]) {
  const stats = emptyLegacyStats()
  stats.baseHp = stats.hp = floorGameValue(base.hp)
  stats.baseAtk = stats.atk = floorGameValue(base.atk)
  stats.baseDef = stats.def = floorGameValue(base.def)
  stats.critRate = character.baseStats.critRate
  stats.critDamage = character.baseStats.critDamage
  return stats
}

function normalizedSkillLevels(character: OwnedCharacter): [number, number, number, number, number] {
  const levels = character.skillLevels?.length === 5 ? character.skillLevels : [1, 1, 1, 1, 1]
  return levels.map((level) => Math.max(1, Math.min(10, level))) as [number, number, number, number, number]
}

type SkillTreeBranch = keyof CharacterCatalogEntry['skillTreeExtras']['bonusStatBranches']

export function skillTreeBonusId(branch: SkillTreeBranch, sourceIndex: number) {
  return `${branch}:${sourceIndex}`
}

export function inherentSkillBonusId(sourceIndex: number) {
  return `inherent:${sourceIndex}`
}

export function defaultEnabledSkillTreeBonusIds(catalog: CharacterCatalogEntry) {
  const bonusIds = (Object.entries(catalog.skillTreeExtras.bonusStatBranches) as Array<[SkillTreeBranch, CharacterCatalogEntry['skillTreeExtras']['bonusStatBranches'][SkillTreeBranch]]>)
    .flatMap(([branch, nodes]) => nodes.map((_, sourceIndex) => skillTreeBonusId(branch, sourceIndex)))
  const inherentIds = catalog.skillTreeExtras.inherentSkills.map((_, sourceIndex) => inherentSkillBonusId(sourceIndex))
  return [...bonusIds, ...inherentIds]
}

function enabledSkillTreeStats(catalog: CharacterCatalogEntry, enabledIds: string[]) {
  const enabled = new Set(enabledIds)
  const bonusNodeLines = (Object.entries(catalog.skillTreeExtras.bonusStatBranches) as Array<[SkillTreeBranch, CharacterCatalogEntry['skillTreeExtras']['bonusStatBranches'][SkillTreeBranch]]>)
    .flatMap(([branch, nodes]) => nodes.flatMap((node, sourceIndex) => {
      if (!enabled.has(skillTreeBonusId(branch, sourceIndex))) return []
      const line = skillTreeStatLine(node.name, node.description)
      return line ? [line] : []
    }))
  const inherentSkills = catalog.skillTreeExtras.inherentSkills.filter((_, sourceIndex) => enabled.has(inherentSkillBonusId(sourceIndex)))
  return {
    lines: bonusNodeLines,
    hasConditionalStats: inherentSkills.some((skill) => hasConditionalStatLines(skill.description))
  }
}

export function resolveCharacterShowcaseModel(input: CharacterShowcaseInput): CharacterShowcaseModel | undefined {
  const catalog = input.catalog ?? characterCatalog.find((entry) => entry.id === input.character.catalogId)
  if (!catalog) return undefined

  const build = input.builds.find((entry) => entry.resonatorId === input.character.catalogId)
  const ownedWeapon = input.weapons.find((entry) => entry.id === build?.weaponId)
    ?? input.weapons.find((entry) => entry.equippedBy === input.character.id)
  const weaponEntry = weaponCatalog.find((entry) => entry.id === ownedWeapon?.catalogId)
  const weaponLevel = ownedWeapon && weaponEntry ? weaponStatsAtLevel(weaponEntry, ownedWeapon.level) : undefined
  const weapon = ownedWeapon && weaponEntry && weaponLevel ? {
    owned: ownedWeapon,
    catalog: weaponEntry,
    levelStats: weaponLevel,
    secondaryStat: weaponSecondaryStat(weaponEntry, weaponLevel.secondaryStatValue)
  } : undefined

  const echoSlots = Array.from({ length: 5 }, (_, index) => {
    const id = build?.echoIds[index]
    return id ? input.echoes.find((echo) => echo.id === id) : undefined
  })
  const equippedEchoes = echoSlots.filter((echo): echo is Echo => Boolean(echo))
  const echoLines = equippedEchoes.flatMap(echoStatLines)
  const sonataCounts: Record<string, number> = {}
  for (const echo of equippedEchoes) sonataCounts[echo.sonata] = (sonataCounts[echo.sonata] ?? 0) + 1
  const sonatas = Object.entries(sonataCounts)
    .map(([name, count]) => ({ name, count, iconSourceUrl: generatedSonataIconSources[name] ?? '' }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
  const characterBaseStats = characterStatsAtLevel(catalog, input.character.level)
  const skillTreeStats = enabledSkillTreeStats(catalog, input.character.enabledSkillTreeBonusIds ?? defaultEnabledSkillTreeBonusIds(catalog))
  const weaponPassiveDescription = weapon?.catalog.passiveEffects[Math.max(0, Math.min(4, weapon.owned.rank - 1))] ?? ''
  const sonataSources = Object.entries(sonataCounts).flatMap(([name, count]) => {
    const sonata = sonataCatalog.find((entry) => entry.name === name)
    return sonata?.effects.filter((effect) => count >= effect.pieces).map((effect) => ({
      id: `sonata-${sonata.id}-${effect.pieces}`,
      label: `${name} · ${effect.pieces}-piece`,
      description: effect.description,
      lines: [],
      hasConditionalStats: hasConditionalStatLines(effect.description)
    })) ?? []
  })
  const statBonusSources: CharacterStatBonusSource[] = [
    ...(skillTreeStats.lines.length || skillTreeStats.hasConditionalStats ? [{ id: 'skill-tree', label: 'Skill tree nodes', description: 'Selected stat bonus and inherent-skill nodes on this character card.', ...skillTreeStats }] : []),
    ...catalog.sequenceIcons.filter((sequence) => input.includeSequenceBonuses !== false && sequence.sequence <= input.character.sequence).flatMap((sequence) => {
      const hasConditionalStats = hasConditionalStatLines(sequence.description)
      return hasConditionalStats ? [{
        id: `sequence-${sequence.sequence}`,
        label: `S${sequence.sequence} · ${sequence.name}`,
        description: sequence.description,
        lines: [],
        hasConditionalStats
      }] : []
    }),
    ...(weapon && weaponPassiveDescription ? [{ id: `weapon-${weapon.owned.id}`, label: weapon.catalog.passiveName || 'Weapon passive', description: weaponPassiveDescription, lines: [], hasConditionalStats: hasConditionalStatLines(weaponPassiveDescription) }] : []),
    ...sonataSources
  ]
  const equipmentOutcome = calculateShowcaseStats({ character:input.character, weapon:weapon?.owned, echoes:equippedEchoes, build }, false)
  const finalOutcome = calculateShowcaseStats({ character:input.character, weapon:weapon?.owned, echoes:equippedEchoes, build }, true)
  const fallbackStats = baseShowcaseStats(catalog, characterBaseStats)

  return {
    character: input.character,
    catalog,
    build,
    characterBaseStats,
    weapon,
    echoSlots,
    equippedEchoes,
    echoStatContributions: totalLines(echoLines),
    equipmentStats: equipmentOutcome.ok ? equipmentOutcome.stats : fallbackStats,
    finalStats: finalOutcome.ok ? finalOutcome.stats : equipmentOutcome.ok ? equipmentOutcome.stats : fallbackStats,
    sonatas,
    statBonusSources,
    skillLevels: normalizedSkillLevels(input.character),
    totalEchoCost: equippedEchoes.reduce((total, echo) => total + echo.cost, 0)
  }
}
