import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScanCandidate } from '../domain/types'
import { ScanReviewCard } from './ScanReviewCard'

const candidate = (valid: boolean): ScanCandidate => ({
  id: 'candidate', createdAt: 1, imageDataUrl: '', fingerprint: 'x', source: 'manual',
  fields: {
    name: { value: valid ? 'Hooscamp' : 'Unknown Echo', confidence: .2 },
    cost: { value: 1, confidence: 1 }, rarity: { value: 5, confidence: 1 }, level: { value: 25, confidence: 1 },
    sonata: { value: valid ? 'Lingering Tunes' : 'Unknown Sonata', confidence: .2 },
    mainStat: { value: { key: 'atkPercent', value: 18 }, confidence: 1 }, subStats: [], equippedBy: { value: '', confidence: 0.25 },
    locked: { value: false, confidence: 1 }, excluded: { value: false, confidence: 1 }
  }
})

function Harness({ initial, onSave }: { initial: ScanCandidate; onSave: () => void }) {
  const [value, setValue] = useState(initial)
  return <ScanReviewCard candidate={value} onChange={setValue} onDiscard={() => undefined} onSave={onSave}/>
}

describe('scan review checkpoint', () => {
  it('blocks invalid OCR defaults from persistence', () => {
    render(<Harness initial={candidate(false)} onSave={vi.fn()}/>)
    expect(screen.getByRole('button', { name: 'Approve & save' })).toBeDisabled()
    expect(screen.getAllByText(/Enter the Echo name/).length).toBeGreaterThan(0)
  })

  it('allows corrected identity fields to pass review', () => {
    const onSave = vi.fn()
    render(<Harness initial={candidate(false)} onSave={onSave}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Name Unknown Echo' }))
    fireEvent.click(screen.getByRole('button', { name: /Hooscamp/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sonata/ }))
    fireEvent.click(screen.getByText('Lingering Tunes'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve & save' }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('renders a valid candidate as saveable', () => {
    render(<Harness initial={candidate(true)} onSave={vi.fn()}/>)
    expect(screen.getByRole('button', { name: 'Approve & save' })).toBeEnabled()
  })
})
