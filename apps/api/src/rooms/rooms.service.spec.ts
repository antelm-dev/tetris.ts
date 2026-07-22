import { describe, expect, it } from 'vitest'
import { AppConfigService } from '../config/config.service'
import { loadConfig } from '../config/env.schema'
import { RoomsService } from './rooms.service'

function makeService(roomMax = 100): RoomsService {
  const config = new AppConfigService(
    loadConfig({ JWT_SECRET: 'a-sufficiently-long-secret', ROOM_MAX_PLAYERS: String(roomMax) })
  )
  return new RoomsService(config)
}

describe('RoomsService', () => {
  it('creates a room with the host as first, un-ready member', () => {
    const room = makeService().create({ name: 'Lobby', hostUserId: 'u1', hostDisplayName: 'Alice' })
    expect(room.hostUserId).toBe('u1')
    expect(room.members.size).toBe(1)
    expect(room.members.get('u1')?.ready).toBe(false)
    expect(room.status).toBe('lobby')
  })

  it('clamps requested capacity to the server-wide maximum', () => {
    const rooms = makeService(8)
    const room = rooms.create({ name: 'Big', hostUserId: 'u1', hostDisplayName: 'A', maxPlayers: 100 })
    expect(room.maxPlayers).toBe(8)
  })

  it('rejects joining a full room', () => {
    const rooms = makeService(1)
    const room = rooms.create({ name: 'Solo', hostUserId: 'u1', hostDisplayName: 'A' })
    expect(() => rooms.join(room.id, 'u2', 'B')).toThrow(/full/i)
  })

  it('reassigns the host when the host leaves', () => {
    const rooms = makeService()
    const room = rooms.create({ name: 'L', hostUserId: 'u1', hostDisplayName: 'A' })
    rooms.join(room.id, 'u2', 'B')
    const after = rooms.leave(room.id, 'u1')
    expect(after?.hostUserId).toBe('u2')
  })

  it('only starts when the host requests it and everyone is ready', () => {
    const rooms = makeService()
    const room = rooms.create({ name: 'L', hostUserId: 'u1', hostDisplayName: 'A' })
    rooms.join(room.id, 'u2', 'B')

    expect(() => rooms.start(room.id, 'u2')).toThrow(/host/i)
    expect(() => rooms.start(room.id, 'u1')).toThrow(/ready/i)

    rooms.setReady(room.id, 'u1', true)
    rooms.setReady(room.id, 'u2', true)
    expect(rooms.start(room.id, 'u1').status).toBe('in-progress')
  })
})
