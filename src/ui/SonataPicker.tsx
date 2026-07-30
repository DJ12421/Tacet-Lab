import { useCallback, useRef, useState } from 'react'
import { generatedSonataCatalog, generatedSonataIconSources } from '../game-data/sonatas.generated'
import { useDismissableLayer } from './useDismissableLayer'

const sonataNames = generatedSonataCatalog.map((sonata) => sonata.name)

export function SonataPicker({ value, onChange, allowAll = false, allowedNames, id }: { value: string; onChange: (value: string) => void; allowAll?: boolean; allowedNames?: readonly string[]; id: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismissableLayer(open, ref, close)
  const selectedIcon = value !== 'all' ? generatedSonataIconSources[value] : undefined
  const options = allowedNames?.length ? sonataNames.filter((name) => allowedNames.includes(name)) : sonataNames
  const filteredOptions = options.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="sonata-picker" id={id} ref={ref}>
    <button type="button" className="sonata-picker-trigger" aria-expanded={open} onClick={() => { setOpen((current) => !current); setQuery('') }}>{selectedIcon ? <img src={selectedIcon} alt=""/> : <span>◇</span>}<b>{value === 'all' ? 'All Sonatas' : value}</b><i>⌄</i></button>
    {open && <div className="sonata-picker-menu"><input autoFocus className="sonata-picker-search" aria-label="Search Sonatas" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Sonatas..."/>{allowAll && !query && <button type="button" className={value === 'all' ? 'active' : ''} onClick={() => { onChange('all'); setOpen(false) }}><span>◇</span><b>All Sonatas</b></button>}{filteredOptions.map((name) => <button type="button" className={value === name ? 'active' : ''} onClick={() => { onChange(name); setOpen(false) }} key={name}><img src={generatedSonataIconSources[name]} alt="" loading="lazy"/><b>{name}</b></button>)}{!filteredOptions.length && <p className="sonata-picker-empty">No Sonatas match “{query}”</p>}</div>}
  </div>
}
