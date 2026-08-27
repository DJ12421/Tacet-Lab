import type { Build, Echo, EquippedLoadout, LoadoutSourceRef, OwnedCharacter, OwnedWeapon, TheorycraftBuild } from '../../domain/types'
import { BuildsView } from '../BuildsView'
import { Icon } from '../components'

export function BuildManagementModal({ characterId, echoes, builds, characters, weapons, equippedLoadouts, theorycraftBuilds, refresh, onSelect, onClose }: {
  characterId: string
  echoes: Echo[]
  builds: Build[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  equippedLoadouts: EquippedLoadout[]
  theorycraftBuilds: TheorycraftBuild[]
  refresh: () => Promise<void>
  onSelect: (source: LoadoutSourceRef) => void
  onClose: () => void
}) {
  return <div className="modal-backdrop tw-build-management-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="tw-build-management-modal" role="dialog" aria-modal="true" aria-label="Build Management">
      <header><div><Icon name="build"/><h2>Build Management</h2></div><button type="button" aria-label="Close build management" onClick={onClose}>×</button></header>
      <div className="tw-build-management-info"><b>ⓘ</b><span>This is the build currently equipped to your character. It represents in-game equipment and remains independent from saved and theorycraft builds.</span></div>
      <div className="tw-build-management-body"><BuildsView echoes={echoes} builds={builds} characters={characters} weapons={weapons} equippedLoadouts={equippedLoadouts} theorycraftBuilds={theorycraftBuilds} refresh={refresh} embedded management characterId={characterId} onSelectSource={onSelect}/></div>
    </section>
  </div>
}
