import { useEffect, useRef, useState } from 'react'
import type { AccountDocument } from '../domain/types'
import { importAccount, previewAccountImport, validateAccount, type AccountImportPreview } from '../storage/database'
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
  const [fileName, setFileName] = useState('Choose a Tacet Lab JSON backup')
  const [account, setAccount] = useState<AccountDocument>()
  const [preview, setPreview] = useState<AccountImportPreview>()
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

  const analyze = async (nextRaw: string, nextFileName = 'Pasted JSON data') => {
    const analysisId = ++analysisRef.current
    setRaw(nextRaw)
    setFileName(nextFileName)
    setAccount(undefined)
    setPreview(undefined)
    setError('')
    if (!nextRaw.trim()) {
      setAnalyzing(false)
      return
    }
    try {
      const parsed: unknown = JSON.parse(nextRaw)
      if (!validateAccount(parsed)) throw new Error('This is not a supported Tacet Lab account backup.')
      setAnalyzing(true)
      const nextPreview = await previewAccountImport(parsed)
      if (analysisId !== analysisRef.current) return
      setAccount(parsed)
      setPreview(nextPreview)
    } catch (caught) {
      if (analysisId !== analysisRef.current) return
      setError(caught instanceof SyntaxError ? 'The JSON is incomplete or malformed.' : caught instanceof Error ? caught.message : 'Could not analyze this import.')
    } finally {
      if (analysisId === analysisRef.current) setAnalyzing(false)
    }
  }

  const chooseFile = async (file?: File) => {
    if (!file) return
    try {
      await analyze(await file.text(), file.name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read this file.')
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
        <div><span className="eyebrow">Local database merge</span><h2 id="import-data-title">Import account data</h2><p>Review exactly what will be added or updated before anything changes.</p></div>
        <button className="close" aria-label="Close import" disabled={importing} onClick={onClose}>×</button>
      </header>

      <section className="import-data-source">
        <div className="import-file-row">
          <button className="secondary" type="button" disabled={importing} onClick={() => fileRef.current?.click()}><Icon name="upload"/>Open JSON</button>
          <div><Icon name="build"/><span>{fileName}</span></div>
          <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = '' }}/>
        </div>
        <div className="import-guardrails" aria-label="Import behavior">
          <label><input type="checkbox" checked readOnly/><span><strong>Detect updates and duplicates</strong><small>Matching records are compared before import.</small></span></label>
          <label><input type="checkbox" checked readOnly/><span><strong>Keep all current data</strong><small>Nothing in this browser will be deleted.</small></span></label>
          <label><input type="checkbox" checked readOnly/><span><strong>Preserve local preferences</strong><small>Your current settings remain unchanged.</small></span></label>
        </div>
        <label className="import-json-input"><span>Or paste account JSON below</span><textarea spellCheck={false} value={raw} disabled={importing} placeholder="Paste a Tacet Lab account export here…" onChange={(event) => void analyze(event.target.value)}/></label>
        {error && <div className="import-message error"><strong>Import unavailable</strong><span>{error}</span></div>}
        {analyzing && <div className="import-message"><span className="import-spinner"/><span>Comparing the import with your local database…</span></div>}
      </section>

      {preview && <section className="import-preview">
        <header>
          <div><span className="eyebrow">Import preview</span><h3>{preview.gameDataVersion || 'Tacet Lab backup'}</h3></div>
          <div><span>Schema v{preview.schemaVersion}</span><small>Exported {formattedExportDate(preview.exportedAt)}</small></div>
        </header>
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

      <footer className="import-data-actions">
        <div>{preview && !hasChanges ? <span>Everything in this backup is already present.</span> : <span>Importing updates matching IDs and appends new records.</span>}</div>
        <button className="secondary" type="button" disabled={importing} onClick={onClose}>Cancel</button>
        <button className="primary" type="button" disabled={!hasChanges || importing || analyzing} onClick={() => void merge()}><Icon name="upload"/>{importing ? 'Merging…' : `Apply ${(preview?.added ?? 0) + (preview?.updated ?? 0)} changes`}</button>
      </footer>
    </Panel>
  </div>
}
