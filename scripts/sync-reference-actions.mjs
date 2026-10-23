import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.argv[2] ?? '.codex-work/combat-reference-3.7/src/characters'
const output = 'src/game-data/combat/reference-actions.generated.json'
// These keys are distinct attacks absent from the catalog, reviewed actions, and imported runtime.
const selected = {
  '1403':['Aalto', 'basicAttacks.ts', ['SequenceNode3HazeyTransitionHalfTruthsStage1DMG','SequenceNode3HazeyTransitionHalfTruthsStage2DMG','SequenceNode3HazeyTransitionHalfTruthsStage3DMG','SequenceNode3HazeyTransitionHalfTruthsStage4DMG','SequenceNode3HazeyTransitionHalfTruthsStage5DMG','SequenceNode3HazeyTransitionHalfTruthsMidAirAttackDMG']],
  '1306':['Augusta', 'basicAttacks.ts', ['SequenceNode6EngravedinRadiantLight']],
  '1103':['Baizhi', 'liberationAttacks.ts', ['SequenceNode4EternalVerity']],
  '1301':['Calcharo', 'liberationAttacks.ts', ['SequenceNode6TheUltimatum']],
  '1607':['Cantarella', 'introAttacks.ts', ['TidalSurgeCoordinatedDMG']],
  '1405':['Jianxin', 'forteCircuitAttacks.ts', ['SequenceNode6TruthfromWithinSpecialChiCounter']],
  '1604':['RoverHavocMale', 'forteCircuitAttacks.ts', ['SequenceNode5AeonSymphony']],
  '1605':['RoverHavocFemale', 'forteCircuitAttacks.ts', ['SequenceNode5AeonSymphony']],
  '1104':['Lingyang', ['forteCircuitAttacks.ts','liberationAttacks.ts'], ['InherentSkillDiligentPractice','SequenceNode5SevenStarsShineSteppeduponHigh']],
  '1204':['Mortefi', 'skillAttacks.ts', ['SequenceNodeFuneraryQuartet']],
  '1305':['XiangliYao', 'forteCircuitAttacks.ts', ['SequenceNode1ProdigyofProteges']],
  '1302':['Yinlin', 'liberationAttacks.ts', ['SequenceNode6PursuitofJustice']],
  '1105':['Zhezhi', ['liberationAttacks.ts','skillAttacks.ts'], ['SequenceNode5CompositionsClue','SequenceNode6InfiniteLegacy']]
}

const hits = expression => {
  const terms = [...expression.matchAll(/(\d+(?:\.\d+)?)%\s*(?:\*\s*(\d+))?/g)]
  if (!terms.length || expression.replace(/\d+(?:\.\d+)?%\s*(?:\*\s*\d+)?|[+\s]/g, '')) throw new Error(`Unsupported expression: ${expression}`)
  return terms.flatMap(term => Array.from({ length:Number(term[2] ?? 1) }, () => Number(term[1]) / 100))
}

const result = {}
for (const [characterId, [directory, files, keys]] of Object.entries(selected)) {
  const rows = []
  for (const file of Array.isArray(files) ? files : [files]) {
    const content = await readFile(join(root, directory, file), 'utf8')
    const pattern = /\{\s*key:\s*["']([^"']+)["'][\s\S]*?label:\s*["'][^"']+["'][\s\S]*?type:\s*["'][^"']+["']([\s\S]*?)(?=\n\s*\},)/g
    for (const match of content.matchAll(pattern)) {
      if (!keys.includes(match[1])) continue
      const body = match[0]
      const label = body.match(/label:\s*["']([^"']+)["']/)?.[1]
      const type = body.match(/type:\s*["']([^"']+)["']/)?.[1]
      const scaling = body.match(/attribute:\s*["']([^"']+)["']/)?.[1] ?? 'attack'
      const coordinated = /subType:\s*["']Coordinated["']/.test(body)
      const formulas = Object.fromEntries([...body.matchAll(/^\s*["'](\d+)["']:\s*["']([^"']+)["'],?\s*$/gm)].map(level => [level[1], hits(level[2])]))
      if (!label || !type || Object.keys(formulas).length !== 10) throw new Error(`Incomplete ${characterId}:${match[1]}`)
      rows.push({ key:match[1], name:label, group:file.replace('Attacks.ts', ''), type, scaling, coordinated, formulas })
    }
  }
  if (rows.length !== keys.length || new Set(rows.map(row => row.key)).size !== keys.length) throw new Error(`Missing or duplicate source keys for ${directory}`)
  result[characterId] = rows
}
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(`Saved ${Object.values(result).flat().length} missing actions`)
