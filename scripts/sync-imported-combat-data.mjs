import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('.local-tools/combat-source')
const catalogText = await readFile('src/game-data/characters.generated.ts', 'utf8')
const catalog = JSON.parse(`[${catalogText.split('=[')[1]}`)
const byId = new Map(catalog.map((character) => [character.id, character]))
const reviewText = await readFile('src/game-data/combat/reviewed-mechanics.generated.ts', 'utf8')
const reviewed = JSON.parse(reviewText.slice(reviewText.indexOf('=') + 1)).characters
const words = (value) => new Set(String(value).toLowerCase().replace(/\b(?:basic|attack|dmg|damage|resonance|stage|skill|forte|heavy|mid|air)\b/g, ' ').match(/[a-z]+|\d+/g) ?? [])
const similarity = (left, right) => {
  const a = words(left)
  const b = words(right)
  const intersection = [...a].filter((word) => b.has(word)).length
  return intersection / Math.max(1, Math.max(a.size, b.size))
}
const sum = (values) => values.reduce((total, value) => total + value, 0)
const levelTen = (attack) => attack.multipliers?.[9]
const reviewedValue = (action) => {
  const formula = action.formulas?.[10] ?? Object.values(action.formulas ?? {})[0]
  return formula?.kind === 'damage' ? sum(formula.hits) : undefined
}
const equivalents = { '1408': ['1408', '1406'], '1502': ['1502', '1501'], '1611': ['1309', '1310'] }
const output = {}
const buffs = {}
const counts = { characters:0, abilities:0, direct:0, additional:0, unmappedCharacters:[] }

for (const file of (await readdir(source)).filter((name) => name.endsWith('.json') && name !== 'roster.json').sort()) {
  const raw = JSON.parse(await readFile(resolve(source, file), 'utf8'))
  const sourceId = String(raw.id)
  if (!Array.isArray(raw.abilities) || new Set(raw.abilities.map((ability) => ability.id)).size !== raw.abilities.length) throw new Error(`Invalid ability IDs in ${file}`)
  if (!Array.isArray(raw.buffs?.team) || !Array.isArray(raw.buffs?.personal)) throw new Error(`Invalid buffs in ${file}`)
  counts.characters++
  counts.abilities += raw.abilities.length
  if (!(equivalents[sourceId] ?? [sourceId]).some((characterId) => byId.has(characterId))) {
    counts.unmappedCharacters.push(`${raw.name} (${sourceId})`)
    output[sourceId] = { sourceId, slug:raw.slug, name:raw.name, abilities:raw.abilities.map((ability) => ({ ...ability, tacetActionId:null, match:'unmapped' })) }
    buffs[sourceId] = raw.buffs
    continue
  }
  for (const characterId of equivalents[sourceId] ?? [sourceId]) {
    const character = byId.get(characterId)
    if (!character) throw new Error(`Missing Tacet Lab character ${characterId}`)
    const actions = [...new Map([
      ...Object.values(reviewed[characterId]?.actions ?? {}).map((action) => ({ id:action.id, name:action.name, value:reviewedValue(action) })).filter((action) => action.value !== undefined),
      ...character.attacks.filter((attack) => levelTen(attack) !== undefined).map((attack) => ({ id:attack.id, name:attack.name, value:levelTen(attack) }))
    ].map((action) => [action.id.replaceAll(':', '-'), action])).values()]
    const used = new Set()
    let tuneBreakMapped = false
    const abilities = raw.abilities.map((ability) => {
      if (!Number.isInteger(ability.id) || !Number.isInteger(ability.total_frames) || ability.total_frames < 0 || !Array.isArray(ability.hits)) throw new Error(`Invalid ability ${file}:${ability.id}`)
      for (const hit of ability.hits) if (!Number.isFinite(hit.motion_value) || !Number.isFinite(hit.frame) || hit.frame < 0) throw new Error(`Invalid hit ${file}:${ability.id}`)
      const total = sum(ability.hits.map((hit) => hit.motion_value)) / 10000
      const candidates = ability.hits.length ? actions.filter((action) => Math.abs(action.value - total) < 0.00011).map((action) => ({ ...action, score:similarity(ability.name, action.name) })).sort((left, right) => right.score - left.score) : []
      const chosen = candidates[0]?.score >= 0.34 && (candidates.length === 1 || candidates[0].score > candidates[1].score) ? candidates[0] : undefined
      const genericTuneBreak = ability.name.startsWith('Tune Break Skill') && !tuneBreakMapped
      if (genericTuneBreak) tuneBreakMapped = true
      const knownUnsupported = characterId === '1508' && ability.name === 'S1: Unseen Snare Fixed DMG'
      const actionId = genericTuneBreak ? `${characterId}:tune-break` : knownUnsupported ? '1508:review:s1-unseen-snare-hit' : chosen && !used.has(chosen.id) ? chosen.id : undefined
      const utilityOutro = ability.genre === 'outro' && ability.hits.length === 0
      if (actionId) { used.add(actionId); counts.direct++ } else if (ability.hits.length) counts.additional++
      return { ...ability, tacetActionId:actionId ?? (ability.hits.length || utilityOutro ? `${characterId}:imported:${ability.id}` : null), match:actionId ? 'direct' : ability.hits.length || utilityOutro ? 'additional' : 'unmapped' }
    })
    output[characterId] = { sourceId, slug:raw.slug, name:raw.name, abilities }
    buffs[characterId] = raw.buffs
  }
}

if (counts.characters !== 48 || counts.abilities !== 1217) throw new Error(`Unexpected source snapshot: ${JSON.stringify(counts)}`)
const runtime = Object.fromEntries(Object.entries(output).map(([characterId, character]) => [characterId, {
  sourceId:character.sourceId, slug:character.slug, name:character.name,
  abilities:character.abilities.filter((ability) => ability.tacetActionId).map((ability) => ({
    id:ability.id, name:ability.name, genre:ability.genre, group_label:ability.group_label,
    total_frames:ability.total_frames, earliest_frame_cancel:ability.earliest_frame_cancel,
    no_swap:ability.no_swap, time_stop:ability.time_stop, motion_stop:ability.motion_stop,
    hits:ability.hits.map((hit) => ({ frame:hit.frame, commit_frame:hit.commit_frame, motion_value:hit.motion_value,
      motion_value_scaling:hit.motion_value_scaling, attribute:hit.attribute, damage_type:hit.damage_type })),
    tacetActionId:ability.tacetActionId, match:ability.match
  }))
}]))
await writeFile('src/game-data/combat/imported-abilities.generated.json', `${JSON.stringify(output)}\n`)
await writeFile('src/game-data/combat/imported-runtime.generated.json', `${JSON.stringify(runtime)}\n`)
await writeFile('src/game-data/combat/imported-buffs.generated.json', `${JSON.stringify(buffs)}\n`)
console.log(JSON.stringify(counts))
