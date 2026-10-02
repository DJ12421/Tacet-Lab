import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const upstreamRoot = resolve(process.argv[2] ?? '.codex-work/wutheringtools-3.7')
const characterRoot = join(upstreamRoot, 'src', 'characters')
const weaponRoot = join(upstreamRoot, 'src', 'weapons')
const reviewRoot = resolve('src/game-data/mechanics-reviews/3.7')
const weaponReviewRoot = join(reviewRoot, 'weapons')
const outputPath = resolve('src/game-data/combat/wutheringtools-action-classification.generated.ts')
const effectScopeOutputPath = resolve('src/game-data/combat/wutheringtools-effect-scopes.generated.ts')

const normalize = value => String(value ?? '').toLowerCase().replaceAll('damage', 'dmg').replace(/[^a-z0-9]+/g, '')
const normalizeExpression = value => String(value ?? '').toLowerCase().replace(/\b(?:hp|atk|def|energy\s*regen)\b/g, '').replace(/[^a-z0-9.%*+/-]+/g, '')
const groupFor = file => file.replace(/Attacks\.ts$/, '').replace('forteCircuit', 'forte').replace('tuneBreak', 'tune-break')
const damageType = value => ({
  Basic:'basic', Heavy:'heavy', Skill:'skill', Liberation:'liberation', Intro:'intro', Outro:'outro',
  Healing:'healing', Echo:'echo', TuneBreak:'tune-break'
})[value]
const percentTotal = expression => [...String(expression ?? '').matchAll(/(\d+(?:\.\d+)?)%\s*(?:\*\s*(\d+(?:\.\d+)?))?/g)]
  .reduce((total, value) => total + Number(value[1]) / 100 * Number(value[2] ?? 1), 0)
const percentHits = expression => [...String(expression ?? '').matchAll(/(\d+(?:\.\d+)?)%\s*(?:\*\s*(\d+(?:\.\d+)?))?/g)]
  .flatMap(value => Array.from({ length:Number(value[2] ?? 1) }, () => Number(value[1]) / 100))
const normalizedText = value => String(value ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/gi, ' ')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')

const arrayAfter = (source, marker) => {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) return ''
  const start = source.indexOf('[', markerIndex + marker.length)
  if (start < 0) return ''
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = start; index < source.length; index++) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue }
    if (character === '[') depth++
    else if (character === ']' && --depth === 0) return source.slice(start + 1, index)
  }
  return ''
}

const topLevelObjects = source => {
  const objects = []
  let start = -1
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue }
    if (character === '{') { if (depth++ === 0) start = index }
    else if (character === '}' && --depth === 0 && start >= 0) { objects.push(source.slice(start, index + 1)); start = -1 }
  }
  return objects
}

const propertyText = (source, property) => {
  const match = source.match(new RegExp(`${property}:\\s*(?:\\r?\\n\\s*)?([\\x60"'])((?:\\\\.|(?!\\1)[\\s\\S])*)\\1`))
  return match?.[2] ?? ''
}

const specificModifierScopes = (source, actionIdsByKey) => {
  const modifierObjects = topLevelObjects(arrayAfter(source, 'modifiers:'))
  return modifierObjects.flatMap(modifier => {
    const targetSource = modifier.match(/modifySpecificTalents\s*:\s*\[([\s\S]*?)\]/)?.[1]
    if (!targetSource) return []
    const keys = [...targetSource.matchAll(/["']([^"']+)["']/g)].map(match => match[1])
    const actionIds = keys.map(key => actionIdsByKey.get(key)).filter(Boolean)
    return [actionIds.length ? [...new Set(actionIds)] : undefined]
  })
}

const allModifiersUseSpecificTargets = source => {
  const modifiers = topLevelObjects(arrayAfter(source, 'modifiers:'))
  return modifiers.length > 0 && modifiers.every(modifier => /modifySpecificTalents\s*:/.test(modifier))
}

const sharedActionScope = scopes => {
  if (!scopes.length || scopes.some(scope => !scope)) return undefined
  if (!scopes.length) return undefined
  const canonical = JSON.stringify([...scopes[0]].sort())
  return scopes.every(scope => JSON.stringify([...scope].sort()) === canonical) ? scopes[0] : undefined
}

const upstreamCharacters = new Map()
for (const directory of (await readdir(characterRoot, { withFileTypes:true })).sort((left, right) => left.name.localeCompare(right.name))) {
  if (!directory.isDirectory()) continue
  const attacks = []
  for (const file of (await readdir(join(characterRoot, directory.name))).sort()) {
    if (!file.endsWith('Attacks.ts')) continue
    const source = await readFile(join(characterRoot, directory.name, file), 'utf8')
    const pattern = /\{\s*key:\s*["']([^"']+)["'][\s\S]*?label:\s*["']([^"']+)["'][\s\S]*?type:\s*["']([^"']+)["']([\s\S]*?)(?=\n\s*\},)/g
    for (const match of source.matchAll(pattern)) {
      const type = damageType(match[3])
      const attribute = match[0].match(/attribute:\s*["']([^"']+)["']/)?.[1]
      const scalingStat = attribute === 'hp' ? 'hp' : attribute === 'defense' ? 'def' : attribute === 'EnergyRegen' ? 'energyRegen' : 'atk'
      const talents = Object.fromEntries([...match[0].matchAll(/^\s*["'](\d+)["']:\s*["']([^"']+)["'],?\s*$/gm)].map(value => [Number(value[1]), value[2]]))
      if (type) attacks.push({
        key:match[1],
        label:match[2],
        damageType:type,
        coordinated:/subType:\s*["']Coordinated["']/.test(match[4]),
        group:groupFor(file),
        scalingStat,
        requiresSequence:/requiresResonanceChain\s*:/.test(match[0]),
        talents
      })
    }
  }
  upstreamCharacters.set(normalize(directory.name), attacks)
}

const corrections = {}
const reviewsByCharacter = new Map()
const actionIdsByCharacter = new Map()
let total = 0
let matched = 0
let formulaMatched = 0
let ambiguous = 0
const multiplierMismatches = []
for (const file of (await readdir(reviewRoot)).filter(value => value.endsWith('.review.json')).sort()) {
  const review = JSON.parse(await readFile(join(reviewRoot, file), 'utf8'))
  const characterKey = normalize(review.entityName)
  const upstream = upstreamCharacters.get(characterKey) ?? []
  reviewsByCharacter.set(characterKey, review)
  const actionIdsByKey = new Map()
  actionIdsByCharacter.set(characterKey, actionIdsByKey)
  const reviewedAttacks = review.sections?.attacks?.approvedData?.entries ?? []
  for (const attack of reviewedAttacks) {
    total++
    const name = normalize(attack.name)
    const expectedGroup = attack.skillSource === 'tuneBreak' ? 'tune-break' : attack.skillSource
    const scoped = upstream.filter(item => item.group === expectedGroup)
    const pool = scoped.length ? scoped : upstream
    const candidates = pool.filter(item => {
      const key = normalize(item.key)
      const label = normalize(item.label)
      return name === key || name.endsWith(key) || key.endsWith(name) || name === label || name.endsWith(label)
    })
    let unique = [...new Map(candidates.map(item => [`${item.key}:${item.damageType}:${item.coordinated}:${item.scalingStat}`, item])).values()]
    if (unique.length !== 1 && attack.expressions?.length) {
      const compatibleKind = item => attack.damageType === 'healing' ? item.damageType === 'healing' : item.damageType !== 'healing'
      const formulaCandidates = pool.filter(item => {
        const talents = Object.entries(item.talents)
        return compatibleKind(item) && talents.length >= 3 && talents.every(([level, expression]) => normalizeExpression(expression) === normalizeExpression(attack.expressions[Number(level) - 1]))
      })
      unique = [...new Map(formulaCandidates.map(item => [`${item.key}:${item.damageType}:${item.coordinated}:${item.scalingStat}`, item])).values()]
      if (unique.length === 1) formulaMatched++
    }
    if (unique.length !== 1) { ambiguous++; continue }
    matched++
    const upstreamAttack = unique[0]
    actionIdsByKey.set(upstreamAttack.key, attack.id)
    const mismatchedLevels = Object.entries(upstreamAttack.talents).filter(([level, expression]) => {
      const index = Number(level) - 1
      const reviewedTotal = (attack.hitMultipliers ?? []).reduce((total, hit) => total + Number(hit[index] ?? 0), 0)
      return Math.abs(reviewedTotal - percentTotal(expression)) > 1e-8
    }).map(([level]) => Number(level))
    if (mismatchedLevels.length) multiplierMismatches.push({ id:attack.id, levels:mismatchedLevels })
    const hitsByLevel = mismatchedLevels.length ? Object.fromEntries(mismatchedLevels.map(level => [level, percentHits(upstreamAttack.talents[level])])) : undefined
    const currentType = attack.damageType === 'tuneBreak' ? 'tune-break' : attack.damageType
    const addTags = upstreamAttack.coordinated && !(attack.tags ?? []).includes('coordinated') ? ['coordinated'] : undefined
    const scalingStat = upstreamAttack.scalingStat === attack.scaling ? undefined : upstreamAttack.scalingStat
    if (upstreamAttack.damageType !== currentType || addTags || scalingStat || hitsByLevel) corrections[attack.id] = {
      ...(upstreamAttack.damageType === currentType ? {} : { damageType:upstreamAttack.damageType }),
      ...(addTags ? { addTags } : {}),
      ...(scalingStat ? { scalingStat } : {}),
      ...(hitsByLevel ? { hitsByLevel } : {})
    }
  }
  for (const group of new Set(upstream.map(attack => attack.group))) {
    const upstreamGroup = upstream.filter(attack => attack.group === group && !attack.requiresSequence)
    const reviewedGroup = reviewedAttacks.filter(attack => (attack.skillSource === 'tuneBreak' ? 'tune-break' : attack.skillSource) === group)
    if (upstreamGroup.length !== reviewedGroup.length) continue
    upstreamGroup.forEach((attack, index) => {
      if (!actionIdsByKey.has(attack.key)) actionIdsByKey.set(attack.key, reviewedGroup[index].id)
    })
  }
}

const effectScopes = {}
let scopedEffects = 0
let blockedUnresolvedEffects = 0
let unresolvedSpecificEffects = 0
const unresolvedSpecificEffectNames = []
for (const [characterKey, review] of reviewsByCharacter) {
  const directory = [...(await readdir(characterRoot, { withFileTypes:true }))].find(entry => entry.isDirectory() && normalize(entry.name) === characterKey)
  const actionIdsByKey = actionIdsByCharacter.get(characterKey)
  if (!directory || !actionIdsByKey) continue
  const characterPath = join(characterRoot, directory.name)

  const buffsPath = join(characterPath, 'buffs.ts')
  let buffObjects = []
  try {
    const source = await readFile(buffsPath, 'utf8')
    buffObjects = topLevelObjects(arrayAfter(source, 'export const buffs'))
  } catch {}
  for (const entry of review.sections?.characterBuffs?.approvedData?.entries ?? []) {
    if (entry.reviewStatus !== 'include' || !(entry.parsed?.modifiers?.length)) continue
    const text = normalizedText(entry.text)
    const sourceName = normalizedText(entry.sourceName)
    const matches = buffObjects.filter(object => {
      const details = normalizedText(propertyText(object, 'details'))
      const name = normalizedText(propertyText(object, 'name'))
      return (text.length >= 12 && details.includes(text)) || (sourceName.length >= 6 && name.endsWith(sourceName))
    })
    if (matches.length !== 1) continue
    const modifierScopes = specificModifierScopes(matches[0], actionIdsByKey)
    const scope = modifierScopes.length === entry.parsed.modifiers.length ? sharedActionScope(modifierScopes) : undefined
    const byOperation = !scope && modifierScopes.length === entry.parsed.modifiers.length && modifierScopes.every(Boolean) ? modifierScopes : undefined
    if (!scope && !byOperation) {
      if (entry.parsed.modifiers.every(modifier => modifier.actionIds?.length)) continue
      if (allModifiersUseSpecificTargets(matches[0])) {
        effectScopes[`character:${review.entityId}:${entry.id}`] = { blockUnscoped:true }
        blockedUnresolvedEffects++
        continue
      }
      if (/modifySpecificTalents/.test(matches[0])) { unresolvedSpecificEffects++; unresolvedSpecificEffectNames.push(`${review.entityName}: ${entry.sourceName}`) }
      continue
    }
    effectScopes[`character:${review.entityId}:${entry.id}`] = scope ? { all:scope } : { byOperation }
    scopedEffects++
  }

  const chainsPath = join(characterPath, 'resonanceChains.ts')
  let chainObjects = []
  try {
    const source = await readFile(chainsPath, 'utf8')
    chainObjects = topLevelObjects(arrayAfter(source, 'export const resonanceChains'))
  } catch {}
  for (const entry of review.sections?.sequences?.approvedData?.entries ?? []) {
    const chain = chainObjects.find(object => Number(propertyText(object, 'key').match(/SequenceNode(\d+)/)?.[1]) === entry.sequence) ?? chainObjects[entry.sequence - 1]
    if (!chain || !/modifySpecificTalents/.test(chain)) continue
    const modifierScopes = specificModifierScopes(chain, actionIdsByKey)
    const scope = sharedActionScope(modifierScopes)
    let emitted = false
    let generatedIndex = 0
    for (const parsedEffect of entry.parsedEffects ?? []) {
      if (!(parsedEffect.modifiers?.length)) continue
      const effectId = `character:${review.entityId}:${review.entityId}:sequence:${entry.sequence}:${generatedIndex++}`
      const byOperation = !scope && modifierScopes.length === parsedEffect.modifiers.length && modifierScopes.every(Boolean) ? modifierScopes : undefined
      if (!scope && !byOperation) {
        if (parsedEffect.modifiers.every(modifier => modifier.actionIds?.length)) emitted = true
        else if (allModifiersUseSpecificTargets(chain)) {
          effectScopes[effectId] = { blockUnscoped:true }
          blockedUnresolvedEffects++
          emitted = true
        }
        continue
      }
      effectScopes[effectId] = scope ? { all:scope } : { byOperation }
      scopedEffects++
      emitted = true
    }
    if (!emitted) { unresolvedSpecificEffects++; unresolvedSpecificEffectNames.push(`${review.entityName}: Sequence ${entry.sequence}`) }
  }
}

const weaponDefenseIgnoreFilters = new Map()
for (const directory of await readdir(weaponRoot, { withFileTypes:true })) {
  if (!directory.isDirectory()) continue
  for (const file of await readdir(join(weaponRoot, directory.name))) {
    if (!file.endsWith('.ts')) continue
    const source = await readFile(join(weaponRoot, directory.name, file), 'utf8')
    const name = normalize(propertyText(source, 'name'))
    const modifiers = [...source.matchAll(/modifier:\s*["']DEFIgnore(?::([^"']+))?["']/g)]
    if (!name || modifiers.length !== 1) continue
    const scope = modifiers[0][1]?.toLowerCase()
    const filter = scope === 'basic' || scope === 'heavy' || scope === 'liberation'
      ? { damageTypes:[scope] }
      : ['spectro','fusion','glacio','electro','aero','havoc','physical'].includes(scope)
        ? { elements:[scope] }
        : null
    weaponDefenseIgnoreFilters.set(name, filter)
  }
}

let correctedWeaponDefenseIgnoreScopes = 0
for (const file of (await readdir(weaponReviewRoot)).filter(value => value.endsWith('.review.json')).sort()) {
  const review = JSON.parse(await readFile(join(weaponReviewRoot, file), 'utf8'))
  if (!weaponDefenseIgnoreFilters.has(normalize(review.entityName))) continue
  const filter = weaponDefenseIgnoreFilters.get(normalize(review.entityName))
  for (const entry of review.sections?.effects?.approvedData?.entries ?? []) {
    const filtersByOperation = Object.fromEntries((entry.parsed?.modifiers ?? []).flatMap((modifier, index) =>
      String(modifier.stat).startsWith('DEFIgnore') ? [[index, filter]] : []
    ))
    if (!Object.keys(filtersByOperation).length) continue
    effectScopes[`weapon:${review.entityId}:${entry.id}`] = { filtersByOperation }
    correctedWeaponDefenseIgnoreScopes += Object.keys(filtersByOperation).length
  }
}

const header = `// Generated by scripts/sync-wutheringtools-combat-types.mjs from the reviewed local upstream snapshot.\n// Ambiguous labels intentionally retain reviewed fallback data. Do not edit manually.\n`
const body = `${header}import type { ActionTag, DamageType, ScalingStat } from '../../domain/combat'\n\nexport const wutheringToolsActionClassification: Readonly<Record<string, { damageType?: DamageType; addTags?: readonly ActionTag[]; scalingStat?: ScalingStat; hitsByLevel?: Readonly<Record<number, readonly number[]>> }>> = ${JSON.stringify(corrections, null, 2)}\n`
await writeFile(outputPath, body)
const effectScopeBody = `${header}import type { EffectFilter } from '../../domain/combat'\n\nexport const wutheringToolsEffectScopes: Readonly<Record<string, { all?: readonly string[]; byOperation?: readonly (readonly string[])[]; filtersByOperation?: Readonly<Record<number, EffectFilter | null>>; blockUnscoped?: boolean }>> = ${JSON.stringify(effectScopes, null, 2)}\n`
await writeFile(effectScopeOutputPath, effectScopeBody)
console.log(`Wrote ${Object.keys(corrections).length} corrections (${matched}/${total} unambiguous, including ${formulaMatched} strict formula matches; ${ambiguous} retained fallbacks).`)
console.log(`${multiplierMismatches.length} upstream damage-multiplier mismatches were emitted as hit corrections.`)
console.log(`${scopedEffects} Forte/Sequence effects received action scopes; ${unresolvedSpecificEffects} specific effects were retained for review.`)
console.log(`${blockedUnresolvedEffects} unresolved action-specific effects were prevented from applying universally.`)
console.log(`${correctedWeaponDefenseIgnoreScopes} weapon DEF Ignore scopes were synchronized from upstream modifiers.`)
if (unresolvedSpecificEffectNames.length) console.log([...new Set(unresolvedSpecificEffectNames)].sort())
if (multiplierMismatches.length) console.log(multiplierMismatches.slice(0, 20))
