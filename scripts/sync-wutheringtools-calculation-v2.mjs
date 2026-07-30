import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import lock from './wutheringtools-calculation-lock.json' with { type: 'json' }

const sourceRoot = path.resolve(process.argv[2] ?? process.env.WUTHERINGTOOLS_SOURCE ?? '')
if (!process.argv[2] && !process.env.WUTHERINGTOOLS_SOURCE) {
  throw new Error('Pass a WutheringTools checkout path or set WUTHERINGTOOLS_SOURCE.')
}

const revision = execFileSync('git', [
  '-c', `safe.directory=${sourceRoot.replaceAll('\\', '/')}`,
  '-C', sourceRoot,
  'rev-parse', 'HEAD'
], { encoding: 'utf8' }).trim()
if (revision !== lock.revision) throw new Error(`Expected WutheringTools ${lock.revision}, received ${revision}.`)

const normalized = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
const cleanDescription = (value = '') => String(value)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(?:div|p|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\n[ \t]+/g, '\n')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

function parseStaticSource(source, fileName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = new Map()
  const functions = new Map()
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) declarations.set(declaration.name.text, declaration.initializer)
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, statement)
  }

  const resolving = new Set()
  const evaluate = (input) => {
    if (!input) return undefined
    let node = input
    while (
      ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node)
      || ts.isParenthesizedExpression(node)
      || ts.isSatisfiesExpression(node)
      || ts.isNonNullExpression(node)
    ) node = node.expression
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return node.text
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isPrefixUnaryExpression(node)) {
      const value = Number(evaluate(node.operand))
      return node.operator === ts.SyntaxKind.MinusToken ? -value : node.operator === ts.SyntaxKind.PlusToken ? value : undefined
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text
      for (const span of node.templateSpans) value += String(evaluate(span.expression) ?? '') + span.literal.text
      return value
    }
    if (ts.isIdentifier(node)) {
      if (node.text === 'undefined') return undefined
      const declaration = declarations.get(node.text)
      if (!declaration || resolving.has(node.text)) return undefined
      resolving.add(node.text)
      const value = evaluate(declaration)
      resolving.delete(node.text)
      return value
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(evaluate).filter((value) => value !== undefined)
    if (ts.isObjectLiteralExpression(node)) {
      const result = {}
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = evaluate(property.expression)
          if (spread && typeof spread === 'object' && !Array.isArray(spread)) Object.assign(result, spread)
          continue
        }
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
        const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))
          ? property.name.text
          : undefined
        if (name === undefined) continue
        const value = ts.isShorthandPropertyAssignment(property) ? evaluate(property.name) : evaluate(property.initializer)
        if (value !== undefined) result[name] = value
      }
      return result
    }
    if (ts.isBinaryExpression(node)) {
      const left = evaluate(node.left)
      const right = evaluate(node.right)
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return typeof left === 'string' || typeof right === 'string'
        ? `${left ?? ''}${right ?? ''}`
        : Number(left) + Number(right)
      if (node.operatorToken.kind === ts.SyntaxKind.MinusToken) return Number(left) - Number(right)
      if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return Number(left) * Number(right)
      if (node.operatorToken.kind === ts.SyntaxKind.SlashToken) return Number(left) / Number(right)
    }
    return undefined
  }

  const returned = (name) => {
    const fn = functions.get(name)
    const statement = fn?.body?.statements.find(ts.isReturnStatement)
    return evaluate(statement?.expression)
  }
  return { value: (name) => evaluate(declarations.get(name)), returned }
}

async function parseFile(file) {
  const source = await readFile(file, 'utf8')
  return parseStaticSource(source, file)
}

function scopeFromDescription(description, fallback = 'self') {
  const text = description.toLowerCase()
  if (/\bnext (?:character|resonator)|incoming resonator|switched-in resonator/.test(text)) return 'next'
  if (/\b(?:all|nearby) (?:resonators|team members|party members)|entire team|on the team/.test(text)) return 'team'
  if (/reduces? (?:the )?(?:target|enemy)|enemy res|target'?s (?:def|res)/.test(text)) return 'enemy'
  return fallback
}

const numericLiteral = (value) => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
  ? Number(value)
  : value

function normalizeModifier(modifier) {
  const normalizedModifier = { ...modifier }
  if ('modifierValue' in normalizedModifier) {
    normalizedModifier.modifierValue = Array.isArray(normalizedModifier.modifierValue)
      ? normalizedModifier.modifierValue.map(numericLiteral)
      : normalizedModifier.modifierValue && typeof normalizedModifier.modifierValue === 'object'
        ? Object.fromEntries(Object.entries(normalizedModifier.modifierValue).map(([key, value]) => [key, numericLiteral(value)]))
        : numericLiteral(normalizedModifier.modifierValue)
  }
  if (normalizedModifier.modifierByRefinement) {
    normalizedModifier.modifierByRefinement = Object.fromEntries(
      Object.entries(normalizedModifier.modifierByRefinement).map(([rank, value]) => [rank, Number(value)])
    )
  }
  for (const key of ['maximumValue', 'modifierStep', 'overflowStep', 'overflowMin', 'overflowMax', 'minStatValue']) {
    if (normalizedModifier[key] !== undefined) normalizedModifier[key] = Number(normalizedModifier[key])
  }
  return normalizedModifier
}

function effectDefinition(raw, {
  sourceKind,
  sourceId,
  valueUnit = 'decimal',
  scope,
  sequence
}) {
  const key = String(raw.key ?? raw.name ?? `${sourceKind}-${sourceId}`)
  const inferredSequence = sequence ?? Number(key.match(/Sequence(?:Node)?(\d)/i)?.[1] ?? raw.name?.match(/Sequence(?: Node)?\s*(\d)/i)?.[1] ?? 0)
  const description = cleanDescription(raw.details ?? raw.description ?? '')
  const modifiers = Array.isArray(raw.modifiers)
    ? raw.modifiers.map(normalizeModifier)
    : raw.modifier
      ? [normalizeModifier({
          modifier: raw.modifier,
          modifierValue: raw.modifierValue,
          modifierByRefinement: raw.modifierByRefinement,
          modifySpecificTalents: raw.modifySpecificTalents,
          maximumValue: raw.maximumValue,
          modifierStep: raw.modifierStep,
          modifierBasedOn: raw.modifierBasedOn,
          modifierTargetAttr: raw.modifierTargetAttr,
          minStatValue: raw.minStatValue
        })]
      : []
  return {
    id: `${sourceKind}:${sourceId}:${key}`,
    key,
    name: String(raw.name ?? raw.label ?? key),
    description,
    sourceKind,
    sourceId,
    scope: scope ?? scopeFromDescription(description),
    valueUnit,
    alwaysEnabled: Boolean(raw.alwaysEnabled),
    hasStacks: Boolean(raw.hasStacks),
    minStacks: Number(raw.minStacks ?? 0),
    maxStacks: Number(raw.maxStacks ?? (raw.hasStacks ? 1 : 0)),
    ...(inferredSequence ? { sequence: inferredSequence } : {}),
    ...(raw.stance ? { stance: String(raw.stance) } : {}),
    ...(raw.appliesOnEveryStep ? { appliesOnEveryStep: Number(raw.appliesOnEveryStep) } : {}),
    modifiers: modifiers.filter(Boolean)
  }
}

function attackDefinition(raw, characterKey, group, element) {
  const key = String(raw.key ?? raw.label ?? `${group}-${characterKey}`)
  const rawType = String(raw.type ?? group).toLowerCase()
  const type = rawType === 'basic' ? 'basic'
    : rawType === 'heavy' ? 'heavy'
      : rawType === 'skill' ? 'skill'
        : rawType === 'liberation' ? 'liberation'
          : rawType === 'intro' ? 'intro'
            : rawType === 'outro' ? 'outro'
              : rawType === 'echo' ? 'echo'
                : rawType === 'healing' ? 'healing'
                  : rawType === 'shield' ? 'shield'
                    : rawType === 'tunebreak' ? 'tuneBreak'
                      : rawType === 'elementaleffect' ? 'status' : 'utility'
  const rawElement = String(raw.element ?? element ?? '').toLowerCase()
  const normalizedElement = ['spectro', 'fusion', 'glacio', 'electro', 'aero', 'havoc'].includes(rawElement) ? rawElement : undefined
  const talents = raw.talents && typeof raw.talents === 'object'
    ? Object.fromEntries(Object.entries(raw.talents).map(([level, value]) => [level, String(value)]))
    : { '1': String(raw.talent ?? '0%') }
  return {
    id: `${characterKey}:${key}`,
    key,
    name: String(raw.label ?? key),
    group,
    type,
    ...(normalizedElement ? { element: normalizedElement } : {}),
    attribute: String(raw.attribute ?? 'attack'),
    talents,
    count: Number(raw.count ?? 1),
    ...(raw.subType ? { subtype: String(raw.subType) } : {}),
    ...(raw.excludeTeamBuffs ? { excludeTeamBuffs: true } : {}),
    ...(raw.excludeWeaponBuffs ? { excludeWeaponBuffs: true } : {}),
    ...(raw.excludeEchoes ? { excludeEchoes: true } : {})
  }
}

const characterAttackFiles = [
  ['basicAttacks.ts', 'Basic Attack'],
  ['skillAttacks.ts', 'Resonance Skill'],
  ['forteCircuitAttacks.ts', 'Forte Circuit'],
  ['liberationAttacks.ts', 'Resonance Liberation'],
  ['introAttacks.ts', 'Intro Skill'],
  ['outroAttacks.ts', 'Outro Skill'],
  ['tuneBreakAttacks.ts', 'Tune Break']
]

const characterRoot = path.join(sourceRoot, 'src', 'characters')
const characterFolders = (await readdir(characterRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
const characters = []
for (const key of characterFolders) {
  const folder = path.join(characterRoot, key)
  const basic = (await parseFile(path.join(folder, 'basic.ts'))).returned('getCharacterBasicInfo') ?? {}
  const effects = ((await parseFile(path.join(folder, 'buffs.ts'))).value('buffs') ?? [])
    .map((effect) => effectDefinition(effect, { sourceKind: 'character', sourceId: key }))
  const sequences = ((await parseFile(path.join(folder, 'resonanceChains.ts'))).value('resonanceChains') ?? [])
    .map((effect, index) => effectDefinition(effect, { sourceKind: 'sequence', sourceId: key, sequence: index + 1 }))
  const attacks = []
  for (const [file, group] of characterAttackFiles) {
    const parsed = await parseFile(path.join(folder, file))
    const exportName = path.basename(file, '.ts')
    const attackGroup = parsed.value(exportName) ?? {}
    for (const attack of attackGroup.attacks ?? []) attacks.push(attackDefinition(attack, key, group, basic.element))
  }
  characters.push({
    id: normalized(`${basic.name ?? key}-${basic.element ?? ''}`),
    key,
    name: String(basic.name ?? key),
    attacks,
    effects,
    sequences,
    stances: [...new Set([...effects, ...sequences].flatMap((effect) => effect.stance ? [effect.stance] : []))]
  })
}

const weaponRoot = path.join(sourceRoot, 'src', 'weapons')
const weaponFiles = []
for (const type of await readdir(weaponRoot, { withFileTypes: true })) {
  if (!type.isDirectory()) continue
  for (const file of await readdir(path.join(weaponRoot, type.name), { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith('.ts')) weaponFiles.push(path.join(weaponRoot, type.name, file.name))
  }
}
const weapons = []
for (const file of weaponFiles.sort()) {
  const parsed = await parseFile(file)
  const info = parsed.value('weaponInfo')
  if (!info?.name) continue
  const key = path.basename(file, '.ts')
  weapons.push({
    id: normalized(info.name),
    key,
    name: String(info.name),
    type: String(info.type ?? path.basename(path.dirname(file))),
    passiveName: String(info.passiveName ?? ''),
    effects: (info.passiveData ?? []).map((effect) => effectDefinition(effect, {
      sourceKind: 'weapon',
      sourceId: key,
      valueUnit: 'decimal'
    }))
  })
}

const sets = await parseFile(path.join(sourceRoot, 'src', 'echoes', 'sets.ts'))
const sonatas = []
for (const exportName of ['setBonusEffectsOnePiece', 'setBonusEffectsOne', 'setBonusEffectsTwo']) {
  for (const [setKey, set] of Object.entries(sets.value(exportName) ?? {})) {
    const pieces = Number(setKey.match(/(\d+)\s*Set/i)?.[1] ?? (exportName === 'setBonusEffectsOnePiece' ? 1 : exportName === 'setBonusEffectsOne' ? 2 : 5))
    sonatas.push({
      id: normalized(`${set.name}-${pieces}`),
      key: String(set.key ?? setKey),
      name: String(set.name ?? setKey.replace(/\s+\d+\s+Set$/i, '')),
      pieces,
      effects: (set.passives ?? []).map((effect) => effectDefinition(effect, {
        sourceKind: 'sonata',
        sourceId: String(set.key ?? setKey),
        valueUnit: 'percent'
      }))
    })
  }
}

const echoSource = await parseFile(path.join(sourceRoot, 'src', 'echoes', 'index.ts'))
const echoes = Object.entries(echoSource.value('mainEchoesData') ?? {}).map(([key, echo]) => ({
  id: normalized(echo.name ?? key),
  key,
  name: String(echo.name ?? key),
  effects: echo.modifiers?.length ? [effectDefinition({
    key: `${key}Passive`,
    name: echo.name ?? key,
    details: echo.details,
    hasStacks: echo.hasStacks,
    minStacks: echo.minStacks,
    maxStacks: echo.maxStacks,
    modifiers: echo.modifiers
  }, { sourceKind: 'echo', sourceId: key, valueUnit: 'decimal' })] : [],
  attacks: (echo.actions ?? []).map((attack) => attackDefinition(attack, key, 'Echo Skill', attack.element))
}))

const partySource = await parseFile(path.join(sourceRoot, 'src', 'buffs', 'index.ts'))
const partyEffects = []
for (const [characterKey, effects] of Object.entries(partySource.value('buffsByCharacter') ?? {})) {
  for (const effect of effects) partyEffects.push(effectDefinition(effect, {
    sourceKind: 'party',
    sourceId: characterKey,
    valueUnit: 'decimal'
  }))
}
for (const effect of partySource.value('allEchoBuffs') ?? []) partyEffects.push(effectDefinition(effect, {
  sourceKind: 'party',
  sourceId: `echo:${effect.name ?? effect.key}`,
  valueUnit: 'decimal'
}))
for (const effect of partySource.value('allWeaponTeamBuffs') ?? []) partyEffects.push(effectDefinition(effect, {
  sourceKind: 'party',
  sourceId: `weapon:${effect.name ?? effect.key}`,
  valueUnit: 'decimal'
}))

const allEffects = [
  ...characters.flatMap((character) => [...character.effects, ...character.sequences]),
  ...weapons.flatMap((weapon) => weapon.effects),
  ...sonatas.flatMap((sonata) => sonata.effects),
  ...echoes.flatMap((echo) => echo.effects),
  ...partyEffects
]
const knownModifierKinds = [...new Set(allEffects.flatMap((effect) => effect.modifiers.map((modifier) => modifier.modifier ?? '(empty)')))].sort()
const catalog = {
  provenance: {
    repository: lock.repository,
    revision,
    generatedAt: new Date().toISOString(),
    importVersion: lock.importVersion
  },
  characters,
  weapons,
  sonatas,
  echoes,
  partyEffects,
  knownModifierKinds
}

const output = `// Generated by scripts/sync-wutheringtools-calculation-v2.mjs. Do not edit.
// WutheringTools revision ${revision}; adapted under GPL-3.0-only.
import type { CalculationCatalogV2 } from '../domain/calculation-v2/types'

export const calculationCatalogV2: CalculationCatalogV2 = ${JSON.stringify(catalog, null, 2)}
`
await writeFile(path.join('src', 'game-data', 'calculation-v2.generated.ts'), output)
console.log(JSON.stringify({
  revision,
  characters: characters.length,
  attacks: characters.reduce((total, character) => total + character.attacks.length, 0),
  characterEffects: characters.reduce((total, character) => total + character.effects.length + character.sequences.length, 0),
  weapons: weapons.length,
  sonatas: sonatas.length,
  echoes: echoes.length,
  partyEffects: partyEffects.length,
  modifierKinds: knownModifierKinds.length
}, null, 2))
