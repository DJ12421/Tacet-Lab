import { useEffect, useRef, useState } from 'react'
import type { AccountDocument } from '../domain/types'
import { importAccount, prepareAccountBackup, previewAccountImport, type AccountImportPreview } from '../storage/database'
import { convertWutheringToolsExport, isWutheringToolsExport, type WutheringToolsCharacterChoice } from '../storage/import-wuthering-tools'
import { Icon, Panel } from './primitives'

interface ImportDataModalProps {
  onClose: () => void
  onImported: (preview: AccountImportPreview) => Promise<void> | void
}

function formattedExportDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function ImportDataModal({ onClose, onImported }: ImportDataModalProps) {
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('Choose a Tacet Lab or Wuthering Tools JSON export')
  const [account, setAccount] = useState<AccountDocument>()
  const [preview, setPreview] = useState<AccountImportPreview>()
  const [repairs, setRepairs] = useState<string[]>([])
  const [sourceNotices, setSourceNotices] = useState<string[]>([])
  const [sourceLabel, setSourceLabel] = useState('')
  const [sourceCharacters, setSourceCharacters] = useState<WutheringToolsCharacterChoice[]>([])
  const [wutheringToolsSource, setWutheringToolsSource] = useState<Record<string, unknown>>()
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const analysisRef = useRef(0)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !importing) onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [importing, onClose])

  const prepare = async (parsed: unknown, analysisId: number, choices: Record<string, boolean> = {}) => {
    const converted = isWutheringToolsExport(parsed) ? await convertWutheringToolsExport(parsed, choices) : undefined
    const prepared = prepareAccountBackup(converted?.document ?? parsed)
    const nextPreview = await previewAccountImport(prepared.document)
    if (analysisId !== analysisRef.current) return
    setAccount(prepared.document)
    setPreview(nextPreview)
    setRepairs(prepared.repairs)
    setSourceNotices(converted?.notices ?? [])
    setSourceLabel(converted ? 'Wuthering Tools v9' : '')
    setSourceCharacters(converted?.choices ?? [])
    setWutheringToolsSource(converted ? parsed as Record<string, unknown> : undefined)
  }

  const analyze = async (nextRaw: string, nextFileName = 'Pasted JSON data', pasted = false) => {
    const analysisId = ++analysisRef.current
    setRaw(pasted ? nextRaw : '')
    setFileName(nextFileName)
    setAccount(undefined)
    setPreview(undefined)
    setRepairs([])
    setSourceNotices([])
    setSourceLabel('')
    setSourceCharacters([])
    setWutheringToolsSource(undefined)
    setError('')
    if (!nextRaw.trim()) {
      setAnalyzing(false)
      if (!pasted) setError('This file is empty. Choose a Tacet Lab JSON backup.')
      return
    }
    try {
      const parsed: unknown = JSON.parse(nextRaw)
      setAnalyzing(true)
      await prepare(parsed, analysisId)
    } catch (caught) {
      if (analysisId !== analysisRef.current) return
      setError(caught instanceof SyntaxError ? `The JSON is incomplete or malformed. ${caught.message}` : caught instanceof Error ? caught.message : 'Could not analyze this import.')
    } finally {
      if (analysisId === analysisRef.current) setAnalyzing(false)
    }
  }

  const setBuildChoice = async (catalogId: string, enabled: boolean) => {
    if (!wutheringToolsSource) return
    const analysisId = ++analysisRef.current
    const choices = Object.fromEntries(sourceCharacters.map((choice) => [choice.catalogId, choice.catalogId === catalogId ? enabled : choice.addAsNewBuild]))
    setAnalyzing(true)
    setAccount(undefined)
    setPreview(undefined)
    setError('')
    try { await prepare(wutheringToolsSource, analysisId, choices) }
    catch (caught) { if (analysisId === analysisRef.current) setError(caught instanceof Error ? caught.message : 'Could not update the import preview.') }
    finally { if (analysisId === analysisRef.current) setAnalyzing(false) }
  }

  const chooseFile = async (file?: File) => {
    if (!file) return
    try {
      await analyze(await file.text(), file.name)
    } catch (caught) {
      setError(caught instanceof Error ? `Could not read ${file.name}: ${caught.message}` : 'Could not read this file.')
    }
  }

  const merge = async () => {
    if (!account || !preview || importing) return
    setImporting(true)
    setError('')
    try {
      const result = await importAccount(account)
      await onImported(result)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed.')
      setImporting(false)
    }
  }

  const hasChanges = Boolean(preview && (preview.added > 0 || preview.updated > 0))

  return <div className="modal-backdrop import-data-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !importing) onClose() }}>
    <Panel className="import-data-modal" role="dialog" aria-modal="true" aria-labelledby="import-data-title">
      <header className="import-data-header">
        <div><span className="eyebrow">Your data · Restore</span><h2 id="import-data-title">Import a backup</h2><p>Choose a Tacet Lab or Wuthering Tools JSON export, then review every change before merging.</p></div>
        <button className="close" aria-label="Close import" disabled={importing} onClick={onClose}>×</button>
      </header>

      <div className="import-data-scroll">
      <section className="import-data-source">
        <div className="import-file-row">
          <button className="secondary" type="button" autoFocus disabled={importing} onClick={() => fileRef.current?.click()}><Icon name="upload"/>Choose backup</button>
          <div><Icon name="build"/><span>{fileName}</span></div>
          <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = '' }}/>
        </div>
        <div className="import-guardrails" aria-label="Import behavior">
          <div><Icon name="lock"/><span><strong>Current data stays</strong><small>Existing records are never deleted.</small></span></div>
          <div><Icon name="build"/><span><strong>Duplicates are skipped</strong><small>Only new and changed records are merged.</small></span></div>
          <div><Icon name="settings"/><span><strong>Optimizer stays local</strong><small>Profiles and old run history are ignored.</small></span></div>
        </div>
        <details className="import-paste"><summary>Paste JSON instead</summary><label className="import-json-input"><span>Account JSON</span><textarea spellCheck={false} value={raw} disabled={importing} placeholder="Paste a Tacet Lab account export here…" onChange={(event) => void analyze(event.target.value, 'Pasted JSON data', true)}/></label></details>
        {error && <div className="import-message error" role="alert"><strong>Could not prepare import</strong><span>{error}</span></div>}
        {analyzing && <div className="import-message"><span className="import-spinner"/><span>Comparing the import with your local database…</span></div>}
      </section>

      {preview && <section className="import-preview">
        <header>
          <div><span className="eyebrow">Import preview</span><h3>{sourceLabel || preview.gameDataVersion || 'Tacet Lab backup'}</h3></div>
          <div><span>Schema v{preview.schemaVersion}</span><small>Exported {formattedExportDate(preview.exportedAt)}</small></div>
        </header>
        {sourceNotices.length > 0 && <div className="import-repair-notice" role="status"><strong>Wuthering Tools import notes</strong><ul>{sourceNotices.map((notice) => <li key={notice}>{notice}</li>)}</ul></div>}
        {sourceCharacters.some((choice) => choice.existing) && <section className="import-build-choices" aria-label="Build import choices"><h3>For each existing character</h3>{sourceCharacters.filter((choice) => choice.existing).map((choice) => <label key={choice.catalogId}><span><strong>{choice.name}</strong><small>{choice.addAsNewBuild ? 'Save separately; keep Equipped' : 'Replace Equipped with this import'}</small></span><input type="checkbox" checked={choice.addAsNewBuild} disabled={importing || analyzing} onChange={(event) => void setBuildChoice(choice.catalogId, event.target.checked)}/><span>Add as new build</span></label>)}</section>}
        {repairs.length > 0 && <div className="import-repair-notice" role="status"><strong>Timing recovered from this backup</strong><p>{repairs.length} rotation action{repairs.length === 1 ? '' : 's'} had missing timing. Tacet Lab estimated the values below. Review these actions after import.</p><ul>{repairs.map((repair) => <li key={repair}>{repair}</li>)}</ul></div>}
        <div className="import-summary-strip">
          <div><span>New</span><strong>{preview.added}</strong></div>
          <div><span>Updates</span><strong>{preview.updated}</strong></div>
          <div><span>Duplicates</span><strong>{preview.duplicates}</strong></div>
          <p><Icon name="lock"/>Additive merge only. No current records will be removed.</p>
        </div>
        <div className="import-collection-grid">
          {preview.collections.map((collection) => <article key={collection.key} className={collection.incoming ? '' : 'empty'}>
            <header><strong>{collection.label}</strong><b>{collection.incoming} incoming</b></header>
            <dl>
              <div><dt>New</dt><dd className="new">+{collection.added}</dd></div>
              <div><dt>Updates</dt><dd className="updated">{collection.updated}</dd></div>
              <div><dt>Duplicates</dt><dd>{collection.duplicates}</dd></div>
              <div className="merged"><dt>Merged total</dt><dd>{collection.current} → {collection.result}</dd></div>
            </dl>
          </article>)}
        </div>
      </section>}
      </div>

      <footer className="import-data-actions">
        <div>{preview && sourceLabel && !sourceCharacters.length ? <span>No new character or build data to import.</span> : preview && !hasChanges ? <span>Everything in this backup is already present.</span> : sourceCharacters.some((choice) => choice.existing && !choice.addAsNewBuild) ? <span>Equipped will be replaced for characters with the toggle off.</span> : repairs.length ? <span>Review the recovered timing before applying changes.</span> : <span>New records are added; matching records are updated.</span>}</div>
        <button className="secondary" type="button" disabled={importing} onClick={onClose}>Cancel</button>
        <button className="primary" type="button" disabled={!hasChanges || importing || analyzing} onClick={() => void merge()}><Icon name="upload"/>{importing ? 'Merging…' : `Apply ${(preview?.added ?? 0) + (preview?.updated ?? 0)} changes`}</button>
      </footer>
    </Panel>
  </div>
}
