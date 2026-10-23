import type { AccountDocument, OwnedCharacter, RotationAction, StatKey, StatLine, Team, TheorycraftBuild } from '../domain/types'
import { createLocalId } from '../domain/id'
import { characterCatalog, echoCatalog, GAME_DATA_VERSION, isFixedSkillValueName, sonataCatalog, weaponCatalog } from '../game-data'
import { mechanicsRegistry } from '../game-data/combat/registry'

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9%]/g, '')
const echoKey = (value: string) => key(value).replace('pavillion', 'pavilion')
const statKeys: Record<string, StatKey> = {
  hp: 'hp', 'hp%': 'hpPercent', atk: 'atk', 'atk%': 'atkPercent', def: 'def', 'def%': 'defPercent',
  critrate: 'critRate', critdmg: 'critDamage', energyregen: 'energyRegen',
  basicdmg: 'basicDamage', heavydmg: 'heavyDamage', skilldmg: 'skillDamage', liberationdmg: 'liberationDamage',
  resonanceskilldmg: 'skillDamage', resonanceliberationdmg: 'liberationDamage',
  spectrodmg: 'spectroDamage', fusiondmg: 'fusionDamage', glaciodmg: 'glacioDamage',
  electrodmg: 'electroDamage', aerodmg: 'aeroDamage', havocdmg: 'havocDamage', healingbonus: 'healingBonus'
}

interface RotationEcho {
  cost: 1 | 3 | 4
  name: string | null
  sonata: string
  main: { label: string; value: string }
  subs: Array<{ label: string; value: string } | null>
}
interface RotationCharacter {
  slot: number
  catalogId: string
  name: string
  sequence: number
  weapon: { name: string; rank: number }
  echoes: RotationEcho[]
}
interface RotationExportAction {
  slot: number
  attackName: string
  attackId: string | null
  timestamp: number
}
interface RotationExport {
  schemaVersion: number
  source: { site: string; rotationId: number; segment: 'loop' | 'full' }
  name: string
  duration: number
  characters: RotationCharacter[]
  actions: RotationExportAction[]
}

export function isRotationExport(value: unknown): value is RecordValue {
  return record(value) && record(value.source) && value.source.site === 'wuwalab'
}

function statLine(value: { label: string; value: string }): StatLine {
  const stat = statKeys[key(value.label)]
  const raw = value.value.trim()
  const amount = Number(raw.replace(/%$/, ''))
  if (!stat || !/^\d+(?:\.\d+)?%?$/.test(raw) || !Number.isFinite(amount)) throw new Error(`Unsupported imported Echo stat: ${value.label}.`)
  return { key: stat, value: amount }
}

function sameImport(left: RecordValue, right: RecordValue, ignored: string[] = ['id']) {
  const comparable = (value: RecordValue) => JSON.stringify(Object.fromEntries(Object.entries(value).filter(([name]) => !ignored.includes(name))))
  return comparable(left) === comparable(right)
}

function availableId<T extends { id: string }>(base: string, current: T[], make: (id: string, existing?: T) => T, ignored?: string[]) {
  for (let number = 1; ; number++) {
    const id = number === 1 ? base : `${base}:${number}`
    const existing = current.find((entry) => entry.id === id)
    const candidate = make(id, existing)
    if (!existing || sameImport(existing as unknown as RecordValue, candidate as unknown as RecordValue, ignored)) return candidate
  }
}

export function convertRotationExport(value: RecordValue, current: AccountDocument) {
  const source = value as unknown as RotationExport
  if (source.schemaVersion !== 1 || !record(source.source) || source.source.site !== 'wuwalab' || !Number.isSafeInteger(source.source.rotationId) ||
      !['loop', 'full'].includes(source.source.segment) || typeof source.name !== 'string' || !source.name.trim() ||
      !Number.isFinite(source.duration) || source.duration <= 0 || source.duration > 600 ||
      !Array.isArray(source.characters) || source.characters.length < 1 || source.characters.length > 3 ||
      !Array.isArray(source.actions) || !source.actions.length || source.actions.length > 2000) throw new Error('This rotation JSON is invalid or unsupported.')
  if (source.characters.some((member) => !record(member))) throw new Error('The imported character list is invalid.')
  const characters = [...source.characters].sort((left, right) => left.slot - right.slot)
  if (characters.some((member, slot) => !record(member) || member.slot !== slot || typeof member.name !== 'string' || !member.name.trim() ||
      !characterCatalog.some((entry) => entry.id === member.catalogId) ||
      !Number.isInteger(member.sequence) || member.sequence < 0 || member.sequence > 6 || !record(member.weapon) ||
      typeof member.weapon.name !== 'string' || !Number.isInteger(member.weapon.rank) || member.weapon.rank < 1 || member.weapon.rank > 5 ||
      !Array.isArray(member.echoes) || member.echoes.length !== 5)) throw new Error('The characters or Echo slots cannot be imported.')
  if (source.actions.some((action) => !record(action) || !Number.isInteger(action.slot) || action.slot < 0 || action.slot >= characters.length ||
      typeof action.attackName !== 'string' || !action.attackName ||
      (action.attackId !== null && typeof action.attackId !== 'string') ||
      !Number.isFinite(action.timestamp) || action.timestamp < 0 || action.timestamp >= source.duration)) {
    throw new Error('The rotation contains an invalid action.')
  }

  const now = Date.now()
  const newCharacters: OwnedCharacter[] = []
  const builds: TheorycraftBuild[] = []
  const notices = ['Echoes are imported as theorycraft gear; owned Echoes, weapons, and existing character progression stay unchanged. Echo rarity 5 and level 25 are assumed.']
  const members: NonNullable<Team['members']> = []
  for (const member of characters) {
    const catalog = characterCatalog.find((entry) => entry.id === member.catalogId)!
    const owned = current.characters.find((entry) => entry.catalogId === member.catalogId) ??
      newCharacters.find((entry) => entry.catalogId === member.catalogId)
    const character = owned ?? {
      id: createLocalId(), catalogId: member.catalogId, level: 90, sequence: member.sequence,
      skillLevels: [10, 10, 10, 10, 10], locked: false, createdAt: now
    }
    if (!owned) newCharacters.push(character)
    const weapon = weaponCatalog.find((entry) => key(entry.name) === key(member.weapon.name) && entry.type.toLowerCase() === catalog.weaponType.toLowerCase())
    if (!weapon) notices.push(`${member.name}: weapon ${member.weapon.name} is not in Tacet Lab's catalog; select a weapon in the imported theorycraft build.`)
    const sonatas = new Map<string, number>()
    // shortcut: The export omits Echo rarity and level; use its displayed level-25, rarity-5 build until those fields are exported.
    const slots = member.echoes.map((echo, index) => {
      if (!record(echo) || ![1, 3, 4].includes(echo.cost) || (echo.name !== null && typeof echo.name !== 'string') || typeof echo.sonata !== 'string' ||
          !record(echo.main) || typeof echo.main.label !== 'string' || typeof echo.main.value !== 'string' ||
          !Array.isArray(echo.subs) || echo.subs.length > 5) throw new Error(`${member.name} Echo ${index + 1} has invalid data.`)
      const name = sonataCatalog.find((entry) => key(entry.name) === key(echo.sonata))?.name ?? echo.sonata
      sonatas.set(name, (sonatas.get(name) ?? 0) + 1)
      return { cost: echo.cost, rarity: 5 as const, level: 25, mainStatKey: statLine(echo.main).key }
    })
    const substats = member.echoes.map((echo, index) => echo.subs.flatMap((line) => {
      if (line === null) return []
      if (!record(line) || typeof line.label !== 'string' || typeof line.value !== 'string') throw new Error(`${member.name} Echo ${index + 1} has an invalid substat.`)
      return [statLine(line)]
    }))
    const mainEcho = member.echoes[0].name
    if (mainEcho && !echoCatalog.some((entry) => echoKey(entry.name) === echoKey(mainEcho))) notices.push(`${member.name}: main Echo ${mainEcho} is not in Tacet Lab's catalog.`)
    const base = `wuwalab:${source.source.rotationId}:${source.source.segment}:build:${member.slot}`
    const build = availableId(base, current.theorycraftBuilds ?? [], (id, existing) => ({
      id, name: `${source.name} · ${member.name}`, description: existing?.description ?? `Imported weapon: ${member.weapon.name}`,
      characterId: character.id, weapon: { catalogId: weapon?.id ?? '', level: 90, rank: member.weapon.rank },
      mainEchoName: echoCatalog.find((entry) => echoKey(entry.name) === echoKey(mainEcho ?? ''))?.name ?? mainEcho ?? '',
      slots, sonatas: [...sonatas].map(([name, pieces]) => ({ name, pieces })),
      substats: { mode: 'slots' as const, slots: substats }, createdAt: existing?.createdAt ?? now, updatedAt: existing?.updatedAt ?? now
    }), ['id', 'createdAt', 'updatedAt'])
    builds.push(build)
    const memberId = `wuwalab:${source.source.rotationId}:${source.source.segment}:member:${member.slot}`
    members.push({ memberId, characterId: character.id, loadoutSource: { type: 'theorycraft', theorycraftBuildId: build.id } })
  }

  const unmatched = new Set<string>()
  const makeTeam = (id: string): Team => {
    const teamMembers = members.map((member, slot) => ({ ...member, memberId: `${id}:member:${slot}` }))
    const actions: RotationAction[] = source.actions.map((action, index) => {
      const member = characters[action.slot]
      const catalog = characterCatalog.find((entry) => entry.id === member.catalogId)!
      const echoId = echoCatalog.find((entry) => entry.name === builds[action.slot].mainEchoName)?.id
      const known = action.attackId && (catalog.attacks.some((entry) => entry.id === action.attackId && !isFixedSkillValueName(entry.name)) ||
        (mechanicsRegistry.characters[member.catalogId]?.actions[action.attackId]?.kind !== 'utility' && Boolean(mechanicsRegistry.characters[member.catalogId]?.actions[action.attackId])) ||
        (echoId && mechanicsRegistry.echoes?.[echoId]?.actions[action.attackId]?.kind !== 'utility' && Boolean(mechanicsRegistry.echoes?.[echoId]?.actions[action.attackId])))
      if (!known) unmatched.add(`${member.name}: ${action.attackName}`)
      return {
        id: `${id}:action:${index}`, buildId: teamMembers[action.slot].memberId,
        attackId: known ? action.attackId! : `wuwalab:${encodeURIComponent(action.attackName)}`,
        label: action.attackName, timestamp: action.timestamp,
        duration: Math.min(0.8, source.duration - action.timestamp)
      }
    })
    return {
      id, name: source.name, members: teamMembers, buildIds: teamMembers.map((member) => member.memberId),
      enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: source.duration, actions, buffs: []
    }
  }
  const team = availableId(`wuwalab:${source.source.rotationId}:${source.source.segment}:team`, current.teams, makeTeam)
  if (unmatched.size) notices.push(`${unmatched.size} imported attack name(s) have no matching Tacet Lab attack; their timeline clips are retained but have no calculated damage: ${[...unmatched].join(', ')}.`)
  const document: AccountDocument = {
    schemaVersion: 7, gameDataVersion: GAME_DATA_VERSION, exportedAt: new Date(now).toISOString(),
    echoes: [], characters: newCharacters, weapons: [], builds: [], equippedLoadouts: [], theorycraftBuilds: builds,
    teams: [team], settings: current.settings
  }
  return { document, notices, choices: [] }
}
