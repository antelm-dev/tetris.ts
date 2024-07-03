/* eslint-disable prettier/prettier */
type Direction = 'left' | 'right' | 'down'
export type Action = Direction | 'rotate' | 'push' | 'pause' | 'save'

type Shape = Record<string, number[][]>

const PIECES_SHAPES = [
  [
    [1, 1],
    [1, 1]
  ],
  [[1, 1, 1, 1]],
  [
    [1, 1, 1],
    [0, 1, 0]
  ],
  [
    [1, 1, 1],
    [1, 0, 0]
  ],
  [
    [1, 1, 0],
    [0, 1, 1]
  ],
  [
    [0, 1, 1],
    [1, 1, 0]
  ],
  [
    [1, 0, 0],
    [1, 1, 1]
  ]
]

class Piece {
  public shape: number[][]
  public x: number
  public y: number

  constructor(shape: number[][]) {
    this.shape = shape
    this.x = 0
    this.y = 0
  }

  public rotate(): void {
    this.shape = this.shape[0].map((_, i) => this.shape.map((row) => row[i])).reverse()
  }

  public move(dir: Direction): void {
    switch (dir) {
      case 'left':
        this.x--
        break
      case 'right':
        this.x++
        break
      case 'down':
        this.y++
        break
    }
  }
}

class Field {
  public slots: number[][]
  public activePiece?: Piece

  constructor(options: { width: number; height: number }) {
    this.slots = Array.from({ length: options.height }, () => {
      return Array.from({ length: options.width }, () => 0)
    })
  }

  public addPiece(piece: Piece): void {
    const center = this.slots[0].length / 2 - piece.shape[0].length / 2
    this.activePiece = piece
    this.activePiece.x = Math.floor(center)
    this.activePiece.shape.map((row) => {
      row.map((cell) => (cell ? 2 : 0))
    })
  }

  public clearRow(index: number): void {
    this.slots.splice(index, 1)
    this.slots.unshift(Array.from({ length: this.slots[0].length }, () => 0))
  }

  public push(): void {
    if (!this.activePiece) return
    while (!this.checkCollision('down')) this.activePiece.move('down')
    this.placePiece()
  }

  public update(action: Direction | 'rotate'): void {
    if (!this.activePiece) return

    const colide = this.checkCollision(action)
    if (action === 'rotate') {
      if (!colide) this.activePiece.rotate()
    } else if (colide) {
      if (action === 'down') this.placePiece()
    } else this.activePiece.move(action)
  }

  private checkCollision(action: Direction | 'rotate'): boolean {
    if (!this.activePiece) return false

    const localPiece: Piece = Object.create(this.activePiece)

    const move = {
      x: action === 'left' ? -1 : action === 'right' ? 1 : 0,
      y: action === 'down' ? 1 : 0
    }

    if (action === 'rotate') localPiece.rotate()

    return localPiece.shape.some((row, dy) =>
      row.some((cell, dx) => {
        if (!cell) return false
        const newY = localPiece.y + dy + move.y
        const newX = localPiece.x + dx + move.x
        return (
          newX <= -1 ||
          newX >= this.slots[0].length ||
          newY >= this.slots.length ||
          (newY >= 0 && this.slots[newY][newX])
        )
      })
    )
  }

  private placePiece(): void {
    this.activePiece!.shape.forEach((row, i) => {
      const k = this.activePiece!.y + i
      row.forEach((cell, j) => {
        if (cell) {
          this.slots[k][this.activePiece!.x + j] = 1
        }
      })
      if (this.slots[k]?.every((v) => v)) this.clearRow(k)
    })

    this.activePiece = undefined
  }

  public reset(): void {
    this.slots = this.slots.map((row) => row.map(() => 0))
  }
}

export class Game {
  public saved?: Piece
  public field: Field
  private paused: boolean = false

  constructor(options: { width: number; height: number }) {
    this.field = new Field(options)
  }

  public update(): void {
    if (this.paused) return
    this.field.update('down')

    if (!this.field.activePiece) {
      const random = Math.floor(Math.random() * PIECES_SHAPES.length)
      const shape = PIECES_SHAPES[random]
      this.field.addPiece(new Piece(shape))
    }

    if (this.field.slots[0].some((v) => v === 1)) this.gameOver()
  }

  public action(name: Direction | 'rotate' | 'push' | 'pause'): void {
    if (name === 'push') {
      this.field.push()
    } else if (name === 'pause') {
      this.pause()
    } else {
      this.field.update(name)
    }
  }

  private gameOver(): void {
    this.field.reset()
  }

  private pause(): void {
    this.paused = !this.paused
  }
}
