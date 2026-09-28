import { generatedEchoCatalog } from './echoes.generated'

export interface EchoCatalogEntry {
  id?: string
  /** Exact English name shown at the top of the Echo detail panel. */
  name: string
  cost: 1 | 3 | 4
  /** A single Sonata can be resolved from the Echo identity without visible set text. */
  sonatas: string[]
  articleUrl?: string
  /** Provenance only; do not hotlink or bundle without checking the file's reuse rights. */
  rarities?: number[]
  intensity?: number
  skillDescription?: string
  iconPath?: string
  /** Provenance only; do not hotlink or bundle without checking the file's reuse rights. */
  iconSourceUrl?: string
}

export const echoCatalog: EchoCatalogEntry[] = generatedEchoCatalog
