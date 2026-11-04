import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { characterCatalog, echoCatalog, weaponSummaries } from '../game-data'
import { db, importAccount } from './database'
import { convertExternalAccountExport } from './import-external-account'

describe('external account build and team imports', () => {
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
      meta: { version: '9', source: 'external' },
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

    const converted = await convertExternalAccountExport(source)
    expect(converted.document.equippedLoadouts).toHaveLength(1)
    expect(converted.document.builds).toMatchObject([{ name: 'Alternate' }])
    expect(converted.document.teams).toHaveLength(1)
    expect(converted.document.teams[0].members?.[0].loadoutSource).toEqual({ type: 'saved', buildId: converted.document.builds[0].id })
    expect(converted.document.teams[0].actions[0].attackId).toBe(lucy.attacks.find((attack) => attack.name.endsWith('Heavy Attack 2 DMG'))?.id)
    expect(converted.document.teams[0].actions[0].multiplier).toBe(2)

    await importAccount(converted.document)
    const repeated = await convertExternalAccountExport(source)
    expect(repeated.document.builds).toHaveLength(0)
    expect(repeated.choices).toHaveLength(0)
    expect(repeated.document.teams[0]?.id).toBe(converted.document.teams[0].id)
  })

  it('uses exported progression for new ownership and preserves it on reimport', async () => {
    const lucy = characterCatalog.find((entry) => entry.name === 'Lucy')!
    const weapon = weaponSummaries.find((entry) => entry.type === lucy.weaponType)!
    const source = {
      meta: { version: '9', source: 'external' },
      data: { character: JSON.stringify({ characters: { Lucy: {
        characterLevel: '70', sequence: '2', talents: { basic: '6', skill: '8', forte: '10', liberation: '7', intro: '5' },
        weapon: weapon.name, weapons: { [weapon.name]: { weaponLevel: '80', refinement: '3' } }
      } } }) }
    }

    const converted = await convertExternalAccountExport(source)
    expect(converted.document.characters[0]).toMatchObject({ level: 70, sequence: 2, skillLevels: [6, 8, 10, 7, 5] })
    expect(converted.document.weapons[0]).toMatchObject({ level: 80, rank: 3 })

    await importAccount(converted.document)
    const changed = JSON.parse(source.data.character)
    changed.characters.Lucy.characterLevel = '90'
    changed.characters.Lucy.talents.skill = '10'
    changed.characters.Lucy.weapons[weapon.name].refinement = '5'
    const repeated = await convertExternalAccountExport({ ...source, data: { character: JSON.stringify(changed) } })
    expect(repeated.document.characters).toHaveLength(0)
    expect(repeated.document.weapons).toHaveLength(0)
  })

  it('imports distinct unequipped inventory Echoes without duplicating a character slot', async () => {
    const catalogEcho = echoCatalog.find((entry) => entry.cost === 1)!
    const sourceEcho = { echo: catalogEcho.name, echoSet: catalogEcho.sonatas[0], type: 1, rank: 5,
      stat: 'ATK', echoSubStatsType1: 'CritRate', echoSubStatsValue1: 10.5 }
    const source = { meta: { version: '9', source: 'external' }, data: {
      character: JSON.stringify({ characters: { Lucy: { echoes: [{ ...sourceEcho, echoId: 'equipped' }] } } }),
      inventory: JSON.stringify({ echoes: [
        { ...sourceEcho, echoId: 'equipped' },
        { ...sourceEcho, echoId: 'spare-1', locked: true },
        { ...sourceEcho, echoId: 'spare-2' },
        { ...sourceEcho, echoId: 'invalid', stat: null }
      ] })
    } }

    const converted = await convertExternalAccountExport(source)
    expect(converted.document.echoes).toHaveLength(3)
    expect(converted.document.echoes.filter((echo) => echo.id.startsWith('external-account:inventory:'))).toMatchObject([
      { id: 'external-account:inventory:spare-1', locked: true, equippedBy: undefined },
      { id: 'external-account:inventory:spare-2', equippedBy: undefined }
    ])
    expect(converted.notices).toContain('1 inventory Echo could not be imported because required details were missing or unsupported.')

    await importAccount(converted.document)
    const repeated = await convertExternalAccountExport(source)
    await importAccount(repeated.document)
    expect(await db.echoes.count()).toBe(3)
  })

  it('ignores opened characters with no gear while keeping gear on a saved build', async () => {
    const lucy = characterCatalog.find((entry) => entry.name === 'Lucy')!
    const empty = characterCatalog.find((entry) => entry.name !== lucy.name && !entry.name.startsWith('Rover: '))!
    const weapon = weaponSummaries.find((entry) => entry.type === lucy.weaponType)!
    const source = { meta: { version: '9' }, data: { character: JSON.stringify({ characters: {
      [empty.name]: {},
      UnknownCharacter: {},
      [lucy.name]: { builds: [{ id: 'saved', weapon: weapon.name }] }
    } }) } }

    const converted = await convertExternalAccountExport(source)
    expect(converted.document.characters).toHaveLength(1)
    expect(converted.document.weapons[0].catalogId).toBe(weapon.id)
    expect(converted.choices).toHaveLength(1)
  })

  it('stops before preview when source characters cannot be accounted for', async () => {
    const source = {
      meta: { version: '9', source: 'external' },
      data: { character: JSON.stringify({ characters: {
        Lucy: { echoes: Array.from({ length: 6 }, () => ({ echo: 'unknown', type: 1 })) },
        UnknownCharacter: { weapon: 'Unknown weapon' }
      } }) }
    }

    await expect(convertExternalAccountExport(source)).rejects.toThrow('2 of 2 imported characters: Lucy, UnknownCharacter')
  })
})
