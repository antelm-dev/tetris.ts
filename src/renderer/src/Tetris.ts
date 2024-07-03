/* eslint-disable prettier/prettier */
type Direction = 'left' | 'right' | 'down'
export type Action = Direction | 'rotate' | 'push' | 'pause' | 'hold'

/**
 * Les formes des pièces de Tetris
 */
const PIECES_SHAPES = {
  O: [
    [1, 1],
    [1, 1]
  ],
  I: [[1, 1, 1, 1]],
  T: [
    [1, 1, 1],
    [0, 1, 0]
  ],
  L: [
    [1, 1, 1],
    [1, 0, 0]
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1]
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0]
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1]
  ]
} as const

/**
 * Classe représentant une pièce de Tetris
 */
class Piece {
  /**
   * Nom de la pièce
   */
  public name: string
  /**
   * Forme de la pièce
   */
  public shape: number[][]
  /**
   * Position de la pièce
   */
  public x: number
  /**
   * Position de la pièce
   */
  public y: number

  /**
   * Crée une pièce de Tetris
   * @param name Nom de la pièce
   * @param shape Forme de la pièce
   */
  public constructor(name: keyof typeof PIECES_SHAPES, shape: number[][]) {
    this.shape = shape
    this.name = name
    this.x = 0
    this.y = 0
  }

  /**
   * Effectue une rotation de la pièce
   * @param dir La direction de la rotation
   */
  public rotate(dir: Omit<Direction, 'down'> = 'right'): void {
    this.shape = this.shape[0]
      .map((_, i) => this.shape.map((row) => (dir === 'right' ? row[i] : row[row.length - i - 1])))
      .reverse()
  }

  /**
   * Déplace la pièce
   * @param dir La direction du mouvement
   */
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
      default:
        throw new Error('Invalid direction')
    }
  }
}

/**
 * Classe représentant le terrain de jeu de Tetris
 */
class Field {
  /**
   * Les cases du terrain de jeu
   */
  public slots: (number | string)[][]

  /**
   * @param options Les options du terrain de jeu
   */
  constructor(options: { width: number; height: number }) {
    this.slots = Array.from({ length: options.height }, () => {
      return Array.from({ length: options.width }, () => 0)
    })
  }

  /**
   * @param index L'index de la ligne à vider
   */
  public clearRow(index: number): void {
    this.slots.splice(index, 1)
    this.slots.unshift(Array.from({ length: this.slots[0].length }, () => 0))
  }

  /**
   * Pousse la pièce active vers le bas
   */
  public push(piece: Piece): void {
    while (!this.checkCollision(piece, 'down')) piece.move('down')
    this.placePiece(piece)
  }

  /**
   * @param action L'action à effectuer
   */
  public computePosition(piece: Piece, action: Direction | 'rotate'): boolean {
    const colide = this.checkCollision(piece, action)

    if (!colide) {
      if (action === 'rotate') {
        piece.rotate()
      }
      if (['down', 'left', 'right'].includes(action)) {
        piece.move(action as Direction)
      }
    } else {
      if (action === 'down') {
        this.placePiece(piece)
        return true
      }
    }
    return false
  }

  /**
   * Vérifie si une action provoque une collision
   * @param action L'action à vérifier
   */
  private checkCollision(piece: Piece, action: Direction | 'rotate'): boolean {
    const localPiece: Piece = Object.create(piece)

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

  /**
   * Place la pièce active sur le terrain de jeu
   */
  private placePiece(piece: Piece): void {
    piece.shape.forEach((row, i) => {
      const k = piece.y + i
      row.forEach((cell, j) => {
        if (cell) {
          this.slots[k][piece.x + j] = piece.name
        }
      })
      if (this.slots[k]?.every((v) => v)) this.clearRow(k)
    })
  }

  public reset(): void {
    this.slots = this.slots.map((row) => row.map(() => 0))
  }
}

/**
 * Classe représentant une partie de Tetris
 */
export class Game {
  /**
   * La pièce sauvegardée
   */
  public savedPiece?: Piece
  /**
   * Le terrain de jeu
   */
  public field: Field
  /**
   * Indique si le jeu est en pause
   */
  private paused: boolean = false
  /**
   * La pièce active
   */
  public activePiece?: Piece
  /**
   * @param options Les options de la partie
   */
  constructor(options: { width: number; height: number }) {
    this.field = new Field(options)
  }

  /**
   * Met à jour la partie
   */
  public update(): void {
    if (this.paused) return

    if (!this.activePiece) {
      this.addPiece(Game.randomPiece)
    } else {
      const land = this.field.computePosition(this.activePiece, 'down')
      if (land) this.addPiece(Game.randomPiece)
    }

    if (this.field.slots[0].some((v) => v)) this.gameOver()
  }

  private addPiece(piece: Piece): void {
    const center = this.field.slots[0].length / 2 - piece.shape[0].length / 2
    this.activePiece = piece
    this.activePiece.x = Math.floor(center)
    this.activePiece.shape.map((row) => {
      row.map((cell) => (cell ? this.activePiece!.name : 0))
    })
  }

  private static get randomPiece(): Piece {
    const keys = Object.keys(PIECES_SHAPES)
    const random = Math.floor(Math.random() * keys.length)
    const key = keys[random]
    return new Piece(key as keyof typeof PIECES_SHAPES, PIECES_SHAPES[key])
  }

  /**
   * @param name L'action à effectuer
   */
  public action(name: Direction | 'rotate' | 'push' | 'pause'): void {
    if (!this.activePiece) return
    if (name === 'push') {
      this.field.push(this.activePiece)
    } else if (name === 'pause') {
      this.pause()
    } else {
      this.field.computePosition(this.activePiece, name)
    }
  }

  /**
   * Réinitialise la partie
   */
  private gameOver(): void {
    this.field.reset()
  }

  /**
   * Met en pause ou reprend la partie
   */
  private pause(): void {
    this.paused = !this.paused
  }
}
