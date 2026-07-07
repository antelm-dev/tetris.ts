import type { PieceName } from './const'

export type { PieceName }

export type Direction = 'left' | 'right' | 'down'
export type Rotate = `rotate-${'right' | 'left'}`
export type Action = Direction | Rotate | 'push' | 'pause' | 'hold'
export type Slot = PieceName | 0
