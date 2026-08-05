export type FormulaScalar = number | string | boolean

export interface FormulaTag {
  actor?: string
  source?: string
  target?: string
  ability?: string
  damageType?: string
  element?: string
  hit?: string
  variant?: string
  result?: string
  scope?: string
  [category: string]: string | undefined
}

export type FormulaNode =
  | { op: 'constant'; value: FormulaScalar; label?: string }
  | { op: 'input'; key: string; fallback?: FormulaScalar; label?: string }
  | { op: 'stat'; key: string; fallback?: number; label?: string }
  | { op: 'floor'; operand: FormulaNode; label?: string }
  | { op: 'sum' | 'prod' | 'min' | 'max'; operands: FormulaNode[]; label?: string }
  | { op: 'lookup'; key: FormulaNode; values: Record<string, FormulaNode>; fallback?: FormulaNode; label?: string }
  | { op: 'compare'; comparator: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le'; left: FormulaNode; right: FormulaNode; label?: string }
  | { op: 'if'; condition: FormulaNode; then: FormulaNode; else: FormulaNode; label?: string }
  | { op: 'query'; tag: FormulaTag; accumulator?: 'sum' | 'prod' | 'min' | 'max' | 'single'; label?: string }

export interface FormulaEntry {
  id: string
  tag: FormulaTag
  value: FormulaNode
  label?: string
  source?: string
}

export interface CalculationTrace {
  operation: FormulaNode['op'] | 'entry'
  label: string
  value: FormulaScalar
  children: CalculationTrace[]
  entryId?: string
  tag?: FormulaTag
}

export interface CalculationSnapshot {
  value: FormulaScalar
  trace: CalculationTrace
}

export interface FormulaRange {
  min: number
  max: number
  monotonic: boolean
}

export interface CalculationContext {
  stats: Record<string, number>
  inputs: Record<string, FormulaScalar>
  entries: FormulaEntry[]
}

const tagKey = (tag: FormulaTag) => Object.entries(tag).filter(([, value]) => value !== undefined)
  .sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}:${value}`).join('|')

function mergeTag(base: FormulaTag, override: FormulaTag): FormulaTag {
  return { ...base, ...Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined)) }
}

function tagMatches(entry: FormulaTag, query: FormulaTag) {
  return Object.entries(entry).every(([key, value]) => value === undefined || query[key] === value)
}

function numeric(value: FormulaScalar, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} did not evaluate to a finite number.`)
  return value
}

function compare(left: FormulaScalar, right: FormulaScalar, comparator: Extract<FormulaNode, { op: 'compare' }>['comparator']) {
  if (comparator === 'eq') return left === right
  if (comparator === 'ne') return left !== right
  if (typeof left !== 'number' || typeof right !== 'number') throw new Error(`${comparator} requires numeric operands.`)
  if (comparator === 'gt') return left > right
  if (comparator === 'ge') return left >= right
  if (comparator === 'lt') return left < right
  return left <= right
}

function accumulate(values: number[], accumulator: NonNullable<Extract<FormulaNode, { op: 'query' }>['accumulator']>) {
  if (accumulator === 'single') {
    if (values.length !== 1) throw new Error(`Expected one formula entry, received ${values.length}.`)
    return values[0]
  }
  if (!values.length) return accumulator === 'prod' ? 1 : 0
  if (accumulator === 'sum') return values.reduce((total, value) => total + value, 0)
  if (accumulator === 'prod') return values.reduce((total, value) => total * value, 1)
  if (accumulator === 'min') return Math.min(...values)
  return Math.max(...values)
}

export class FormulaCalculator {
  private readonly memo = new Map<string, CalculationSnapshot>()
  private readonly active = new Set<string>()

  constructor(private readonly context: CalculationContext) {}

  evaluate(node: FormulaNode, tag: FormulaTag = {}): CalculationSnapshot {
    return this.compute(node, tag)
  }

  query(tag: FormulaTag, accumulator: Extract<FormulaNode, { op: 'query' }>['accumulator'] = 'sum') {
    return this.compute({ op: 'query', tag, accumulator }, tag)
  }

  private compute(node: FormulaNode, currentTag: FormulaTag): CalculationSnapshot {
    const child = (value: FormulaNode, tag = currentTag) => this.compute(value, tag)
    const finish = (value: FormulaScalar, children: CalculationTrace[] = []): CalculationSnapshot => ({
      value,
      trace: { operation: node.op, label: node.label ?? node.op, value, children, tag: currentTag }
    })
    if (node.op === 'constant') return finish(node.value)
    if (node.op === 'input') return finish(this.context.inputs[node.key] ?? node.fallback ?? 0)
    if (node.op === 'stat') return finish(this.context.stats[node.key] ?? node.fallback ?? 0)
    if (node.op === 'floor') {
      const snapshot = child(node.operand)
      return finish(Math.floor(numeric(snapshot.value, node.label ?? node.op) + 1e-9), [snapshot.trace])
    }
    if (node.op === 'sum' || node.op === 'prod' || node.op === 'min' || node.op === 'max') {
      const snapshots = node.operands.map((operand) => child(operand))
      const values = snapshots.map((snapshot) => numeric(snapshot.value, node.label ?? node.op))
      return finish(accumulate(values, node.op), snapshots.map((snapshot) => snapshot.trace))
    }
    if (node.op === 'lookup') {
      const key = child(node.key)
      const branch = node.values[String(key.value)] ?? node.fallback
      if (!branch) throw new Error(`No lookup branch exists for ${String(key.value)}.`)
      const selected = child(branch)
      return finish(selected.value, [key.trace, selected.trace])
    }
    if (node.op === 'compare') {
      const left = child(node.left), right = child(node.right)
      return finish(compare(left.value, right.value, node.comparator), [left.trace, right.trace])
    }
    if (node.op === 'if') {
      const condition = child(node.condition)
      const selected = child(condition.value ? node.then : node.else)
      return finish(selected.value, [condition.trace, selected.trace])
    }
    const queryNode = node as Extract<FormulaNode, { op: 'query' }>
    const queryTag = mergeTag(currentTag, queryNode.tag)
    const memoKey = `${tagKey(queryTag)}#${queryNode.accumulator ?? 'sum'}`
    const cached = this.memo.get(memoKey)
    if (cached) return cached
    if (this.active.has(memoKey)) throw new Error(`Formula query cycle detected at ${memoKey}.`)
    this.active.add(memoKey)
    try {
      const matches = this.context.entries.filter((entry) => tagMatches(entry.tag, queryTag))
      const snapshots = matches.map((entry) => {
        const snapshot = this.compute(entry.value, queryTag)
        return {
          value: numeric(snapshot.value, entry.label ?? entry.id),
          trace: { ...snapshot.trace, operation: 'entry' as const, label: entry.label ?? entry.id, entryId: entry.id, tag: entry.tag }
        }
      })
      const value = accumulate(snapshots.map((snapshot) => snapshot.value), queryNode.accumulator ?? 'sum')
      const result = finish(value, snapshots.map((snapshot) => snapshot.trace))
      this.memo.set(memoKey, result)
      return result
    } finally {
      this.active.delete(memoKey)
    }
  }
}

/** Evaluate a formula without constructing the user-facing trace tree. */
export function evaluateFormulaValue(node: FormulaNode, context: CalculationContext, initialTag: FormulaTag = {}): FormulaScalar {
  const memo = new Map<string, FormulaScalar>()
  const active = new Set<string>()
  const compute = (current: FormulaNode, currentTag: FormulaTag): FormulaScalar => {
    if (current.op === 'constant') return current.value
    if (current.op === 'input') return context.inputs[current.key] ?? current.fallback ?? 0
    if (current.op === 'stat') return context.stats[current.key] ?? current.fallback ?? 0
    if (current.op === 'floor') return Math.floor(numeric(compute(current.operand, currentTag), current.label ?? current.op) + 1e-9)
    if (current.op === 'sum' || current.op === 'prod' || current.op === 'min' || current.op === 'max') {
      return accumulate(current.operands.map((operand) => numeric(compute(operand, currentTag), current.label ?? current.op)), current.op)
    }
    if (current.op === 'lookup') {
      const key = compute(current.key, currentTag)
      const branch = current.values[String(key)] ?? current.fallback
      if (!branch) throw new Error(`No lookup branch exists for ${String(key)}.`)
      return compute(branch, currentTag)
    }
    if (current.op === 'compare') return compare(compute(current.left, currentTag), compute(current.right, currentTag), current.comparator)
    if (current.op === 'if') return compute(compute(current.condition, currentTag) ? current.then : current.else, currentTag)
    if (current.op !== 'query') throw new Error(`Unsupported formula operation: ${current.op}`)
    const queryTag = mergeTag(currentTag, current.tag)
    const memoKey = `${tagKey(queryTag)}#${current.accumulator ?? 'sum'}`
    const cached = memo.get(memoKey)
    if (cached !== undefined) return cached
    if (active.has(memoKey)) throw new Error(`Formula query cycle detected at ${memoKey}.`)
    active.add(memoKey)
    try {
      const values = context.entries
        .filter((entry) => tagMatches(entry.tag, queryTag))
        .map((entry) => numeric(compute(entry.value, queryTag), entry.label ?? entry.id))
      const value = accumulate(values, current.accumulator ?? 'sum')
      memo.set(memoKey, value)
      return value
    } finally {
      active.delete(memoKey)
    }
  }
  return compute(node, initialTag)
}

export function estimateFormulaRange(
  node: FormulaNode,
  context: CalculationContext,
  inputRanges: Record<string, FormulaRange> = {},
  statRanges: Record<string, FormulaRange> = {}
): FormulaRange {
  const exact = (value: number): FormulaRange => ({ min: value, max: value, monotonic: true })
  if (node.op === 'constant') return typeof node.value === 'number' ? exact(node.value) : { min: -Infinity, max: Infinity, monotonic: false }
  if (node.op === 'stat') return statRanges[node.key] ?? exact(context.stats[node.key] ?? node.fallback ?? 0)
  if (node.op === 'floor') {
    const range = estimateFormulaRange(node.operand, context, inputRanges, statRanges)
    return { min: Math.floor(range.min + 1e-9), max: Math.floor(range.max + 1e-9), monotonic: range.monotonic }
  }
  if (node.op === 'input') {
    const value = context.inputs[node.key] ?? node.fallback ?? 0
    return inputRanges[node.key] ?? (typeof value === 'number' ? exact(value) : { min: -Infinity, max: Infinity, monotonic: false })
  }
  if (node.op === 'sum') {
    const ranges = node.operands.map((operand) => estimateFormulaRange(operand, context, inputRanges, statRanges))
    return { min: ranges.reduce((sum, range) => sum + range.min, 0), max: ranges.reduce((sum, range) => sum + range.max, 0), monotonic: ranges.every((range) => range.monotonic) }
  }
  if (node.op === 'prod') {
    const ranges = node.operands.map((operand) => estimateFormulaRange(operand, context, inputRanges, statRanges))
    let result = exact(1)
    for (const range of ranges) {
      const values = [result.min * range.min, result.min * range.max, result.max * range.min, result.max * range.max]
      result = { min: Math.min(...values), max: Math.max(...values), monotonic: result.monotonic && range.monotonic && range.min >= 0 }
    }
    return result
  }
  if (node.op === 'min' || node.op === 'max') {
    const ranges = node.operands.map((operand) => estimateFormulaRange(operand, context, inputRanges, statRanges))
    const select = node.op === 'min' ? Math.min : Math.max
    return { min: select(...ranges.map((range) => range.min)), max: select(...ranges.map((range) => range.max)), monotonic: ranges.every((range) => range.monotonic) }
  }
  // Unsupported control-flow/query nodes cannot be evaluated at one endpoint
  // when ranged stats are present: that could underestimate another branch.
  if (Object.keys(statRanges).length) return { min: -Infinity, max: Infinity, monotonic: false }
  try {
    const value = new FormulaCalculator(context).evaluate(node).value
    return typeof value === 'number' ? exact(value) : { min: -Infinity, max: Infinity, monotonic: false }
  } catch {
    return { min: -Infinity, max: Infinity, monotonic: false }
  }
}

export const formula = {
  constant: (value: FormulaScalar, label?: string): FormulaNode => ({ op: 'constant', value, label }),
  input: (key: string, fallback: FormulaScalar = 0, label?: string): FormulaNode => ({ op: 'input', key, fallback, label }),
  stat: (key: string, fallback = 0, label?: string): FormulaNode => ({ op: 'stat', key, fallback, label }),
  floor: (operand: FormulaNode, label?: string): FormulaNode => ({ op: 'floor', operand, label }),
  sum: (...operands: FormulaNode[]): FormulaNode => ({ op: 'sum', operands }),
  prod: (...operands: FormulaNode[]): FormulaNode => ({ op: 'prod', operands }),
  min: (...operands: FormulaNode[]): FormulaNode => ({ op: 'min', operands }),
  max: (...operands: FormulaNode[]): FormulaNode => ({ op: 'max', operands }),
  query: (tag: FormulaTag, accumulator: Extract<FormulaNode, { op: 'query' }>['accumulator'] = 'sum'): FormulaNode => ({ op: 'query', tag, accumulator }),
  percent: (node: FormulaNode): FormulaNode => ({ op: 'prod', operands: [node, { op: 'constant', value: 0.01 }] })
}
