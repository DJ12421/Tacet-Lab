import type { Echo, StatLine, StatKey } from '../domain/types'
import { characterCatalog, weaponCatalog } from '../game-data'

export interface CardMetadata {
  format: 'tacet-lab-card'
  version: 1
  characterCatalogId: string
  characterLevel: number
  sequence: number
  skillLevels: number[]
  weaponCatalogId: string
  weaponLevel: number
  weaponRank: number
  echoes: Array<Pick<Echo, 'name' | 'cost' | 'rarity' | 'level' | 'sonata' | 'mainStat' | 'subStats'>>
}

const keyword = 'TacetLabCard\0\0\0\0\0'
const signature = [137, 80, 78, 71, 13, 10, 26, 10]
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const keywordBytes = encoder.encode(keyword)

function crc32(bytes: Uint8Array) {
  let crc = -1
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ -1) >>> 0
}

function pngBytes(dataUrl: string) {
  if (!dataUrl.startsWith('data:image/png;base64,')) return undefined
  const bytes = Uint8Array.from(atob(dataUrl.slice('data:image/png;base64,'.length)), (char) => char.charCodeAt(0))
  return signature.every((byte, index) => bytes[index] === byte) ? bytes : undefined
}

function chunks(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const result: Array<{ start: number; end: number; type: string; data: Uint8Array }> = []
  for (let start = 8; start + 12 <= bytes.length;) {
    const length = view.getUint32(start)
    const end = start + 12 + length
    if (end > bytes.length) throw new Error('The card PNG is damaged.')
    const type = String.fromCharCode(...bytes.subarray(start + 4, start + 8))
    result.push({ start, end, type, data: bytes.subarray(start + 8, end - 4) })
    if (type === 'IEND') break
    start = end
  }
  return result
}

const stat = (value: unknown): value is StatLine => Boolean(value && typeof value === 'object' &&
  Object.keys(value).length === 2 && typeof (value as StatLine).key === 'string' &&
  typeof (value as StatLine).value === 'number' && Number.isFinite((value as StatLine).value) &&
  (value as StatLine).value >= 0 && statKeys.has((value as StatLine).key))

const statKeys = new Set<StatKey>(['hp', 'hpPercent', 'atk', 'atkPercent', 'def', 'defPercent', 'critRate', 'critDamage', 'energyRegen', 'basicDamage', 'heavyDamage', 'skillDamage', 'liberationDamage', 'spectroDamage', 'fusionDamage', 'glacioDamage', 'electroDamage', 'aeroDamage', 'havocDamage', 'healingBonus'])

function validCard(value: unknown): value is CardMetadata {
  if (!value || typeof value !== 'object') return false
  const card = value as CardMetadata
  return card.format === 'tacet-lab-card' && card.version === 1
    && characterCatalog.some((entry) => entry.id === card.characterCatalogId)
    && weaponCatalog.some((entry) => entry.id === card.weaponCatalogId)
    && Number.isInteger(card.characterLevel) && card.characterLevel >= 1 && card.characterLevel <= 90
    && Number.isInteger(card.sequence) && card.sequence >= 0 && card.sequence <= 6
    && Array.isArray(card.skillLevels) && card.skillLevels.length === 5 && card.skillLevels.every((level) => Number.isInteger(level) && level >= 1 && level <= 10)
    && Number.isInteger(card.weaponLevel) && card.weaponLevel >= 1 && card.weaponLevel <= 90
    && Number.isInteger(card.weaponRank) && card.weaponRank >= 1 && card.weaponRank <= 5
    && Array.isArray(card.echoes) && card.echoes.length <= 5 && card.echoes.every((echo) => echo && typeof echo.name === 'string' && echo.name.length <= 120
      && [1, 3, 4].includes(echo.cost) && [1, 2, 3, 4, 5].includes(echo.rarity)
      && Number.isInteger(echo.level) && echo.level >= 0 && echo.level <= 25
      && typeof echo.sonata === 'string' && echo.sonata.length <= 120
      && stat(echo.mainStat) && Array.isArray(echo.subStats) && echo.subStats.length <= 5 && echo.subStats.every(stat))
}

// shortcut: PNG editors may strip metadata; use visual recognition if edited cards must round-trip.
export function readCardMetadata(dataUrl: string): CardMetadata | undefined {
  const bytes = pngBytes(dataUrl)
  if (!bytes) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (const chunk of chunks(bytes)) {
    if (chunk.type !== 'iTXt' || !keywordBytes.every((byte, index) => chunk.data[index] === byte)) continue
    if (chunk.data.length > 16_384 || view.getUint32(chunk.end - 4) !== crc32(bytes.subarray(chunk.start + 4, chunk.end - 4))) throw new Error('The Tacet Lab card metadata is damaged.')
    try {
      const card: unknown = JSON.parse(decoder.decode(chunk.data.subarray(keyword.length)))
      if (validCard(card)) return card
    } catch { /* Invalid metadata is reported below. */ }
    throw new Error('The Tacet Lab card metadata is invalid or unsupported.')
  }
  return undefined
}

export async function embedCardMetadata(dataUrl: string, card: CardMetadata): Promise<string> {
  const bytes = pngBytes(dataUrl)
  if (!bytes || !validCard(card)) throw new Error('The character card could not be exported with reimport data.')
  const end = chunks(bytes).find((chunk) => chunk.type === 'IEND')?.start
  if (end === undefined) throw new Error('The character card PNG is incomplete.')
  const payload = encoder.encode(keyword + JSON.stringify(card))
  const chunk = new Uint8Array(payload.length + 12)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, payload.length)
  chunk.set(encoder.encode('iTXt'), 4)
  chunk.set(payload, 8)
  view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The character card PNG could not be encoded.'))
    reader.readAsDataURL(new Blob([bytes.subarray(0, end), chunk, bytes.subarray(end)], { type: 'image/png' }))
  })
}
