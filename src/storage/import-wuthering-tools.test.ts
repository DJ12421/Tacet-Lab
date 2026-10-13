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

  it('uses exported progression for new ownership and preserves it on reimport', async () => {
    const lucy = characterCatalog.find((entry) => entry.name === 'Lucy')!
    const weapon = weaponSummaries.find((entry) => entry.type === lucy.weaponType)!
    const source = {
      meta: { version: '9', source: 'WutheringTools' },
      data: { character: JSON.stringify({ characters: { Lucy: {
        characterLevel: '70', sequence: '2', talents: { basic: '6', skill: '8', forte: '10', liberation: '7', intro: '5' },
        weapon: weapon.name, weapons: { [weapon.name]: { weaponLevel: '80', refinement: '3' } }
      } } }) }
    }

    const converted = await convertWutheringToolsExport(source)
    expect(converted.document.characters[0]).toMatchObject({ level: 70, sequence: 2, skillLevels: [6, 8, 10, 7, 5] })
    expect(converted.document.weapons[0]).toMatchObject({ level: 80, rank: 3 })

    await importAccount(converted.document)
    const changed = JSON.parse(source.data.character)
    changed.characters.Lucy.characterLevel = '90'
    changed.characters.Lucy.talents.skill = '10'
    changed.characters.Lucy.weapons[weapon.name].refinement = '5'
    const repeated = await convertWutheringToolsExport({ ...source, data: { character: JSON.stringify(changed) } })
    expect(repeated.document.characters).toHaveLength(0)
    expect(repeated.document.weapons).toHaveLength(0)
  })

  it('stops before preview when source characters cannot be accounted for', async () => {
    const source = {
      meta: { version: '9', source: 'WutheringTools' },
      data: { character: JSON.stringify({ characters: {
        Lucy: { echoes: Array.from({ length: 6 }, () => ({ echo: 'unknown', type: 1 })) },
        UnknownCharacter: {}
      } }) }
    }

    await expect(convertWutheringToolsExport(source)).rejects.toThrow('2 of 2 Wuthering Tools characters: Lucy, UnknownCharacter')
  })
})
