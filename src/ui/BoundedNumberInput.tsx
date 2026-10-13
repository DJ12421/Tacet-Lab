import { useEffect, useId, useState, type InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max' | 'onChange'> & {
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
}

export function BoundedNumberInput({ value, min, max, onChange, ...props }: Props) {
  const [draft, setDraft] = useState(String(value))
  const warningId = useId()
  useEffect(() => setDraft(String(value)), [value])
  const entered = draft.trim() === '' ? NaN : Number(draft)
  const warning = Number.isFinite(entered)
    ? min !== undefined && entered < min ? `Minimum: ${min} · not applied` : max !== undefined && entered > max ? `Maximum: ${max} · not applied` : ''
    : draft.trim() ? 'Enter a valid number' : ''

  return <><input {...props} className={[props.className, 'bounded-number-input'].filter(Boolean).join(' ')} type="number" min={min} max={max} value={draft} aria-invalid={Boolean(warning)} aria-describedby={[props['aria-describedby'], warning && warningId].filter(Boolean).join(' ') || undefined} onChange={(event) => {
    const next = event.target.value
    setDraft(next)
    const number = Number(next)
    if (next.trim() && Number.isFinite(number) && (min === undefined || number >= min) && (max === undefined || number <= max)) onChange(number)
  }}/>{warning && <small id={warningId} className="bounded-number-warning" role="alert">{warning}</small>}</>
}
