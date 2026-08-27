import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { statAliases } from '../game-data/core'
import { echoCatalog, type EchoCatalogEntry } from '../game-data/echoes'
import { generatedSonataCatalog } from '../game-data/sonatas.generated'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { closestTunableRoll, exactTunableRoll, tunableRolls } from '../game-data/tunable-rolls'
import { fixedSecondaryMainStat, isMainStatAllowed, mainStatError, mainStatKeysByCost, maxSubStatsForLevel } from '../game-data/echo-main-stats'
import type { Echo, ScanCandidate, StatKey, StatLine } from '../domain/types'
import { createLocalId } from '../domain/id'
import { dedupeBySubstatKey, duplicateSubstatKeys } from '../domain/echo-substats'

const sonataNames = generatedSonataCatalog.map((sonata) => sonata.name)

export interface VisualRecognition {
  rarity?: { value: Echo['rarity']; confidence: number }
  sonata?: { value: string; confidence: number }
  locked?: { value: boolean; confidence: number }
  excluded?: { value: boolean; confidence: number }
}

const uuid = () => createLocalId()

export function normalizeOcrText(text: string) {
  return text.replace(/[|]/g, 'I').replace(/\uFF05/g, '%').replace(/[\u2013\u2014]/g, '-').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const percentageLimits: Partial<Record<StatKey, number>> = {
  hpPercent: 50, atkPercent: 50, defPercent: 50, critRate: 22, critDamage: 50,
  energyRegen: 50, basicDamage: 50, heavyDamage: 50, skillDamage: 50,
  liberationDamage: 50, spectroDamage: 50, fusionDamage: 50, glacioDamage: 50,
  electroDamage: 50, aeroDamage: 50, havocDamage: 50,
  healingBonus: 50
}

function restoreDroppedDecimal(key: StatKey, value: number) {
  const limit = percentageLimits[key]
  if (!limit || !Number.isInteger(value)) return value
  let normalized = value
  while (normalized > limit) normalized /= 10
  return normalized
}

function exactRollAfterAmbiguousDigitSwap(key: StatKey, value: number) {
  const text = String(value)
  const matches = new Map<number, NonNullable<ReturnType<typeof exactTunableRoll>>>()
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '1' && text[index] !== '7') continue
    const swapped = `${text.slice(0, index)}${text[index] === '1' ? '7' : '1'}${text.slice(index + 1)}`
    const normalized = restoreDroppedDecimal(key, Number(swapped))
    const roll = exactTunableRoll(key, normalized)
    if (roll) matches.set(roll.value, roll)
  }
  return matches.size === 1 ? [...matches.values()][0] : undefined
}

export function resolveTunableRoll(key: StatKey, value: number) {
  return closestTunableRoll(key, value) ?? exactRollAfterAmbiguousDigitSwap(key, value)
}

export function parseStatLine(line: string): StatLine | undefined {
  const valueMatch = line.match(/(-?\d+(?:[.,]\d+)?)\s*(%)?\s*$/)
  if (!valueMatch) return
  const label = line.slice(0, valueMatch.index).replace(/[+.:]/g, ' ').trim()
  const isPercent = Boolean(valueMatch[2] || label.includes('%'))
  const normalizedLabel = label.replace(/%/g, '').trim()
  let key: StatKey | undefined
  for (const [pattern, candidate] of statAliases) {
    if (pattern.test(`${normalizedLabel}${isPercent ? ' %' : ''}`)) { key = candidate; break }
  }
  if (!key) return
  const value = restoreDroppedDecimal(key, Number(valueMatch[1].replace(',', '.')))
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return
  return { key, value }
}

const normalizedIdentity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0]
    row[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex]
      row[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1] ? diagonal : Math.min(diagonal, row[rightIndex - 1], row[rightIndex]) + 1
      diagonal = previous
    }
  }
  return row[right.length]
}

function identitySimilarity(left: string, right: string) {
  const normalizedLeft = normalizedIdentity(left)
  const normalizedRight = normalizedIdentity(right)
  if (!normalizedLeft || !normalizedRight) return 0
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 1
  return 1 - editDistance(normalizedLeft, normalizedRight) / Math.max(normalizedLeft.length, normalizedRight.length)
}

function closestName<T>(lines: string[], entries: T[], nameOf: (entry: T) => string, threshold: number) {
  let best: { entry: T; score: number } | undefined
  for (const entry of entries) for (const line of lines) {
    const score = identitySimilarity(line.replace(/\s*\+\s*\d{1,2}.*$/, ''), nameOf(entry))
    if (!best || score > best.score) best = { entry, score }
  }
  return best && best.score >= threshold ? best : undefined
}

function closestSonata(lines: string[]) {
  return closestName(lines, sonataNames, (name) => name, 0.76)?.entry ?? 'Unknown Sonata'
}

function catalogMatch(lines: string[]): EchoCatalogEntry | undefined {
  const text = normalizedIdentity(lines.join(' '))
  const windows = lines.flatMap((_, index) => [lines.slice(index, index + 2).join(' '), lines.slice(index, index + 3).join(' ')])
  return echoCatalog.find((entry) => text.includes(normalizedIdentity(entry.name))) ?? closestName([...lines, ...windows], echoCatalog, (entry) => entry.name, 0.68)?.entry
}

function confidence(found: boolean, base: number) { return found ? base : 0.25 }

export async function imageFingerprint(dataUrl: string) {
  const data = new TextEncoder().encode(dataUrl.slice(-6000))
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  // Web Crypto is unavailable on plain-HTTP LAN origins used for phone access.
  // Three independently seeded FNV-1a hashes retain a stable 96-bit duplicate key.
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b]
  for (const byte of data) {
    for (let index = 0; index < hashes.length; index += 1) {
      hashes[index] = Math.imul(hashes[index] ^ byte, 0x01000193) >>> 0
    }
  }
  return hashes.map((hash) => hash.toString(16).padStart(8, '0')).join('')
}

export async function parseEchoText(text: string, imageDataUrl: string, source: ScanCandidate['source'], visual: VisualRecognition = {}): Promise<ScanCandidate> {
  const lines = normalizeOcrText(text)
  const detailsEnd = lines.findIndex((line) => /(?:Echo|ho|no)\s+Skills?|Sonata Effect/i.test(line))
  const detailLines = detailsEnd < 0 ? lines : lines.slice(0, detailsEnd)
  const stats = detailLines.map(parseStatLine).filter((stat): stat is StatLine => Boolean(stat))
  const joined = lines.join(' ')
  const levelMatch = joined.match(/(?:Lv\.?|Level|\+)\s*(\d{1,2})/i)
  const level = Number(levelMatch?.[1] ?? 0)
  const costMatch = joined.match(/Cost\s*([134])/i)
  const rarityMatch = joined.match(/([1-5])\s*(?:Star|\u2605)/i)
  const equippedLine = [...lines].reverse().find((line) => /Equipp?e?d\s+by\b/i.test(line))
  const equippedMatch = equippedLine?.match(/Equipp?e?d\s+by\b\s*(?:[:;,=-]\s*)?(.+?)\s*$/i)
  const equippedRaw = equippedMatch?.[1]?.trim() ?? ''
  const exactEquipped = equippedRaw ? characterCatalog.find((entry) => normalizedIdentity(entry.name) === normalizedIdentity(equippedRaw)) : undefined
  const equippedCatalog = exactEquipped ? { entry: exactEquipped, score: 1 } : equippedRaw ? closestName([equippedRaw], characterCatalog, (entry) => entry.name, 0.72) : undefined
  const catalog = catalogMatch(lines)
  const detectedName = lines.find((line) => !parseStatLine(line) && !/(level|cost|sonata|equipped|locked|echo skills)/i.test(line) && line.length > 2) ?? 'Unknown Echo'
  const name = catalog?.name ?? detectedName.replace(/\s*\+\s*\d{1,2}.*$/, '').trim()
  const textSonata = closestSonata(lines)
  const visualSonata = visual.sonata && (!catalog || catalog.sonatas.includes(visual.sonata.value)) ? visual.sonata : undefined
  const sonata = visualSonata?.value ?? (catalog?.sonatas.length === 1 ? catalog.sonatas[0] : textSonata)
  const cost = catalog?.cost ?? Number(costMatch?.[1] ?? 1) as 1 | 3 | 4
  const rarity = visual.rarity?.value ?? Number(rarityMatch?.[1] ?? 5) as Echo['rarity']
  const mainStatIndex = stats.findIndex((stat) => isMainStatAllowed(cost, stat.key))
  const mainStat = stats[mainStatIndex] ?? { key: mainStatKeysByCost[cost][0], value: 0 }
  const remainingStats = stats.filter((_, index) => index !== mainStatIndex)
  const fixedSecondary = fixedSecondaryMainStat({ cost, rarity, level })
  const secondaryMainIndex = remainingStats.findIndex((stat) => stat.key === fixedSecondary.key && Math.abs(stat.value - fixedSecondary.value) <= .51)
  const uniqueSubStats = dedupeBySubstatKey(remainingStats.filter((_, index) => index !== secondaryMainIndex), (stat) => stat.key).values
  const subStats = uniqueSubStats.slice(0, maxSubStatsForLevel(level)).map((stat) => {
    const roll = resolveTunableRoll(stat.key, stat.value)
    return { value: roll ? { ...stat, value: roll.value } : stat, confidence: roll ? (exactTunableRoll(stat.key, stat.value) ? 0.92 : 0.84) : 0.52, raw: String(stat.value) }
  })

  return {
    id: uuid(), createdAt: Date.now(), imageDataUrl, fingerprint: await imageFingerprint(imageDataUrl), source,
    fields: {
      name: { value: name, confidence: catalog ? 0.98 : confidence(name !== 'Unknown Echo', 0.72), raw: detectedName },
      cost: { value: cost, confidence: catalog ? 0.98 : confidence(Boolean(costMatch), 0.9), raw: costMatch?.[0] },
      rarity: { value: rarity, confidence: visual.rarity?.confidence ?? confidence(Boolean(rarityMatch), 0.85), raw: rarityMatch?.[0] },
      level: { value: level, confidence: confidence(Boolean(levelMatch), 0.92), raw: levelMatch?.[0] },
      sonata: { value: sonata, confidence: visualSonata?.confidence ?? (catalog?.sonatas.length === 1 ? 0.96 : confidence(sonata !== 'Unknown Sonata', 0.86)), raw: textSonata },
      mainStat: { value: mainStat, confidence: confidence(mainStatIndex >= 0, 0.9) },
      subStats,
      equippedBy: { value: equippedCatalog?.entry.name ?? equippedRaw, confidence: equippedCatalog ? Math.max(.84, equippedCatalog.score) : confidence(Boolean(equippedMatch), 0.72), raw: equippedMatch?.[0] },
      locked: { value: visual.excluded?.value ? false : (visual.locked?.value ?? false), confidence: visual.locked?.confidence ?? 0.25 },
      excluded: { value: visual.excluded?.value ?? false, confidence: visual.excluded?.confidence ?? 0.25 }
    }
  }
}

export function candidateToEcho(candidate: ScanCandidate): Echo {
  return {
    id: uuid(), name: candidate.fields.name.value, cost: candidate.fields.cost.value,
    rarity: candidate.fields.rarity.value, level: candidate.fields.level.value,
    sonata: candidate.fields.sonata.value, mainStat: candidate.fields.mainStat.value,
    subStats: candidate.fields.subStats.slice(0, maxSubStatsForLevel(candidate.fields.level.value)).map((field) => field.value), locked: candidate.fields.locked.value, excluded: candidate.fields.excluded.value,
    equippedByName: candidate.fields.equippedBy.value.trim() || undefined,
    createdAt: Date.now(), source: candidate.source === 'screen' || candidate.source === 'video' ? 'scan' : candidate.source
  }
}

export function candidateErrors(candidate: ScanCandidate) {
  const errors: string[] = []
  if (!candidate.fields.name.value.trim() || candidate.fields.name.value === 'Unknown Echo') errors.push('Enter the Echo name.')
  if (candidate.fields.level.value < 0 || candidate.fields.level.value > 25) errors.push('Level must be between 0 and 25.')
  if (![1, 3, 4].includes(candidate.fields.cost.value)) errors.push('Cost must be 1, 3, or 4.')
  if (![1, 2, 3, 4, 5].includes(candidate.fields.rarity.value)) errors.push('Rarity must be between 1 and 5.')
  if (!candidate.fields.sonata.value.trim() || candidate.fields.sonata.value === 'Unknown Sonata') errors.push('Choose or enter a Sonata set.')
  if (!Number.isFinite(candidate.fields.mainStat.value.value) || candidate.fields.mainStat.value.value < 0) errors.push('Main stat must be a non-negative number.')
  const invalidMainStat = mainStatError(candidate.fields.cost.value, candidate.fields.rarity.value, candidate.fields.level.value, candidate.fields.mainStat.value)
  if (invalidMainStat) errors.push(invalidMainStat)
  const maxSubStats = maxSubStatsForLevel(candidate.fields.level.value)
  if (candidate.fields.subStats.length > maxSubStats) errors.push(`A level ${candidate.fields.level.value} Echo can only have ${maxSubStats} substat${maxSubStats === 1 ? '' : 's'}.`)
  if (candidate.fields.subStats.some((field) => !Number.isFinite(field.value.value) || field.value.value < 0)) errors.push('Substats must be non-negative numbers.')
  if (duplicateSubstatKeys(candidate.fields.subStats.map((field) => field.value)).length) errors.push('Each substat type can only appear once.')
  if (candidate.fields.subStats.some((field) => tunableRolls[field.value.key] && !exactTunableRoll(field.value.key, field.value.value))) errors.push('Each tunable substat must match an exact in-game roll value.')
  if (candidate.buildCard) {
    if (!characterCatalog.some((entry) => entry.id === candidate.buildCard?.characterCatalogId || normalizedIdentity(entry.name) === normalizedIdentity(candidate.buildCard?.character.value ?? ''))) errors.push('Choose the build-card character from the catalog.')
    if (!weaponCatalog.some((entry) => entry.id === candidate.buildCard?.weaponCatalogId || normalizedIdentity(entry.name) === normalizedIdentity(candidate.buildCard?.weapon.value ?? ''))) errors.push('Choose the build-card weapon from the catalog.')
    if (candidate.buildCard.skillLevels.length !== 5 || candidate.buildCard.skillLevels.some((field) => field.value < 1 || field.value > 10)) errors.push('Build-card skill levels must be between 1 and 10.')
  }
  return errors
}
