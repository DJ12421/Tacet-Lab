import { useEffect, useState } from 'react'
import { exportAccount, prepareAccountBackup } from '../storage/database'
import { Icon, Panel } from './primitives'

interface ExportDataModalProps {
  onClose: () => void
  onExported: () => void
}

export function ExportDataModal({ onClose, onExported }: ExportDataModalProps) {
  const [payload, setPayload] = useState('')
  const [counts, setCounts] = useState<Array<[string, number]>>([])
  const [repairs, setRepairs] = useState<string[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void exportAccount().then((snapshot) => {
      const prepared = prepareAccountBackup(snapshot)
      const serialized = JSON.stringify(prepared.document, null, 2)
      const checked = prepareAccountBackup(JSON.parse(serialized))
      if (checked.repairs.length) throw new Error('Rotation timing changed while preparing the file. Export was stopped to protect your backup.')
      if (!active) return
      setPayload(serialized)
      setRepairs(prepared.repairs)
      setCounts([
        ['Echoes', prepared.document.echoes.length], ['Characters', prepared.document.characters.length],
        ['Weapons', prepared.document.weapons.length], ['Saved builds', prepared.document.builds.length],
        ['Equipped loadouts', prepared.document.equippedLoadouts?.length ?? 0],
        ['Theorycraft builds', prepared.document.theorycraftBuilds?.length ?? 0],
        ['Teams and rotations', prepared.document.teams.length]
      ])
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not prepare this backup.') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const download = () => {
    if (!payload) return
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `tacet-lab-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    onExported()
    onClose()
  }

  return <div className="modal-backdrop import-data-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <Panel className="import-data-modal export-data-modal" role="dialog" aria-modal="true" aria-labelledby="export-data-title">
      <header className="import-data-header"><div><span className="eyebrow">Your data · Backup</span><h2 id="export-data-title">Export your account</h2><p>Download your inventory, builds, teams, and account preferences.</p></div><button className="close" autoFocus aria-label="Close export" onClick={onClose}>×</button></header>
      <div className="import-data-scroll export-data-content">
        <div className="export-data-intro"><Icon name="download"/><div><strong>Account backup · Schema v7</strong><span>Includes Echoes, inventory, builds, teams, rotation actions and their timing, and account preferences.</span></div></div>
        {error ? <div className="import-message error" role="alert"><strong>Export unavailable</strong><span>{error}</span></div> : !payload ? <div className="import-message" role="status"><span className="import-spinner"/>Checking account data…</div> : <>
          {repairs.length > 0 && <div className="import-repair-notice" role="status"><strong>Rotation timing recovered</strong><p>{repairs.length} action{repairs.length === 1 ? '' : 's'} had missing timing in local storage. This backup includes estimated timing; review the action after import.</p><ul>{repairs.map((repair) => <li key={repair}>{repair}</li>)}</ul></div>}
          <div className="export-data-list" aria-label="Backup contents">{counts.map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
          <p className="export-data-note">Optimizer filters and past search results are not included.</p>
          <p className="export-data-note"><Icon name="lock"/>The file is saved by your browser. No account data is uploaded.</p>
        </>}
      </div>
      <footer className="import-data-actions"><div>{payload ? 'Backup checked and ready to download.' : error ? 'Fix the listed issue before exporting.' : 'Preparing a complete backup…'}</div><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!payload} onClick={download}><Icon name="download"/>Download backup</button></footer>
    </Panel>
  </div>
}
