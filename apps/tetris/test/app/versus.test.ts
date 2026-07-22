import { describe, it, expect } from 'vitest'
import { VersusMatch } from '@tetris/renderer/app/versus'
import { mulberry32 } from '@tetris/renderer/core/random'

/** Track calls to `game.receiveGarbage` without touching engine internals. */
function spyOnReceiveGarbage(match: VersusMatch, side: 'player' | 'bot'): number[] {
  const received: number[] = []
  const game = match[side].game
  const original = game.receiveGarbage.bind(game)
  game.receiveGarbage = (count: number) => {
    received.push(count)
    original(count)
  }
  return received
}

function newMatch(): VersusMatch {
  return new VersusMatch('normal', { random: mulberry32(1), strategyRandom: mulberry32(2) })
}

describe('VersusMatch', () => {
  it('ends the match, with the other side winning, when a side tops out', () => {
    const match = newMatch()
    expect(match.isOver).toBe(false)

    match.bot.game.events.onGameOver?.(0)

    expect(match.isOver).toBe(true)
    expect(match.winner).toBe('player')
  })

  it('the other side wins when the player tops out', () => {
    const match = newMatch()
    match.player.game.events.onGameOver?.(0)
    expect(match.isOver).toBe(true)
    expect(match.winner).toBe('bot')
  })

  it('the player pausing freezes the whole match, including the bot', () => {
    const match = newMatch()
    expect(match.isPaused).toBe(false)

    match.player.game.events.onPause?.(true)
    expect(match.isPaused).toBe(true)

    const botScoreBefore = match.bot.game.score
    const botFieldBefore = match.bot.game.field.slots.map((row) => [...row])
    match.update(0.5) // enough time for gravity/the bot to normally act
    expect(match.bot.game.score).toBe(botScoreBefore)
    expect(match.bot.game.field.slots).toEqual(botFieldBefore)

    match.player.game.events.onPause?.(false)
    expect(match.isPaused).toBe(false)
  })

  it('uses the attack table and queues garbage for the recipient, applied only at their next lock', () => {
    const match = newMatch()
    const botReceived = spyOnReceiveGarbage(match, 'bot')

    // Player scores a T-spin double: attack table says 4.
    match.player.game.events.onSpin?.('T', 2)
    match.player.game.events.onClear?.([18, 19], 2, 1)

    // Not applied yet — only queued once the frame resolves.
    match.update(0)
    expect(botReceived).toEqual([])

    // Applied the moment the bot itself locks a piece.
    match.bot.game.events.onLock?.(false)
    expect(botReceived).toEqual([4])
  })

  it('cancels simultaneous opposing attacks before queuing the remainder', () => {
    const match = newMatch()
    const playerReceived = spyOnReceiveGarbage(match, 'player')
    const botReceived = spyOnReceiveGarbage(match, 'bot')

    // Same frame: player clears a double (attack 1), bot clears a tetris (attack 4).
    match.player.game.events.onClear?.([19], 2, 1)
    match.bot.game.events.onClear?.([16, 17, 18, 19], 4, 1)
    match.update(0)

    match.player.game.events.onLock?.(false)
    match.bot.game.events.onLock?.(false)

    // 4 - 1 = 3 net lines to the player; nothing left over for the bot.
    expect(playerReceived).toEqual([3])
    expect(botReceived).toEqual([])
  })

  it('applies the requested attack table values for every clear type', () => {
    const match = newMatch()
    const botReceived = spyOnReceiveGarbage(match, 'bot')

    const cases: [lines: number, spin: boolean, expected: number][] = [
      [1, false, 0], // single
      [2, false, 1], // double
      [3, false, 2], // triple
      [4, false, 4], // tetris
      [1, true, 2], // T-spin single
      [2, true, 4], // T-spin double
      [3, true, 6] // T-spin triple
    ]

    for (const [lines, spin] of cases) {
      // Faithful to the engine's real per-lock order: onLock resets the spin
      // flag for *this* lock before onSpin (if any) sets it and onClear reads it.
      match.player.game.events.onLock?.(false)
      if (spin) match.player.game.events.onSpin?.('T', lines)
      match.player.game.events.onClear?.([], lines, 1)
      match.update(0)
      match.bot.game.events.onLock?.(false)
    }

    expect(botReceived).toEqual(cases.map(([, , expected]) => expected).filter((n) => n > 0))
  })

  it('ends the match via a garbage-induced top-out', () => {
    const match = newMatch()
    // Occupy the bot's top row so any pushed-in garbage tops it out.
    match.bot.game.field.slots[0].fill('L')

    match.player.game.events.onClear?.([19], 4, 1) // tetris: attack 4
    match.update(0)
    match.bot.game.events.onLock?.(false) // applies the queued garbage

    expect(match.isOver).toBe(true)
    expect(match.winner).toBe('player')
  })
})
