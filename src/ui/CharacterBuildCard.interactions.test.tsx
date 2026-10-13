import { createRef } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Echo, OwnedCharacter } from '../domain/types'
import { resolveCharacterSubstatProfile } from '../domain/character-substat-score'
import { characterCatalog, defaultSettings } from '../game-data'
import type { NanokaSpinePortraitHandle } from './NanokaSpinePortrait'
import { CharacterBuildCard, prioritizedBuildCardStats } from './CharacterBuildCard'
import { EchoPicker } from './CharacterShowcase'
import { defaultEnabledSkillTreeBonusIds, resolveCharacterShowcaseModel } from './character-showcase-model'

vi.mock('./NanokaSpinePortrait', () => ({ NanokaSpinePortrait: ({ paused }: { paused: boolean }) => <div data-testid="live-character-art" data-paused={paused}/> }))
vi.mock('./EchoEditModal', () => ({ EchoEditModal: ({ echo }: { echo: Echo }) => <div data-testid="echo-editor">{echo.name}</div> }))

beforeEach(() => {
  window.localStorage.removeItem('tacet-lab-character-card-pickers:owned-lucy')
  window.localStorage.removeItem('tacet-lab-character-card-pickers:another-character')
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

const catalog = characterCatalog.find((entry) => entry.name === 'Lucy')!
const character: OwnedCharacter = {
  id: 'owned-lucy', catalogId: catalog.id, level: 90, sequence: 0, locked: false,
  skillLevels: [6, 6, 10, 10, 6], createdAt: 1
}
const profile = resolveCharacterSubstatProfile(catalog)
const baseModel = resolveCharacterShowcaseModel({ character, catalog, weapons: [], echoes: [], builds: [] })!

function card(editable: boolean, overrides: Partial<typeof baseModel> = {}, settings = defaultSettings) {
  const callbacks = {
    onSetLevel: vi.fn(), onSetSequence: vi.fn(), onSetSkillLevel: vi.fn(), onToggleSkillTreeNode: vi.fn(),
    onOpenWeapon: vi.fn(), onOpenEcho: vi.fn(), onMoveEcho: vi.fn(), onEditPriorities: vi.fn(), onShowScoreInfo: vi.fn()
  }
  const result = render(<CharacterBuildCard
    character={character}
    catalog={catalog}
    model={{ ...baseModel, ...overrides }}
    settings={settings}
    profile={profile}
    statRows={prioritizedBuildCardStats(catalog, profile)}
    statDetail={(_key, label) => ({ title: label, value: '0', formula: 'Test formula', rows: [] })}
    editable={editable}
    portraitRef={createRef<HTMLImageElement>()}
    livePortraitRef={createRef<NanokaSpinePortraitHandle>()}
    portraitFailed={false}
    animatedPortraitReady={false}
    enabledSkillTreeNodeIds={defaultEnabledSkillTreeBonusIds(catalog)}
    onPortraitError={vi.fn()}
    onLiveReady={vi.fn()}
    onLiveFallback={vi.fn()}
    onUploadArtwork={vi.fn()}
    onRestoreArtwork={vi.fn()}
    {...callbacks}
  />)
  return { ...result, callbacks }
}

describe('CharacterBuildCard direct editing', () => {
  it('does not mount live character art and defaults static art to 135% zoom when disabled', async () => {
    const { container, queryByTestId } = card(true, {}, { ...defaultSettings, liveCharacterArt: false })
    expect(queryByTestId('live-character-art')).not.toBeInTheDocument()
    expect(container.querySelector('.cbc-live-portrait-snapshot')).not.toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('.cbc-art-positioner')).toHaveStyle({ width: '2592px', height: '1458px' }))
  })

  it('pauses live art while a card popover is open', () => {
    const { container } = card(true)
    const art = screen.getByTestId('live-character-art')
    expect(art).toHaveAttribute('data-paused', 'false')
    fireEvent.click(container.querySelector<HTMLButtonElement>('.cbc-identity button')!)
    expect(art).toHaveAttribute('data-paused', 'true')
    fireEvent.click(container.querySelector<HTMLButtonElement>('.cbc-identity button')!)
    expect(art).toHaveAttribute('data-paused', 'false')
  })

  it('opens appearance controls by default and gates layout editing', async () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1920)
    const layoutPanelHost = document.createElement('div')
    const layoutControlsHost = document.createElement('div')
    document.body.append(layoutPanelHost)
    document.body.append(layoutControlsHost)
    const result = render(<CharacterBuildCard
      character={character}
      catalog={catalog}
      model={baseModel}
      settings={defaultSettings}
      profile={profile}
      statRows={prioritizedBuildCardStats(catalog, profile)}
      statDetail={(_key, label) => ({ title: label, value: '0', formula: 'Test formula', rows: [] })}
      editable
      portraitRef={createRef<HTMLImageElement>()}
      livePortraitRef={createRef<NanokaSpinePortraitHandle>()}
      portraitFailed={false}
      animatedPortraitReady={false}
      enabledSkillTreeNodeIds={defaultEnabledSkillTreeBonusIds(catalog)}
      onPortraitError={vi.fn()}
      onLiveReady={vi.fn()}
      onLiveFallback={vi.fn()}
      onSetLevel={vi.fn()}
      onSetSequence={vi.fn()}
      onSetSkillLevel={vi.fn()}
      onToggleSkillTreeNode={vi.fn()}
      onOpenWeapon={vi.fn()}
      onOpenEcho={vi.fn()}
      onEditPriorities={vi.fn()}
      onShowScoreInfo={vi.fn()}
      onUploadArtwork={vi.fn()}
      onRestoreArtwork={vi.fn()}
      layoutPanelHost={layoutPanelHost}
      layoutControlsHost={layoutControlsHost}
    />)

    expect(layoutPanelHost.style.height).toBe('1080px')
    expect(within(layoutControlsHost).getByText('Customize').closest('details')).toHaveAttribute('open')
    expect(screen.getByTestId('live-character-art')).toHaveAttribute('data-paused', 'false')
    const layoutToggle = within(layoutPanelHost).getByRole('checkbox', { name: /Customize layout/ })
    expect(within(layoutPanelHost).getByRole('group', { name: 'Card appearance' })).toContainElement(within(layoutPanelHost).getByRole('checkbox', { name: /Color Echo rolls/ }))
    expect(layoutToggle).not.toBeChecked()
    expect(result.container.querySelector('.cbc-layout-calibration-layer')).not.toBeInTheDocument()
    expect(within(layoutPanelHost).queryByText('Reset selected')).not.toBeInTheDocument()
    fireEvent.click(layoutToggle)
    expect(result.container.querySelector('.cbc-layout-calibration-layer')).toBeInTheDocument()
    await waitFor(() => expect(within(layoutPanelHost).getByText('Reset selected')).toBeInTheDocument())
    fireEvent.click(layoutToggle)
    expect(result.container.querySelector('.cbc-layout-calibration-layer')).not.toBeInTheDocument()
    expect(within(layoutPanelHost).queryByText('Reset selected')).not.toBeInTheDocument()
    fireEvent.click(within(layoutPanelHost).getByRole('button', { name: 'Save changes' }))
    expect(within(layoutControlsHost).getByText('Customize').closest('details')).toHaveAttribute('open')
    expect(within(layoutPanelHost).getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    fireEvent.click(within(layoutControlsHost).getByText('Customize'))
    expect(within(layoutControlsHost).getByText('Customize').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByTestId('live-character-art')).toHaveAttribute('data-paused', 'false')
    expect(within(layoutPanelHost).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    result.unmount()
    expect(layoutPanelHost.style.height).toBe('')
    layoutPanelHost.remove()
    layoutControlsHost.remove()
    clientWidth.mockRestore()
  })

  it('edits level, Sequence, skill level, bonus nodes, weapon, and an empty Echo slot when equipped', () => {
    const { container, callbacks } = card(true)

    fireEvent.click(container.querySelector<HTMLButtonElement>('.cbc-identity > button')!)
    fireEvent.click(screen.getByRole('button', { name: '80' }))
    expect(callbacks.onSetLevel).toHaveBeenCalledWith(80)

    fireEvent.click(within(screen.getByLabelText('Sequence 0')).getAllByRole('button')[0])
    expect(callbacks.onSetSequence).toHaveBeenCalledWith(1)

    fireEvent.click(container.querySelector<HTMLButtonElement>('.cbc-main-skill')!)
    fireEvent.click(container.querySelector<HTMLButtonElement>('.cbc-skill-level-popover button:last-child')!)
    expect(callbacks.onSetSkillLevel).toHaveBeenCalledWith(0, 7)

    const firstBonus = container.querySelector<HTMLButtonElement>('.cbc-skill-bonuses button')!
    fireEvent.click(firstBonus)
    expect(callbacks.onToggleSkillTreeNode).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /No weapon equipped/ }))
    expect(callbacks.onOpenWeapon).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /Empty Echo slot Main Echo/ }))
    expect(callbacks.onOpenEcho).toHaveBeenCalledWith(0)
  })

  it('keeps ER and nonzero elemental damage readable while dimming unweighted stats', () => {
    const echo: Echo = {
      id: 'echo-1', name: 'Hooscamp', cost: 4, rarity: 5, level: 25, sonata: 'Lingering Tunes',
      mainStat: { key: 'critRate', value: 22 }, subStats: [{ key: 'energyRegen', value: 10.5 }, { key: 'spectroDamage', value: 10.5 }, { key: 'basicDamage', value: 10.5 }],
      locked: false, excluded: false, createdAt: 1, source: 'manual'
    }
    const { container, callbacks } = card(true, { echoSlots: [echo, undefined, undefined, undefined, undefined], equippedEchoes: [echo], totalEchoCost: 4, finalStats: { ...baseModel.finalStats, spectroDamage: 12 } })
    fireEvent.click(screen.getByRole('button', { name: 'Switch Hooscamp' }))
    expect(callbacks.onOpenEcho).toHaveBeenCalledWith(0)
    const substat = (label: string) => [...container.querySelectorAll('.cbc-echo-substats .cbc-stat-source')].find((row) => row.textContent?.includes(label))
    const statRow = (label: string) => [...container.querySelectorAll('.cbc-stat-row')].find((row) => row.textContent?.includes(label))
    expect(substat('Energy Regen')).not.toHaveClass('is-unweighted')
    expect(substat('Spectro DMG')).not.toHaveClass('is-unweighted')
    expect(substat('Basic Attack')).toHaveClass('is-unweighted')
    expect(statRow('Energy Regen')).not.toHaveClass('is-unweighted')
    expect(statRow('Spectro DMG')).not.toHaveClass('is-unweighted')
    expect(statRow('DEF')).toHaveClass('is-unweighted')
  })

  it('dims a zero elemental damage bonus without a weight', () => {
    const { container } = card(true)
    expect([...container.querySelectorAll('.cbc-stat-row')].find((row) => row.textContent?.includes('Spectro DMG'))).toHaveClass('is-unweighted')
  })

  it('dismisses the skill edit popover when the pointer leaves its owner', () => {
    const { container } = card(true)

    const skillColumn = container.querySelector<HTMLElement>('.cbc-skill-column')!
    fireEvent.click(skillColumn.querySelector<HTMLButtonElement>('.cbc-main-skill')!)
    expect(within(skillColumn).getByRole('spinbutton')).toBeInTheDocument()
    fireEvent.mouseLeave(skillColumn)
    expect(within(skillColumn).queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('moves an Echo into an empty slot and offers occupied slots as swap targets', () => {
    const first: Echo = { id: 'first', name: 'Hooscamp', cost: 1, rarity: 5, level: 25, sonata: 'Lingering Tunes', mainStat: { key: 'atkPercent', value: 18 }, subStats: [], locked: false, excluded: false, createdAt: 1, source: 'manual' }
    const { container, callbacks } = card(true, { echoSlots: [first, undefined, undefined, undefined, undefined], equippedEchoes: [first], totalEchoCost: 1 })
    const source = container.querySelector<HTMLElement>('[data-echo-slot="0"]')!
    const target = container.querySelector<HTMLElement>('[data-echo-slot="1"]')!
    fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } })
    fireEvent.dragOver(target, { dataTransfer: { dropEffect: 'move' } })
    expect(container.querySelector('.cbc-echo-stage')).toHaveClass('is-dropping-on-1')
    fireEvent.drop(target)
    expect(callbacks.onMoveEcho).toHaveBeenCalledWith(0, 1)
  })

  it('keeps Saved and Theorycraft presentations read-only through the shared editable contract', () => {
    const { container, callbacks } = card(false)

    expect(screen.getByRole('button', { name: /Lv\. 90/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /No weapon equipped/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Empty Echo slot Main Echo/ })).toBeDisabled()
    fireEvent.click(within(screen.getByLabelText('Sequence 0')).getAllByRole('button')[0])
    fireEvent.click(container.querySelector<HTMLButtonElement>('.cbc-main-skill')!)
    fireEvent.click(container.querySelector<HTMLButtonElement>('.cbc-skill-bonuses button')!)

    expect(callbacks.onSetSequence).not.toHaveBeenCalled()
    expect(callbacks.onSetSkillLevel).not.toHaveBeenCalled()
    expect(callbacks.onToggleSkillTreeNode).not.toHaveBeenCalled()
    expect(callbacks.onOpenWeapon).not.toHaveBeenCalled()
    expect(callbacks.onOpenEcho).not.toHaveBeenCalled()
  })

  it('edits an Echo from the switch picker without equipping it', () => {
    const echo: Echo = {
      id: 'echo-1', name: 'Hooscamp', cost: 4, rarity: 5, level: 25, sonata: 'Lingering Tunes',
      mainStat: { key: 'critRate', value: 22 }, subStats: [],
      locked: false, excluded: false, createdAt: 1, source: 'manual'
    }
    const onSelect = vi.fn()
    render(<EchoPicker slot={0} characterId={character.id} currentIds={[]} echoes={[echo]} accentClass="" refresh={vi.fn()} onClose={vi.fn()} onSelect={onSelect}/>)

    const picker = screen.getByRole('dialog', { name: 'Equip Echo slot 1' })
    expect(picker).toHaveClass('echo-inventory-view')
    expect(picker.querySelector('.echo-grid')).toBeInTheDocument()
    expect(within(picker).getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(picker).getByRole('button', { name: /All Sonatas/ })).toBeInTheDocument()
    const oneCost = within(within(picker).getByRole('group', { name: 'Cost' })).getByRole('button', { name: '1 cost' })
    expect(oneCost).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(oneCost)
    expect(oneCost).toHaveAttribute('aria-pressed', 'true')
    expect(picker.querySelector('.echo-card')).not.toBeInTheDocument()
    fireEvent.click(oneCost)
    expect(picker.querySelector('.echo-card')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hooscamp' }))
    expect(screen.getByTestId('echo-editor')).toHaveTextContent('Hooscamp')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('restores Echo filters for the same character without sharing them with another', () => {
    const props = { slot: 0, currentIds: [], echoes: [], accentClass: '', refresh: vi.fn(), onClose: vi.fn() }
    const first = render(<EchoPicker {...props} characterId={character.id}/>)
    fireEvent.click(screen.getByRole('button', { name: '3 cost' }))
    first.unmount()
    const reopened = render(<EchoPicker {...props} characterId={character.id}/>)
    expect(screen.getByRole('button', { name: '1 cost' })).toHaveAttribute('aria-pressed', 'false')
    reopened.unmount()
    render(<EchoPicker {...props} characterId="another-character"/>)
    expect(screen.getByRole('button', { name: '1 cost' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps empty Echo slots and swaps Echoes already equipped on the same character', async () => {
    const first: Echo = { id: 'first', name: 'Hooscamp', cost: 1, rarity: 5, level: 25, sonata: 'Lingering Tunes', mainStat: { key: 'atkPercent', value: 18 }, subStats: [], locked: false, excluded: false, createdAt: 1, source: 'manual' }
    const second: Echo = { ...first, id: 'second', name: 'Fusion Warrior' }
    const onSelect = vi.fn().mockResolvedValue(false)
    const result = render(<EchoPicker slot={0} characterId={character.id} currentIds={['first', 'second']} echoes={[first, second]} accentClass="" refresh={vi.fn()} onClose={vi.fn()} onSelect={onSelect}/>)

    fireEvent.click(screen.getByRole('button', { name: 'Unequip current Echo' }))
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(['', 'second'], undefined))
    const secondCard = [...document.querySelectorAll<HTMLElement>('.echo-card')].find((card) => card.querySelector('h3')?.textContent === 'Fusion Warrior')!
    fireEvent.click(secondCard)
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(['second', 'first'], second))
    result.unmount()

    const move = vi.fn().mockResolvedValue(false)
    render(<EchoPicker slot={0} characterId={character.id} currentIds={['', 'second']} echoes={[first, second]} accentClass="" refresh={vi.fn()} onClose={vi.fn()} onSelect={move}/>)
    const movingCard = [...document.querySelectorAll<HTMLElement>('.echo-card')].find((card) => card.querySelector('h3')?.textContent === 'Fusion Warrior')!
    fireEvent.click(movingCard)
    await waitFor(() => expect(move).toHaveBeenCalledWith(['second'], second))
  })
})
