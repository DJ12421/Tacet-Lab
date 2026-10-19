import type { PointerEvent } from 'react'
import { Icon, PageHeader, Panel } from './primitives'
import { TacetLabLogo } from './TacetLabLogo'

const partners = [
  {
    name: 'Rover Waves',
    label: 'Partnered server',
    image: 'partners/rover-waves.webp',
    description: 'Welcome to Rover Waves! A server dedicated to Rover and anything else related to the gameplay such as team building and much more!',
    links: [{ label: 'Discord', icon: 'discord', url: 'https://discord.gg/ENk8XS38TY' }]
  },
  {
    name: 'Ultimate Gacha Hub',
    label: 'Partnered server',
    image: 'partners/ultimate-gacha-hub.gif',
    description: 'An unofficial server made to act as a hub for all popular gacha games! We have the latest news and an enthusiastic community, so come and join the discussions!',
    links: [{ label: 'Discord', icon: 'discord', url: 'https://discord.gg/nGBjMbwTy9' }]
  },
  {
    name: 'Tacet Lab',
    label: 'Official server',
    description: 'A local-first Wuthering Waves optimizer for Echoes, builds, and team damage.',
    links: [
      { label: 'Discord', icon: 'discord', url: 'https://discord.gg/fy66NmapWb' },
      { label: 'GitHub', icon: 'github', url: 'https://github.com/DJ12421/Tacet-Lab' }
    ]
  }
] as const

function moveCardLight(event: PointerEvent<HTMLElement>) {
  const bounds = event.currentTarget.getBoundingClientRect()
  event.currentTarget.style.setProperty('--light-x', `${event.clientX - bounds.left}px`)
  event.currentTarget.style.setProperty('--light-y', `${event.clientY - bounds.top}px`)
}

export function PartnershipsView() {
  return <div className="partnerships-page">
    <PageHeader eyebrow="Community" title="Partnerships" description="Discover communities and creators connected with Tacet Lab."/>
    <div className="partnerships-grid">
      {partners.map((partner) => <Panel className="partner-card" onPointerMove={moveCardLight} key={partner.name}>
        <div className="partner-card-head">
          {partner.name === 'Tacet Lab' ? <TacetLabLogo className="tacet-lab-logo-static"/> : <img src={`${import.meta.env.BASE_URL}${partner.image}`} alt={`${partner.name} icon`} width="60" height="60"/>}
          <div><span className="eyebrow partner-shiny-text">{partner.label}</span><h2>{partner.name}</h2></div>
        </div>
        <p>{partner.description}</p>
        <nav aria-label={`${partner.name} links`}>
          <span>Connect</span>
          <div>{partner.links.map((link) => <a href={link.url} target="_blank" rel="noreferrer" aria-label={`${partner.name} on ${link.label}`} title={link.label} key={link.label}><Icon name={link.icon}/></a>)}</div>
        </nav>
      </Panel>)}
    </div>
  </div>
}
