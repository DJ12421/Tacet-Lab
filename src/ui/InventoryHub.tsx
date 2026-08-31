import { useState } from 'react'
import type { Echo, OwnedCharacter, OwnedWeapon } from '../domain/types'
import { PageHeader } from './components'
import { InventoryView } from './InventoryView'
import { CharacterInventory, WeaponInventory } from './OwnedInventoryView'

type InventoryTab = 'echoes' | 'characters' | 'weapons'

export function InventoryHub({ echoes, characters, weapons, refresh, openScanner }: { echoes: Echo[]; characters: OwnedCharacter[]; weapons: OwnedWeapon[]; refresh: () => Promise<void>; openScanner: () => void }) {
  const [tab, setTab] = useState<InventoryTab>('echoes')
  return <><PageHeader eyebrow="Local collection" title="Inventory" description="Manage owned Echoes, characters, and weapon copies without leaving the browser."/><div className="archive-tabs inventory-tabs" role="tablist">{([{ id: 'echoes', label: 'Echoes', count: echoes.length }, { id: 'characters', label: 'Characters', count: characters.length }, { id: 'weapons', label: 'Weapons', count: weapons.length }] as const).map((item) => <button role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} key={item.id}><span>{item.label}</span><b>{item.count}</b></button>)}</div>{tab === 'echoes' && <InventoryView echoes={echoes} characters={characters} refresh={refresh} openScanner={openScanner} embedded/>}{tab === 'characters' && <CharacterInventory owned={characters} refresh={refresh}/>} {tab === 'weapons' && <WeaponInventory owned={weapons} refresh={refresh}/>}</>
}
