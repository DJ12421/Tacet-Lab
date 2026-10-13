import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoundedNumberInput } from './BoundedNumberInput'

describe('BoundedNumberInput', () => {
  it('keeps an out-of-range entry visible without applying it', () => {
    const onChange = vi.fn()
    render(<BoundedNumberInput aria-label="Level" min={1} max={90} value={50} onChange={onChange}/>)
    const input = screen.getByRole('spinbutton', { name: 'Level' })

    fireEvent.change(input, { target: { value: '91' } })
    expect(input).toHaveValue(91)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Maximum: 90')
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '0' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Minimum: 1')
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '75' } })
    expect(onChange).toHaveBeenCalledWith(75)
  })
})
