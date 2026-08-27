import type { ReactNode } from 'react'
import type { OwnedWeapon } from '../domain/types'
import { weaponCatalog } from '../game-data'
import { weaponStatsAtLevel } from './character-showcase-model'

type WeaponCatalogEntry = (typeof weaponCatalog)[number]

export function WeaponInventoryCard({ weapon, catalog, onClick, ariaLabel, footer, className = '' }: { weapon: OwnedWeapon; catalog: WeaponCatalogEntry; onClick: () => void; ariaLabel?: string; footer?: ReactNode; className?: string }) {
  const stats = weaponStatsAtLevel(catalog, weapon.level)
  return <article className={`wv-card rarity-${catalog.rarity}${className ? ` ${className}` : ''}`}>
    <button className="wv-card-main" type="button" onClick={onClick} aria-label={ariaLabel ?? `Open ${catalog.name}`}>
      <div className="wv-card-art"><img src={catalog.iconSourceUrl} alt=""/><span>{'★'.repeat(catalog.rarity)}</span></div>
      <div className="wv-card-copy"><small>{catalog.type}</small><h2>{catalog.name}</h2><div className="wv-card-level"><b>Lv. {weapon.level}</b><span>R{weapon.rank}</span></div><div className="wv-card-stats"><span>ATK <b>{stats.baseAtk}</b></span><span>{catalog.secondaryStat} <b>{stats.secondaryStatValue}</b></span></div></div>
    </button>
    {footer && <div className="wv-card-footer" onClick={(event) => event.stopPropagation()}>{footer}</div>}
  </article>
}
