import { createRef } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Echo, OwnedCharacter } from '../domain/types'
import { resolveCharacterSubstatProfile } from '../domain/character-substat-score'
import { characterCatalog, defaultSettings } from '../game-data'
import type { NanokaSpinePortraitHandle } from './NanokaSpinePortrait'
import { CharacterBuildCard, prioritizedBuildCardStats } from './CharacterBuildCard'
import { defaultEnabledSkillTreeBonusIds, resolveCharacterShowcaseModel } from './character-showcase-model'

vi.mock('./NanokaSpinePortrait', () => ({ NanokaSpinePortrait: () => null }))

beforeEach(() => {
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

function card(editable: boolean, overrides: Partial<typeof baseModel> = {}) {
  const callbacks = {
    onSetLevel: vi.fn(), onSetSequence: vi.fn(), onSetSkillLevel: vi.fn(), onToggleSkillTreeNode: vi.fn(),
    onOpenWeapon: vi.fn(), onOpenEcho: vi.fn(), onEditEcho: vi.fn(), onEditPriorities: vi.fn(), onShowScoreInfo: vi.fn()
  }
  const result = render(<CharacterBuildCard
    character={character}
    catalog={catalog}
    model={{ ...baseModel, ...overrides }}
    settings={defaultSettings}
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
  it('synchronizes the layout sidebar host to the rendered card height', () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1920)
    const layoutPanelHost = document.createElement('div')
    document.body.append(layoutPanelHost)
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
      onEditEcho={vi.fn()}
      onEditPriorities={vi.fn()}
      onShowScoreInfo={vi.fn()}
      onUploadArtwork={vi.fn()}
      onRestoreArtwork={vi.fn()}
      layoutPanelHost={layoutPanelHost}
    />)

    expect(layoutPanelHost.style.height).toBe('1080px')
    result.unmount()
    expect(layoutPanelHost.style.height).toBe('')
    layoutPanelHost.remove()
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

  it('offers Edit and Switch for an occupied Echo', () => {
    const echo: Echo = {
      id: 'echo-1', name: 'Hooscamp', cost: 4, rarity: 5, level: 25, sonata: 'Lingering Tunes',
      mainStat: { key: 'critRate', value: 22 }, subStats: [{ key: 'critRate', value: 10.5 }],
      locked: false, excluded: false, createdAt: 1, source: 'manual'
    }
    const first = card(true, { echoSlots: [echo, undefined, undefined, undefined, undefined], equippedEchoes: [echo], totalEchoCost: 4 })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hooscamp' }))
    const actions = screen.getByText('Edit Echo').parentElement!
    fireEvent.click(within(actions).getByText('Edit Echo'))
    expect(first.callbacks.onEditEcho).toHaveBeenCalledWith(echo)

    first.unmount()
    const second = card(true, { echoSlots: [echo, undefined, undefined, undefined, undefined], equippedEchoes: [echo], totalEchoCost: 4 })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Hooscamp' }))
    fireEvent.click(screen.getByText(/Switch Echo/))
    expect(second.callbacks.onOpenEcho).toHaveBeenCalledWith(0)
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
})
