import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Build, OwnedCharacter, OwnedWeapon } from '../domain/types'
import { characterCatalog, weaponCatalog } from '../game-data'
import { WeaponInventoryCard, weaponBuildLabels } from './WeaponInventoryCard'

describe('WeaponInventoryCard', () => {
  it('labels each weapon copy with its numbered saved build', () => {
    const catalog = characterCatalog[0]
    const character: OwnedCharacter = { id: 'character-1', catalogId: catalog.id, level: 90, sequence: 0, locked: false, createdAt: 1 }
    const builds: Build[] = ['old', 'current'].map((weaponId, index) => ({
      id: `build-${index + 1}`, name: `Build ${index + 1}`, characterId: character.id,
      resonatorId: catalog.id, weaponId, echoIds: [], level: 90, skillLevel: 10
    }))

    const labels = weaponBuildLabels(builds, [character])

    expect(labels.get('old')).toEqual([`${catalog.name} · Build 1`])
    expect(labels.get('current')).toEqual([`${catalog.name} · Build 2`])
  })

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
