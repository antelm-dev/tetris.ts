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
   * La pièce active
   */
  public activePiece?: Piece

  /**
   * @param options Les options du terrain de jeu
   */
  constructor(options: { width: number; height: number }) {
    this.slots = Array.from({ length: options.height }, () => {
      return Array.from({ length: options.width }, () => 0)
    })
  }

  /**
   * @param piece La pièce à ajouter
   */
  public addPiece(piece: Piece): void {
    const center = this.slots[0].length / 2 - piece.shape[0].length / 2
    this.activePiece = piece
    this.activePiece.x = Math.floor(center)
    this.activePiece.shape.map((row) => {
      row.map((cell) => (cell ? 2 : 0))
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
  public push(): void {
    if (!this.activePiece) return
    while (!this.checkCollision('down')) this.activePiece.move('down')
    this.placePiece()
  }

  /**
   * @param action L'action à effectuer
   */
  public update(action: Direction | 'rotate'): void {
    if (!this.activePiece) return

    const colide = this.checkCollision(action)

    if (!colide) {
      if (action === 'rotate') {
        this.activePiece.rotate()
      }
      if (['down', 'left', 'right'].includes(action)) {
        this.activePiece.move(action)
      }
    } else {
      if (action === 'down') {
        this.placePiece()
      }
    }
  }

  /**
   * Vérifie si une action provoque une collision
   * @param action L'action à vérifier
   */
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

  /**
   * Place la pièce active sur le terrain de jeu
   */
  private placePiece(): void {
    this.activePiece!.shape.forEach((row, i) => {
      const k = this.activePiece!.y + i
      row.forEach((cell, j) => {
        if (cell) {
          this.slots[k][this.activePiece!.x + j] = this.activePiece!.name
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

/**
 * Classe représentant une partie de Tetris
 */
export class Game {
  /**
   * La pièce sauvegardée
   */
  public saved?: Piece
  /**
   * Le terrain de jeu
   */
  public field: Field
  /**
   * Indique si le jeu est en pause
   */
  private paused: boolean = false

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
    this.field.update('down')

    if (!this.field.activePiece) {
      const keys = Object.keys(PIECES_SHAPES)
      const random = Math.floor(Math.random() * keys.length)
      const key = keys[random]
      this.field.addPiece(new Piece(key as keyof typeof PIECES_SHAPES, PIECES_SHAPES[key]))
    }

    if (this.field.slots[0].some((v) => v)) this.gameOver()
  }

  /**
   * @param name L'action à effectuer
   */
  public action(name: Direction | 'rotate' | 'push' | 'pause'): void {
    if (name === 'push') {
      this.field.push()
    } else if (name === 'pause') {
      this.pause()
    } else {
      this.field.update(name)
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
