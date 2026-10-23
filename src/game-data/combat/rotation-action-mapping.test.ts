import { describe, expect, it } from 'vitest'
import { echoCatalog } from '../echoes'
import source from './imported-runtime.generated.json'
import { resolveRotationActionId } from './rotation-action-mapping'

describe('rotation action mapping', () => {
  it('maps saved character and Echo labels to current action IDs', () => {
    expect(resolveRotationActionId('1505', 'wuwalab:Forte%3A%20Illation', 'Forte: Illation', 'Fallacy of No Return')).toBe('1505:imported:333')
    expect(resolveRotationActionId('1505', 'wuwalab:Outro%3A%20Binary%20Butterfly', 'Outro: Binary Butterfly', 'Fallacy of No Return')).toBe('1505:imported:325')
    expect(resolveRotationActionId('1505', 'wuwalab:Echo%3A%20Fallacy%20of%20No%20Return', 'Echo: Fallacy of No Return', 'Fallacy of No Return')).toBe('echo:6000060:skill:1')
    expect(resolveRotationActionId('1505', null, 'Echo: Fallacy of No Return', 'Other Echo')).toBeUndefined()
  })

  it('covers every additional imported character action and generic main Echo cast', () => {
    for (const [characterId, character] of Object.entries(source)) {
      for (const ability of character.abilities) {
        if (ability.match !== 'additional' || !ability.tacetActionId || (!ability.hits.length && ability.genre !== 'outro')) continue
        expect(resolveRotationActionId(characterId, null, ability.name)).toBe(ability.tacetActionId)
      }
    }
    for (const echo of echoCatalog) {
      expect(resolveRotationActionId('1505', null, `Echo: ${echo.name}`, echo.name)).toBeDefined()
    }
  })
})
