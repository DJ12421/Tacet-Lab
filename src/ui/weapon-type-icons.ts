const root = `${import.meta.env.BASE_URL}weapon-type-icons/`

const files: Record<string, string> = {
  Sword: 'sword.webp',
  Broadblade: 'broadblade.webp',
  Pistols: 'pistols.webp',
  Gauntlets: 'gauntlets.webp',
  Rectifier: 'rectifier.webp'
}

export const weaponTypeIconSource = (type: string) => `${root}${files[type]}`
