import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { CalculationTrace } from '../domain/calculation'
import './calculation-details.css'

export interface CalculationDetailRow {
  label: string
  value: string
  children?: CalculationDetailRow[]
}

export interface CalculationDetail {
  title: string
  value: string
  formula?: string
  equationOperator?: '+' | '×' | '÷'
  note?: string
  rows: CalculationDetailRow[]
}

function compactDetailRows(rows: CalculationDetailRow[]) {
  const generic = /^(prod|sum|min|max|floor|stat|input|constant|lookup|query|if|compare)$/i
  const result: CalculationDetailRow[] = []
  const visit = (row: CalculationDetailRow) => {
    if (!generic.test(row.label.trim())) result.push(row)
    else row.children?.forEach(visit)
  }
  rows.forEach(visit)
  return result
    .filter((row, index) => result.findIndex((candidate) => candidate.label === row.label && candidate.value === row.value) === index)
    .slice(0, 12)
}

export function traceCalculationDetail(trace: CalculationTrace, title = trace.label): CalculationDetail {
  const traceValue = (node: CalculationTrace) => {
    if (typeof node.value !== 'number') return String(node.value)
    const value = node.value.toLocaleString('en-US', { maximumFractionDigits: 3 })
    if (/\bbonus\b/i.test(node.label) && !/\bmultiplier\b/i.test(node.label)) return `(100% + ${value}%)`
    if (/\b(?:multiplier|factor|motion value)\b/i.test(node.label) && Math.abs(node.value) <= 10) {
      return `${(node.value * 100).toLocaleString('en-US', { maximumFractionDigits: 3 })}%`
    }
    if (/\b(?:rate|regen|ignore|reduction)\b/i.test(node.label) && !/%$/.test(value)) return `${value}%`
    return value
  }
  const row = (node: CalculationTrace): CalculationDetailRow => ({
    label: node.label,
    value: traceValue(node),
    children: node.children.map(row)
  })
  const equationOperator = trace.operation === 'sum' ? '+' : trace.operation === 'prod' ? '×' : undefined
  const resultValue = typeof trace.value === 'number'
    ? Math.floor(trace.value + 1e-9).toLocaleString('en-US')
    : String(trace.value)
  return { title, value: resultValue, formula: 'Declarative formula trace', equationOperator, rows: [row(trace)] }
}

function CalculationEquation({ detail }: { detail: CalculationDetail }) {
  const rows = compactDetailRows(detail.rows)
  const operator = detail.equationOperator ?? (detail.formula?.includes('÷') ? '÷' : detail.formula?.toLowerCase().includes('sum') ? '+' : '×')
  return <div className="calculation-equation">
    {detail.formula && <div className="calculation-formula"><span>Formula</span><code>{detail.formula}</code></div>}
    {rows.length ? <div className="calculation-terms">{rows.map((row, index) => <span className="calculation-term" key={`${row.label}-${index}`}>
      {index > 0 && <i>{operator}</i>}
      <em>{row.label}</em>
      <b>{row.value}</b>
    </span>)}</div> : <span className="calculation-formula-text">{detail.formula ?? detail.value}</span>}
  </div>
}

function CalculationDialog({ detail, onClose }: { detail: CalculationDetail; onClose: () => void }) {
  return createPortal(<div className="calculation-backdrop" role="presentation" onMouseDown={onClose}>
    <article className="calculation-box" role="dialog" aria-modal="true" aria-label={`${detail.title} calculation`} onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><small>Calculation breakdown</small><span>{detail.title}</span></div>
        <strong>{detail.value}</strong>
        <button type="button" onClick={onClose} aria-label="Close calculation">×</button>
      </header>
      <CalculationEquation detail={detail}/>
      {detail.note && <p>{detail.note}</p>}
    </article>
  </div>, document.body)
}

export function CalculatedValue({ children, detail, className = '', ariaLabel, presentation = 'dialog', tooltipValues }: { children: ReactNode; detail: CalculationDetail; className?: string; ariaLabel?: string; presentation?: 'dialog' | 'tooltip'; tooltipValues?: Array<string | number> }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])
  if (presentation === 'tooltip') {
    const rows = compactDetailRows(detail.rows)
    return <>
      <span className="calculation-tooltip-anchor">
        <button type="button" className={`calculated-value ${className}`} onClick={() => setOpen(true)} aria-label={ariaLabel ?? `Show calculation for ${detail.title}`}>{children}</button>
        <span className="calculation-tooltip" role="tooltip">
          {!tooltipValues?.length && <strong>{detail.title}</strong>}
          <span className={`calculation-tooltip-expression ${tooltipValues?.length ? 'damage-split' : ''}`}>{tooltipValues?.length
            ? tooltipValues.map((value, index) => <span key={`${value}-${index}`}><b>{value}</b></span>)
            : rows.length
              ? rows.map((row, index) => <span key={`${row.label}-${index}`}><b>{row.label}</b> {row.value}</span>)
              : <span>{detail.formula ?? 'Calculated formula'}: {detail.value}</span>}</span>
        </span>
      </span>
      {open && <CalculationDialog detail={detail} onClose={() => setOpen(false)}/>}
    </>
  }
  return <>
    <button type="button" className={`calculated-value ${className}`} onClick={() => setOpen(true)} aria-label={ariaLabel ?? `Show calculation for ${detail.title}`}>{children}</button>
    {open && <CalculationDialog detail={detail} onClose={() => setOpen(false)}/>}
  </>
}
