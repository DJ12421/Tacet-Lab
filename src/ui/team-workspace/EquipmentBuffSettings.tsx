import { useEffect, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { sonataCatalog, weaponCatalog } from '../../game-data'
import { mechanicsRegistry } from '../../game-data/combat/registry'
import { generatedSonataIconSources } from '../../game-data/sonatas.generated'
import { useWorkspacePreference } from './useWorkspacePreference'
import { Icon } from '../components'

type BuffRow = { key: string; detail: string; pieces?: number }
type BuffGroup = { id: string; name: string; subtitle: string; icon?: string; rows: BuffRow[] }

export function EquipmentBuffSettings({ accent, disabledKeys, onChange, onClose, weaponType }: {
  accent?: string
  disabledKeys: string[]
  onChange: (keys: string[]) => void
  onClose: () => void
  weaponType?: string
}) {
  const [section, setSection] = useWorkspacePreference<'sonatas' | 'weapons'>('buff-panel:section', 'sonatas')
  const [query, setQuery] = useWorkspacePreference('buff-panel:query', '')
  const [pieces, setPieces] = useWorkspacePreference<number[]>('buff-panel:pieces', [])
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { searchRef.current?.focus() }, [section])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const sonataGroups: BuffGroup[] = sonataCatalog.map((sonata) => ({
    id:String(sonata.id), name:sonata.name, subtitle:`Set #${sonata.id}`, icon:generatedSonataIconSources[sonata.name],
    rows:(mechanicsRegistry.sonatas?.[String(sonata.id)]?.effects ?? []).map((effect) => ({
      key:`sonata-effect:${effect.sourceId}`, pieces:effect.minimumPieces ?? 2,
      detail:effect.description ?? sonata.effects.find((entry) => entry.pieces === (effect.minimumPieces ?? 2))?.description ?? ''
    })).sort((left, right) => (left.pieces ?? 0) - (right.pieces ?? 0))
  })).filter((group) => group.rows.length)
  const weaponGroups: BuffGroup[] = weaponCatalog.filter((weapon) => !weaponType || weapon.type.toLowerCase() === weaponType.toLowerCase()).map((weapon) => ({
    id:weapon.id, name:weapon.name, subtitle:`${weapon.passiveName || 'Passive effects'} · R1`, icon:weapon.iconSourceUrl,
    rows:[...new Map<string, BuffRow>((mechanicsRegistry.weapons[weapon.id]?.effects ?? [])
      .filter((effect) => 1 >= (effect.minimumRank ?? 1) && 1 <= (effect.maximumRank ?? Infinity))
      .map((effect): [string, BuffRow] => [effect.sourceId, { key:`weapon-effect:${effect.sourceId}`, detail:effect.description ?? weapon.passiveEffects[0] ?? '' }])).values()]
  })).filter((group) => group.rows.length)
  const groups = (section === 'sonatas' ? sonataGroups : weaponGroups).flatMap((group) => {
    const nameMatches = `${group.name} ${group.subtitle}`.toLowerCase().includes(query.toLowerCase())
    const rows = group.rows.filter((row) => (section === 'weapons' || !pieces.length || pieces.includes(row.pieces ?? 0)) && (nameMatches || row.detail.toLowerCase().includes(query.toLowerCase())))
    return rows.length ? [{ ...group, rows }] : []
  })
  const rows = groups.flatMap((group) => group.rows)
  const enabled = rows.filter((row) => !disabledKeys.includes(row.key)).length
  const toggle = (key: string) => onChange(disabledKeys.includes(key) ? disabledKeys.filter((entry) => entry !== key) : [...disabledKeys, key])
  const toggleVisible = () => onChange(enabled === rows.length ? [...new Set([...disabledKeys, ...rows.map((row) => row.key)])] : disabledKeys.filter((key) => !rows.some((row) => row.key === key)))

  return createPortal(<div className="modal-backdrop equipment-buff-backdrop" style={{ '--buff-accent': accent ?? '#c8d0ce' } as CSSProperties} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="equipment-buff-dialog" role="dialog" aria-modal="true" aria-labelledby="equipment-buff-title">
      <header className="equipment-buff-heading"><div><h2 id="equipment-buff-title">Equipment buffs</h2><p>Choose the effects used in suggestions and optimization.</p></div><button type="button" className="close" aria-label="Close equipment buffs" onClick={onClose}>×</button></header>
      <div className="equipment-buff-controls"><div className="equipment-buff-tabs" role="group" aria-label="Equipment type"><button type="button" aria-pressed={section === 'sonatas'} className={section === 'sonatas' ? 'active' : ''} onClick={() => setSection('sonatas')}>Sonata sets</button><button type="button" aria-pressed={section === 'weapons'} className={section === 'weapons' ? 'active' : ''} onClick={() => setSection('weapons')}>Weapons</button></div><label className="equipment-buff-toggle-all"><input type="checkbox" checked={rows.length > 0 && enabled === rows.length} onChange={toggleVisible} disabled={!rows.length}/>Toggle all visible <span>{enabled}/{rows.length}</span></label></div>
      <div className="equipment-buff-toolbar">{section === 'sonatas' && <div className="equipment-buff-filters" role="group" aria-label="Sonata piece count">{[5, 3, 2, 1].map((count) => <button type="button" aria-pressed={pieces.includes(count)} className={pieces.includes(count) ? 'active' : ''} onClick={() => setPieces((current) => current.includes(count) ? current.filter((entry) => entry !== count) : [...current, count])} key={count}>{count}PC</button>)}</div>}<span className="search-field"><Icon name="scan"/><input ref={searchRef} data-search="" autoFocus type="search" aria-label="Search equipment buffs" placeholder={section === 'sonatas' ? 'Search Sonata sets…' : 'Search weapons…'} value={query} onChange={(event) => setQuery(event.target.value)}/><kbd>Ctrl K</kbd></span></div>
      <div className="equipment-buff-list">{groups.length ? groups.map((group) => <article className="equipment-buff-group" key={group.id}><header>{group.icon && <img src={group.icon} alt=""/>}<span><strong>{group.name}</strong><small>{group.subtitle}</small></span><b>{group.rows.filter((row) => !disabledKeys.includes(row.key)).length}/{group.rows.length}</b></header>{group.rows.map((row) => <label className="equipment-buff-row" key={row.key}><input type="checkbox" checked={!disabledKeys.includes(row.key)} onChange={() => toggle(row.key)}/>{row.pieces && <b>{row.pieces}</b>}<span>{row.detail}</span></label>)}</article>) : <p className="tw-empty-state">No matching reviewed buffs.</p>}</div>
    </section>
  </div>, document.body)
}
