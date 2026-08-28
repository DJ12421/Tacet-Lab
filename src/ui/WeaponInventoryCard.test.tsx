import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OwnedWeapon } from '../domain/types'
import { weaponCatalog } from '../game-data'
import { WeaponInventoryCard } from './WeaponInventoryCard'

describe('WeaponInventoryCard', () => {
  it('renders the Weapons-tab card structure and current weapon stats', () => {
    const catalog = weaponCatalog[0]
    const weapon: OwnedWeapon = { id: 'weapon-1', catalogId: catalog.id, level: 90, rank: 3, locked: false, createdAt: 1 }
    const onClick = vi.fn()
    const { container } = render(<WeaponInventoryCard weapon={weapon} catalog={catalog} onClick={onClick} footer={<span>Equipped owner</span>}/>)

    expect(container.querySelector('.wv-card.rarity-5, .wv-card.rarity-4, .wv-card.rarity-3, .wv-card.rarity-2, .wv-card.rarity-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Open ${catalog.name}` })).toBeInTheDocument()
    expect(screen.getByText(`Lv. ${weapon.level}`)).toBeInTheDocument()
    expect(screen.getByText(`R${weapon.rank}`)).toBeInTheDocument()
    expect(screen.getByText('Equipped owner')).toBeInTheDocument()
    expect(container.querySelector('.wv-card-stats')).toHaveTextContent('ATK')
    expect(container.querySelector('.wv-card-stats')).toHaveTextContent(catalog.secondaryStat)
  })
})
