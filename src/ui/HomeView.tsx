import { useEffect, useState } from 'react'
import { generatedCharacterSummaries as characterCatalog } from '../game-data/character-summaries.generated'
import { generatedWeaponSummaries as weaponCatalog } from '../game-data/weapon-summaries.generated'
import type { AppSettings, AppView, Build, Echo, OwnedCharacter, OwnedWeapon, Team } from '../domain/types'
import { getSettings, saveSettings } from '../storage/database'
import { EchoWaveform } from './EchoWaveform'
import { Icon } from './primitives'
import './home-view.css'
import './home-changelog.css'

interface HomeViewProps {
  echoes: Echo[]
  characters: OwnedCharacter[]
  weapons: OwnedWeapon[]
  builds: Build[]
  teams: Team[]
  navigate: (view: AppView) => void
}

type HomeSettings = AppSettings & { homeFeaturedCharacterId?: string }
const sidebarIconRoot = `${import.meta.env.BASE_URL}sidebar-icons/`
const sidebarIconFiles: Partial<Record<AppView, string>> = {
  dashboard: 'home.svg',
  archive: 'archive.svg',
  echoes: 'echoes.svg',
  weapons: 'weapons.svg',
  characters: 'characters.svg',
  teams: 'teams.webp'
}

function HomeNavIcon({ view }: { view: AppView }) {
  const source = sidebarIconFiles[view]
  if (source) return <img className="home-nav-icon" src={`${sidebarIconRoot}${source}`} alt=""/>
  return <Icon name={view === 'scanner' ? 'scan' : view === 'teams' ? 'team' : 'home'}/>
}

const quickStarts = [
  { view: 'scanner' as const, number: '01', title: 'Scan your collection', description: 'Import Echoes and character build cards.' },
  { view: 'characters' as const, number: '02', title: 'Check their builds', description: 'Review equipment, stats, and damage.' },
  { view: 'teams' as const, number: '03', title: 'See what works', description: 'Compare builds, damage, and teams.' }
]

const changelogEntries = [
  { hash: '88c13dc', date: 'Aug 31, 2026', title: 'Add ranked Team Theorizer comparisons' },
  { hash: '88c13dc', date: 'Aug 31, 2026', title: 'Enforce character-restricted Sonata effects' },
  { hash: '88c13dc', date: 'Aug 31, 2026', title: 'Redesign mobile navigation and responsive workflows' },
  { hash: '88c13dc', date: 'Aug 31, 2026', title: 'Improve Archive, Echo, and weapon inventory controls' },
  { hash: '88c13dc', date: 'Aug 31, 2026', title: 'Add live character artwork settings and card polish' },
  { hash: '88c13dc', date: 'Aug 31, 2026', title: 'Refine scanner calibration and review controls' },
  { hash: '88c13dc', date: 'Aug 31, 2026', title: 'Improve site discovery metadata and app visuals' },
  { hash: '1ba32e2', date: 'Aug 28, 2026', title: 'Fix scanner build-card type integration' },
  { hash: 'e70a3f9', date: 'Aug 28, 2026', title: 'Add the local scanner signature command' },
  { hash: '97dc7b8', date: 'Aug 28, 2026', title: 'Make the skill popover independent of test fixtures' },
  { hash: '9cc3156', date: 'Aug 28, 2026', title: 'Preserve theorycraft substat narrowing' },
  { hash: 'f90d565', date: 'Aug 28, 2026', title: 'Fix missing loadout UI dependencies' },
  { hash: '6d710b4', date: 'Aug 28, 2026', title: 'Fix Teams section rendering' },
  { hash: '9455c1d', date: 'Aug 28, 2026', title: 'Fix the legal substat slot fixture' },
  { hash: 'ec249c5', date: 'Aug 28, 2026', title: 'Narrow legacy substat mode in the editor' },
  { hash: 'db5a3ba', date: 'Aug 28, 2026', title: 'Fix inventory foundation type errors' },
  { hash: '8f480a0', date: 'Aug 28, 2026', title: 'Fix character card test assumptions' },
  { hash: '513d074', date: 'Aug 28, 2026', title: 'Adjust the default character card artwork position' },
  { hash: '78ef342', date: 'Aug 28, 2026', title: 'Add the inventory and loadout foundation' },
  { hash: 'ffd9ce1', date: 'Aug 28, 2026', title: 'Add character loadout and scoring UI' },
  { hash: '2ce1d76', date: 'Aug 28, 2026', title: 'Improve scanner formats and OCR' },
  { hash: '87cfb24', date: 'Aug 28, 2026', title: 'Polish the Archive and PWA experience' },
  { hash: '912e066', date: 'Aug 27, 2026', title: 'Redirect the Pages root to the homepage' },
  { hash: 'dd656ea', date: 'Aug 25, 2026', title: 'Add character card layout controls' },
  { hash: '9e46bb9', date: 'Aug 23, 2026', title: 'Update the GitHub Pages URL' },
  { hash: '74e4cf6', date: 'Aug 23, 2026', title: 'Remove the custom domain configuration' },
  { hash: 'b8687d4', date: 'Aug 23, 2026', title: 'Update the custom domain configuration' },
  { hash: '5d64947', date: 'Aug 23, 2026', title: 'Add the custom domain configuration' },
  { hash: '9630484', date: 'Aug 19, 2026', title: 'Polish scrolling and update the changelog' },
  { hash: 'e7bcaa5', date: 'Aug 19, 2026', title: 'Update game data and characters for version 3.6' },
  { hash: 'd00cd2f', date: 'Aug 17, 2026', title: 'Improve character card layouts and exports' },
  { hash: '296bdfa', date: 'Aug 17, 2026', title: 'Expand loadout workflows and refresh app UI' },
  { hash: 'c198e19', date: 'Aug 10, 2026', title: 'Improve teams, Echo inventory, calculations, and app updates' },
  { hash: 'f947d9a', date: 'Aug 6, 2026', title: 'Fix sidebar auto-hide behavior' },
  { hash: 'a91225c', date: 'Aug 6, 2026', title: 'Stabilize optimizer and refine team UI' },
  { hash: '644b989', date: 'Aug 6, 2026', title: 'Expand optimizer and team workflows' },
  { hash: '6310093', date: 'Jul 30, 2026', title: 'Extend home cards to right edge' },
  { hash: '4957c53', date: 'Jul 30, 2026', title: 'Add Calculation V2 and route-aware UI' },
  { hash: '4e1e21a', date: 'Jul 29, 2026', title: 'Refresh game data and refine optimizer UI' },
  { hash: '6c52ea1', date: 'Jul 28, 2026', title: 'Update default scanner calibrations' },
  { hash: '609dfd3', date: 'Jul 28, 2026', title: 'Improve Echo scoring and scanner reliability' },
  { hash: '7ab7694', date: 'Jul 28, 2026', title: 'Revise Echo roll grading system' },
  { hash: 'b9e7965', date: 'Jul 28, 2026', title: 'Add privacy and community resources' },
  { hash: '54665ca', date: 'Jul 27, 2026', title: 'Improve scanner, Tune Break, and character exports' },
  { hash: 'c1ce98f', date: 'Jul 26, 2026', title: 'Add team gallery and character overview calculations' },
  { hash: '18b338a', date: 'Jul 25, 2026', title: 'Update team formula trace assertion' },
  { hash: 'ffb4bfe', date: 'Jul 25, 2026', title: 'Improve damage calculations and formula details' },
  { hash: 'b5c4f85', date: 'Jul 25, 2026', title: 'Refactor optimizer data and calculation architecture' },
  { hash: 'bbcf8e9', date: 'Jul 23, 2026', title: 'Add shared character condition calculations' },
  { hash: 'ee8e8a4', date: 'Jul 19, 2026', title: 'Fix Crit stat sentence parsing' },
  { hash: '31fa9e7', date: 'Jul 19, 2026', title: 'Fix missing Vitest imports' },
  { hash: '71959d3', date: 'Jul 19, 2026', title: 'Add clipboard pasting and multi-import to scanner' },
  { hash: '21f4dd0', date: 'Jul 19, 2026', title: 'Add passive stats and calculation details' },
  { hash: '27d76da', date: 'Jul 18, 2026', title: 'Add safe PWA update prompt' },
  { hash: '9e025cf', date: 'Jul 18, 2026', title: 'Add formula engine and scanner persistence' },
  { hash: 'a33c24d', date: 'Jul 15, 2026', title: 'Expand character and team workspaces' },
  { hash: '1b2707f', date: 'Jul 15, 2026', title: 'Fix scan review picker test' },
  { hash: '8527551', date: 'Jul 15, 2026', title: 'Overhaul Echo scanning pipeline' },
  { hash: 'de6e072', date: 'Jul 14, 2026', title: 'Expand character builds and team management' },
  { hash: 'fec4838', date: 'Jul 13, 2026', title: 'Update README for current Tacet Lab experience' },
  { hash: '4544918', date: 'Jul 13, 2026', title: 'Expand local archive and catalog support' },
  { hash: '21600e6', date: 'Jul 13, 2026', title: 'Improve live Echo scanning responsiveness' },
  { hash: '2036e54', date: 'Jul 13, 2026', title: 'Fix Nanoka-backed Echo parsing' },
  { hash: '1b23720', date: 'Jul 12, 2026', title: 'Add Echo data and update scanner support' },
  { hash: '6abe006', date: 'Jul 12, 2026', title: 'Enable GitHub Pages setup' },
  { hash: '88384ae', date: 'Jul 12, 2026', title: 'Initial Tacet Lab implementation' }
]

export function HomeView({ echoes, characters, builds, teams, navigate }: HomeViewProps) {
  const [showAllChanges, setShowAllChanges] = useState(false)
  const [heroPickerOpen, setHeroPickerOpen] = useState(false)
  const [heroControlDismissed, setHeroControlDismissed] = useState(false)
  const [featuredCharacterId, setFeaturedCharacterId] = useState('1506')
  useEffect(() => { void getSettings().then((settings) => setFeaturedCharacterId((settings as HomeSettings).homeFeaturedCharacterId ?? '1506')) }, [])
  const featured = characterCatalog.find((entry) => entry.id === featuredCharacterId)
    ?? characterCatalog.find((entry) => entry.name === 'Phoebe')
    ?? characterCatalog[0]
  const hasStarted = characters.length + echoes.length + builds.length + teams.length > 0
  const completeBuilds = builds.filter((build) => build.echoIds.length === 5).length
  const primaryView: AppView = hasStarted ? 'characters' : 'scanner'
  const changeFeaturedCharacter = async (characterId: string) => {
    const previous = featuredCharacterId
    setFeaturedCharacterId(characterId)
    try {
      const settings = await getSettings()
      await saveSettings({ ...settings, homeFeaturedCharacterId: characterId } as HomeSettings)
    } catch {
      setFeaturedCharacterId(previous)
    }
  }
  const closeHeroPicker = () => {
    setHeroPickerOpen(false)
    setHeroControlDismissed(true)
  }

  return <section className={`home-view home-element-${featured.element.toLowerCase()}`}>
    <article className="home-hero">
      <div className="home-hero-grid"/>
      <img className="home-hero-art" src={featured.portraitSourceUrl || featured.iconSourceUrl} alt=""/>
      <div className="home-hero-art-zone" onMouseEnter={() => setHeroControlDismissed(false)} onMouseLeave={closeHeroPicker}>
        <div className={`home-hero-character-control${heroPickerOpen ? ' is-open' : ''}${heroControlDismissed ? ' is-dismissed' : ''}`}>
          <div className="home-hero-character-pill"><span>{featured.name}</span><b aria-hidden="true">⌄</b></div>
          {heroPickerOpen && <div className="home-hero-character-menu" role="listbox" aria-label="Home hero character">{characterCatalog.map((entry) => <button type="button" role="option" aria-selected={entry.id === featured.id} className={entry.id === featured.id ? 'is-selected' : ''} key={entry.id} onClick={() => { closeHeroPicker(); void changeFeaturedCharacter(entry.id) }}><img src={entry.iconSourceUrl} alt=""/><span>{entry.name}</span></button>)}</div>}
          <button type="button" aria-label="Change home character" title="Change home character" aria-expanded={heroPickerOpen} onClick={() => { if (heroPickerOpen) closeHeroPicker(); else setHeroPickerOpen(true) }}><Icon name="settings"/></button>
        </div>
      </div>
      <div className="home-hero-copy">
        <span className="home-kicker">Tacet Lab Optimizer</span>
        <h1>Build stronger teams.<br/><em>Without the guesswork.</em></h1>
        <p>Pick a character, add your Echoes, and see what improves your damage.</p>
        <div className="home-hero-actions">
          <button className="primary" onClick={() => navigate(primaryView)}>{hasStarted ? 'Continue your build' : 'Start scanning'}<span aria-hidden="true">→</span></button>
          <button className="secondary" onClick={() => navigate(hasStarted ? 'scanner' : 'archive')}><HomeNavIcon view={hasStarted ? 'scanner' : 'archive'}/>{hasStarted ? 'Add my Echoes' : 'Browse characters'}</button>
        </div>
        <div className="home-trust-line"><Icon name="lock"/><span>Free · No account · Your data stays on this device</span></div>
      </div>
      <EchoWaveform element={featured.element}/>
    </article>

    <section className="home-start" aria-labelledby="home-start-title">
      <div className="home-section-heading"><span className="eyebrow">New here?</span><h2 id="home-start-title">Start in three simple steps</h2></div>
      <div className="home-steps">{quickStarts.map((item) => <button key={item.view} className="home-step" onClick={() => navigate(item.view)}><span className="home-step-number">{item.number}</span><span className="home-step-icon"><HomeNavIcon view={item.view}/></span><span className="home-step-copy"><strong>{item.title}</strong><small>{item.description}</small></span><b aria-hidden="true">→</b></button>)}</div>
    </section>

    <article className="home-account-band">
      <div><span className="eyebrow">Your collection</span><h2>{hasStarted ? 'Welcome back' : 'Ready when you are'}</h2></div>
      <dl><div><dd>{characters.length}</dd><dt>Characters</dt></div><div><dd>{echoes.length}</dd><dt>Echoes</dt></div><div><dd>{completeBuilds}</dd><dt>Full builds</dt></div><div><dd>{teams.length}</dd><dt>Teams</dt></div></dl>
      <button className="home-collection-action" onClick={() => navigate(hasStarted ? 'characters' : 'scanner')}>{hasStarted ? 'Open collection' : 'Add your first Echo'}<span aria-hidden="true">→</span></button>
    </article>

    <div className="home-discover">
      <button onClick={() => navigate('archive')}><span><HomeNavIcon view="archive"/></span><div><strong>Explore the game database</strong><small>{characterCatalog.length} characters · {weaponCatalog.length} weapons</small></div><b aria-hidden="true">→</b></button>
      <button onClick={() => navigate('echoes')}><span><HomeNavIcon view="echoes"/></span><div><strong>Browse your Echoes</strong><small>Filter, compare, and edit your collection</small></div><b aria-hidden="true">→</b></button>
      <button onClick={() => navigate('teams')}><span><HomeNavIcon view="teams"/></span><div><strong>Plan a team</strong><small>Put three characters together</small></div><b aria-hidden="true">→</b></button>
    </div>

    <article className="home-community">
      <div><Icon name="discord"/><span><strong>Tacet Lab community</strong><small>Questions, feedback, and updates</small></span></div>
      <nav aria-label="Community links"><a href="https://discord.gg/fy66NmapWb" target="_blank" rel="noreferrer">Join Discord</a><a href="https://github.com/dj12421/Tacet-Lab/issues/new" target="_blank" rel="noreferrer">Report a bug</a><a href="https://github.com/dj12421/Tacet-Lab" target="_blank" rel="noreferrer">GitHub</a></nav>
    </article>

    <article className="home-changelog">
      <header className="home-changelog-header">
        <div><span className="eyebrow">What’s new</span><h2>Recent updates</h2></div>
        <a href="https://github.com/dj12421/Tacet-Lab/commits/main/" target="_blank" rel="noreferrer">Full history <span aria-hidden="true">→</span></a>
      </header>
      <ol className="home-changelog-list">
        {(showAllChanges ? changelogEntries : changelogEntries.slice(0, 3)).map((entry) => <li key={`${entry.hash}:${entry.title}`}><time>{entry.date}</time><div><h3>{entry.title}</h3><a href={`https://github.com/dj12421/Tacet-Lab/commit/${entry.hash}`} target="_blank" rel="noreferrer">{entry.hash} <span aria-hidden="true">→</span></a></div></li>)}
      </ol>
      <button className="home-changelog-toggle" type="button" aria-expanded={showAllChanges} onClick={() => setShowAllChanges((current) => !current)}>{showAllChanges ? 'Show less' : `See all ${changelogEntries.length} updates`}</button>
    </article>
  </section>
}
