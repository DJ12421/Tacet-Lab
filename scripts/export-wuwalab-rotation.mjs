// Usage: node scripts/export-wuwalab-rotation.mjs [rotation-url [output.json]]
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const abilitiesPath = new URL('./wuwalab-attack-map.json', import.meta.url)

export function parseRotationUrl(input) {
  const url = new URL(input)
  const match = /^\/rotation\/([1-9]\d*)(?:\/(loop))?\/?$/.exec(url.pathname)
  if (url.protocol !== 'https:' || url.hostname !== 'wuwalab.com' || !match || url.search || url.hash ||
      (match && !Number.isSafeInteger(Number(match[1])))) {
    throw new Error('Expected a WuwaLab rotation URL, such as https://wuwalab.com/rotation/554/loop.')
  }
  return { id: Number(match[1]), segment: match[2] === 'loop' ? 'loop' : 'full' }
}

export function convertRotation(data, { id, segment }, abilities) {
  if (!data || !Array.isArray(data.team) || !Array.isArray(data.rows) || !data.meta || data.meta.id !== id || typeof data.meta.title !== 'string') {
    throw new Error('WuwaLab returned an unexpected rotation document.')
  }
  const slots = new Map(data.team.map((member, slot) => [member.id, slot]))
  if (data.team.length < 1 || data.team.length > 3 || slots.size !== data.team.length ||
      data.team.some((member) => !Number.isInteger(member.id) || typeof member.name !== 'string' || !Array.isArray(member.echoes))) {
    throw new Error('WuwaLab returned invalid character data.')
  }
  const range = segment === 'loop' ? data.loopRange : { start: 0, end: data.rows.length }
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 ||
      range.end > data.rows.length || range.start >= range.end) {
    throw new Error('This rotation has no usable actions in the selected segment.')
  }
  const startFrame = data.rows[range.start]?.frame
  const endFrame = segment === 'loop'
    ? data.rows[range.end]?.frame ?? startFrame + data.meta.loopFrames
    : data.meta.totalFrames
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || endFrame <= startFrame) {
    throw new Error('WuwaLab returned invalid rotation timing.')
  }
  const rows = data.rows.slice(range.start, range.end)
  if (rows.some((row) => !slots.has(row.charId) || typeof row.skill !== 'string' || !row.skill ||
      !Number.isInteger(row.frame) || row.frame < startFrame || row.frame > endFrame)) {
    throw new Error('WuwaLab returned an invalid rotation action.')
  }
  // shortcut: Exact names leave new or renamed attacks for review; update local ability data to resolve them.
  const attackIds = new Map()
  for (const [characterId, character] of Object.entries(abilities)) {
    for (const ability of character.abilities ?? []) {
      if (!ability.tacetActionId) continue
      const key = `${characterId}:${ability.name}`
      const ids = attackIds.get(key) ?? new Set()
      ids.add(ability.tacetActionId)
      attackIds.set(key, ids)
    }
  }
  const seconds = (frames) => Math.round(frames / 60 * 10000) / 10000
  return {
    schemaVersion: 1,
    source: { site: 'wuwalab', url: `https://wuwalab.com/rotation/${id}${segment === 'loop' ? '/loop' : ''}`, rotationId: id, segment },
    name: data.meta.title,
    duration: seconds(endFrame - startFrame),
    characters: data.team.map((member, slot) => ({
      slot, catalogId: String(member.id), name: member.name, sequence: member.sequence,
      weapon: { name: member.weapon, rank: member.rank }, echoSet: member.echoSet, echoes: member.echoes
    })),
    actions: rows.map((row) => {
      const ids = attackIds.get(`${row.charId}:${row.skill}`)
      return {
        slot: slots.get(row.charId), attackName: row.skill, attackId: ids?.size === 1 ? [...ids][0] : null,
        timestamp: seconds(row.frame - startFrame), frame: row.frame - startFrame, auto: row.auto === true
      }
    })
  }
}

export async function exportRotation(link, fetchImpl = fetch) {
  const parsed = parseRotationUrl(link)
  const response = await fetchImpl(`https://api.wuwalab.com/api/app/rotation/${parsed.id}`, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`WuwaLab returned HTTP ${response.status}.`)
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('WuwaLab did not return JSON.')
  const abilities = JSON.parse(await readFile(abilitiesPath, 'utf8'))
  return convertRotation(await response.json(), parsed, abilities)
}

export async function startGui() {
  const html = await readFile(new URL('./wuwalab-rotation-gui.html', import.meta.url), 'utf8')
  const server = createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`
    if (request.headers.host !== `127.0.0.1:${server.address().port}`) {
      response.writeHead(403).end('Forbidden')
      return
    }
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html)
      return
    }
    if (request.method !== 'POST' || request.url !== '/export' || request.headers.origin !== origin) {
      response.writeHead(404).end('Not found')
      return
    }
    try {
      let link = ''
      for await (const chunk of request) {
        link += chunk
        if (link.length > 2048) throw new Error('The rotation link is too long.')
      }
      const result = await exportRotation(link)
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(result))
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        .end(error instanceof Error ? error.message : 'Could not export this rotation.')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const url = `http://127.0.0.1:${server.address().port}/`
  console.log(`WuwaLab rotation exporter: ${url}`)
  if (process.platform === 'win32') {
    const browser = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' })
    browser.on('error', () => console.error(`Could not open the browser automatically. Open ${url} manually.`))
    browser.unref()
  }
  return server
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const [link, output] = process.argv.slice(2)
    if (!link) {
      if (output) throw new Error('Usage: node scripts/export-wuwalab-rotation.mjs [rotation-url [output.json]]')
      await startGui()
    } else {
      if (process.argv.length > 4) throw new Error('Usage: node scripts/export-wuwalab-rotation.mjs [rotation-url [output.json]]')
      const result = await exportRotation(link)
      const json = `${JSON.stringify(result, null, 2)}\n`
      if (output) await writeFile(output, json, { flag: 'wx' })
      else process.stdout.write(json)
      const unmatched = [...new Set(result.actions.filter((action) => !action.attackId).map((action) => `${result.characters[action.slot].name}: ${action.attackName}`))]
      if (unmatched.length) console.error(`${unmatched.length} attack name(s) could not be mapped to Tacet Lab IDs; their WuwaLab names remain in the JSON.\n${unmatched.join('\n')}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
