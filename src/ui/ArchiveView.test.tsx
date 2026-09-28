import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArchiveView } from './ArchiveView'

vi.mock('../storage/database', () => ({ getSettings: vi.fn().mockResolvedValue({}) }))

describe('ArchiveView details', () => {
  it.each([
    ['characters', 'Yangyang: Xuanling', /Deals powerful Heavy Attack DMG/],
    ['weapons', 'Abyss Surges', /Gauntlets pulsate with an uncontrollable force/],
    ['echoes', 'Abyssal Gladius', /268.20% Glacio DMG/]
  ] as const)('opens local details for %s cards', (tab, name, detailText) => {
    render(<ArchiveView roverGender="male" tab={tab} onTabChange={vi.fn()}/>)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))

    expect(screen.getByRole('dialog', { name })).toBeInTheDocument()
    expect(screen.getByText(detailText)).toBeInTheDocument()
    if (tab === 'characters') {
      const roles = screen.getByText('Roles').closest('div')
      expect(roles?.querySelectorAll('.archive-role-chip')).toHaveLength(4)
      expect(screen.getByRole('heading', { name: 'Skill Input' })).toBeInTheDocument()
      expect(screen.getByText('Features')).toBeInTheDocument()
      expect(screen.getAllByText('Instructions').length).toBeGreaterThan(0)
      expect(screen.getByRole('heading', { name: 'Forte Gauge' })).toBeInTheDocument()
      expect(screen.getByText(/Consume Melody to cast Normal Attacks/)).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Base stats' })).not.toBeInTheDocument()
    }
    if (tab === 'weapons') {
      const rank = screen.getByRole('slider', { name: 'Weapon rank' })
      expect(rank).toHaveAttribute('min', '1')
      expect(rank).toHaveAttribute('max', '5')
      fireEvent.change(rank, { target: { value: '5' } })
      expect(screen.getByText('Current: R5')).toBeInTheDocument()
      const passive = screen.getByRole('dialog', { name }).querySelector('.archive-weapon-passive')
      expect([...passive!.querySelectorAll('mark.archive-refinement-value')].map((value) => value.textContent)).toEqual(['25.6%', '20%', '20%'])
      expect(passive).toHaveTextContent('lasting for 8s')
    }
    if (tab === 'echoes') {
      const dialog = screen.getByRole('dialog', { name })
      expect(within(dialog).getByText('Sonatas')).toBeInTheDocument()
      expect(within(dialog).getByText('Freezing Frost').closest('span')).toHaveClass('archive-sonata-chip')
      expect(within(dialog).getByRole('heading', { name: 'Skill' })).toBeInTheDocument()
      expect(within(dialog).getByText('Max rank')).toBeInTheDocument()
      expect(within(dialog).queryByText('Available rarities')).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('link', { name: new RegExp(name) })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument()
  })
})
