import type {
  Build, Echo, EquippedLoadout, LoadoutSourceRef, OwnedCharacter, OwnedWeapon, StatKey, StatLine,
  TheorycraftBuild, TheorycraftEchoSlot
} from './types'
import { characterCatalog, echoCatalog, sonataCatalog, statLabels, weaponCatalog } from '../game-data'
import { maxLevelByRarity, maxSubStatsForLevel, primaryMainStatValue } from '../game-data/echo-main-stats'
import { exactTunableRoll, tunableRolls } from '../game-data/tunable-rolls'

export interface LoadoutCollections {
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  echoes: Echo[]
  builds: Build[]
  equippedLoadouts: EquippedLoadout[]
  theorycraftBuilds: TheorycraftBuild[]
}

export interface ResolvedLoadout {
  source: LoadoutSourceRef
  character?: OwnedCharacter
  build?: Build
  weapon?: OwnedWeapon
  echoes: Echo[]
  theorycraft?: TheorycraftBuild
  warnings: string[]
}

export type TheorycraftAxis = 'weapon' | 'sonata' | 'mainEcho' | 'mainStats' | 'substats'

const characterRestrictedSonatas: Partial<Record<string, readonly string[]>> = {
  'Shadow of Shattered Dreams': ['1511', '1308']
}

export function isSonataAvailableToCharacter(name: string, characterCatalogId?: string) {
  const allowedCharacterIds = characterRestrictedSonatas[name]
  return !allowedCharacterIds || Boolean(characterCatalogId && allowedCharacterIds.includes(characterCatalogId))
}

const comparable = (value: unknown) => JSON.stringify(value)

const comparableSubstats = (slots: Array<Array<{ key: StatKey; value: number }>>) => slots.map((slot) =>
  [...slot].sort((left, right) => left.key.localeCompare(right.key)).map(({ key, value }) => ({ key, value }))
)

export function changedTheorycraftAxes(candidate: TheorycraftBuild, baseline: Pick<ResolvedLoadout, 'weapon' | 'echoes'>): TheorycraftAxis[] {
  const axes: TheorycraftAxis[] = []
  const baselineWeapon = baseline.weapon ? { catalogId:baseline.weapon.catalogId, level:baseline.weapon.level, rank:baseline.weapon.rank } : undefined
  if (comparable(candidate.weapon) !== comparable(baselineWeapon)) axes.push('weapon')
  const baselineSonatas = [...new Map(baseline.echoes.map((echo) => [echo.sonata, baseline.echoes.filter((entry) => entry.sonata === echo.sonata).length]))]
    .map(([name, pieces]) => ({ name, pieces })).sort((left, right) => left.name.localeCompare(right.name))
  const candidateSonatas = [...candidate.sonatas].filter((entry) => entry.pieces > 0).sort((left, right) => left.name.localeCompare(right.name))
  if (comparable(candidateSonatas) !== comparable(baselineSonatas)) axes.push('sonata')
  if (candidate.mainEchoName !== (baseline.echoes[0]?.name ?? '')) axes.push('mainEcho')
  const baselineMainStats = baseline.echoes.map((echo) => ({ cost:echo.cost, rarity:echo.rarity, level:echo.level, mainStatKey:echo.mainStat.key }))
  if (comparable(candidate.slots) !== comparable(baselineMainStats)) axes.push('mainStats')
  const baselineSubstats = comparableSubstats(baseline.echoes.map((echo) => echo.subStats))
  const candidateSubstats = candidate.substats.mode === 'slots' ? comparableSubstats(candidate.substats.slots) : [theorycraftSubstatLines(candidate)]
  if (comparable(candidateSubstats) !== comparable(baselineSubstats)) axes.push('substats')
  return axes
}

const sourceId = (source: LoadoutSourceRef) => source.type === 'equipped'
  ? `equipped:${source.characterId}`
  : source.type === 'saved' ? source.buildId : `theorycraft:${source.theorycraftBuildId}`

export function loadoutCharacterId(source: LoadoutSourceRef, collections: LoadoutCollections) {
  if (source.type === 'equipped') return source.characterId
  if (source.type === 'saved') {
    const build = collections.builds.find((entry) => entry.id === source.buildId)
    return build?.characterId ?? collections.characters.find((entry) => entry.catalogId === build?.resonatorId)?.id
  }
  return collections.theorycraftBuilds.find((entry) => entry.id === source.theorycraftBuildId)?.characterId
}

export function theorycraftRollValue(key: StatKey, count: number, quality: 'low' | 'mid' | 'high') {
  const rolls = tunableRolls[key]
  if (!rolls?.length || count <= 0) return 0
  const index = quality === 'low' ? 0 : quality === 'high' ? rolls.length - 1 : Math.floor((rolls.length - 1) / 2)
  return rolls[index].value * Math.floor(count)
}

export function theorycraftSubstatLines(build: TheorycraftBuild): StatLine[] {
  if (build.substats.mode === 'slots') {
    const totals = new Map<StatKey, number>()
    build.substats.slots.flat().forEach((line) => totals.set(line.key, (totals.get(line.key) ?? 0) + line.value))
    return [...totals].map(([key, value]) => ({ key, value }))
  }
  const values = build.substats.mode === 'values'
    ? build.substats.values
    : Object.fromEntries(Object.entries(build.substats.rolls).map(([key, count]) => [key, theorycraftRollValue(key as StatKey, Number(count), build.substats.mode === 'rolls' ? build.substats.quality : 'mid')]))
  return Object.entries(values).flatMap(([key, value]) => Number.isFinite(value) && Number(value) !== 0
    ? [{ key: key as StatKey, value: Number(value) }] : [])
}

export function theorycraftWarnings(build: TheorycraftBuild) {
  const warnings: string[] = []
  if (build.slots.length !== 5) warnings.push('A theorycraft build must contain five Echo slots.')
  const cost = build.slots.reduce((sum, slot) => sum + slot.cost, 0)
  if (cost > 12) warnings.push(`Echo cost is ${cost}/12.`)
  for (const [index, slot] of build.slots.entries()) {
    if (slot.level < 0 || slot.level > maxLevelByRarity[slot.rarity]) warnings.push(`Slot ${index + 1} exceeds the level cap for its rarity.`)
    if (primaryMainStatValue(slot.cost, slot.rarity, slot.level, slot.mainStatKey) === undefined) warnings.push(`Slot ${index + 1} has an invalid Cost ${slot.cost} main stat.`)
  }
  const pieces = build.sonatas.reduce((sum, entry) => sum + entry.pieces, 0)
  if (pieces !== 5) warnings.push(`Sonata composition accounts for ${pieces}/5 Echoes.`)
  for (const selected of build.sonatas.filter((entry) => entry.pieces > 0)) {
    const sonata = sonataCatalog.find((entry) => entry.name === selected.name)
    const maximum = sonata ? Math.max(...sonata.effects.map((effect) => effect.pieces)) : 0
    if (!sonata) warnings.push(`${selected.name || 'Selected Sonata'} is not a valid Sonata set.`)
    else if (selected.pieces > maximum) warnings.push(`${selected.name} supports at most ${maximum} Sonata piece${maximum === 1 ? '' : 's'}.`)
  }
  const main = echoCatalog.find((entry) => entry.name === build.mainEchoName)
  if (!main) warnings.push('Select a valid main Echo.')
  else {
    if (build.slots[0] && build.slots[0].cost !== main.cost) warnings.push(`The main Echo requires a Cost ${main.cost} first slot.`)
    const selected = new Set(build.sonatas.filter((entry) => entry.pieces > 0).map((entry) => entry.name))
    if (selected.size && !main.sonatas.some((name) => selected.has(name))) warnings.push('The main Echo is incompatible with the selected Sonata composition.')
  }
  if (build.substats.mode === 'slots') {
    if (build.substats.slots.length !== 5) warnings.push(`Substats cover ${build.substats.slots.length}/5 Echo slots.`)
    build.slots.forEach((slot, index) => {
      const lines = build.substats.mode === 'slots' ? build.substats.slots[index] ?? [] : []
      const capacity = maxSubStatsForLevel(slot.level)
      if (lines.length > capacity) warnings.push(`Slot ${index + 1} has ${lines.length}/${capacity} available substats.`)
      const seen = new Set<StatKey>()
      for (const line of lines) {
        if (line.key === slot.mainStatKey) warnings.push(`Slot ${index + 1} repeats its main stat ${statLabels[line.key]} as a substat.`)
        if (seen.has(line.key)) warnings.push(`Slot ${index + 1} has duplicate ${statLabels[line.key]} substats.`)
        seen.add(line.key)
        if (!exactTunableRoll(line.key, line.value)) warnings.push(`Slot ${index + 1} has an invalid ${statLabels[line.key]} roll of ${line.value}.`)
      }
    })
  } else if (build.substats.mode === 'rolls') {
    warnings.push('Legacy aggregate substats must be converted to exact per-Echo rolls before saving.')
    const capacity = build.slots.reduce((sum, slot) => sum + maxSubStatsForLevel(slot.level), 0)
    const total = Object.values(build.substats.rolls).reduce((sum, count) => sum + Math.max(0, Math.floor(Number(count) || 0)), 0)
    if (total > capacity) warnings.push(`Substat allocation uses ${total}/${capacity} available rolls.`)
    for (const [key, count] of Object.entries(build.substats.rolls)) {
      const availableSlots = build.slots.filter((slot) => slot.mainStatKey !== key && maxSubStatsForLevel(slot.level) > 0).length
      if (Number(count) > availableSlots) warnings.push(`${key} appears on more Echoes than the configured main stats permit.`)
    }
  } else {
    warnings.push('Legacy aggregate substats must be converted to exact per-Echo rolls before saving.')
    for (const [key, value] of Object.entries(build.substats.values)) {
      if (Number(value) > 0 && !build.slots.some((slot) => slot.mainStatKey !== key && maxSubStatsForLevel(slot.level) > 0)) warnings.push(`${key} cannot be placed because every eligible slot uses it as a main stat.`)
    }
  }
  return [...new Set(warnings)]
}

const normalizedSonataEffect = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const activeSonataEffects = (name: string, pieces: number) => sonataCatalog.find((entry) => entry.name === name)?.effects
  .filter((effect) => effect.pieces <= pieces).map((effect) => effect.description) ?? []
const sonataEffectKey = (name: string, pieces: number) => activeSonataEffects(name, pieces).map(normalizedSonataEffect).sort().join('|') || `sonata:${name}`

export function theorycraftSonataPlanKey(sonatas: TheorycraftBuild['sonatas']) {
  return sonatas.filter((entry) => entry.pieces > 0).map((entry) => `${entry.pieces}:${sonataEffectKey(entry.name, entry.pieces)}`).sort().join('|')
}

export function groupTheorycraftSonatas(sonatas: TheorycraftBuild['sonatas']) {
  return sonatas.filter((entry) => entry.pieces > 0).map((sonata) => {
    const key = sonataEffectKey(sonata.name, sonata.pieces)
    const effects = activeSonataEffects(sonata.name, sonata.pieces)
    const names = sonataCatalog.filter((entry) => sonataEffectKey(entry.name, sonata.pieces) === key).map((entry) => entry.name)
    return { key, pieces: sonata.pieces, names, label: names.length > 1 ? effects.join(' + ') : sonata.name }
  })
}

function syntheticTheorycraftEchoes(build: TheorycraftBuild): Echo[] {
  const sonatas = build.sonatas.flatMap((entry) => Array.from({ length: Math.max(0, Math.floor(entry.pieces)) }, () => entry.name))
  const substats = theorycraftSubstatLines(build)
  const distributed: StatLine[][] = build.substats.mode === 'slots'
    ? build.slots.map((_, index) => build.substats.mode === 'slots' ? build.substats.slots[index] ?? [] : [])
    : build.slots.map(() => [])
  if (build.substats.mode !== 'slots') substats.forEach((line, index) => distributed[index % Math.max(1, distributed.length)].push(line))
  return build.slots.slice(0, 5).map((slot, index) => ({
    id: `theorycraft:${build.id}:echo:${index}`,
    name: index === 0 ? build.mainEchoName || 'Theorycrafted main Echo' : `Theorycrafted Echo ${index + 1}`,
    cost: slot.cost,
    rarity: slot.rarity,
    level: slot.level,
    sonata: sonatas[index] ?? '',
    mainStat: { key: slot.mainStatKey, value: primaryMainStatValue(slot.cost, slot.rarity, slot.level, slot.mainStatKey) ?? 0 },
    subStats: distributed[index],
    locked: false,
    excluded: false,
    createdAt: build.createdAt,
    source: 'manual'
  }))
}

export function resolveLoadout(source: LoadoutSourceRef, collections: LoadoutCollections, runtimeId = sourceId(source)): ResolvedLoadout {
  const characterId = loadoutCharacterId(source, collections)
  const character = collections.characters.find((entry) => entry.id === characterId)
  if (!character) return { source, echoes: [], warnings: ['The owned character for this loadout is missing.'] }
  if (source.type === 'equipped') {
    const loadout = collections.equippedLoadouts.find((entry) => entry.characterId === character.id)
    const echoes = (loadout?.echoIds ?? []).map((id) => collections.echoes.find((entry) => entry.id === id)).filter((entry): entry is Echo => Boolean(entry))
    const weapon = collections.weapons.find((entry) => entry.id === loadout?.weaponId)
    return {
      source, character, weapon, echoes,
      build: { id: runtimeId, name: 'Equipped Build', characterId: character.id, resonatorId: character.catalogId, weaponId: weapon?.id ?? '', echoIds: echoes.map((entry) => entry.id), level: character.level, skillLevel: character.skillLevels?.[1] ?? 1 },
      warnings: [...(!loadout ? ['No equipped loadout has been created.'] : []), ...(echoes.length < 5 ? [`${echoes.length}/5 Echoes equipped.`] : []), ...(echoes.reduce((sum, echo) => sum + echo.cost, 0) > 12 ? ['Echo cost exceeds the 12-cost limit.'] : [])]
    }
  }
  if (source.type === 'saved') {
    const saved = collections.builds.find((entry) => entry.id === source.buildId)
    if (!saved) return { source, character, echoes: [], warnings: ['The saved build is missing.'] }
    const echoes = saved.echoIds.map((id) => collections.echoes.find((entry) => entry.id === id)).filter((entry): entry is Echo => Boolean(entry))
    const weapon = collections.weapons.find((entry) => entry.id === saved.weaponId)
    return {
      source, character, weapon, echoes, build: { ...saved, id: runtimeId, characterId: character.id, resonatorId: character.catalogId, echoIds: echoes.map((entry) => entry.id), level: character.level, skillLevel: character.skillLevels?.[1] ?? saved.skillLevel },
      warnings: [...(echoes.length !== saved.echoIds.length ? ['One or more saved Echo references are missing.'] : []), ...(!weapon ? ['The saved weapon reference is missing.'] : []), ...(echoes.length < 5 ? [`${echoes.length}/5 Echoes referenced.`] : []), ...(echoes.reduce((sum, echo) => sum + echo.cost, 0) > 12 ? ['Echo cost exceeds the 12-cost limit.'] : [])]
    }
  }
  const theorycraft = collections.theorycraftBuilds.find((entry) => entry.id === source.theorycraftBuildId)
  if (!theorycraft) return { source, character, echoes: [], warnings: ['The theorycraft build is missing.'] }
  const echoes = syntheticTheorycraftEchoes(theorycraft)
  const weaponCatalogEntry = weaponCatalog.find((entry) => entry.id === theorycraft.weapon.catalogId)
  const weapon: OwnedWeapon | undefined = weaponCatalogEntry ? {
    id: `theorycraft:${theorycraft.id}:weapon`, catalogId: weaponCatalogEntry.id, level: theorycraft.weapon.level,
    rank: theorycraft.weapon.rank, locked: false, createdAt: theorycraft.createdAt
  } : undefined
  return {
    source, character, weapon, echoes, theorycraft,
    build: { id: runtimeId, name: theorycraft.name, description: theorycraft.description, characterId: character.id, resonatorId: character.catalogId, weaponId: weapon?.id ?? '', echoIds: echoes.map((entry) => entry.id), level: character.level, skillLevel: character.skillLevels?.[1] ?? 1 },
    warnings: theorycraftWarnings(theorycraft)
  }
}

export function defaultTheorycraftSlots(): TheorycraftEchoSlot[] {
  return [
    { cost: 4, rarity: 5, level: 25, mainStatKey: 'critRate' },
    { cost: 3, rarity: 5, level: 25, mainStatKey: 'atkPercent' },
    { cost: 3, rarity: 5, level: 25, mainStatKey: 'energyRegen' },
    { cost: 1, rarity: 5, level: 25, mainStatKey: 'atkPercent' },
    { cost: 1, rarity: 5, level: 25, mainStatKey: 'atkPercent' }
  ]
}

export function createTheorycraftBuild(character: OwnedCharacter, name = 'Theorycraft build'): TheorycraftBuild {
  const characterEntry = characterCatalog.find((entry) => entry.id === character.catalogId)
  const compatibleWeapon = weaponCatalog.find((entry) => entry.type.toLowerCase() === characterEntry?.weaponType.toLowerCase()) ?? weaponCatalog[0]
  const mainEcho = echoCatalog.find((entry) => entry.cost === 4) ?? echoCatalog[0]
  const sonata = mainEcho?.sonatas[0] ?? sonataCatalog[0]?.name ?? ''
  const now = Date.now()
  return {
    id: `theorycraft-${now}-${Math.random().toString(36).slice(2, 8)}`, name, description: '', characterId: character.id,
    weapon: { catalogId: compatibleWeapon?.id ?? '', level: 90, rank: 1 }, mainEchoName: mainEcho?.name ?? '',
    slots: defaultTheorycraftSlots(), sonatas: sonata ? [{ name: sonata, pieces: 5 }] : [],
    substats: { mode: 'slots', slots: Array.from({ length: 5 }, () => []) }, createdAt: now, updatedAt: now
  }
}
