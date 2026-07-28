import type { BuildCardDetails, Echo, ScanCandidate, ScanField, StatLine } from '../domain/types'
import { createLocalId } from '../domain/id'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { echoCatalog } from '../game-data/echoes'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import { isMainStatAllowed, mainStatKeysByCost, primaryMainStatValue } from '../game-data/echo-main-stats'
import { exactTunableRoll } from '../game-data/tunable-rolls'
import { imageFingerprint, normalizeOcrText, parseStatLine, resolveTunableRoll } from './parser'
import type { OcrPool } from './ocr-pool'
import type { PreprocessClient } from './preprocess'
import { recognizeSonataAt } from './visual'
import type { CalibrationProfile, DiagnosticScanCandidate, ScanEvidence, ScanFrame, ScanRect, ScanRegion } from './types'

const CARD_STARTS = [.011, .207, .402, .596, .79]
const skillRects: ScanRect[] = [
  { x: .427, y: .304, width: .063, height: .047 }, // Normal Attack
  { x: .476, y: .535, width: .063, height: .047 }, // Resonance Skill
  { x: .548, y: .166, width: .063, height: .047 }, // Forte Circuit
  { x: .647, y: .304, width: .063, height: .047 }, // Resonance Liberation
  { x: .604, y: .535, width: .063, height: .047 } // Intro Skill
]

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
  const image = new Image(); image.crossOrigin = 'anonymous'; image.src = source; await image.decode(); return image
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

const echoSignatureCache = new Map<string, Promise<number[] | undefined>>()
function loadEchoSignature(url: string) {
  let pending = echoSignatureCache.get(url)
  if (!pending) {
    pending = loadImage(url).then((image) => signature(cropPixels(image, { x: 0, y: 0, width: 1, height: 1 }))).catch(() => undefined)
    echoSignatureCache.set(url, pending)
  }
  return pending
}

export function rankImageSignatures(captured: number[], templates: Array<{ name: string; signature: number[] }>) {
  return templates.map((template) => ({ name: template.name, score: 1 - template.signature.reduce((sum, value, index) => sum + Math.abs(value - captured[index]), 0) / (captured.length * 4) })).sort((left, right) => right.score - left.score)
}

async function matchEcho(imageDataUrl: string, cost: Echo['cost']) {
  const image = await loadImage(imageDataUrl)
  const captured = signature(cropPixels(image, { x: .04, y: .04, width: .92, height: .92 }))
  const entries = echoCatalog.filter((entry) => entry.cost === cost && entry.iconSourceUrl)
  const templates: Array<{ name: string; signature: number[] }> = []
  for (let index = 0; index < entries.length; index += 8) {
    const chunk = entries.slice(index, index + 8)
    const loaded = await Promise.all(chunk.map(async (entry) => ({ entry, value: await loadEchoSignature(entry.iconSourceUrl!) })))
    for (const item of loaded) if (item.value) templates.push({ name: item.entry.name, signature: item.value })
  }
  const ranked = rankImageSignatures(captured, templates), best = ranked[0], runnerUp = ranked[1]
  if (!best || best.score < .42) return { value: 'Unknown Echo', confidence: .2 }
  return { value: best.name, confidence: Math.min(.94, .48 + best.score * .42 + Math.max(0, best.score - (runnerUp?.score ?? 0)) * 2) }
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
  kind?: ScanRegion['kind']
) {
  const configured = region(id, rect, recognition, kind)
  const original = await preprocess.process(image, { ...configured, recognition: 'visual' })
  const processed = recognition === 'visual' ? original : await preprocess.process(image, configured)
  const result = await pool.recognize(processed.blob, configured, `build-card:${id}`)
  return { ...result, region: configured, originalCrop: original.dataUrl, processedCrop: processed.dataUrl, preprocessing: processed.strategy }
}

type BuildCardOcrResult = Awaited<ReturnType<typeof recognizeText>>
type BuildCardCrop = Awaited<ReturnType<PreprocessClient['crop']>>

function numberField(raw: string, fallback: number, min: number, max: number): ScanField<number> {
  const match = raw.match(/\d{1,2}/), value = Math.max(min, Math.min(max, Number(match?.[0] ?? fallback)))
  return { value, confidence: match ? .88 : .25, raw }
}

function skillLevelField(raw: string): ScanField<number> {
  const normalized = raw.replace(/\s+/g, '')
  const afterLevelMarker = normalized.match(/[.,](10|[1-9])/)
  if (afterLevelMarker) return { value: Number(afterLevelMarker[1]), confidence: .92, raw }
  const fraction = normalized.match(/(?:LV)?(10|[1-9])[\/|]10/i)
  if (fraction) return { value: Number(fraction[1]), confidence: .88, raw }
  return numberField(raw, 1, 1, 10)
}

export function parseBuildCardStats(text: string, cost: Echo['cost']) {
  const stats = normalizeOcrText(text).map(parseStatLine).filter((value): value is StatLine => Boolean(value))
  const mainIndex = stats.findIndex((stat) => isMainStatAllowed(cost, stat.key))
  const recognizedMainStat = stats[mainIndex]
  const expectedMainStatValue = recognizedMainStat
    ? primaryMainStatValue(cost, 5, 25, recognizedMainStat.key)
    : undefined
  const mainStat = recognizedMainStat
    ? { ...recognizedMainStat, value: expectedMainStatValue ?? recognizedMainStat.value }
    : { key: mainStatKeysByCost[cost][0], value: 0 }
  const mainStatWasCorrected = recognizedMainStat !== undefined
    && expectedMainStatValue !== undefined
    && Math.abs(recognizedMainStat.value - expectedMainStatValue) > .051
  const remaining = stats.filter((_, index) => index !== mainIndex)
  const subStats = remaining.slice(0, 5).map((stat) => {
    const corrected = stat.value >= 71 && stat.value < 72 ? { ...stat, value: stat.value - 64 } : stat
    const roll = resolveTunableRoll(corrected.key, corrected.value)
    return { value: roll ? { ...corrected, value: roll.value } : corrected, confidence: roll ? (exactTunableRoll(corrected.key, corrected.value) ? .9 : .8) : .5, raw: String(stat.value) }
  })
  return { mainStat, mainConfidence: mainIndex < 0 ? .25 : mainStatWasCorrected ? .8 : .88, subStats }
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
  const [characterOcr, weaponOcr, weaponLevelOcr, ...skillOcr] = await Promise.all([
    recognizeText(pool, preprocess, source, 'character', configuredRect('character', { x: .03, y: .012, width: .19, height: .062 })),
    recognizeText(pool, preprocess, source, 'weapon', configuredRect('weapon', { x: .825, y: .416, width: .15, height: .045 })),
    recognizeText(pool, preprocess, source, 'weapon-level', configuredRect('weapon-level', { x: .846, y: .468, width: .075, height: .043 }), 'number'),
    ...skillRects.map((rect, index) => recognizeText(pool, preprocess, source, `skill-${index}`, configuredRect(`skill-${index}`, rect), 'number'))
  ])
  const characterMatch = closestCatalogEntry(characterOcr.text, characterCatalog, (entry) => entry.name)
  const weaponMatch = closestCatalogEntry(weaponOcr.text, weaponCatalog, (entry) => entry.name)
  const buildCardId = createLocalId()
  const details: BuildCardDetails = {
    id: buildCardId,
    character: { value: characterMatch?.entry.name ?? normalizeOcrText(characterOcr.text)[0] ?? '', confidence: characterMatch ? Math.max(.72, characterMatch.score) : characterOcr.confidence, raw: characterOcr.text },
    characterCatalogId: characterMatch?.entry.id,
    characterLevel: { value: 90, confidence: 0, raw: 'Not scanned from build cards' },
    sequence: { value: 0, confidence: 0, raw: 'Not detected from build cards' },
    skillLevels: skillOcr.map((result) => skillLevelField(result.text)),
    weapon: { value: weaponMatch?.entry.name ?? normalizeOcrText(weaponOcr.text)[0] ?? '', confidence: weaponMatch ? Math.max(.72, weaponMatch.score) : weaponOcr.confidence, raw: weaponOcr.text },
    weaponCatalogId: weaponMatch?.entry.id,
    weaponLevel: numberField(weaponLevelOcr.text, 1, 1, 90),
    sourceImageDataUrl: source
  }
  const headerEvidence: Record<string, ScanEvidence> = {
    character: ocrEvidence(characterOcr, details.character.confidence, details.character.value),
    weapon: ocrEvidence(weaponOcr, details.weapon.confidence, details.weapon.value),
    'weapon-level': ocrEvidence(weaponLevelOcr, details.weaponLevel.confidence, details.weaponLevel.value)
  }
  skillOcr.forEach((result, index) => { headerEvidence[`skill-${index}`] = ocrEvidence(result, details.skillLevels[index].confidence, details.skillLevels[index].value) })
  const candidates: DiagnosticScanCandidate[] = []
  for (let index = 0; index < CARD_STARTS.length; index += 1) {
    onStage?.(.25 + index * .14, `Reading build-card Echo ${index + 1} of 5`)
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
    const echoIdentity = await matchEcho(art.dataUrl, parsedCost)
    const echoEntry = echoCatalog.find((entry) => entry.name === echoIdentity.value)
    const [sonata, sonataCrop] = await Promise.all([recognizeSonataAt(source, sonataRect, echoEntry?.sonatas), preprocess.crop(source, sonataRect)])
    const mainStatRaw = `${mainStatLabelOcr.text.trim()} ${mainStatValueOcr.text.trim()}`.trim()
    let statsOcr = initialStatsOcr
    let stats = parseBuildCardStats(`${mainStatRaw}\n${statsOcr.text}`, parsedCost)
    if (stats.subStats.length < 5) {
      const rowOcr = await Promise.all(Array.from({ length: 5 }, (_, rowIndex) => recognizeText(
        pool,
        preprocess,
        source,
        `echo-${index}-stats-row-${rowIndex}`,
        { ...statsRect, y: statsRect.y + statsRect.height * rowIndex / 5, height: statsRect.height / 5 },
        'text',
        'substat-row'
      )))
      const rowText = rowOcr.map((result) => result.text.trim()).filter(Boolean).join('\n')
      const rowStats = parseBuildCardStats(`${mainStatRaw}\n${rowText}`, parsedCost)
      if (rowStats.subStats.length > stats.subStats.length) {
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
    candidates.push({ ...candidate, sessionId: frame.sessionId, frameSequence: frame.sequence + index / 10, reviewState: 'new', evidence })
  }
  onStage?.(1, 'Build card ready for review')
  return candidates
}
