import { describe, it, expect } from 'vitest'
import {
  ClientEvent,
  ServerEvent,
  PROTOCOL_VERSION,
  type ActionAckPayload,
  type SnapshotPayload,
  type GarbageDeliveryPayload,
  type EliminationPayload,
  type GameOverPayload,
  type ServerEnvelope
} from '@tetris/protocol'

describe('protocol wire contract', () => {
  it('exposes action-ack and garbage delivery server events', () => {
    expect(ServerEvent.ActionAcknowledged).toBe('server:player:action:ack')
    expect(ServerEvent.GarbageDelivered).toBe('server:game:garbage')
    expect(ServerEvent.Snapshot).toBe('server:game:snapshot')
    expect(ServerEvent.Elimination).toBe('server:game:elimination')
    expect(ServerEvent.GameOver).toBe('server:game:over')
    expect(ClientEvent.PlayerAction).toBe('client:player:action')
  })

  it('types a versioned snapshot with a required board encoding', () => {
    const payload: SnapshotPayload = {
      schemaVersion: 1,
      roomId: 'r1',
      userId: 'u1',
      seq: 3,
      score: 100,
      lines: 4,
      level: 2,
      board: [
        [0, 0, 'T', 0],
        ['GARBAGE', 'GARBAGE', 0, 'GARBAGE']
      ],
      activePiece: { name: 'T', x: 1, y: 0, orientation: 0 },
      gameOver: false
    }
    expect(payload.board).toHaveLength(2)
    expect(payload.board[1][2]).toBe(0)
  })

  it('types action ack, garbage delivery, elimination, and standings', () => {
    const ack: ActionAckPayload = {
      schemaVersion: 1,
      roomId: 'r1',
      seq: 7,
      action: 'left'
    }
    const garbage: GarbageDeliveryPayload = {
      schemaVersion: 1,
      roomId: 'r1',
      deliverySeq: 1,
      fromUserId: 'u1',
      toUserId: 'u2',
      rows: [{ hole: 3 }, { hole: 5 }],
      appliedAtLock: 2
    }
    const elimination: EliminationPayload = {
      schemaVersion: 1,
      roomId: 'r1',
      userId: 'u2',
      place: 2,
      reason: 'top-out'
    }
    const gameOver: GameOverPayload = {
      schemaVersion: 1,
      roomId: 'r1',
      endedAt: 1_700_000_000_000,
      standings: [
        { userId: 'u1', place: 1, score: 1200, lines: 8 },
        { userId: 'u2', place: 2, score: 400, lines: 2 }
      ]
    }

    const envelope: ServerEnvelope<GameOverPayload> = {
      protocolVersion: PROTOCOL_VERSION,
      seq: 42,
      ts: gameOver.endedAt,
      data: gameOver
    }

    expect(ack.seq).toBe(7)
    expect(garbage.rows).toHaveLength(2)
    expect(elimination.reason).toBe('top-out')
    expect(envelope.data.standings[0].lines).toBe(8)
  })
})
