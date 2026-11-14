import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const base = 'https://api.wuwalab.com/api/app'
const source = resolve('.local-tools/combat-source')
const load = async (path) => {
  const response = await fetch(`${base}${path}`, { headers: { 'User-Agent':'Tacet Lab data sync (https://github.com/DJ12421/Tacet-Lab)' } })
  if (!response.ok) throw new Error(`WuWaLab ${path}: ${response.status}`)
  return response.json()
}

const roster = await load('/characters')
const cards = roster.groups?.flatMap((group) => group.cards).filter((card) => card.registered)
if (!cards?.length || cards.some((card) => !Number.isInteger(card.id) || !/^[a-z0-9-]+$/.test(card.slug)) ||
    new Set(cards.map((card) => card.slug)).size !== cards.length) throw new Error('Invalid WuWaLab roster')
const details = []
for (const card of cards) {
  const detail = await load(`/characters/${encodeURIComponent(card.slug)}`)
  if (detail.id !== card.id || detail.slug !== card.slug || !Array.isArray(detail.abilities)) throw new Error(`Invalid WuWaLab character: ${card.slug}`)
  details.push(detail)
  await new Promise((resolve) => setTimeout(resolve, 300))
}

await mkdir(source, { recursive:true })
for (const detail of details) await writeFile(resolve(source, `${detail.slug}.json`), `${JSON.stringify(detail)}\n`)
await writeFile(resolve(source, 'roster.json'), `${JSON.stringify(roster)}\n`)
console.log(`Saved ${details.length} registered WuWaLab characters to ${source}`)
