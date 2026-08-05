import { describe, expect, it } from 'vitest'
import { FormulaCalculator, estimateFormulaRange, evaluateFormulaValue, formula, type CalculationContext } from './engine'

describe('declarative formula engine', () => {
  const context: CalculationContext = {
    stats: { atk: 1000, critRate: 50 },
    inputs: { stacks: 3, enabled: true, branch: 'high' },
    entries: [
      { id: 'base', tag: { actor: 'self', scope: 'bonus' }, value: formula.constant(10), label: 'Base bonus' },
      { id: 'skill', tag: { actor: 'self', scope: 'bonus', ability: 'skill' }, value: formula.prod(formula.input('stacks'), formula.constant(5)), label: 'Skill stacks' }
    ]
  }

  it('evaluates arithmetic, lookup, branches, stats, and tagged accumulation with traces', () => {
    const calculator = new FormulaCalculator(context)
    const node = formula.sum(
      formula.stat('atk'),
      formula.query({ actor: 'self', scope: 'bonus', ability: 'skill' }),
      { op: 'if', condition: formula.input('enabled'), then: { op: 'lookup', key: formula.input('branch'), values: { high: formula.constant(20) } }, else: formula.constant(999) }
    )
    const result = calculator.evaluate(node)
    expect(result.value).toBe(1045)
    expect(result.trace.children).toHaveLength(3)
  })

  it('short-circuits unselected branches and rejects cyclic queries', () => {
    const calculator = new FormulaCalculator({ ...context, entries: [{ id: 'cycle', tag: { scope: 'cycle' }, value: formula.query({ scope: 'cycle' }) }] })
    expect(calculator.evaluate({ op: 'if', condition: formula.constant(false), then: formula.query({ scope: 'cycle' }), else: formula.constant(7) }).value).toBe(7)
    expect(() => calculator.query({ scope: 'cycle' })).toThrow(/cycle/i)
  })

  it('computes conservative ranges and monotonicity for arithmetic nodes', () => {
    const range = estimateFormulaRange(formula.prod(formula.sum(formula.input('x'), formula.constant(2)), formula.constant(3)), context, { x: { min: 1, max: 4, monotonic: true } })
    expect(range).toEqual({ min: 9, max: 18, monotonic: true })
  })

  it('floors formula results and preserves the unrounded child trace', () => {
    const result = new FormulaCalculator(context).evaluate(formula.floor(formula.prod(formula.constant(10.9), formula.constant(1.5)), 'Damage'))
    expect(result.value).toBe(16)
    expect(result.trace.children[0].value).toBeCloseTo(16.35)
  })

  it('matches traced evaluation in the compact optimizer path', () => {
    const node = formula.sum(
      formula.stat('atk'),
      formula.query({ actor: 'self', scope: 'bonus', ability: 'skill' }),
      { op: 'if', condition: formula.input('enabled'), then: formula.constant(20), else: formula.constant(0) }
    )
    expect(evaluateFormulaValue(node, context)).toBe(new FormulaCalculator(context).evaluate(node).value)
  })
})
