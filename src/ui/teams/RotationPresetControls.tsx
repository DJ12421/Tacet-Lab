import { useRef, useState } from 'react'
import { createLocalId } from '../../domain/id'
import { createRotationPreset, parseRotationPresetDocument, previewRotationPreset, type RotationPresetDocument } from '../../domain/rotation-presets'
import type { Team } from '../../domain/types'
import { bundledRotationPresets } from '../../game-data/rotation-presets.generated'
import type { TeamWorkspaceModel } from '../team-workspace-model'

interface Props {
  model: TeamWorkspaceModel
  updateTeam: (patch: Partial<Team>) => Promise<void>
  onApplied: () => void
}

const memberName = (member: TeamWorkspaceModel['members'][number]) => member.catalog?.name ?? member.build?.name ?? `Member ${member.slot + 1}`

export function RotationPresetControls({ model, updateTeam, onApplied }: Props) {
  const [message, setMessage] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const members = model.members.flatMap((member) => member.build ? [{
    slot:member.slot, buildId:member.build.id, catalogId:member.catalog?.id ?? '', name:memberName(member), attackIds:member.attacks.map((attack) => attack.id)
  }] : [])
  const presets = [...bundledRotationPresets, ...(model.team.rotationPresets ?? [])]

  const download = (preset: RotationPresetDocument) => {
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type:'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = `${preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rotation'}.tacet-rotation.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000)
  }

  const apply = async (preset: RotationPresetDocument) => {
    const preview = previewRotationPreset(preset, members)
    const warnings = preview.warnings.length ? `\n\nWarnings:\n${preview.warnings.map((warning) => `• ${warning}`).join('\n')}` : ''
    if (!preview.compatible) {
      setMessage(`Cannot apply ${preset.name}. ${preview.warnings.join(' ')}`)
      return
    }
    if (!window.confirm(`Replace the current ${model.team.actions.length}-action rotation with ${preview.actions.length} actions from “${preset.name}”?${warnings}`)) return
    await updateTeam({ actions:preview.actions, rotationDuration:preset.duration })
    onApplied()
    setMessage(`Applied ${preset.name}${preview.warnings.length ? ' with warnings' : ''}.`)
  }

  const save = async () => {
    const name = window.prompt('Preset name', `${model.team.name} rotation`)?.trim()
    if (!name) return
    const preset = createRotationPreset(model.team, members, name)
    await updateTeam({ rotationPresets:[...(model.team.rotationPresets ?? []), preset] })
    setMessage(`Saved ${preset.name} as a user preset.`)
  }

  const importFile = async (file?: File) => {
    if (!file) return
    try {
      const preset = parseRotationPresetDocument(JSON.parse(await file.text()))
      const preview = previewRotationPreset(preset, members)
      if (!preview.compatible) throw new Error(`Preset is not compatible with this team. ${preview.warnings.join(' ')}`)
      const stored = { ...preset, id:createLocalId(), source:'user' as const, createdAt:Date.now() }
      await updateTeam({ rotationPresets:[...(model.team.rotationPresets ?? []), stored] })
      setMessage(`Imported ${stored.name}. Review and apply it when ready.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Rotation preset could not be imported.')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  return <section className="tw-rotation-presets" aria-label="Rotation presets">
    <header><div><span className="eyebrow">Reusable rotations</span><h3>Presets</h3><p>Import community JSON, save this timeline, or export a stable character-and-attack document to share.</p></div><div><button type="button" className="secondary" onClick={() => void save()}>Save current</button><button type="button" className="secondary" onClick={() => download(createRotationPreset(model.team, members, `${model.team.name} rotation`))}>Export current</button><button type="button" className="secondary" onClick={() => importRef.current?.click()}>Import JSON</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importFile(event.target.files?.[0])}/></div></header>
    {presets.length ? <div className="tw-preset-list">{presets.map((preset) => <article key={preset.id}><span><strong>{preset.name}</strong><small>{preset.actions.length} actions · {preset.duration}s · {preset.source === 'bundled' ? 'Bundled' : 'User preset'}</small></span><div><button type="button" onClick={() => void apply(preset)}>Preview & apply</button><button type="button" aria-label={`Export ${preset.name}`} onClick={() => download(preset)}>Export</button>{preset.source !== 'bundled' && <button type="button" aria-label={`Delete ${preset.name}`} onClick={() => { if (window.confirm(`Delete “${preset.name}”?`)) void updateTeam({ rotationPresets:model.team.rotationPresets?.filter((entry) => entry.id !== preset.id) }) }}>Delete</button>}</div></article>)}</div> : <p className="tw-empty-state">No saved presets yet. Imported rotations stay local until you export and share their JSON.</p>}
    {message && <p className="tw-preset-message" role="status">{message}</p>}
  </section>
}
