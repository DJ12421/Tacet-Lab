import { calculateRotation, formatDamage } from '../domain/damage'
import { resonators, weapons } from '../game-data'
import type { Build, Echo, Team } from '../domain/types'
import { Icon, PageHeader, Panel } from './components'
import { CalculatedValue } from './CalculationDetails'
import { sumDetail } from './calculation-detail-model'

export function DashboardView({ echoes, builds, teams, navigate }: { echoes: Echo[]; builds: Build[]; teams: Team[]; navigate: (view: 'scanner' | 'builds' | 'teams') => void }) {
  const team = teams[0]
  const rotation = team ? calculateRotation(team, builds, resonators, weapons, echoes) : undefined
  const assigned = echoes.filter((echo) => echo.equippedBy).length
  return <>
    <PageHeader eyebrow="Local signal / English OCR" title="Your account, decoded." description="Scan the game window, test complete teams, and turn inventory noise into a build you can act on." actions={<button className="primary" onClick={() => navigate('scanner')}><Icon name="scan"/>Start scanning</button>} />
    <div className="metric-grid">
      <Panel><span>Echo archive</span><strong>{echoes.length}</strong><small>{assigned} assigned to builds</small></Panel>
      <Panel><span>Active builds</span><strong>{builds.length}</strong><small>{builds.filter((build) => build.echoIds.length === 5).length} complete loadouts</small></Panel>
      <Panel><span>Primary rotation</span>{rotation ? <><CalculatedValue detail={sumDetail('Primary rotation', rotation.total, rotation.actions.map((action) => ({ label: `${action.timestamp.toFixed(1)}s action`, value: action.expected })))}><strong>{formatDamage(rotation.total)}</strong></CalculatedValue><small><CalculatedValue detail={sumDetail('Expected DPS', rotation.dps, [{ label: 'Rotation total', value: rotation.total }, { label: 'Duration', value: team?.rotationDuration ?? 0 }], 'Rotation total ÷ duration')}>{formatDamage(rotation.dps)} expected DPS</CalculatedValue></small></> : <><strong>0</strong><small>Awaiting team data</small></>}</Panel>
      <Panel className="signal-metric"><span>Data boundary</span><strong>LOCAL</strong><small>No account. No scan uploads. Your data stays local.</small></Panel>
    </div>
    <div className="dashboard-grid">
      <Panel className="hero-panel"><div className="radar"/><span className="eyebrow">Recommended next action</span><h2>{echoes.length ? 'Run an optimization pass' : 'Build your Echo archive'}</h2><p>{echoes.length ? 'Your inventory is ready to be evaluated against the current character and enemy configuration.' : 'Share the WuWa window and move through Echo detail screens. Stable panels are captured automatically.'}</p><button className="secondary" onClick={() => navigate(echoes.length ? 'teams' : 'scanner')}>{echoes.length ? 'Open teams' : 'Open capture lab'}<span>→</span></button></Panel>
      <Panel><div className="section-heading"><div><span className="eyebrow">Field unit</span><h2>{team?.name ?? 'No team'}</h2></div><button className="text-button" onClick={() => navigate('builds')}>View builds</button></div><div className="unit-list">{builds.map((build) => { const resonator = resonators.find((item) => item.id === build.resonatorId); return <div className="unit-row" key={build.id}><div className="avatar" style={{ '--accent': resonator?.accent } as React.CSSProperties}>{resonator?.name.slice(0, 1)}</div><div><strong>{resonator?.name}</strong><span>{resonator?.role}</span></div><b>{build.echoIds.length}/5</b></div> })}</div></Panel>
    </div>
  </>
}
