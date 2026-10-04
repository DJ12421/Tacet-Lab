import type { ReactNode } from 'react'
import type { OwnedWeapon } from '../domain/types'
import { weaponCatalog } from '../game-data'
import { weaponStatsAtLevel } from './character-showcase-model'
import { statIconSource, weaponStatIconSource } from './stat-icons'

type WeaponCatalogEntry = (typeof weaponCatalog)[number]

export function WeaponInventoryCard({ weapon, catalog, onClick, ariaLabel, footer, className = '' }: { weapon: OwnedWeapon; catalog: WeaponCatalogEntry; onClick: () => void; ariaLabel?: string; footer?: ReactNode; className?: string }) {
  const stats = weaponStatsAtLevel(catalog, weapon.level)
  return <article className={`wv-card rarity-${catalog.rarity}${className ? ` ${className}` : ''}`}>
    <button className="wv-card-main" type="button" onClick={onClick} aria-label={ariaLabel ?? `Open ${catalog.name}`}>
      <div className="wv-card-art"><img src={catalog.iconSourceUrl} alt=""/><span>{'★'.repeat(catalog.rarity)}</span></div>
      <div className="wv-card-copy"><h2>{catalog.name}</h2><small>{catalog.type}</small><div className="wv-card-level"><b>Lv. {weapon.level}</b><span>R{weapon.rank}</span></div><div className="wv-card-stats"><span><span className="weapon-stat-label"><img className="weapon-stat-icon" src={statIconSource('atk')} alt="" aria-hidden="true"/>ATK</span><b>{stats.baseAtk}</b></span><span><span className="weapon-stat-label"><img className="weapon-stat-icon" src={weaponStatIconSource(catalog.secondaryStat)} alt="" aria-hidden="true"/>{catalog.secondaryStat}</span><b>{stats.secondaryStatValue}</b></span></div></div>
    </button>
    {footer && <div className="wv-card-footer" onClick={(event) => event.stopPropagation()}>{footer}</div>}
  </article>
}
