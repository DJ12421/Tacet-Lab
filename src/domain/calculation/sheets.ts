import { baseTuneBreakBoost, characterCatalog, echoCatalog, isFixedSkillValueName, sonataCatalog, weaponCatalog } from '../../game-data'
import type { DamageType, Element } from '../types'
import { formula, type FormulaEntry, type FormulaNode } from './engine'

export type ConditionValue = boolean | number | string
export interface ConditionDefinition {
  id: string
  label: string
  type: 'boolean' | 'number' | 'stack' | 'enum'
  defaultValue: ConditionValue
  min?: number
  max?: number
  options?: string[]
  scope: 'self' | 'team' | 'enemy' | 'action'
  description?: string
  card?: keyof typeof characterCatalog[number]['skillIcons'] | 'outroSkill'
  inherentSkillIndex?: number
  stance?: string
  sequence?: number
  disabled?: boolean
}

export interface FormulaTarget {
  id: string
  label: string
  group: string
  kind: 'damage' | 'healing' | 'shield' | 'stat' | 'rotation'
  damageType?: DamageType
  element?: Element
  normal: FormulaNode
  critical: FormulaNode
  expected: FormulaNode
}

export type FormulaSheetKind = 'character' | 'weapon' | 'sonata' | 'echo'
export interface FormulaSheet {
  id: string
  kind: FormulaSheetKind
  version: 'nanoka-3.6-formula-v2'
  status: 'modeled' | 'noCombatEffect'
  name: string
  source: string
  referenceText?: string
  conditions: ConditionDefinition[]
  entries: FormulaEntry[]
  targets: FormulaTarget[]
}

export const FORMULA_SHEET_VERSION = 'nanoka-3.6-formula-v2' as const
const one = formula.constant(1)
const hundred = formula.constant(100)
const addPercent = (node: FormulaNode) => formula.sum(one, formula.prod(node, formula.constant(0.01)))
const clampedPercent = (key: string, min: number, max: number) => formula.min(formula.max(formula.input(key), formula.constant(min)), formula.constant(max))

const elementKey = (element: string) => `${element.toLowerCase()}Damage`
const typeKey = (type: DamageType) => type === 'basic' ? 'basicDamage' : type === 'heavy' ? 'heavyDamage' : type === 'skill' ? 'skillDamage' : type === 'liberation' ? 'liberationDamage' : undefined
const tuneBreakLevelConstants = {
  1: 2.215,
  20: 5.932,
  40: 29.357,
  50: 60.934,
  60: 130.868,
  70: 249.715,
  80: 437.085,
  90: 716.22
} as const
const tuneBreakEnemyClasses = [
  ['Common', 1],
  ['Elite', 3],
  ['Overlord / Calamity', 14]
] as const
const attackGroup = (attack: typeof characterCatalog[number]['attacks'][number]) => attack.type === 'outro' ? 'Outro Skill'
  : attack.type === 'intro' ? 'Intro Skill'
    : attack.skillLevelIndex === 0 ? 'Basic Attack'
      : attack.skillLevelIndex === 1 ? 'Resonance Skill'
        : attack.skillLevelIndex === 2 ? 'Forte Circuit'
          : attack.skillLevelIndex === 3 ? 'Resonance Liberation'
            : attack.type === 'basic' || attack.type === 'heavy' ? 'Basic Attack'
              : attack.type === 'skill' ? 'Resonance Skill'
                : attack.type === 'liberation' ? 'Resonance Liberation' : 'Damage'

function tuneBreakTargets(characterId: string, baseBoost: number): FormulaTarget[] {
  const supportedLevels = Object.keys(tuneBreakLevelConstants).map(Number)
  const levelKey: FormulaNode = {
    op: 'lookup',
    key: formula.input('characterLevel', 90, 'Character level'),
    values: Object.fromEntries(Array.from({ length: 90 }, (_, index) => {
      const level = index + 1
      const nearest = supportedLevels.reduce((best, candidate) => Math.abs(candidate - level) < Math.abs(best - level) ? candidate : best)
      return [String(level), formula.constant(tuneBreakLevelConstants[nearest as keyof typeof tuneBreakLevelConstants])]
    })),
    fallback: formula.constant(tuneBreakLevelConstants[90]),
    label: 'Tune Break level constant'
  }
  return tuneBreakEnemyClasses.map(([enemyClass, enemyMultiplier]) => {
    const damage = formula.floor(formula.prod(
      levelKey,
      formula.constant(16, 'Tune Break motion value'),
      formula.constant(enemyMultiplier, `${enemyClass} multiplier`),
      addPercent(formula.input('tuneBreakBoost', baseBoost, 'Tune Break Boost')),
      formula.input('defenseMultiplier', 0.5, 'Enemy DEF multiplier'),
      formula.input('resistanceMultiplier', 0.9, 'Physical RES multiplier'),
      formula.sum(one, formula.prod(formula.input('damageReduction', 0, 'Damage reduction'), formula.constant(-0.01))),
      addPercent(formula.input('specialMultiplier', 0, 'Special multiplier / vulnerability'))
    ), 'Tune Break damage')
    return {
      id: `${characterId}:tune-break-${enemyClass.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      label: `Tune Break DMG · ${enemyClass}`,
      group: 'Tune Break',
      kind: 'damage',
      normal: damage,
      critical: damage,
      expected: damage
    }
  })
}

function damageTarget(characterId: string, element: string, attack: typeof characterCatalog[number]['attacks'][number]): FormulaTarget {
  const multipliers = Object.fromEntries(attack.multipliers.map((value, index) => [String(index + 1), formula.constant(value)]))
  const baseMultiplier: FormulaNode = { op: 'lookup', key: formula.input(`skillLevel:${attack.skillLevelIndex}`, 1), values: multipliers, fallback: formula.constant(attack.multipliers[0] ?? 0), label: 'Base motion value' }
  const multiplier: FormulaNode = {
    op: 'prod',
    operands: [
      formula.sum(baseMultiplier, formula.percent(formula.input('additionalMotionValue', 0, 'Additional motion value'))),
      addPercent(formula.input('motionValueMultiplier', 0, 'Motion value multiplier'))
    ],
    label: 'Total motion value'
  }
  const scaling = formula.stat(attack.scalesWith, 0, attack.scalesWith.toUpperCase())
  if (attack.type === 'healing') {
    const healing = formula.floor(formula.prod(scaling, multiplier, addPercent(formula.stat('healingBonus', 0, 'Healing Bonus'))), 'Healing')
    return { id: `${characterId}:${attack.id}`, label: attack.name, group: 'Healing', kind: 'healing', damageType: attack.type, element: element.toLowerCase() as Element, normal: healing, critical: healing, expected: healing }
  }
  const typeBonus = typeKey(attack.type) ? formula.stat(typeKey(attack.type)!, 0, `${attack.type} DMG Bonus`) : formula.constant(0)
  const elementBonus = formula.stat(elementKey(element), 0, `${element} DMG Bonus`)
  const bonus: FormulaNode = { op: 'sum', operands: [typeBonus, elementBonus, formula.input('bonusDamage', 0, 'Scenario DMG Bonus')], label: 'Total DMG Bonus' }
  const amplification: FormulaNode = { ...addPercent(formula.input('amplification', 0, 'Amplification')), label: 'Amplification multiplier' }
  const specialMultiplier: FormulaNode = { ...addPercent(formula.input('specialMultiplier', 0, 'Special multiplier / vulnerability')), label: 'Special multiplier' }
  const reduction: FormulaNode = { op: 'sum', operands: [one, formula.prod(formula.input('damageReduction', 0, 'Damage reduction'), formula.constant(-0.01))], label: 'Damage reduction multiplier' }
  const base = formula.prod(
    scaling,
    multiplier,
    addPercent(bonus),
    formula.input('defenseMultiplier', 0.5, 'Enemy DEF multiplier'),
    formula.input('resistanceMultiplier', 0.9, 'Enemy RES multiplier'),
    amplification,
    specialMultiplier,
    reduction
  )
  const critMultiplier: FormulaNode = { op: 'max', operands: [one, formula.prod(formula.stat('critDamage', 0, 'CRIT DMG'), formula.constant(0.01))], label: 'CRIT multiplier' }
  const normal = formula.floor(base, 'Normal damage')
  const critical = formula.floor(formula.prod(normal, critMultiplier), 'Critical damage')
  const critRate: FormulaNode = { ...formula.prod(clampedPercent('effectiveCritRate', 0, 100), formula.constant(0.01)), label: 'Effective CRIT Rate' }
  const expectedFactor: FormulaNode = { op: 'sum', operands: [one, formula.prod(critRate, formula.sum(critMultiplier, formula.constant(-1)))], label: 'Expected CRIT factor' }
  const expected = formula.floor(formula.prod(normal, expectedFactor), 'Average damage')
  return {
    id: `${characterId}:${attack.id}`, label: attack.name, group: attackGroup(attack),
    kind: 'damage', damageType: attack.type, element: element.toLowerCase() as Element, normal, critical, expected
  }
}

function characterSheet(character: typeof characterCatalog[number]): FormulaSheet {
  return {
    id: character.id, kind: 'character', version: FORMULA_SHEET_VERSION, status: 'modeled', name: character.name,
    source: character.articleUrl, referenceText: [character.skillIcons.normalAttack.description, character.skillIcons.resonanceSkill.description, character.skillIcons.forteCircuit.description, character.skillIcons.resonanceLiberation.description].join('\n'),
    conditions: [],
    entries: [],
    targets: [
      ...character.attacks.filter((attack) => !isFixedSkillValueName(attack.name)).map((attack) => damageTarget(character.id, character.element, attack)),
      ...tuneBreakTargets(character.id, baseTuneBreakBoost(character))
    ]
  }
}

const referenceSheet = (kind: Exclude<FormulaSheetKind, 'character'>, entry: { id?: string; name: string }, source: string, referenceText: string, status: FormulaSheet['status'] = 'modeled'): FormulaSheet => ({
  id: entry.id ?? entry.name, kind, version: FORMULA_SHEET_VERSION, status, name: entry.name, source, referenceText, conditions: [], entries: [], targets: []
})

export const characterFormulaSheets = characterCatalog.map(characterSheet)
export const weaponFormulaSheets = weaponCatalog.map((weapon) => referenceSheet('weapon', weapon, weapon.articleUrl, weapon.passiveEffects.join('\n')))
export const sonataFormulaSheets = sonataCatalog.map((sonata) => referenceSheet('sonata', sonata, `https://ww.nanoka.cc/echo-group/${sonata.id}`, sonata.effects.map((effect) => `${effect.pieces}: ${effect.description}`).join('\n')))
export const echoFormulaSheets = echoCatalog.map((echo) => referenceSheet('echo', echo, echo.articleUrl ?? '', 'Main Echo metadata is classified; the pinned catalog does not expose a structured active-effect formula.', 'noCombatEffect'))
export const formulaSheets = [...characterFormulaSheets, ...weaponFormulaSheets, ...sonataFormulaSheets, ...echoFormulaSheets]

export const formulaSheetById = new Map(formulaSheets.map((sheet) => [`${sheet.kind}:${sheet.id}`, sheet]))

export interface FormulaCoverage {
  version: typeof FORMULA_SHEET_VERSION
  expected: Record<FormulaSheetKind, number>
  classified: Record<FormulaSheetKind, number>
  modeled: Record<FormulaSheetKind, number>
  complete: boolean
}

export function getFormulaCoverage(): FormulaCoverage {
  const expected = { character: characterCatalog.length, weapon: weaponCatalog.length, sonata: sonataCatalog.length, echo: echoCatalog.length }
  const classified = { character: characterFormulaSheets.length, weapon: weaponFormulaSheets.length, sonata: sonataFormulaSheets.length, echo: echoFormulaSheets.length }
  const modeled = {
    character: characterFormulaSheets.filter((sheet) => sheet.status === 'modeled').length,
    weapon: weaponFormulaSheets.filter((sheet) => sheet.status === 'modeled').length,
    sonata: sonataFormulaSheets.filter((sheet) => sheet.status === 'modeled').length,
    echo: echoFormulaSheets.filter((sheet) => sheet.status === 'modeled').length
  }
  return { version: FORMULA_SHEET_VERSION, expected, classified, modeled, complete: Object.keys(expected).every((key) => expected[key as FormulaSheetKind] === classified[key as FormulaSheetKind]) }
}

export function resolveFormulaTarget(characterId: string, targetId: string) {
  return characterFormulaSheets.find((sheet) => sheet.id === characterId)?.targets.find((target) => target.id === targetId)
}
