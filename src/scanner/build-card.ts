import type { BuildCardDetails, Echo, ScanCandidate, ScanField, StatLine } from '../domain/types'
import { createLocalId } from '../domain/id'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { echoCatalog } from '../game-data/echoes'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { fixedSecondaryMainStat, isMainStatAllowed, mainStatKeysByCost, primaryMainStatValue } from '../game-data/echo-main-stats'
import { exactTunableRoll } from '../game-data/tunable-rolls'
import { imageFingerprint, normalizeOcrText, parseStatLine, resolveTunableRoll } from './parser'
import { dedupeBySubstatKey } from '../domain/echo-substats'
import type { OcrPool } from './ocr-pool'
import type { PreprocessClient } from './preprocess'
import { recognizeSonataAt, recognizeWideCardSonataAt } from './visual'
import type { CalibrationProfile, DiagnosticScanCandidate, ScanEvidence, ScanFrame, ScanRect, ScanRegion } from './types'
import { buildCardFormat } from './build-card-formats'
import { generatedEchoSignatures } from '../game-data/scanner-signatures.generated'
import { iconColor, scoreIconSignature, type IconColor } from './icon-color'

const CARD_STARTS = [.011, .207, .402, .596, .79]
const skillRects: ScanRect[] = [
  { x: .427, y: .304, width: .063, height: .047 }, // Normal Attack
  { x: .476, y: .535, width: .063, height: .047 }, // Resonance Skill
  { x: .548, y: .166, width: .063, height: .047 }, // Forte Circuit
  { x: .647, y: .304, width: .063, height: .047 }, // Resonance Liberation
  { x: .604, y: .535, width: .063, height: .047 } // Intro Skill
]

export async function mapCardEchoes<T>(count: number, scan: (index: number) => Promise<T>, concurrency = 3): Promise<T[]> {
  const results = new Array<T>(count)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (next < count) {
      const index = next++
      results[index] = await scan(index)
    }
  }))
  return results
}

export const cardEchoConcurrency = (workerCount: number) => workerCount > 4 ? 5 : 3

const normalizedIdentity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0]; row[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex]
      row[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1] ? diagonal : Math.min(diagonal, row[rightIndex - 1], row[rightIndex]) + 1
      diagonal = previous
    }
  }
  return row[right.length]
}

function closestCatalogEntry<T>(raw: string, entries: T[], nameOf: (entry: T) => string) {
  const normalizedRaw = normalizedIdentity(raw)
  if (normalizedRaw.length < 3) return undefined
  const ranked = entries.map((entry) => {
    const name = normalizedIdentity(nameOf(entry))
    const score = normalizedRaw === name
      ? 1
      : normalizedRaw.includes(name)
        ? .9 + .09 * name.length / Math.max(1, normalizedRaw.length)
        : name.includes(normalizedRaw)
          ? .8 + .09 * normalizedRaw.length / Math.max(1, name.length)
          : 1 - editDistance(normalizedRaw, name) / Math.max(1, normalizedRaw.length, name.length)
    return { entry, score }
  }).sort((left, right) => right.score - left.score)
  return ranked[0]?.score >= .62 ? ranked[0] : undefined
}

const loadImage = async (source: string) => {
  const image = new Image(); image.src = source; await image.decode(); return image
}

function cropPixels(image: HTMLImageElement, rect: ScanRect, size = 24) {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return new Uint8ClampedArray()
  context.drawImage(image, image.naturalWidth * rect.x, image.naturalHeight * rect.y, image.naturalWidth * rect.width, image.naturalHeight * rect.height, 0, 0, size, size)
  return context.getImageData(0, 0, size, size).data
}

function signature(pixels: Uint8ClampedArray) {
  const values: number[] = []
  for (let offset = 0; offset < pixels.length; offset += 4) values.push(pixels[offset + 3] < 32 ? 0 : (pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722) / 255)
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length)) || 1
  return values.map((value) => Math.max(-2, Math.min(2, (value - mean) / deviation)))
}

export function rankImageSignatures(captured: number[], templates: Array<{ name: string; signature: number[]; color?: IconColor }>, capturedColor?: IconColor) {
  return templates.map((template) => ({
    name: template.name,
    score: scoreIconSignature(captured, template.signature, capturedColor, template.color)
  })).sort((left, right) => right.score - left.score)
}

export function resolveKernelPuppetTint(name: string, pixels: Uint8ClampedArray) {
  if (!name.startsWith('Kernel Puppet:')) return name
  let red = 0, blue = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const [r, g, b] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
    if (r > 100 && r > g * 1.25 && r > b * 1.25) red += 1
    if (b > 100 && b > r * 1.25 && b > g * 1.05) blue += 1
  }
  return red > pixels.length / 4 * .06 && red > blue * 2 ? 'Kernel Puppet: Anger' : name
}

export function echoSignatureCandidates(cost: Echo['cost'], sonata?: string) {
  return generatedEchoSignatures.filter((entry) => entry.cost === cost
    && (!sonata || echoCatalog.some((echo) => echo.name === entry.name && echo.sonatas.includes(sonata))))
}

async function matchEcho(imageDataUrl: string, cost: Echo['cost'], useColor = true, sonata?: string) {
  const image = await loadImage(imageDataUrl)
  const pixels = cropPixels(image, { x: .04, y: .04, width: .92, height: .92 }, 16)
  const captured = signature(pixels)
  const templates = echoSignatureCandidates(cost, sonata)
    .map((entry) => ({ name: entry.name, signature: Array.from(entry.signature, (value) => value / 32), color: 'color' in entry ? entry.color : undefined }))
  const ranked = rankImageSignatures(captured, templates, useColor ? iconColor(pixels) : undefined), best = ranked[0], runnerUp = ranked[1]
  // Recolored wide card artwork can make different Echoes nearly indistinguishable.
  if (!best || best.score < .42 || (!useColor && runnerUp && best.score - runnerUp.score < .03)) return { value: 'Unknown Echo', confidence: .2 }
  const name = useColor ? resolveKernelPuppetTint(best.name, pixels) : best.name
  return { value: name, confidence: name === best.name ? Math.min(.94, .48 + best.score * .42 + Math.max(0, best.score - (runnerUp?.score ?? 0)) * 2) : .9 }
}

const region = (
  id: string,
  rect: ScanRect,
  recognition: ScanRegion['recognition'],
  kind: ScanRegion['kind'] = recognition === 'number' ? 'level' : 'name'
): ScanRegion => ({ id, kind, label: id, rect, recognition })

async function recognizeText(
  pool: OcrPool,
  preprocess: PreprocessClient,
  image: string,
  id: string,
  rect: ScanRect,
  recognition: ScanRegion['recognition'] = 'text',
  kind?: ScanRegion['kind'],
  strategy?: 'bright-substat' | 'plain' | 'wide-card-name' | 'contrast'
) {
  const configured = region(id, rect, recognition, kind)
  const [original, ocrCrop] = await Promise.all([
    preprocess.process(image, { ...configured, recognition: 'visual' }),
    recognition === 'visual' ? undefined : preprocess.process(image, configured, strategy)
  ])
  const processed = ocrCrop ?? original
  const result = await pool.recognize(processed.blob, configured, `build-card:${id}`)
  return { ...result, region: configured, originalCrop: original.dataUrl, processedCrop: processed.dataUrl, preprocessing: processed.strategy }
}

async function recognizePreparedText(
  pool: OcrPool, preprocess: PreprocessClient, source: string, prepared: string,
  id: string, originalRect: ScanRect, preparedRect: ScanRect,
  recognition: ScanRegion['recognition'], kind: ScanRegion['kind']
) {
  const configured = region(id, originalRect, recognition, kind)
  const [original, processed] = await Promise.all([preprocess.crop(source, originalRect), preprocess.crop(prepared, preparedRect, false)])
  const result = await pool.recognize(processed.blob, configured, `build-card:${id}`)
  return { ...result, region: configured, originalCrop: original.dataUrl, processedCrop: processed.dataUrl, preprocessing: 'substat' as const }
}

type BuildCardOcrResult = Awaited<ReturnType<typeof recognizeText>>
type BuildCardCrop = Awaited<ReturnType<PreprocessClient['crop']>>

export function confirmedDroppedDigitValue(line: string, reread: string) {
  const parsed = parseStatLine(line)
  if (!parsed || !/^1\.\d$/.test(String(parsed.value))) return
  const read = reread.trim().match(/^(7|11)[.,](\d)\s*%?$/)
  if (!read || Number(read[2]) !== Math.round((parsed.value % 1) * 10)) return
  const value = Number(`${read[1]}.${read[2]}`)
  return exactTunableRoll(parsed.key, value) ? line.replace(/\d+(?:[.,]\d+)?(?=\s*%?\s*$)/, String(value)) : undefined
}

async function recoverAmbiguousStatValues(
  rows: string[], rowRects: ScanRect[], index: number, source: string, pool: OcrPool, preprocess: PreprocessClient
) {
  const lines = [...rows]
  const retries: BuildCardOcrResult[] = []
  if (lines.length !== rowRects.length) return { lines, retries }
  for (let rowIndex = 0; rowIndex < lines.length; rowIndex += 1) {
    const parsed = parseStatLine(lines[rowIndex])
    if (!parsed || !/^1\.\d$/.test(String(parsed.value)) || exactTunableRoll(parsed.key, parsed.value)) continue
    const row = rowRects[rowIndex]
    const result = await recognizeText(pool, preprocess, source, `echo-${index}-stats-row-${rowIndex}-value-contrast`,
      { ...row, x: row.x + row.width * .62, width: row.width * .38 }, 'number', 'level', 'contrast')
    retries.push(result)
    if (result.confidence >= .8) lines[rowIndex] = confirmedDroppedDigitValue(lines[rowIndex], result.text) ?? lines[rowIndex]
  }
  return { lines, retries }
}

export function mergeVerifiedStatRows(blockText: string, rows: Array<{ text: string; confidence: number }>) {
  const blockRows = normalizeOcrText(blockText)
  if (blockRows.length !== rows.length) return blockText
  return blockRows.map((blockText, index) => {
    const block = parseStatLine(blockText), row = parseStatLine(rows[index].text)
    return block && row && block.key === row.key && rows[index].confidence >= .8 && exactTunableRoll(row.key, row.value)
      ? rows[index].text : blockText
  }).join('\n')
}

export function canUseStatBlockWithoutRows(text: string, confidence: number) {
  if (confidence < .95) return false
  const lines = normalizeOcrText(text)
  const rows = lines.map(parseStatLine)
  return rows.length === 5 && rows.every((row, index): row is StatLine => {
    const rawValue = Number(lines[index].match(/(-?\d+(?:[.,]\d+)?)\s*%?\s*$/)?.[1].replace(',', '.'))
    return Boolean(row && rawValue === row.value && exactTunableRoll(row.key, row.value))
  })
    && new Set(rows.map((row) => row.key)).size === 5
}

function numberField(raw: string, fallback: number, min: number, max: number): ScanField<number> {
  const match = raw.match(/\d{1,2}/), value = Math.max(min, Math.min(max, Number(match?.[0] ?? fallback)))
  return { value, confidence: match ? .88 : .25, raw }
}

export function discordCharacterLevelField(raw: string): ScanField<number> {
  const token = raw.match(/L[VY][^0-9O]{0,3}([0-9O]{1,2})(?![0-9O])/i)?.[1]
    ?? raw.trim().match(/^([0-9O]{1,2})$/i)?.[1]
  const value = Number(token?.replace(/O/gi, '0'))
  return value >= 1 && value <= 90
    ? { value, confidence: .88, raw }
    : { value: 90, confidence: .25, raw }
}

export function findGoldBadgeRun(pixels: Uint8ClampedArray, minimumLength: number) {
  let start = -1, bestStart = -1, bestLength = 0
  for (let x = 0; x <= pixels.length / 4; x += 1) {
    const offset = x * 4, red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
    const gold = x < pixels.length / 4 && red > 105 && green > 80 && red > blue * 1.35 && green > blue * 1.25
    if (gold && start < 0) start = x
    if (!gold && start >= 0) {
      if (x - start > bestLength) { bestStart = start; bestLength = x - start }
      start = -1
    }
  }
  return bestLength >= minimumLength ? { start: bestStart, length: bestLength } : undefined
}

function discordLevelBadgeRect(image: HTMLImageElement, search: ScanRect): ScanRect {
  if (search.x < 0 || search.y < 0 || search.width <= 0 || search.height <= 0 || search.x + search.width > 1 || search.y + search.height > 1) return search
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return search
  const y = Math.round((search.y + search.height * .43) * image.naturalHeight)
  context.drawImage(image, 0, -y)
  const left = Math.round(search.x * image.naturalWidth)
  const right = Math.round((search.x + search.width) * image.naturalWidth)
  const run = findGoldBadgeRun(context.getImageData(left, 0, right - left, 1).data, Math.round(image.naturalWidth * .02))
  if (!run) return search
  return {
    x: (left + run.start - 4) / image.naturalWidth, y: search.y + search.height * .3,
    width: (run.length + 29) / image.naturalWidth, height: search.height * .5
  }
}

export function classifyDiscordSequence(brightness: number[]): ScanField<number> {
  if (brightness.length !== 6 || brightness.some((value) => !Number.isFinite(value))) return { value: 0, confidence: 0, raw: 'Sequence stars could not be read' }
  if (brightness.some((value) => value < 70)) return { value: 0, confidence: 0, raw: `Sequence star centers are outside the expected artwork: ${brightness.join(', ')}` }
  const firstDark = brightness.findIndex((value) => value < 145)
  const value = firstDark < 0 ? 6 : firstDark
  const consistent = brightness.slice(value).every((score) => score < 145)
  const margin = Math.min(...brightness.map((score) => Math.abs(score - 145)))
  return { value, confidence: consistent ? Math.min(.95, .5 + margin / 65) : .25, raw: `Star center brightness: ${brightness.join(', ')}` }
}

function discordSequenceBrightness(image: HTMLImageElement, rect: ScanRect) {
  return Array.from({ length: 6 }, (_, index) => {
    const pixels = cropPixels(image, {
      x: rect.x + rect.width * ((index + .5) / 6 - 1 / 60), y: rect.y + rect.height * .375,
      width: rect.width / 30, height: rect.height / 4
    }, 16)
    if (!pixels.length) return NaN
    let total = 0
    for (let offset = 0; offset < pixels.length; offset += 4) total += pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722
    return Math.round(total / (pixels.length / 4))
  })
}

export function classifyWideCardSequence(whiteFractions: number[]): ScanField<number> {
  if (whiteFractions.length !== 6 || whiteFractions.some((value) => !Number.isFinite(value)))
    return { value: 0, confidence: 0, raw: 'Sequence icons could not be read' }
  const threshold = .1
  const firstInactive = whiteFractions.findIndex((value) => value < threshold)
  const value = firstInactive < 0 ? 6 : firstInactive
  const consistent = whiteFractions.slice(value).every((fraction) => fraction < threshold)
  const margin = Math.min(...whiteFractions.map((fraction) => Math.abs(fraction - threshold)))
  return {
    value, confidence: !consistent || margin < .025 ? .25 : Math.min(.95, .65 + margin * 2),
    raw: `White icon fractions: ${whiteFractions.map((fraction) => fraction.toFixed(3)).join(', ')}`
  }
}

function wideCardSequenceWhiteFractions(image: HTMLImageElement, rect: ScanRect) {
  return Array.from({ length: 6 }, (_, index) => {
    const pixels = cropPixels(image, {
      x: rect.x + rect.width * .24,
      y: rect.y + rect.height * ((index + .5) / 6 - 1 / 24),
      width: rect.width * .52, height: rect.height / 12
    })
    if (!pixels.length) return NaN
    let white = 0
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
      if (Math.min(red, green, blue) > 170 && Math.max(red, green, blue) - Math.min(red, green, blue) < 55) white += 1
    }
    return white / (pixels.length / 4)
  })
}

function skillLevelField(raw: string): ScanField<number> {
  const normalized = raw.replace(/\s+/g, '')
  const afterLevelMarker = normalized.match(/[.,](10|[1-9])/)
  if (afterLevelMarker) return { value: Number(afterLevelMarker[1]), confidence: .92, raw }
  const fraction = normalized.match(/(?:LV)?(10|[1-9])[\/|]10/i)
  if (fraction) return { value: Number(fraction[1]), confidence: .88, raw }
  return numberField(raw, 1, 1, 10)
}

interface ExplicitBuildCardMainOcr { label: string; value: string }

function parseExplicitBuildCardMain(ocr: ExplicitBuildCardMainOcr) {
  const label = normalizeOcrText(ocr.label).join(' ')
  const value = ocr.value.match(/-?\d+(?:[.,]\d+)?/)?.[0]
  const parsed = value ? parseStatLine(`${label} ${value}%`) : undefined
  if (parsed?.key === 'hp') return { ...parsed, key: 'hpPercent' as const }
  if (parsed?.key === 'atk') return { ...parsed, key: 'atkPercent' as const }
  if (parsed?.key === 'def') return { ...parsed, key: 'defPercent' as const }
  return parsed
}

function inferBuildCardCostFromMain(ocr: ExplicitBuildCardMainOcr) {
  const main = parseExplicitBuildCardMain(ocr)
  if (!main) return undefined
  return ([1, 3, 4] as const).reduce<{ cost: Echo['cost']; distance: number } | undefined>((best, cost) => {
    if (!isMainStatAllowed(cost, main.key)) return best
    const expected = primaryMainStatValue(cost, 5, 25, main.key)
    if (expected === undefined) return best
    const distance = Math.abs(main.value - expected)
    return !best || distance < best.distance ? { cost, distance } : best
  }, undefined)?.cost
}

export function parseBuildCardStats(text: string, cost: Echo['cost'], explicitMainOcr?: ExplicitBuildCardMainOcr) {
  const stats = normalizeOcrText(text).map(parseStatLine).filter((value): value is StatLine => Boolean(value))
  const hasExplicitMainRegion = explicitMainOcr !== undefined
  const parsedExplicitMainStat = explicitMainOcr ? parseExplicitBuildCardMain(explicitMainOcr) : undefined
  const explicitMainStat = parsedExplicitMainStat && isMainStatAllowed(cost, parsedExplicitMainStat.key) ? parsedExplicitMainStat : undefined
  const mainIndex = hasExplicitMainRegion ? -1 : stats.reduce((best, stat, index) => {
    if (!isMainStatAllowed(cost, stat.key)) return best
    const expected = primaryMainStatValue(cost, 5, 25, stat.key)
    const distance = expected === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(stat.value - expected)
    return best.index < 0 || distance < best.distance ? { index, distance } : best
  }, { index: -1, distance: Number.MAX_SAFE_INTEGER }).index
  const recognizedMainStat = explicitMainStat ?? stats[mainIndex]
  const expectedMainStatValue = recognizedMainStat
    ? primaryMainStatValue(cost, 5, 25, recognizedMainStat.key)
    : undefined
  const mainStat = recognizedMainStat
    ? { ...recognizedMainStat, value: expectedMainStatValue ?? recognizedMainStat.value }
    : { key: mainStatKeysByCost[cost][0], value: 0 }
  const mainStatWasCorrected = recognizedMainStat !== undefined
    && expectedMainStatValue !== undefined
    && Math.abs(recognizedMainStat.value - expectedMainStatValue) > .051
  const remaining = hasExplicitMainRegion ? stats : stats.filter((_, index) => index !== mainIndex)
  const fixedSecondary = fixedSecondaryMainStat({ cost, rarity: 5, level: 25 })
  const secondaryMainIndex = remaining.findIndex((stat) => stat.key === fixedSecondary.key && Math.abs(stat.value - fixedSecondary.value) <= .51)
  const subStats = dedupeBySubstatKey(remaining.filter((_, index) => index !== secondaryMainIndex), (stat) => stat.key).values.slice(0, 5).map((stat) => {
    const corrected = stat.value >= 71 && stat.value < 72 ? { ...stat, value: stat.value - 64 } : stat
    const roll = resolveTunableRoll(corrected.key, corrected.value)
    return { value: roll ? { ...corrected, value: roll.value } : corrected, confidence: roll ? (exactTunableRoll(corrected.key, corrected.value) ? .9 : .8) : .5, raw: String(stat.value) }
  })
  return { mainStat, mainConfidence: recognizedMainStat === undefined ? .25 : mainStatWasCorrected ? .8 : .88, subStats }
}

async function recognizeConfiguredBuildCard(
  frame: ScanFrame,
  profile: CalibrationProfile,
  pool: OcrPool,
  preprocess: PreprocessClient,
  onStage?: (progress: number, status: string) => void
): Promise<DiagnosticScanCandidate[]> {
  const source = frame.panelImageDataUrl
  const format = buildCardFormat(frame.buildCardFormat ?? 'landscape-card')
  const configuredRect = (id: string, fallback: ScanRect) => profile.regions.find((entry) => entry.id === id)?.rect ?? fallback
  const optionalText = async (id: string, rect: ScanRect | undefined, recognition: ScanRegion['recognition'] = 'text', kind?: ScanRegion['kind']) => rect
    ? recognizeText(pool, preprocess, source, id, configuredRect(id, rect), recognition, kind)
    : undefined

  onStage?.(.05, `Reading ${format.label} character and weapon`)
  const [characterOcr, characterLevelOcr, weaponOcr, weaponLevelOcr, weaponRankOcr, skillOcr, cardImage] = await Promise.all([
    optionalText('character', format.character), optionalText('character-level', format.characterLevel, 'number'),
    optionalText('weapon', format.weapon), optionalText('weapon-level', format.weaponLevel, 'number'),
    optionalText('weapon-rank', format.weaponRank, 'number'),
    Promise.all(format.skills.map((rect, index) => recognizeText(pool, preprocess, source, `skill-${index}`, configuredRect(`skill-${index}`, rect), 'number'))),
    loadImage(source)
  ])
  const characterMatch = closestCatalogEntry(characterOcr?.text ?? '', characterCatalog, (entry) => entry.name)
  const weaponMatch = closestCatalogEntry(weaponOcr?.text ?? '', weaponCatalog, (entry) => entry.name)
  const field = (result: BuildCardOcrResult | undefined, fallback: number, min: number, max: number) => result ? numberField(result.text, fallback, min, max) : { value: fallback, confidence: 0, raw: 'Not displayed by this card format' }
  const sequenceRect = format.sequence && configuredRect('sequence', format.sequence)
  const sequenceCrop = sequenceRect ? await preprocess.crop(source, sequenceRect) : undefined
  const sequence = sequenceRect
    ? classifyWideCardSequence(wideCardSequenceWhiteFractions(cardImage, sequenceRect))
    : { value: 0, confidence: 0, raw: 'Review sequence from the card artwork' }
  const details: BuildCardDetails = {
    id: createLocalId(), formatId: format.id, formatConfidence: frame.buildCardFormatConfidence ?? 1,
    character: { value: characterMatch?.entry.name ?? normalizeOcrText(characterOcr?.text ?? '')[0] ?? '', confidence: characterMatch ? Math.max(.72, characterMatch.score) : characterOcr?.confidence ?? 0, raw: characterOcr?.text },
    characterCatalogId: characterMatch?.entry.id,
    characterLevel: field(characterLevelOcr, 90, 1, 90),
    sequence,
    skillLevels: format.skills.length === 5 ? skillOcr.map((result) => skillLevelField(result.text)) : [1, 1, 1, 1, 1].map((value) => ({ value, confidence: 0, raw: 'Not displayed by this card format' })),
    weapon: { value: weaponMatch?.entry.name ?? normalizeOcrText(weaponOcr?.text ?? '')[0] ?? '', confidence: weaponMatch ? Math.max(.72, weaponMatch.score) : weaponOcr?.confidence ?? 0, raw: weaponOcr?.text },
    weaponCatalogId: weaponMatch?.entry.id,
    weaponLevel: field(weaponLevelOcr, 90, 1, 90),
    weaponRank: field(weaponRankOcr, 1, 1, 5),
    sourceImageDataUrl: source
  }

  let completedEchoes = 0
  const candidates = await mapCardEchoes(format.echoes.length, async (index): Promise<DiagnosticScanCandidate> => {
    const layout = format.echoes[index]
    const artRect = configuredRect(`echo-${index}-art`, layout.art)
    const statsRect = configuredRect(`echo-${index}-stats`, layout.stats)
    const [art, nameOcr, costOcr, initialStatsOcr, initialMainLabelOcr, mainValueOcr] = await Promise.all([
      preprocess.crop(source, artRect),
      layout.name ? recognizeText(pool, preprocess, source, `echo-${index}-name`,
        configuredRect(`echo-${index}-name`, layout.name), 'text', 'name', format.id.startsWith('wide-card') ? 'wide-card-name' : undefined) : undefined,
      optionalText(`echo-${index}-cost`, layout.cost, 'number'),
      recognizeText(pool, preprocess, source, `echo-${index}-stats`, statsRect, 'text', 'substats-block'),
      optionalText(`echo-${index}-main-stat-label`, layout.mainStatLabel, 'text', 'main-stat-label'),
      optionalText(`echo-${index}-main-stat-value`, layout.mainStatValue, 'number')
    ])
    let mainLabelOcr = initialMainLabelOcr
    if (format.id.startsWith('wide-card') && layout.mainStatLabel && mainLabelOcr && mainValueOcr && !parseExplicitBuildCardMain({ label: mainLabelOcr.text, value: mainValueOcr.text })) {
      const rect = configuredRect(`echo-${index}-main-stat-label`, layout.mainStatLabel)
      for (const [retryIndex, retryRect] of [
        { ...rect, x: rect.x - .006, width: rect.width + .006 },
        { ...rect, y: rect.y - .015, height: rect.height + .015 }
      ].entries()) {
        const retry = await recognizeText(pool, preprocess, source, `echo-${index}-main-stat-label-retry-${retryIndex}`, retryRect, 'text', 'main-stat-label')
        if (parseExplicitBuildCardMain({ label: retry.text, value: mainValueOcr.text })) { mainLabelOcr = retry; break }
      }
    }
    const mainOcr = { label: mainLabelOcr?.text ?? '', value: mainValueOcr?.text ?? '' }
    const mainRaw = `${mainOcr.label} ${mainOcr.value}`.trim()
    let selectedNameOcr = nameOcr
    let nameMatch = closestCatalogEntry(nameOcr?.text ?? '', echoCatalog, (entry) => entry.name)
    if (format.id.startsWith('wide-card') && layout.name && (!nameMatch || nameMatch.score < .9)) {
      const alternateName = await recognizeText(pool, preprocess, source, `echo-${index}-name-plain`,
        configuredRect(`echo-${index}-name`, layout.name), 'text', 'name', 'plain')
      const alternateMatch = closestCatalogEntry(alternateName.text, echoCatalog, (entry) => entry.name)
      if (alternateMatch && alternateMatch.score >= .8 && (!nameMatch || alternateMatch.score > nameMatch.score)) {
        nameMatch = alternateMatch
        selectedNameOcr = alternateName
      }
    }
    const costFromOcr = Number(costOcr?.text.match(/[134]/)?.[0]) as Echo['cost']
    const inferredMainCost = inferBuildCardCostFromMain(mainOcr)
    const provisionalCost = nameMatch && (format.id.startsWith('wide-card') || nameMatch.score >= .9) ? nameMatch.entry.cost
      : [1, 3, 4].includes(costFromOcr) ? costFromOcr : inferredMainCost ?? nameMatch?.entry.cost ?? (index === 0 ? 4 : index < 3 ? 3 : 1)
    const sonataRect = layout.sonata ? configuredRect(`echo-${index}-sonata`, layout.sonata) : undefined
    const cardSonata = format.id.startsWith('wide-card') && sonataRect ? await recognizeWideCardSonataAt(cardImage, sonataRect) : undefined
    const echoIdentity = nameMatch
      ? { value: nameMatch.entry.name, confidence: Math.max(.75, nameMatch.score) }
      : await matchEcho(art.dataUrl, provisionalCost, !format.id.startsWith('wide-card'), cardSonata && cardSonata.confidence >= .85 ? cardSonata.value : undefined)
    const echoEntry = echoCatalog.find((entry) => entry.name === echoIdentity.value)
    const cost = echoEntry?.cost ?? provisionalCost
    const hasExplicitMainRegion = layout.mainStatLabel !== undefined || layout.mainStatValue !== undefined
    let stats = parseBuildCardStats(initialStatsOcr.text, cost, hasExplicitMainRegion ? mainOcr : undefined)
    let statRows: BuildCardOcrResult[] = []
    const statRetries: BuildCardOcrResult[] = []
    if (format.id.startsWith('wide-card') && (stats.subStats.length !== 5 || !canUseStatBlockWithoutRows(initialStatsOcr.text, initialStatsOcr.confidence))) {
      statRows = await Promise.all(Array.from({ length: 5 }, (_, rowIndex) => recognizeText(
        pool, preprocess, source, `echo-${index}-stats-row-${rowIndex}`,
        { ...statsRect, y: statsRect.y + statsRect.height * rowIndex / 5, height: statsRect.height / 5 },
        'text', 'substat-row', 'bright-substat'
      )))
      const rowTexts = statRows.map((result) => result.text.trim())
      for (let rowIndex = 0; rowIndex < statRows.length; rowIndex += 1) {
        const parsedRow = parseStatLine(rowTexts[rowIndex])
        if (parsedRow && exactTunableRoll(parsedRow.key, parsedRow.value)) continue
        if (parsedRow && /^1\.\d$/.test(String(parsedRow.value))) continue
        const rowRect = statRows[rowIndex].region.rect
        const split = rowRect.width * .72
        const [label, value] = await Promise.all([
          recognizePreparedText(pool, preprocess, source, statRows[rowIndex].processedCrop, `echo-${index}-stats-row-${rowIndex}-label`, { ...rowRect, width: split }, { x: 0, y: 0, width: .72, height: 1 }, 'text', 'main-stat-label'),
          recognizePreparedText(pool, preprocess, source, statRows[rowIndex].processedCrop, `echo-${index}-stats-row-${rowIndex}-value`, { ...rowRect, x: rowRect.x + split, width: rowRect.width - split }, { x: .72, y: 0, width: .28, height: 1 }, 'number', 'level')
        ])
        statRetries.push(label, value)
        const combined = `${label.text.trim()} ${value.text.trim()}`
        if (parseStatLine(combined)) rowTexts[rowIndex] = combined
      }
      const repaired = await recoverAmbiguousStatValues(rowTexts, statRows.map((row) => row.region.rect), index, source, pool, preprocess)
      statRetries.push(...repaired.retries)
      rowTexts.splice(0, rowTexts.length, ...repaired.lines)
      const rowStats = parseBuildCardStats(rowTexts.join('\n'), cost, mainOcr)
      const mergedText = mergeVerifiedStatRows(initialStatsOcr.text, rowTexts.map((text, rowIndex) => ({ text, confidence: statRows[rowIndex].confidence })))
      const mergedStats = parseBuildCardStats(mergedText, cost, mainOcr)
      const quality = (candidate: typeof stats) => candidate.subStats.length * 10 + candidate.subStats.reduce((score, field) => score + field.confidence, 0)
      if (quality(rowStats) >= quality(stats)) stats = rowStats
      if (quality(mergedStats) > quality(stats)) stats = mergedStats
    }
    const allowedSonatas = echoEntry?.sonatas
    const [sonata, sonataCrop] = sonataRect
      ? await Promise.all([
        format.id.startsWith('wide-card')
          ? (cardSonata && cardSonata.confidence >= .85 ? cardSonata : recognizeWideCardSonataAt(cardImage, sonataRect, allowedSonatas))
          : recognizeSonataAt(cardImage, sonataRect, allowedSonatas),
        preprocess.crop(source, sonataRect)
      ])
      : [undefined, undefined]
    const sonataField = sonata ?? { value: echoEntry?.sonatas.length === 1 ? echoEntry.sonatas[0] : 'Unknown Sonata', confidence: echoEntry?.sonatas.length === 1 ? .75 : .25 }
    const candidate: ScanCandidate = {
      id: createLocalId(), createdAt: Date.now(), imageDataUrl: art.dataUrl, fingerprint: await imageFingerprint(art.dataUrl), source: frame.source,
      fields: {
        name: echoIdentity, cost: { value: cost, confidence: echoEntry ? .98 : costOcr?.confidence ?? .35, raw: costOcr?.text },
        rarity: { value: 5, confidence: .8, raw: `${format.label} build card` }, level: { value: 25, confidence: stats.subStats.length === 5 ? .9 : .55, raw: 'Inferred from build card' },
        sonata: sonataField, mainStat: { value: stats.mainStat, confidence: stats.mainConfidence, raw: mainRaw }, subStats: stats.subStats,
        equippedBy: { value: details.character.value, confidence: details.character.confidence }, locked: { value: true, confidence: 1 }, excluded: { value: false, confidence: 1 }
      }, buildCard: details
    }
    const evidenceRegion = region(`echo-${index}-stats`, statsRect, 'text', 'substats-block')
    const evidence: Record<string, ScanEvidence> = {
      [`echo-${index}-stats`]: {
        region: { ...evidenceRegion, label: `${format.label} Echo ${index + 1} stats block` }, originalCrop: initialStatsOcr.originalCrop, processedCrop: initialStatsOcr.processedCrop,
        rawOcr: initialStatsOcr.text, confidence: initialStatsOcr.confidence, parsedValue: stats.subStats.map((item) => item.value),
        validation: { valid: stats.subStats.length === 5, messages: stats.subStats.length === 5 ? [] : [`Recognized ${stats.subStats.length} of 5 substats.`] },
        workerId: initialStatsOcr.workerId, jobId: initialStatsOcr.jobId, processingMs: initialStatsOcr.processingMs, preprocessing: initialStatsOcr.preprocessing
      }
    }
    if (selectedNameOcr) evidence[`echo-${index}-name`] = {
      region: { ...selectedNameOcr.region, id: `echo-${index}-name`, label: `${format.label} Echo ${index + 1} name` },
      originalCrop: selectedNameOcr.originalCrop, processedCrop: selectedNameOcr.processedCrop,
      rawOcr: selectedNameOcr.text || '(No name text recognized)', confidence: echoIdentity.confidence, parsedValue: echoIdentity.value,
      validation: { valid: Boolean(nameMatch && echoEntry), messages: nameMatch && echoEntry ? [] : ['Name OCR was not recognized; review the artwork match.'] },
      workerId: selectedNameOcr.workerId, jobId: selectedNameOcr.jobId,
      processingMs: selectedNameOcr.processingMs, preprocessing: selectedNameOcr.preprocessing
    }
    if (sequenceRect && sequenceCrop) evidence.sequence = {
      region: { ...region('sequence', sequenceRect, 'visual'), label: 'Sequence icons' },
      originalCrop: sequenceCrop.dataUrl, processedCrop: sequenceCrop.dataUrl, rawOcr: sequence.raw ?? '',
      confidence: sequence.confidence, parsedValue: sequence.value,
      validation: { valid: sequence.confidence >= .55, messages: sequence.confidence >= .55 ? [] : ['Sequence icons need review.'] },
      workerId: 'visual-classifier', jobId: 'build-card:sequence', processingMs: 0, preprocessing: sequenceCrop.strategy
    }
    for (const result of [...statRows, ...statRetries]) {
      const parsed = parseStatLine(result.text)
      const valid = result.region.kind === 'substat-row' ? Boolean(parsed) : Boolean(result.text.trim())
      evidence[result.region.id] = {
        region: result.region, originalCrop: result.originalCrop, processedCrop: result.processedCrop, rawOcr: result.text,
        confidence: result.confidence, parsedValue: parsed ?? result.text.trim(), validation: { valid, messages: valid ? [] : ['Stat label or value was not recognized.'] },
        workerId: result.workerId, jobId: result.jobId, processingMs: result.processingMs, preprocessing: result.preprocessing
      }
    }
    if (mainLabelOcr) evidence[`echo-${index}-main-stat-label`] = {
      region: { ...mainLabelOcr.region, label: `${format.label} Echo ${index + 1} main stat` },
      originalCrop: mainLabelOcr.originalCrop, processedCrop: mainLabelOcr.processedCrop, rawOcr: mainLabelOcr.text,
      confidence: stats.mainConfidence, parsedValue: stats.mainStat.key,
      validation: { valid: Boolean(mainLabelOcr.text.trim()), messages: mainLabelOcr.text.trim() ? [] : ['No main stat label was recognized.'] },
      workerId: mainLabelOcr.workerId, jobId: mainLabelOcr.jobId, processingMs: mainLabelOcr.processingMs, preprocessing: mainLabelOcr.preprocessing
    }
    if (mainValueOcr) evidence[`echo-${index}-main-stat-value`] = {
      region: { ...mainValueOcr.region, label: `${format.label} Echo ${index + 1} main stat value` },
      originalCrop: mainValueOcr.originalCrop, processedCrop: mainValueOcr.processedCrop, rawOcr: mainValueOcr.text,
      confidence: stats.mainConfidence, parsedValue: stats.mainStat.value,
      validation: { valid: Boolean(mainValueOcr.text.trim()), messages: mainValueOcr.text.trim() ? [] : ['No main stat value was recognized.'] },
      workerId: mainValueOcr.workerId, jobId: mainValueOcr.jobId, processingMs: mainValueOcr.processingMs, preprocessing: mainValueOcr.preprocessing
    }
    if (sonataRect && sonataCrop) evidence[`echo-${index}-sonata`] = {
      region: { ...region(`echo-${index}-sonata`, sonataRect, 'visual', 'sonata'), label: `${format.label} Echo ${index + 1} Sonata` },
      originalCrop: sonataCrop.dataUrl, processedCrop: sonataCrop.dataUrl, rawOcr: '', confidence: sonataField.confidence, parsedValue: sonataField.value,
      validation: { valid: sonataField.confidence >= .55, messages: sonataField.confidence >= .55 ? [] : ['Sonata has low confidence.'] },
      workerId: 'visual-classifier', jobId: `build-card:echo-${index}-sonata`, processingMs: 0, preprocessing: sonataCrop.strategy
    }
    completedEchoes += 1
    onStage?.(.2 + completedEchoes * .15, `Read ${completedEchoes} of ${format.echoes.length} ${format.label} Echoes`)
    return { ...candidate, sessionId: frame.sessionId, frameSequence: frame.sequence + index / 10, reviewState: 'new', evidence }
  }, cardEchoConcurrency(pool.metrics().workerCount))
  if (format.id.startsWith('wide-card')) {
    const unresolved = candidates.findIndex((candidate) => candidate.fields.sonata.value === 'Unknown Sonata')
    const peers = candidates.filter((candidate, index) => index !== unresolved && candidate.fields.sonata.value !== 'Unknown Sonata' && candidate.fields.sonata.confidence >= .7)
    const sharedSonata = peers[0]?.fields.sonata.value
    const target = candidates[unresolved]
    if (target && sharedSonata && peers.length === candidates.length - 1 && peers.every((candidate) => candidate.fields.sonata.value === sharedSonata)
      && target.fields.name.confidence >= .9 && echoCatalog.find((entry) => entry.name === target.fields.name.value)?.sonatas.includes(sharedSonata)) {
      target.fields.sonata = { value: sharedSonata, confidence: .7, raw: 'Inferred from the other four Echoes on this card' }
      const evidence = target.evidence?.[`echo-${unresolved}-sonata`]
      if (evidence) {
        evidence.confidence = .7
        evidence.parsedValue = sharedSonata
        evidence.rawOcr = target.fields.sonata.raw ?? ''
        evidence.validation = { valid: true, messages: [] }
        evidence.workerId = 'card-context'
      }
    }
  }
  onStage?.(1, `${format.label} card ready for review`)
  return candidates
}

export async function looksLikeOfficialBuildCard(imageDataUrl: string) {
  const image = await loadImage(imageDataUrl)
  if (image.naturalWidth / image.naturalHeight < 1.6) return false
  const pixels = cropPixels(image, { x: .755, y: .045, width: .13, height: .235 }, 48)
  let transitions = 0, samples = 0
  for (let y = 0; y < 48; y += 2) for (let x = 1; x < 48; x += 1) {
    const left = pixels[(y * 48 + x - 1) * 4] > 128, right = pixels[(y * 48 + x) * 4] > 128
    transitions += Number(left !== right); samples += 1
  }
  return samples > 0 && transitions / samples > .22
}

export async function recognizeBuildCard(frame: ScanFrame, profile: CalibrationProfile, pool: OcrPool, preprocess: PreprocessClient, onStage?: (progress: number, status: string) => void): Promise<DiagnosticScanCandidate[]> {
  if (frame.cardMetadata) {
    const card = frame.cardMetadata
    const character = characterCatalog.find((entry) => entry.id === card.characterCatalogId)!
    const weapon = weaponCatalog.find((entry) => entry.id === card.weaponCatalogId)!
    const field = <T,>(value: T): ScanField<T> => ({ value, confidence: 1, raw: 'Embedded Tacet Lab card data' })
    const details: BuildCardDetails = {
      id: createLocalId(), formatId: 'tacet-lab', formatConfidence: 1,
      character: field(character.name), characterCatalogId: character.id,
      characterLevel: field(card.characterLevel), sequence: field(card.sequence), skillLevels: card.skillLevels.map(field),
      weapon: field(weapon.name), weaponCatalogId: weapon.id, weaponLevel: field(card.weaponLevel), weaponRank: field(card.weaponRank),
      sourceImageDataUrl: frame.panelImageDataUrl
    }
    onStage?.(1, 'Tacet Lab card ready for review')
    return card.echoes.map((echo, index) => ({
      id: createLocalId(), createdAt: Date.now(), imageDataUrl: frame.panelImageDataUrl,
      fingerprint: `${frame.id}:${index}`, source: frame.source, sessionId: frame.sessionId,
      frameSequence: frame.sequence + index / 10, reviewState: 'new' as const, buildCard: details,
      fields: {
        name: field(echo.name), cost: field(echo.cost), rarity: field(echo.rarity), level: field(echo.level),
        sonata: field(echo.sonata), mainStat: field(echo.mainStat), subStats: echo.subStats.map(field),
        equippedBy: field(character.name), locked: field(true), excluded: field(false)
      }
    }))
  }
  if (frame.buildCardFormat && frame.buildCardFormat !== 'landscape-card') return recognizeConfiguredBuildCard(frame, profile, pool, preprocess, onStage)
  const source = frame.panelImageDataUrl
  const configuredRect = (id: string, fallback: ScanRect) => profile.regions.find((entry) => entry.id === id)?.rect ?? fallback
  const evidenceRegion = (id: string, fallback: ScanRegion) => profile.regions.find((entry) => entry.id === id) ?? fallback
  const validation = (label: string, confidence: number, recognized: boolean) => {
    const messages: string[] = []
    if (!recognized) messages.push(`${label} was not recognized.`)
    if (confidence < .55) messages.push(`${label} has low confidence.`)
    return { valid: messages.length === 0, messages }
  }
  const ocrEvidence = (result: BuildCardOcrResult, confidence: number, parsedValue?: unknown): ScanEvidence => {
    const configured = evidenceRegion(result.region.id, result.region)
    return {
      region: configured, originalCrop: result.originalCrop, processedCrop: result.processedCrop, rawOcr: result.text,
      confidence, parsedValue, validation: validation(configured.label, confidence, Boolean(result.text.trim())),
      workerId: result.workerId, jobId: result.jobId, processingMs: result.processingMs, preprocessing: result.preprocessing
    }
  }
  const visualEvidence = (id: string, fallback: ScanRegion, crop: BuildCardCrop, confidence: number, parsedValue?: unknown, rawOcr = ''): ScanEvidence => {
    const configured = evidenceRegion(id, fallback)
    return {
      region: configured, originalCrop: crop.dataUrl, processedCrop: crop.dataUrl, rawOcr, confidence, parsedValue,
      validation: validation(configured.label, confidence, parsedValue !== undefined && parsedValue !== ''),
      workerId: 'visual-classifier', jobId: `build-card:${id}`, processingMs: 0, preprocessing: crop.strategy
    }
  }
  onStage?.(.05, 'Reading build-card character and weapon')
  const sequenceRect = configuredRect('sequence', { x: .077, y: .495, width: .248, height: .074 })
  const sequenceImage = await loadImage(source)
  const characterLevelRect = discordLevelBadgeRect(sequenceImage, configuredRect('character-level', { x: .03134882694626692, y: .012790172493497516, width: .304398065663291, height: .0653783661759327 }))
  const [characterOcr, characterLevelOcr, weaponOcr, weaponLevelOcr, sequenceCrop, ...skillOcr] = await Promise.all([
    recognizeText(pool, preprocess, source, 'character', configuredRect('character', { x: .03, y: .012, width: .19, height: .062 })),
    recognizeText(pool, preprocess, source, 'character-level', characterLevelRect, 'text', 'level'),
    recognizeText(pool, preprocess, source, 'weapon', configuredRect('weapon', { x: .825, y: .416, width: .15, height: .045 })),
    recognizeText(pool, preprocess, source, 'weapon-level', configuredRect('weapon-level', { x: .846, y: .468, width: .075, height: .043 }), 'number'),
    preprocess.crop(source, sequenceRect),
    ...skillRects.map((rect, index) => recognizeText(pool, preprocess, source, `skill-${index}`, configuredRect(`skill-${index}`, rect), 'number'))
  ])
  const characterMatch = closestCatalogEntry(characterOcr.text, characterCatalog, (entry) => entry.name)
  const weaponMatch = closestCatalogEntry(weaponOcr.text, weaponCatalog, (entry) => entry.name)
  const sequence = classifyDiscordSequence(discordSequenceBrightness(sequenceImage, sequenceRect))
  const buildCardId = createLocalId()
  const details: BuildCardDetails = {
    id: buildCardId,
    character: { value: characterMatch?.entry.name ?? normalizeOcrText(characterOcr.text)[0] ?? '', confidence: characterMatch ? Math.max(.72, characterMatch.score) : characterOcr.confidence, raw: characterOcr.text },
    characterCatalogId: characterMatch?.entry.id,
    characterLevel: discordCharacterLevelField(characterLevelOcr.text),
    sequence,
    skillLevels: skillOcr.map((result) => skillLevelField(result.text)),
    weapon: { value: weaponMatch?.entry.name ?? normalizeOcrText(weaponOcr.text)[0] ?? '', confidence: weaponMatch ? Math.max(.72, weaponMatch.score) : weaponOcr.confidence, raw: weaponOcr.text },
    weaponCatalogId: weaponMatch?.entry.id,
    weaponLevel: numberField(weaponLevelOcr.text, 1, 1, 90),
    weaponRank: { value: 1, confidence: 0, raw: 'Not detected from Discord build cards' },
    sourceImageDataUrl: source
  }
  const headerEvidence: Record<string, ScanEvidence> = {
    character: ocrEvidence(characterOcr, details.character.confidence, details.character.value),
    'character-level': ocrEvidence(characterLevelOcr, details.characterLevel.confidence, details.characterLevel.value),
    sequence: visualEvidence('sequence', { ...region('sequence', sequenceRect, 'visual'), label: 'Sequence stars' }, sequenceCrop, sequence.confidence, sequence.value, sequence.raw),
    weapon: ocrEvidence(weaponOcr, details.weapon.confidence, details.weapon.value),
    'weapon-level': ocrEvidence(weaponLevelOcr, details.weaponLevel.confidence, details.weaponLevel.value)
  }
  skillOcr.forEach((result, index) => { headerEvidence[`skill-${index}`] = ocrEvidence(result, details.skillLevels[index].confidence, details.skillLevels[index].value) })
  let completedEchoes = 0
  const candidates = await mapCardEchoes(CARD_STARTS.length, async (index): Promise<DiagnosticScanCandidate> => {
    const x = CARD_STARTS[index]
    const artRect = configuredRect(`echo-${index}-art`, { x, y: .605, width: .108, height: .162 })
    const costRect = configuredRect(`echo-${index}-cost`, { x: x + .158, y: .615, width: .033, height: .043 })
    const sonataRect = configuredRect(`echo-${index}-sonata`, { x: x + .135, y: .615, width: .031, height: .045 })
    const statsRect = configuredRect(`echo-${index}-stats`, { x: x + .018, y: .815, width: .174, height: .17 })
    const mainStatLabelRect = configuredRect(`echo-${index}-main-stat-label`, { x: x + .018, y: .775, width: .108, height: .04 })
    const mainStatValueRect = configuredRect(`echo-${index}-main-stat-value`, { x: x + .129, y: .775, width: .063, height: .04 })
    const [art, costOcr, mainStatLabelOcr, mainStatValueOcr, initialStatsOcr] = await Promise.all([
      preprocess.crop(source, artRect),
      recognizeText(pool, preprocess, source, `echo-${index}-cost`, costRect, 'number'),
      recognizeText(pool, preprocess, source, `echo-${index}-main-stat-label`, mainStatLabelRect, 'text', 'main-stat-label'),
      recognizeText(pool, preprocess, source, `echo-${index}-main-stat-value`, mainStatValueRect, 'number'),
      recognizeText(pool, preprocess, source, `echo-${index}-stats`, statsRect, 'text', 'substats-block')
    ])
    const parsedCost = Number(costOcr.text.match(/[134]/)?.[0] ?? (index === 0 ? 4 : index < 3 ? 3 : 1)) as Echo['cost']
    const [cardSonata, sonataCrop] = await Promise.all([
      recognizeSonataAt(sequenceImage, sonataRect, undefined, true), preprocess.crop(source, sonataRect)
    ])
    const echoIdentity = await matchEcho(art.dataUrl, parsedCost, true, cardSonata && cardSonata.confidence >= .85 ? cardSonata.value : undefined)
    const echoEntry = echoCatalog.find((entry) => entry.name === echoIdentity.value)
    const sonata = cardSonata && cardSonata.confidence >= .85
      ? cardSonata : await recognizeSonataAt(sequenceImage, sonataRect, echoEntry?.sonatas, true)
    const mainStatRaw = `${mainStatLabelOcr.text.trim()} ${mainStatValueOcr.text.trim()}`.trim()
    const mainOcr = { label: mainStatLabelOcr.text, value: mainStatValueOcr.text }
    const parsedMain = parseExplicitBuildCardMain(mainOcr)
    const explicitMain = parsedMain && isMainStatAllowed(parsedCost, parsedMain.key) ? mainOcr : undefined
    const rowRects = Array.from({ length: 5 }, (_, rowIndex) => ({ ...statsRect, y: statsRect.y + statsRect.height * rowIndex * .19, height: statsRect.height / 5 }))
    const initialRepair = await recoverAmbiguousStatValues(normalizeOcrText(initialStatsOcr.text), rowRects, index, source, pool, preprocess)
    let valueRetries = initialRepair.retries
    let statsOcr = initialStatsOcr
    let rowOcr: BuildCardOcrResult[] = []
    const initialText = initialRepair.lines.join('\n')
    let stats = parseBuildCardStats(explicitMain ? initialText : `${mainStatRaw}\n${initialText}`, parsedCost, explicitMain)
    if (stats.subStats.length < 5 || stats.subStats.some((field) => field.confidence < .8)) {
      rowOcr = await Promise.all(Array.from({ length: 5 }, (_, rowIndex) => recognizeText(
        pool,
        preprocess,
        source,
        `echo-${index}-stats-row-${rowIndex}`,
        rowRects[rowIndex],
        'text',
        'substat-row'
      )))
      const rowRepair = await recoverAmbiguousStatValues(rowOcr.map((result) => result.text.trim()), rowRects, index, source, pool, preprocess)
      valueRetries = [...valueRetries, ...rowRepair.retries]
      const rowText = rowRepair.lines.join('\n')
      const rowStats = parseBuildCardStats(explicitMain ? rowText : `${mainStatRaw}\n${rowText}`, parsedCost, explicitMain)
      const quality = (candidate: typeof stats) => candidate.subStats.length * 10 + candidate.subStats.reduce((score, field) => score + field.confidence, 0)
      if (quality(rowStats) > quality(stats)) {
        stats = rowStats
        statsOcr = {
          ...initialStatsOcr,
          text: rowText,
          confidence: Math.min(...rowOcr.map((result) => result.confidence)),
          processingMs: rowOcr.reduce((total, result) => total + result.processingMs, 0),
          preprocessing: rowOcr[0]?.preprocessing ?? initialStatsOcr.preprocessing
        }
      }
    }
    const sonataField = sonata ?? { value: echoEntry?.sonatas.length === 1 ? echoEntry.sonatas[0] : 'Unknown Sonata', confidence: echoEntry?.sonatas.length === 1 ? .75 : .25 }
    const candidate: ScanCandidate = {
      id: createLocalId(), createdAt: Date.now(), imageDataUrl: art.dataUrl, fingerprint: await imageFingerprint(art.dataUrl), source: frame.source,
      fields: {
        name: echoIdentity, cost: { value: parsedCost, confidence: costOcr.confidence, raw: costOcr.text }, rarity: { value: 5, confidence: .8, raw: 'Official build card' },
        level: { value: 25, confidence: stats.subStats.length === 5 ? .9 : .55, raw: 'Inferred from five tuned substats' },
        sonata: sonataField,
        mainStat: { value: stats.mainStat, confidence: stats.mainConfidence, raw: mainStatRaw }, subStats: stats.subStats,
        equippedBy: { value: details.character.value, confidence: details.character.confidence }, locked: { value: false, confidence: .25 }, excluded: { value: false, confidence: .25 }
      }, buildCard: details
    }
    const statsConfidence = stats.subStats.length ? Math.min(...stats.subStats.map((field) => field.confidence)) : statsOcr.confidence
    const evidence: Record<string, ScanEvidence> = {
      ...headerEvidence,
      [`echo-${index}-art`]: visualEvidence(`echo-${index}-art`, { ...region(`echo-${index}-art`, artRect, 'visual'), label: `Echo ${index + 1} art` }, art, echoIdentity.confidence, echoIdentity.value),
      [`echo-${index}-cost`]: ocrEvidence(costOcr, candidate.fields.cost.confidence, parsedCost),
      [`echo-${index}-sonata`]: visualEvidence(`echo-${index}-sonata`, { ...region(`echo-${index}-sonata`, sonataRect, 'visual'), label: `Echo ${index + 1} Sonata` }, sonataCrop, sonataField.confidence, sonataField.value),
      [`echo-${index}-main-stat-label`]: ocrEvidence(mainStatLabelOcr, stats.mainConfidence, stats.mainStat.key),
      [`echo-${index}-main-stat-value`]: ocrEvidence(mainStatValueOcr, stats.mainConfidence, stats.mainStat.value),
      [`echo-${index}-stats`]: ocrEvidence(statsOcr, statsConfidence, stats.subStats.map((field) => field.value))
    }
    rowOcr.forEach((result) => { evidence[result.region.id] = ocrEvidence(result, result.confidence, parseStatLine(result.text)) })
    valueRetries.forEach((result) => { evidence[result.region.id] = ocrEvidence(result, result.confidence, result.text.trim()) })
    completedEchoes += 1
    onStage?.(.25 + completedEchoes * .14, `Read ${completedEchoes} of ${CARD_STARTS.length} build-card Echoes`)
    return { ...candidate, sessionId: frame.sessionId, frameSequence: frame.sequence + index / 10, reviewState: 'new', evidence }
  }, cardEchoConcurrency(pool.metrics().workerCount))
  onStage?.(1, 'Build card ready for review')
  return candidates
}
