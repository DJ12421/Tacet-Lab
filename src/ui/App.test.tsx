import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../storage/database'
import { characterCatalog, weaponCatalog } from '../game-data'
import App from './App'

describe('application shell', () => {
  beforeEach(async () => {
    vi.stubGlobal('scrollTo', vi.fn())
    window.history.replaceState({}, '', '/home')
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => { vi.unstubAllGlobals(); db.close() })

  it('opens the local archive and navigates core workflows', async () => {
    render(<App/>)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/WUTHERING WAVES.*OPTIMIZER/)
    const navigation = within(screen.getByRole('complementary', { name: 'Primary navigation' }).querySelector('.desktop-nav') as HTMLElement)
    fireEvent.click(navigation.getByRole('button', { name: /^Echoes$/ }))
    expect(await screen.findByText('Your Echoes', {}, { timeout: 5_000 })).toBeInTheDocument()
    fireEvent.click(navigation.getByRole('button', { name: /Scanner/ }))
    expect(await screen.findByText('Scan Echoes. Skip the typing.', {}, { timeout: 5_000 })).toBeInTheDocument()
  }, 15_000)

  it('warns before leaving a scanner session with unsaved Echo data', async () => {
    render(<App/>)
    await screen.findByRole('heading', { level: 1 })
    const navigation = within(screen.getByRole('complementary', { name: 'Primary navigation' }).querySelector('.desktop-nav') as HTMLElement)
    fireEvent.click(navigation.getByRole('button', { name: /Scanner/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Enter manually/i }, { timeout: 5_000 }))
    expect(await screen.findByRole('heading', { name: /^Review your scans 1$/i })).toBeInTheDocument()

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(navigation.getByRole('button', { name: /^Echoes$/ }))
    expect(screen.getByText('Scan Echoes. Skip the typing.')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledWith('Leave the scanner? Screen sharing will stop and scanned Echo data that has not been saved will be lost.')

    confirm.mockReturnValue(true)
    fireEvent.click(navigation.getByRole('button', { name: /^Echoes$/ }))
    expect(await screen.findByText('Your Echoes')).toBeInTheDocument()
  }, 15_000)

  it('opens the v2 team layout and can return to the original URL', async () => {
    await db.teams.add({ id: 'sample-team', name: 'Team 1', members: [], buildIds: [], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 25, actions: [], buffs: [] })
    window.history.replaceState({}, '', '/teams/v2/team_1')

    render(<App/>)
    const switchLayout = await screen.findByRole('button', { name: 'Use original layout' }, { timeout: 5_000 })
    expect(document.querySelector('.team-workspace-v2')).toBeInTheDocument()
    const sections = screen.getByRole('navigation', { name: 'Character sections' })
    expect(within(sections).getAllByRole('button')).toHaveLength(4)
    expect(within(sections).getByRole('button', { name: 'DMG Numbers' })).toBeDisabled()
    fireEvent.click(switchLayout)
    expect(window.location.pathname).toBe('/teams/team_1')
    expect(document.querySelector('.team-workspace-v2')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try v2 layout' }))
    expect(window.location.pathname).toBe('/teams/v2/team_1')
  }, 15_000)

  it('opens a selected character directly in v2 DMG Numbers', async () => {
    const catalog = characterCatalog[0]
    const weapon = weaponCatalog.find((entry) => entry.type.toLowerCase() === catalog.weaponType.toLowerCase())!
    await db.characters.add({ id: 'owned-character', catalogId: catalog.id, level: 90, sequence: 0, locked: false, skillLevels: [10, 10, 10, 10, 10], createdAt: 1 })
    await db.weapons.add({ id: 'owned-weapon', catalogId: weapon.id, level: 90, rank: 1, locked: false, createdAt: 1 })
    await db.builds.add({ id: 'saved-build', name: 'Test build', characterId: 'owned-character', resonatorId: catalog.id, weaponId: 'owned-weapon', echoIds: [], level: 90, skillLevel: 10 })
    await db.teams.add({ id: 'sample-team', name: 'Team 1', members: [{ memberId: 'member', characterId: 'owned-character', loadoutSource: { type: 'saved', buildId: 'saved-build' } }], buildIds: ['member'], enemy: { level: 90, resistance: 10, damageReduction: 0 }, rotationDuration: 25, actions: [] })
    window.history.replaceState({}, '', `/teams/v2/team_1/${catalog.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}/damage`)

    render(<App/>)
    expect(await screen.findByRole('heading', { name: 'DMG Numbers' })).toBeInTheDocument()
    const sections = screen.getByRole('navigation', { name: 'Character sections' })
    expect(screen.getByText('Combat scenario')).toBeInTheDocument()
    expect(screen.getAllByText('Custom modifiers').length).toBeGreaterThan(0)
    fireEvent.click(within(sections).getByRole('button', { name: 'Setup/config' }))
    expect(screen.queryByText('Combat scenario')).not.toBeInTheDocument()
    expect(screen.queryByText('Custom modifiers')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Equipped Echoes' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Character setup details' })).not.toBeInTheDocument()
    expect(document.querySelector('.tw-v2-setup .tw-member-column')).not.toBeInTheDocument()
  }, 30_000)
})
