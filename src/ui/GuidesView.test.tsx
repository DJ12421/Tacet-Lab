import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuidesView } from './GuidesView'
import { LiveTutorial } from './LiveTutorial'
import { guideFor, guides, stepsFor, type GuideCounts } from './guide-content'

const empty: GuideCounts = { echoes: 0, weapons: 0, characters: 0, teams: 0 }
const owned: GuideCounts = { echoes: 2, weapons: 1, characters: 1, teams: 1 }

describe('guides', () => {
  it('branches on first visits and owned Echoes', () => {
    const echoGuide = guideFor('echoes')!
    expect(stepsFor(echoGuide, empty, true).map((step) => step.title)).toContain('Add your first Echo')
    expect(stepsFor(echoGuide, owned, false).map((step) => step.title)).toContain('Find an owned Echo')
    expect(stepsFor(echoGuide, owned, false).map((step) => step.title)).not.toContain('Add your first Echo')
    expect(stepsFor(guideFor('weapons')!, owned, false).map((step) => step.title)).not.toContain('Select the owned copy')
    expect(stepsFor(guideFor('characters')!, owned, false).map((step) => step.title)).toContain('Open an existing character')
    expect(stepsFor(guideFor('archive')!, empty, true)[0].title).toBe('Pick a category')
    expect(stepsFor(guideFor('archive')!, empty, false)[0].title).toBe('Switch categories')
    expect(stepsFor(guideFor('theorizer')!, empty, true).map((step) => step.title)).toContain('Create a team workspace')
    expect(stepsFor(guideFor('rotation')!, owned, false).map((step) => step.title)).toContain('Select a filled member')
    expect(guides.map((guide) => guide.id)).not.toContain('partnerships')
    expect(guides.map((guide) => guide.id)).not.toContain('settings')
  })

  it('shows the documents and screenshots', () => {
    const onSelect = vi.fn()
    const onStart = vi.fn()
    const { rerender } = render(<GuidesView counts={empty} isFirstVisit={() => true} onSelect={onSelect} onStart={onStart}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Read document' }))
    expect(onSelect).toHaveBeenCalledWith('privacy')
    rerender(<GuidesView document="scanner" counts={empty} isFirstVisit={() => true} onSelect={onSelect} onStart={onStart}/>)
    expect(screen.getAllByRole('img', { name: /^Tacet Lab example for/ })).toHaveLength(5)
    fireEvent.click(screen.getAllByRole('button', { name: 'Start live tutorial' })[0])
    expect(onStart).toHaveBeenCalledWith('scanner')
  })

  it('does not advance before the real action', () => {
    const onClose = vi.fn()
    const { container } = render(<><div className="home-hero-character-control"><div className="home-hero-character-menu"><button type="button" role="option" aria-selected="false">Hero option</button></div></div><LiveTutorial id="dashboard" counts={empty} firstVisit onClose={onClose}/></>)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    fireEvent.click(container.querySelector('.home-hero-character-menu button')!)
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
