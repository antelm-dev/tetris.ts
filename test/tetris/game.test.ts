import { describe, it, expect } from 'vitest'
import Game from '../../renderer/src/engine/Game'
import Piece from '../../renderer/src/engine/Piece'
import { PIECES_SHAPES, type PieceName } from '../../renderer/src/engine/const'
import type { Action } from '../../renderer/src/engine/types'

const newGame = () => new Game({ width: 6, height: 10 })

/** Paint one row of the well from ASCII art: '#' filled, anything else empty. */
const fillRow = (game: Game, y: number, art: string): void => {
  ;[...art].forEach((c, x) => {
    game.field.slots[y][x] = c === '#' ? 'L' : 0
  })
}

/** A jagged 10-wide stack with a few overhangs, deterministic in `seed`. */
const randomStack = (seed: number): string[] => {
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const heights = Array.from({ length: 10 }, () => 2 + Math.floor(rnd() * 5))
  const rows = Array.from({ length: 20 }, () => Array<string>(10).fill('.'))
  for (let x = 0; x < 10; x++) for (let y = 20 - heights[x]; y < 20; y++) if (rnd() > 0.12) rows[y][x] = '#'
  return rows.map((r) => r.join(''))
}

/**
 * Every spin a player could score on this board with a single rotate press:
 * exhaustively try each position and pre-rotation, turn once, and lock.
 */
const countSpins = (board: string[], name: PieceName, dir: Action) => {
  let count = 0
  let best = 0
  for (let pre = 0; pre < 4; pre++) {
    for (let x = -3; x < 11; x++) {
      for (let y = -2; y < 20; y++) {
        const game = new Game({ width: 10, height: 20 })
        board.forEach((row, i) => fillRow(game, i, row))
        const piece = new Piece(name, PIECES_SHAPES[name])
        for (let i = 0; i < pre; i++) piece.rotate('right')
        piece.x = x
        piece.y = y
        if (game.field.collides(piece)) continue
        game.activePiece = piece
        let lines = -1
        game.events.onSpin = (_n, c) => (lines = c)
        game.action(dir)
        game.push(true)
        if (lines >= 0) {
          count++
          best = Math.max(best, lines)
        }
      }
    }
  }
  return { count, best }
}

describe('Game', () => {
  it('initializes empty with a 4-piece queue', () => {
    const game = newGame()
    expect(game.score).toBe(0)
    expect(game.gameOver).toBe(false)
    expect(game.activePiece).toBeUndefined()
    expect(game.nextPieces).toHaveLength(4)
    expect(game.field.slots).toHaveLength(10)
  })

  it('spawns an active piece on the first update, keeping the queue full', () => {
    const game = newGame()
    game.update()
    expect(game.activePiece).toBeDefined()
    expect(game.nextPieces).toHaveLength(4)
  })

  it('drops the active piece by one row on update', () => {
    const game = newGame()
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.x = 2
    game.activePiece.y = 0
    game.update()
    expect(game.activePiece?.y).toBe(1)
  })

  it('moves the active piece left/right, respecting walls', () => {
    const game = newGame()
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.x = 0
    game.action('right')
    expect(game.activePiece?.x).toBe(1)
    game.action('left')
    game.action('left') // blocked by the wall
    expect(game.activePiece?.x).toBe(0)
  })

  it('hold stashes the active piece and cannot be repeated until the next lock', () => {
    const game = newGame()
    game.activePiece = new Piece('T', [
      [1, 1, 1],
      [0, 1, 0]
    ])
    game.hold()
    expect(game.holdPiece?.name).toBe('T')
    expect(game.activePiece).toBeDefined()
    const afterFirstHold = game.holdPiece
    game.hold() // no-op: already held this turn
    expect(game.holdPiece).toBe(afterFirstHold)
  })

  it('push hard-drops, locks the piece and clears hold', () => {
    const game = newGame()
    const piece = new Piece('O', [[1]])
    piece.x = 2
    piece.y = 0
    game.activePiece = piece
    game.push()
    expect(game.activePiece).toBeUndefined()
    // landed at the bottom row
    expect(game.field.slots[9][2]).toBe('O')
  })

  it('scores 100 for a single line clear', () => {
    const game = newGame()
    game.field.slots[0][0] = 'S' // survivor — keep the clear from being perfect
    // fill the bottom row except the last column
    for (let x = 0; x < 5; x++) game.field.slots[9][x] = 'O'
    const piece = new Piece('O', [[1]])
    piece.x = 5
    piece.y = 0
    game.activePiece = piece
    game.push()
    expect(game.score).toBe(100)
    expect(game.streak).toBe(1)
  })

  it('ends the game when a new piece has nowhere to spawn', () => {
    const game = newGame()
    game.field.slots.forEach((row) => row.fill('O')) // board completely full
    game.update() // tries to spawn -> overlaps -> game over
    expect(game.gameOver).toBe(true)
  })

  it('restarts from game over on push', () => {
    const game = newGame()
    game.field.slots.forEach((row) => row.fill('O'))
    game.update()
    expect(game.gameOver).toBe(true)
    game.action('push')
    expect(game.gameOver).toBe(false)
    expect(game.score).toBe(0)
    expect(game.field.slots.flat().every((c) => c === 0)).toBe(true)
  })

  it('wall-kicks a rotation that would otherwise collide with the floor', () => {
    const game = newGame()
    const piece = new Piece('T', PIECES_SHAPES.T)
    piece.x = 2
    piece.y = 8 // flat on the floor: the turned T would poke through it
    game.activePiece = piece
    game.action('rotate-right')
    // Turned upright, and kicked up-and-left by the 0>1 offsets to fit.
    expect(game.activePiece?.orientation).toBe(1)
    expect([game.activePiece?.x, game.activePiece?.y]).toEqual([1, 7])
    expect(game.activePiece?.bottom).toBe(9) // still standing on the floor
  })

  // Regression: with the old non-square boxes an I lying on the floor needed a
  // 3-row lift to stand up, which no kick offered — so it simply could not be
  // rotated at all.
  it('stands an I piece up off the floor', () => {
    const game = new Game({ width: 10, height: 20 })
    const piece = new Piece('I', PIECES_SHAPES.I)
    piece.x = 3
    piece.y = 18 // the I's cells sit on row 19, the floor
    game.activePiece = piece
    expect(piece.bottom).toBe(19)

    game.action('rotate-right')

    expect(game.activePiece?.orientation).toBe(1)
    // Vertical, still standing on the floor rather than poking through it.
    expect(game.activePiece?.bottom).toBe(19)
    expect(game.activePiece?.cells()).toHaveLength(4)
  })

  it('detects a T-spin: rotating into a wedged slot scores a spin and fires onSpin', () => {
    const game = new Game({ width: 10, height: 20 })
    // The T-slot below, but with the far right column left open so the rows
    // don't complete: a spin that clears nothing still earns its bonus.
    fillRow(game, 17, '###..#....')
    fillRow(game, 18, '###...###.')
    fillRow(game, 19, '####.####.')

    // The T comes in upright beside the cave and turns into it.
    const piece = new Piece('T', PIECES_SHAPES.T)
    piece.rotate('right')
    piece.x = 2
    piece.y = 16
    game.activePiece = piece

    let spun: { name: string; lines: number } | undefined
    game.events.onSpin = (name, lines) => (spun = { name, lines })

    game.action('rotate-right') // kicks down into the slot
    game.push()

    expect(spun).toEqual({ name: 'T', lines: 0 })
    expect(game.score).toBe(100) // spin-without-clear bonus
  })

  /**
   * The bug this rotation system exists to fix. A T-spin double and its exact
   * mirror image must both work — the first turning clockwise into the slot,
   * the second turning counter-clockwise into the mirrored one. Under the old
   * shared kick list the right-hand version silently failed.
   */
  describe('a T-spin double works from both sides', () => {
    const SLOT = ['###..#....', '###...####', '####.#####']
    const mirrored = SLOT.map((r) => [...r].reverse().join(''))

    const build = (rows: string[]) => {
      const game = new Game({ width: 10, height: 20 })
      rows.forEach((row, i) => fillRow(game, 17 + i, row))
      return game
    }

    // The T arrives vertical beside the cave and turns into it.
    const spin = (game: Game, orientation: 1 | 3, x: number, dir: Action) => {
      const piece = new Piece('T', PIECES_SHAPES.T)
      for (let i = 0; i < orientation; i++) piece.rotate('right')
      piece.x = x
      piece.y = 16
      game.activePiece = piece
      let lines = -1
      game.events.onSpin = (_n, count) => (lines = count)
      game.action(dir)
      game.push()
      return lines
    }

    it('clockwise, into a slot open on its left', () => {
      const game = build(SLOT)
      expect(spin(game, 1, 2, 'rotate-right')).toBe(2)
      expect(game.score).toBe(1200) // T-spin double
    })

    it('counter-clockwise, into the mirrored slot', () => {
      const game = build(mirrored)
      expect(spin(game, 3, 5, 'rotate-left')).toBe(2)
      expect(game.score).toBe(1200) // the same score, the other way round
    })
  })

  /**
   * The general form of the same property: the engine must be blind to which
   * hand you are. Mirror the board, mirror the rotation direction, and mirror
   * the piece — an L reflects into a J, an S into a Z — and every spin that was
   * available must still be available.
   *
   * I is excluded on purpose: SRS's published I kicks list the same five offsets
   * for a rotation and its reflection but in a *different order*, so the two can
   * settle on different (equally legal) cells. That asymmetry is in the standard
   * itself, not in this port, and it is not the one players feel.
   */
  it('is mirror-symmetric across random stacks', () => {
    const reflect: Partial<Record<PieceName, PieceName>> = {
      T: 'T',
      L: 'J',
      J: 'L',
      S: 'Z',
      Z: 'S'
    }
    const asymmetric: string[] = []

    for (let seed = 1; seed <= 15; seed++) {
      const board = randomStack(seed)
      const flipped = board.map((r) => [...r].reverse().join(''))
      for (const [name, twin] of Object.entries(reflect) as [PieceName, PieceName][]) {
        const cw = countSpins(board, name, 'rotate-right')
        const ccw = countSpins(flipped, twin, 'rotate-left')
        if (cw.count !== ccw.count || cw.best !== ccw.best) {
          asymmetric.push(`seed ${seed} ${name}: ${cw.count}/${cw.best} vs ${twin} ${ccw.count}/${ccw.best}`)
        }
      }
    }

    expect(asymmetric).toEqual([])
  })

  it('does not count a spin when the last action was a move, not a rotation', () => {
    const game = new Game({ width: 10, height: 20 })
    fillRow(game, 17, '###..#....')
    fillRow(game, 18, '###...####')
    fillRow(game, 19, '####.#####')

    // Dropped into the very slot the T-spin double aims for — but never rotated
    // into it. It clears the same two rows, and must score them as a plain
    // double (300), not a T-spin double (1200).
    const piece = new Piece('T', PIECES_SHAPES.T)
    piece.rotate('right')
    piece.rotate('right') // nub down, the slot's shape
    piece.x = 3
    piece.y = 17
    game.activePiece = piece

    let spun = false
    game.events.onSpin = () => (spun = true)

    game.action('right') // blocked by the enclosing wall, but still a "move"
    game.push()

    expect(spun).toBe(false)
    expect(game.lines).toBe(2)
    expect(game.score).toBe(300)
  })

  describe('lock delay', () => {
    /** A T resting on the floor of an otherwise empty 10×20 well. */
    const grounded = () => {
      const game = new Game({ width: 10, height: 20 })
      const piece = new Piece('T', PIECES_SHAPES.T)
      piece.x = 3
      piece.y = 18
      game.activePiece = piece
      return game
    }

    it('gives a grounded piece a grace period instead of locking on contact', () => {
      const game = grounded()
      game.update() // the gravity tick that finds the floor
      expect(game.activePiece).toBeDefined() // still the player's to move

      game.tick(0.3) // 300 ms — inside the 500 ms window
      expect(game.activePiece).toBeDefined()

      game.tick(0.3) // past it now
      expect(game.activePiece).toBeUndefined()
      expect(game.field.slots[19][4]).toBe('T')
    })

    it('a move or rotation restarts the countdown', () => {
      const game = grounded()
      game.tick(0.4)
      game.action('left') // last-second slide
      game.tick(0.4) // would have locked without the reset
      expect(game.activePiece).toBeDefined()
      game.action('rotate-right')
      game.tick(0.4)
      expect(game.activePiece).toBeDefined()
      game.tick(0.2)
      expect(game.activePiece).toBeUndefined()
    })

    it('caps the resets so a piece cannot be stalled forever', () => {
      const game = grounded()
      // Far more resets than the budget allows, each just short of locking.
      for (let i = 0; i < 40 && game.activePiece; i++) {
        game.tick(0.4)
        game.action(i % 2 === 0 ? 'left' : 'right')
      }
      expect(game.activePiece).toBeUndefined()
    })

    it('falling to a new row refills the reset budget', () => {
      const game = new Game({ width: 10, height: 20 })
      const piece = new Piece('T', PIECES_SHAPES.T)
      piece.x = 3
      piece.y = 0
      game.activePiece = piece
      for (let i = 0; i < 20; i++) game.action('left') // burn resets in mid-air
      game.action('push')
      expect(game.activePiece).toBeUndefined() // hard drop still locks at once
    })
  })

  // Fill the bottom `rows` completely except the last column, then hard-drop a
  // vertical I into that gap — clearing `rows` lines at once (a Tetris at 4).
  // A survivor block stays on the board so the clear is not a perfect clear.
  const dropIInto = (game: Game, rows: number): void => {
    const h = game.field.slots.length
    game.field.slots[0][0] = 'S'
    for (let r = h - rows; r < h; r++) for (let x = 0; x < 5; x++) game.field.slots[r][x] = 'O'
    const piece = new Piece(
      'I',
      Array.from({ length: rows }, () => [1])
    )
    piece.x = 5
    piece.y = 0
    game.activePiece = piece
    game.push()
  }

  // Fill the bottom row except the last column, then drop a 1×1 into the gap.
  const dropSingle = (game: Game): void => {
    const h = game.field.slots.length
    game.field.slots[0][0] = 'S'
    for (let x = 0; x < 5; x++) game.field.slots[h - 1][x] = 'O'
    const piece = new Piece('O', [[1]])
    piece.x = 5
    piece.y = 0
    game.activePiece = piece
    game.push()
  }

  it('rewards back-to-back Tetrises with a 1.5× bonus and fires onB2B', () => {
    const game = newGame()
    const chains: number[] = []
    game.events.onB2B = (chain) => chains.push(chain)

    dropIInto(game, 4) // first Tetris: opens the chain, no bonus yet
    const first = game.score
    expect(first).toBe(800)
    expect(game.b2b).toBe(1)
    expect(chains).toEqual([])

    dropIInto(game, 4) // second Tetris: back-to-back → 1.5× + combo bonus
    expect(game.b2b).toBe(2)
    expect(chains).toEqual([2])
    // 1200 (800 × 1.5) for the clear plus a combo bonus for the 2nd clear.
    expect(game.score).toBeGreaterThan(first + 1200 - 1)
  })

  it('breaks the back-to-back chain on a plain line clear', () => {
    const game = newGame()
    dropIInto(game, 4)
    expect(game.b2b).toBe(1)
    dropSingle(game) // a plain single — not difficult — resets the chain
    expect(game.b2b).toBe(0)
  })

  it('awards a combo bonus for consecutive clears and fires onCombo', () => {
    const game = newGame()
    const combos: number[] = []
    game.events.onCombo = (combo) => combos.push(combo)

    dropSingle(game) // first clear: combo 0, no bonus
    expect(game.score).toBe(100)
    expect(combos).toEqual([])

    dropSingle(game) // second clear: combo 1 → +50 × 1 × level
    expect(game.streak).toBe(2)
    expect(combos).toEqual([1])
    expect(game.score).toBe(100 + 100 + 50)
  })

  it('resets the combo when a drop clears no lines', () => {
    const game = newGame()
    dropSingle(game)
    expect(game.streak).toBe(1)
    // Park a piece off to the side so it locks without completing a row.
    const piece = new Piece('O', [[1]])
    piece.x = 0
    piece.y = 0
    game.activePiece = piece
    game.push()
    expect(game.streak).toBe(0)
  })

  it('toggles pause, halting updates', () => {
    const game = newGame()
    game.activePiece = new Piece('O', [[1]])
    game.activePiece.y = 0
    game.action('pause')
    expect(game.isPaused).toBe(true)
    game.update()
    expect(game.activePiece?.y).toBe(0) // no drop while paused
    game.action('pause')
    expect(game.isPaused).toBe(false)
  })

  describe('lock-out', () => {
    it('ends the game when a piece locks partially above the field', () => {
      const game = new Game({ width: 10, height: 20 })
      // Ground the O while its top row is still above the well.
      game.field.slots[1][4] = 'L'
      game.field.slots[1][5] = 'L'
      const piece = new Piece('O', PIECES_SHAPES.O)
      piece.x = 4
      piece.y = -1
      game.activePiece = piece
      expect(game.field.checkCollision(piece, 'down')).toBe(true)
      game.push()
      expect(game.gameOver).toBe(true)
      expect(game.field.slots[0][4]).toBe('O')
      expect(game.field.slots[0][5]).toBe('O')
    })

    it('ends the game when a piece locks entirely above the field', () => {
      const game = new Game({ width: 10, height: 20 })
      game.field.slots[0][4] = 'L'
      game.field.slots[0][5] = 'L'
      const piece = new Piece('O', PIECES_SHAPES.O)
      piece.x = 4
      piece.y = -2
      game.activePiece = piece
      expect(game.field.checkCollision(piece, 'down')).toBe(true)
      game.push()
      expect(game.gameOver).toBe(true)
      expect(game.field.slots[0][4]).toBe('L')
      expect(game.field.slots[0][5]).toBe('L')
    })

    it('does not end the game on a normal on-board lock', () => {
      const game = newGame()
      const piece = new Piece('O', [[1]])
      piece.x = 2
      piece.y = 0
      game.activePiece = piece
      game.push()
      expect(game.gameOver).toBe(false)
      expect(game.field.slots[9][2]).toBe('O')
    })
  })

  describe('scoring', () => {
    it('scales plain line clears with the current level', () => {
      const game = newGame()
      game.level = 3
      dropSingle(game)
      expect(game.score).toBe(300)
    })

    it('scales spin clears with the current level', () => {
      const game = new Game({ width: 10, height: 20 })
      game.level = 2
      fillRow(game, 17, '###..#....')
      fillRow(game, 18, '###...####')
      fillRow(game, 19, '####.#####')
      const piece = new Piece('T', PIECES_SHAPES.T)
      piece.rotate('right')
      piece.x = 2
      piece.y = 16
      game.activePiece = piece
      game.action('rotate-right')
      game.push()
      expect(game.score).toBe(2400) // 1200 × level 2
    })

    it('awards soft-drop and hard-drop distance points', () => {
      const soft = newGame()
      soft.activePiece = new Piece('O', [[1]])
      soft.activePiece.x = 0
      soft.activePiece.y = 0
      soft.action('down')
      soft.action('down')
      expect(soft.score).toBe(2)

      const hard = newGame()
      hard.activePiece = new Piece('O', [[1]])
      hard.activePiece.x = 0
      hard.activePiece.y = 0
      hard.action('push') // hard drop from row 0 → 9
      expect(hard.score).toBe(18) // 9 cells × 2
    })

    it('stacks combo and back-to-back with level scaling', () => {
      const game = newGame()
      game.level = 2
      dropIInto(game, 4)
      expect(game.score).toBe(1600) // 800 × 2
      dropIInto(game, 4)
      // second Tetris: floor(800×2×1.5)=2400 plus combo 50×1×2=100
      expect(game.score).toBe(1600 + 2400 + 100)
      expect(game.b2b).toBe(2)
    })

    it('awards a perfect-clear bonus when a clear empties the well', () => {
      const game = new Game({ width: 4, height: 4 })
      const perfectClears: number[] = []
      game.events.onPerfectClear = (lines) => perfectClears.push(lines)
      for (let x = 0; x < 3; x++) game.field.slots[3][x] = 'O'
      const piece = new Piece('O', [[1]])
      piece.x = 3
      piece.y = 0
      game.activePiece = piece
      game.push()
      // single (100) + perfect clear (800) at level 1
      expect(game.score).toBe(900)
      expect(game.field.isEmpty()).toBe(true)
      expect(perfectClears).toEqual([1])
    })
  })

  describe('7-bag determinism', () => {
    const mulberry32 = (seed: number) => {
      let s = seed >>> 0
      return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = s
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    const dealNames = (seed: number, count: number) => {
      const game = new Game({ width: 10, height: 40, random: mulberry32(seed) })
      const names: string[] = []
      game.events.onSpawn = (name) => names.push(name)
      game.start()
      while (names.length < count) {
        game.push(true)
        if (game.gameOver) break
        game.update()
      }
      return names
    }

    it('deals every tetromino exactly once per seven-piece bag', () => {
      const names = dealNames(7, 14)
      const all = ['I', 'J', 'L', 'O', 'S', 'T', 'Z']
      expect(names.slice(0, 7).sort()).toEqual(all)
      expect(names.slice(7, 14).sort()).toEqual(all)
    })

    it('reproduces the same sequence for the same seed', () => {
      expect(dealNames(42, 20)).toEqual(dealNames(42, 20))
      expect(dealNames(42, 20)).not.toEqual(dealNames(43, 20))
    })
  })
})
