import { describe, expect, it } from 'vitest'
import { characterCatalog, echoCatalog, sonataCatalog, weaponCatalog } from '../../game-data'
import { FormulaCalculator } from './engine'
import { characterFormulaSheets, echoFormulaSheets, formulaSheets, getFormulaCoverage, sonataFormulaSheets, weaponFormulaSheets } from './sheets'

describe('Nanoka 3.6 formula coverage', () => {
  it('classifies the complete pinned catalog', () => {
    expect(characterCatalog).toHaveLength(62)
    expect(weaponCatalog).toHaveLength(122)
    expect(sonataCatalog).toHaveLength(34)
    expect(echoCatalog).toHaveLength(181)
    expect(characterFormulaSheets).toHaveLength(characterCatalog.length)
    expect(weaponFormulaSheets).toHaveLength(weaponCatalog.length)
    expect(sonataFormulaSheets).toHaveLength(sonataCatalog.length)
    expect(echoFormulaSheets).toHaveLength(echoCatalog.length)
    expect(formulaSheets.every((sheet) => sheet.status === 'modeled' || sheet.status === 'noCombatEffect')).toBe(true)
    expect(getFormulaCoverage().complete).toBe(true)
  })

  it('evaluates every displayable character formula target to finite values', () => {
    const inputs = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`skillLevel:${index}`, 10]))
    const calculator = new FormulaCalculator({
      stats: { hp: 30000, atk: 2000, def: 1200, critRate: 75, critDamage: 250, healingBonus: 20, basicDamage: 40, heavyDamage: 40, skillDamage: 40, liberationDamage: 40, spectroDamage: 40, fusionDamage: 40, glacioDamage: 40, electroDamage: 40, aeroDamage: 40, havocDamage: 40 },
      inputs: { ...inputs, effectiveCritRate: 75, defenseMultiplier: 0.5, resistanceMultiplier: 0.9, damageReduction: 0, amplification: 0 }, entries: []
    })
    for (const sheet of characterFormulaSheets) for (const target of sheet.targets) {
      const normal = Number(calculator.evaluate(target.normal).value)
      const critical = Number(calculator.evaluate(target.critical).value)
      const expected = Number(calculator.evaluate(target.expected).value)
      expect(Number.isFinite(normal), `${sheet.name}: ${target.label} normal`).toBe(true)
      expect(Number.isFinite(critical), `${sheet.name}: ${target.label} critical`).toBe(true)
      expect(Number.isFinite(expected), `${sheet.name}: ${target.label} expected`).toBe(true)
      expect(Number.isInteger(normal), `${sheet.name}: ${target.label} normal floor`).toBe(true)
      expect(Number.isInteger(critical), `${sheet.name}: ${target.label} critical floor`).toBe(true)
      expect(Number.isInteger(expected), `${sheet.name}: ${target.label} expected floor`).toBe(true)
    }
  })
})
