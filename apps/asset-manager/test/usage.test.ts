import { describe, expect, it } from 'vitest'
import { parsePorcelain } from '../server/git-status.ts'
import { referencedNames } from '../server/usage.ts'

describe('referencedNames', () => {
  it('collects cited filenames with the requested extensions only', () => {
    const text = `
      move: 'SFX_Move.ogg',
      voice: "VO_WOW.ogg", // and VO_B2B.ogg in a comment
      icon: 'icon.png',
      path: \`/sounds/\${'SFX_Hold.ogg'}\`
    `
    expect(referencedNames(text, ['.ogg'])).toEqual(
      new Set(['SFX_Move.ogg', 'VO_WOW.ogg', 'VO_B2B.ogg', 'SFX_Hold.ogg'])
    )
    expect(referencedNames(text, ['.png'])).toEqual(new Set(['icon.png']))
    expect(referencedNames(text, [])).toEqual(new Set())
  })

  it('does not match an extension that is only a prefix of a longer one', () => {
    expect(referencedNames('a.oggx b.ogg', ['.ogg'])).toEqual(new Set(['b.ogg']))
  })
})

describe('parsePorcelain', () => {
  it('reads paths and skips rename sources', () => {
    expect(parsePorcelain(' M a/b.ogg\0?? c.ogg\0R  new.ogg\0old.ogg\0')).toEqual(['a/b.ogg', 'c.ogg', 'new.ogg'])
  })
})
