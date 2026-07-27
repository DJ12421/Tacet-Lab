import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import type { AppView, Build, Echo, OwnedCharacter, OwnedWeapon, Team } from '../domain/types'
import { EchoWaveform } from './EchoWaveform'
import { Icon } from './primitives'
import './home-view.css'

interface HomeViewProps {
  echoes: Echo[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  builds: Build[]
  teams: Team[]
  navigate: (view: AppView) => void
}

const featureCards = [
  { view: 'scanner' as const, icon: 'scan' as const, tone: 'gold', title: 'Auto Import', subtitle: 'Scan your collection', description: 'Capture Echo detail screens with local OCR and approve every result before it enters your archive.', points: ['English OCR scanning', 'Review before saving', 'No uploads or accounts'], action: 'Start scanning' },
  { view: 'characters' as const, icon: 'team' as const, tone: 'blue', title: 'Character Management', subtitle: 'Optimize your builds', description: 'Create character loadouts, tune skill levels, equip weapons, and inspect complete combat statistics.', points: ['Character-specific loadouts', 'Five-branch Forte trees', 'Weapon and Echo assignment'], action: 'View characters' },
  { view: 'echoes' as const, icon: 'echo' as const, tone: 'green', title: 'Echo Management', subtitle: 'Analyze your collection', description: 'Filter every saved Echo, compare its rolls, and prepare inventory for optimizer searches.', points: ['Complete local inventory', 'Advanced filtering', 'Editable stats and locks'], action: 'View Echoes' }
]

export function HomeView({ echoes, characters, weapons, builds, teams, navigate }: HomeViewProps) {
  const featured = characterCatalog.find((entry) => entry.name === 'Phoebe') ?? characterCatalog[0]
  const ownedEntries = characters.flatMap((owned) => {
    const catalog = characterCatalog.find((entry) => entry.id === owned.catalogId)
    return catalog ? [catalog] : []
  })
  const roster = [...ownedEntries, ...characterCatalog.filter((entry) => !ownedEntries.some((owned) => owned.id === entry.id))].slice(0, 10)
  const weaponStrip = weaponCatalog.slice(0, 4)
  const assignedEchoes = echoes.filter((echo) => echo.equippedBy).length
  const completeBuilds = builds.filter((build) => build.echoIds.length === 5).length

  return <section className={`home-view home-element-${featured.element.toLowerCase()}`}>
    <article className="home-hero">
      <div className="home-hero-grid"/>
      <img className="home-hero-art" src={featured.portraitSourceUrl || featured.iconSourceUrl} alt=""/>
      <div className="home-hero-copy"><span className="home-kicker">|| Local-first Wuthering Waves toolkit</span><h1>Tacet Lab Optimizer</h1><p>Optimize builds, evaluate Echoes, and maximize your characters without sending account data anywhere.</p><div className="home-hero-actions"><button className="primary" onClick={() => navigate('scanner')}><Icon name="scan"/>Start import</button><button className="secondary" onClick={() => navigate('characters')}><Icon name="team"/>Open roster</button></div></div>
      <div className="home-release-strip">{roster.map((entry) => <button key={entry.id} title={entry.name} onClick={() => navigate('characters')}><img src={entry.iconSourceUrl} alt=""/><span>{entry.name}</span></button>)}{weaponStrip.map((entry) => <button className="is-weapon" key={entry.id} title={entry.name} onClick={() => navigate('weapons')}><img src={entry.iconSourceUrl} alt=""/><span>{entry.name}</span></button>)}</div>
      <EchoWaveform element={featured.element}/>
    </article>

    <div className="home-features">{featureCards.map((feature) => <article className={`home-feature home-tone-${feature.tone}`} key={feature.view}><header><span><Icon name={feature.icon}/></span><div><h2>{feature.title}</h2><small>{feature.subtitle}</small></div></header><p>{feature.description}</p><ul>{feature.points.map((point) => <li key={point}><b>✓</b>{point}</li>)}</ul><button onClick={() => navigate(feature.view)}>{feature.action}<span>→</span></button></article>)}</div>

    <article className="home-account-band"><div><span className="eyebrow">Local account overview</span><h2>Your archive at a glance</h2><p>All values come from this browser’s IndexedDB archive.</p></div><dl><div><dt>Characters</dt><dd>{characters.length}</dd></div><div><dt>Weapons</dt><dd>{weapons.length}</dd></div><div><dt>Echoes</dt><dd>{echoes.length}</dd><small>{assignedEchoes} equipped</small></div><div><dt>Builds</dt><dd>{builds.length}</dd><small>{completeBuilds} complete</small></div><div><dt>Teams</dt><dd>{teams.length}</dd></div></dl></article>

    <div className="home-lower-grid">
      <article className="home-showcase"><div><span className="eyebrow">Character-specific evaluation</span><h2>Build scoring system</h2><p>Compare complete loadouts against the stats and damage types each Resonator actually needs.</p><button className="secondary" onClick={() => navigate('characters')}>Open character builds <span>→</span></button></div><div className="home-score-visual"><div className="home-score-ring"><strong>{completeBuilds ? 'S' : '—'}</strong><span>Build grade</span></div><div className="home-score-bars"><i style={{ width: '88%' }}/><i style={{ width: '72%' }}/><i style={{ width: '94%' }}/><i style={{ width: '61%' }}/></div></div><EchoWaveform element={featured.element}/></article>
      <article className="home-archive-card"><span className="eyebrow">Nanoka 3.5 database</span><h2>Browse the complete archive</h2><p>Explore imported characters, weapons, Sonata sets, and Echo metadata.</p><div className="home-archive-counts"><span><b>{characterCatalog.length}</b>Characters</span><span><b>{weaponCatalog.length}</b>Weapons</span></div><button onClick={() => navigate('archive')}>Open database <span>→</span></button></article>
    </div>

    <article className="home-community">
      <div className="home-community-copy"><span className="eyebrow">Community signal</span><h2>Help shape Tacet Lab</h2><p>Have a suggestion? Found a bug? Want to test new scanner layouts, calculations, or features before release? Join the community and help make the project better.</p><div className="home-community-points"><span><b>01</b>Share feedback</span><span><b>02</b>Become a tester</span><span><b>03</b>Follow development</span></div></div>
      <div className="home-community-actions">
        <a className="home-community-primary" href="https://discord.gg/fy66NmapWb" target="_blank" rel="noreferrer"><span><strong>Join the Discord</strong><small>Suggestions, testing, and project chat</small></span><b>↗</b></a>
        <a href="https://github.com/DhruvJ12421/WuWa-Optimizer" target="_blank" rel="noreferrer"><span><strong>View on GitHub</strong><small>Explore the source and development history</small></span><b>↗</b></a>
        <a href="https://github.com/DhruvJ12421/WuWa-Optimizer/issues/new" target="_blank" rel="noreferrer"><span><strong>Report an issue</strong><small>Share a reproducible bug or problem</small></span><b>↗</b></a>
      </div>
    </article>
  </section>
}
