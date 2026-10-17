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

  it('shows the selected build-card fields and keeps the other sections available', () => {
    const buildCard = {
      ...candidate(true),
      buildCard: {
        id: 'card', character: { value: 'Jinhsi', confidence: 1 }, characterLevel: { value: 90, confidence: 1 },
        sequence: { value: 1, confidence: 1 }, skillLevels: Array.from({ length: 5 }, () => ({ value: 10, confidence: 1 })),
        weapon: { value: 'Ages of Harvest', confidence: 1 }, weaponLevel: { value: 90, confidence: 1 },
        weaponRank: { value: 2, confidence: 1 }, sourceImageDataUrl: 'data:image/png;base64,abc'
      }
    }
    const onReviewSectionChange = vi.fn()
    const view = render(<ScanReviewCard candidate={buildCard} reviewSection="character" onReviewSectionChange={onReviewSectionChange} onChange={vi.fn()} onDiscard={vi.fn()} onSave={vi.fn()}/>)
    expect(screen.getByText('Character level')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.queryByText('Weapon rank')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Weapon', pressed: false }))
    expect(onReviewSectionChange).toHaveBeenCalledWith('weapon')
    view.rerender(<ScanReviewCard candidate={buildCard} reviewSection="weapon" onReviewSectionChange={onReviewSectionChange} onChange={vi.fn()} onDiscard={vi.fn()} onSave={vi.fn()}/>)
    expect(screen.getByText('Weapon rank')).toBeInTheDocument()
    expect(screen.queryByText('Character level')).not.toBeInTheDocument()
    expect(screen.queryByText('Skills')).not.toBeInTheDocument()
  })

  it('shows the Echo name crop in build-card field evidence', () => {
    const buildCard = {
      ...candidate(true),
      buildCard: {
        id: 'card', character: { value: 'Jinhsi', confidence: 1 }, characterLevel: { value: 90, confidence: 1 },
        sequence: { value: 0, confidence: 1 }, skillLevels: Array.from({ length: 5 }, () => ({ value: 10, confidence: 1 })),
        weapon: { value: 'Ages of Harvest', confidence: 1 }, weaponLevel: { value: 90, confidence: 1 },
        weaponRank: { value: 1, confidence: 1 }, sourceImageDataUrl: 'data:image/png;base64,abc'
      },
      evidence: {
        'echo-0-art': {
          region: { id: 'echo-0-art', kind: 'name' as const, label: 'Echo 1 art', rect: { x: .27, y: .6, width: .1, height: .1 }, recognition: 'visual' as const },
          originalCrop: 'data:image/png;base64,abc', processedCrop: 'data:image/png;base64,abc', rawOcr: '',
          confidence: .9, parsedValue: 'Hooscamp', validation: { valid: true, messages: [] },
          workerId: 'visual-classifier', jobId: 'art', processingMs: 0, preprocessing: 'visual'
        },
        'echo-0-name': {
          region: { id: 'echo-0-name', kind: 'name' as const, label: 'WuWaFlex Echo 1 name', rect: { x: .27, y: .6, width: .14, height: .03 }, recognition: 'text' as const },
          originalCrop: 'data:image/png;base64,abc', processedCrop: 'data:image/png;base64,abc', rawOcr: 'Hooscamp',
          confidence: .9, parsedValue: 'Hooscamp', validation: { valid: true, messages: [] },
          workerId: 'ocr-1', jobId: 'name', processingMs: 1, preprocessing: 'name'
        },
        'echo-0-sonata': {
          region: { id: 'echo-0-sonata', kind: 'sonata' as const, label: 'Echo 1 Sonata', rect: { x: .8, y: .6, width: .03, height: .04 }, recognition: 'visual' as const },
          originalCrop: 'data:image/png;base64,abc', processedCrop: 'data:image/png;base64,abc', rawOcr: '',
          confidence: .9, parsedValue: 'Sierra Gale', validation: { valid: true, messages: [] },
          workerId: 'visual-classifier', jobId: 'sonata', processingMs: 0, preprocessing: 'visual'
        }
      }
    }
    render(<ScanReviewCard candidate={buildCard} onChange={vi.fn()} onDiscard={vi.fn()} onSave={vi.fn()}/> )
    fireEvent.click(screen.getByRole('button', { name: 'Show field evidence' }))
    expect(screen.getByText('WuWaFlex Echo 1 name')).toBeInTheDocument()
    expect(screen.getByAltText('WuWaFlex Echo 1 name original crop')).toBeInTheDocument()
    expect(screen.getByText('Echo 1 art').closest('article')?.querySelector('code')).toHaveTextContent('Hooscamp')
    expect(screen.getByText('Echo 1 Sonata').closest('article')?.querySelector('code')).toHaveTextContent('Sierra Gale')
  })
})
