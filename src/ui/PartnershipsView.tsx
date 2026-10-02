import type { PointerEvent } from 'react'
import { Icon, PageHeader, Panel } from './primitives'

function moveCardLight(event: PointerEvent<HTMLElement>) {
  const bounds = event.currentTarget.getBoundingClientRect()
  event.currentTarget.style.setProperty('--light-x', `${event.clientX - bounds.left}px`)
  event.currentTarget.style.setProperty('--light-y', `${event.clientY - bounds.top}px`)
}

export function PartnershipsView() {
  return <div className="partnerships-page">
    <PageHeader eyebrow="Community" title="Partnerships" description="Discover communities and creators connected with Tacet Lab."/>
    <div className="partnerships-grid">
      <Panel className="partner-card" onPointerMove={moveCardLight}>
        <div className="partner-card-head">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="Tacet Lab logo" width="60" height="60"/>
          <div><span className="eyebrow partner-shiny-text">Featured example</span><h2>Tacet Lab</h2></div>
        </div>
        <p>A local-first Wuthering Waves optimizer for Echoes, builds, and team damage.</p>
        <nav aria-label="Tacet Lab links">
          <span>Connect</span>
          <div><a href="https://discord.gg/fy66NmapWb" target="_blank" rel="noreferrer" aria-label="Tacet Lab on Discord" title="Discord"><Icon name="discord"/></a>
          <a href="https://github.com/DJ12421/Tacet-Lab" target="_blank" rel="noreferrer" aria-label="Tacet Lab on GitHub" title="GitHub"><Icon name="github"/></a></div>
        </nav>
      </Panel>
    </div>
  </div>
}
