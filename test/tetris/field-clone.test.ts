import { describe, it, expect } from 'vitest'
import Field from '../../renderer/src/engine/Field'

describe('Field.clone', () => {
  it('produces an independent deep copy — mutating the clone leaves the original untouched', () => {
    const field = new Field({ width: 4, height: 3 })
    field.slots[2][0] = 'O'

    const clone = field.clone()
    clone.slots[2][1] = 'T'

    expect(field.slots[2][1]).toBe(0)
    expect(clone.slots[2][0]).toBe('O')
  })

  it('mutating the original after cloning leaves the clone untouched', () => {
    const field = new Field({ width: 4, height: 3 })
    const clone = field.clone()

    field.slots[0][0] = 'L'

    expect(clone.slots[0][0]).toBe(0)
  })

  it('clone rows are distinct array instances, not shared references', () => {
    const field = new Field({ width: 4, height: 3 })
    const clone = field.clone()
    expect(clone.slots).not.toBe(field.slots)
    field.slots.forEach((row, i) => expect(clone.slots[i]).not.toBe(row))
  })
})
