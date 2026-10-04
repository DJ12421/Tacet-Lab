import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { characterCatalog, weaponSummaries } from '../game-data'
import { db, importAccount } from './database'
import { convertWutheringToolsExport } from './import-wuthering-tools'

describe('Wuthering Tools build and team imports', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterAll(() => db.close())

  it('keeps distinct saved builds and links a rotation to its selected build', async () => {
    const lucy = characterCatalog.find((entry) => entry.name === 'Lucy')!
    const [firstWeapon, secondWeapon] = weaponSummaries.filter((weapon) => weapon.type === lucy.weaponType)
    const source = {
      meta: { version: '9', source: 'WutheringTools' },
      data: {
        character: JSON.stringify({ characters: { Lucy: {
          weapon: firstWeapon.name, activeBuildId: 'main', builds: [
            { id: 'main', name: 'Main', weapon: firstWeapon.name, echoes: {} },
            { id: 'alternate', name: 'Alternate', weapon: secondWeapon.name, echoes: {} }
          ]
        } } }),
        teamRotations: JSON.stringify({ teams: [{ id: 'rotation', name: 'Lucy rotation', characterIds: ['Lucy', null, null],
          buildIds: ['alternate', null, null], duration: '20', enemyConfig: { enemyLevel: 90, enemyResist: 0.1 },
          actions: [{ id: 'heavy', slot: 0, order: 1, key: 'HeavyAttack2DMG', count: 2 }] },
        { id: 'empty', name: 'Empty team', characterIds: [null, null, null], actions: [] }] })
      }
    }

    const converted = await convertWutheringToolsExport(source)
    expect(converted.document.equippedLoadouts).toHaveLength(1)
    expect(converted.document.builds).toMatchObject([{ name: 'Alternate' }])
    expect(converted.document.teams).toHaveLength(1)
    expect(converted.document.teams[0].members?.[0].loadoutSource).toEqual({ type: 'saved', buildId: converted.document.builds[0].id })
    expect(converted.document.teams[0].actions[0].attackId).toBe(lucy.attacks.find((attack) => attack.name.endsWith('Heavy Attack 2 DMG'))?.id)
    expect(converted.document.teams[0].actions[0].multiplier).toBe(2)

    await importAccount(converted.document)
    const repeated = await convertWutheringToolsExport(source)
    expect(repeated.document.builds).toHaveLength(0)
    expect(repeated.choices).toHaveLength(0)
  })
})
