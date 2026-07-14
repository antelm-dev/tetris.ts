import { describe, it, expect } from 'vitest'
import { createScrollState, scrollBy, scrollIntoView, updateScroll } from '../../renderer/src/hud/widgets'

describe('scroll state', () => {
  it('clamps the scroll target to the scrollable range', () => {
    const s = createScrollState()
    s.viewport = 100
    s.content = 300

    scrollBy(s, -50)
    expect(s.target).toBe(0)

    scrollBy(s, 1000)
    expect(s.target).toBe(200) // content - viewport
  })

  it('has nothing to scroll when content already fits the viewport', () => {
    const s = createScrollState()
    s.viewport = 300
    s.content = 200
    scrollBy(s, 1000)
    expect(s.target).toBe(0)
  })

  it('scrollIntoView is a no-op when the range is already visible', () => {
    const s = createScrollState()
    s.viewport = 200
    s.content = 500
    s.target = 50
    scrollIntoView(s, 60, 40)
    expect(s.target).toBe(50)
  })

  it('scrollIntoView pulls a row above the viewport down to its top', () => {
    const s = createScrollState()
    s.viewport = 200
    s.content = 500
    s.target = 100
    scrollIntoView(s, 20, 40, 8)
    expect(s.target).toBe(12) // top - margin
  })

  it('scrollIntoView pushes a row below the viewport up to its bottom', () => {
    const s = createScrollState()
    s.viewport = 200
    s.content = 500
    s.target = 0
    scrollIntoView(s, 250, 40, 8)
    expect(s.target).toBe(98) // top + h + margin - viewport
  })

  it('updateScroll eases offset toward target and snaps once close', () => {
    const s = createScrollState()
    s.viewport = 100
    s.content = 300
    s.target = 100
    updateScroll(s, 10) // a large dt settles the ease almost completely
    expect(s.offset).toBe(100)
  })
})
