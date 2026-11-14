import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { generatedCharacterCatalog } from '../game-data/characters.generated'
import { ArchiveView } from './ArchiveView'

vi.mock('../storage/database', () => ({ getSettings: async () => ({}) }))

describe('character archive roles', () => {
  it('filters by either selected role and resets to all characters', () => {
    const { container } = render(<ArchiveView roverGender="male" tab="characters" onTabChange={vi.fn()}/>)
    const allCharacters = container.querySelectorAll('.archive-character-card').length
    fireEvent.click(screen.getByRole('button', { name: 'Filter characters by roles' }))
    const menu = within(screen.getByLabelText('Character role options'))
    expect(menu.getAllByRole('button').slice(0, 4).map((button) => button.querySelector('b')?.textContent)).toEqual(['All roles', 'Main Damage Dealer', 'Support and Healer', 'Concerto Efficiency'])
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search roles' }), { target: { value: 'glacio' } })
    expect(menu.getAllByRole('button').every((button) => button.textContent?.toLowerCase().includes('glacio'))).toBe(true)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search roles' }), { target: { value: '' } })
    fireEvent.click(menu.getByRole('button', { name: 'Main Damage Dealer' }))
    const mainDamageDealers = container.querySelectorAll('.archive-character-card').length
    expect(mainDamageDealers).toBeGreaterThan(0)
    fireEvent.click(menu.getByRole('button', { name: 'Support and Healer' }))
    const cards = [...container.querySelectorAll('.archive-character-card')]
    expect(cards.length).toBeGreaterThanOrEqual(mainDamageDealers)
    expect(cards.every((card) => generatedCharacterCatalog.some((item) => item.name === card.querySelector('h2')?.textContent && item.roles.some((role) => role === 'Main Damage Dealer' || role === 'Support and Healer')))).toBe(true)
    expect(menu.getByRole('button', { name: 'Main Damage Dealer' })).toHaveAttribute('aria-pressed', 'true')
    expect(menu.getByRole('button', { name: 'Support and Healer' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(menu.getByRole('button', { name: 'All roles' }))
    expect(container.querySelectorAll('.archive-character-card')).toHaveLength(allCharacters)
  })
})
