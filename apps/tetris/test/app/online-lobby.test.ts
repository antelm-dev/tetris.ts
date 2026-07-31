/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Game, mulberry32 } from '@tetris/engine'
import {
  buildLobbyEntries,
  buildOnlineLobbyView,
  nextOnlineSceneAction,
  type OnlineLobbyView
} from '@tetris/renderer/hud/online/model'
import { OnlineLobby } from '@tetris/renderer/hud/online/OnlineLobby'
import type { OnlineClient, OnlineClientState } from '@tetris/renderer/app/online'
import { pieceFromWire } from '@tetris/renderer/scene/remote'
import { isOnlineMultiplayerUiEnabled, parseOnlineFlag } from '@tetris/renderer/app/onlineFlag'

function emptyState(partial: Partial<OnlineClientState> = {}): OnlineClientState {
  return {
    connection: 'idle',
    lobby: 'none',
    user: null,
    sessionId: null,
    room: null,
    match: null,
    lastError: null,
    lastEnvelopeSeq: -1,
    ...partial
  }
}

describe('parseOnlineFlag', () => {
  it('is true only for the string 1', () => {
    expect(parseOnlineFlag({ VITE_ONLINE_MULTIPLAYER_UI: '1' })).toBe(true)
    expect(parseOnlineFlag({ VITE_ONLINE_MULTIPLAYER_UI: '0' })).toBe(false)
    expect(parseOnlineFlag({ VITE_ONLINE_MULTIPLAYER_UI: 'true' })).toBe(false)
    expect(parseOnlineFlag({ VITE_ONLINE_MULTIPLAYER_UI: '' })).toBe(false)
    expect(parseOnlineFlag({})).toBe(false)
    expect(parseOnlineFlag(undefined)).toBe(false)
    expect(parseOnlineFlag(null)).toBe(false)
  })
})

describe('online lobby view model', () => {
  it('keeps unauthenticated users on the auth panel', () => {
    const view = buildOnlineLobbyView(emptyState())
    expect(view.panel).toBe('auth')
    expect(view.canStart).toBe(false)
    expect(view.statusText.toLowerCase()).toContain('sign in')
  })

  it('exposes create/join lobby when connected with no room', () => {
    const view = buildOnlineLobbyView(
      emptyState({
        connection: 'ready',
        user: { id: 'u1', email: 'a@b.co', displayName: 'Ada' },
        sessionId: 's1'
      })
    )
    expect(view.panel).toBe('lobby')
    expect(view.roomId).toBeNull()
    expect(view.statusText.toLowerCase()).toContain('create or join')
  })

  it('computes host start eligibility from ready membership', () => {
    const base = emptyState({
      connection: 'ready',
      lobby: 'in-room',
      user: { id: 'u1', email: 'a@b.co', displayName: 'Ada' },
      sessionId: 's1',
      room: {
        roomId: 'room-1',
        name: 'Private',
        hostUserId: 'u1',
        maxPlayers: 2,
        status: 'lobby',
        players: [
          { userId: 'u1', displayName: 'Ada', ready: true, connected: true },
          { userId: 'u2', displayName: 'Bob', ready: true, connected: true }
        ]
      }
    })
    const ready: OnlineLobbyView = buildOnlineLobbyView(base)
    expect(ready.isHost).toBe(true)
    expect(ready.canStart).toBe(true)
    expect(ready.selfReady).toBe(true)

    const notReady = buildOnlineLobbyView({
      ...base,
      room: {
        ...base.room!,
        players: [
          { userId: 'u1', displayName: 'Ada', ready: true, connected: true },
          { userId: 'u2', displayName: 'Bob', ready: false, connected: true }
        ]
      }
    })
    expect(notReady.canStart).toBe(false)
  })

  it('surfaces protocol errors in the view', () => {
    const view = buildOnlineLobbyView(
      emptyState({
        connection: 'error',
        user: { id: 'u1', email: 'a@b.co', displayName: 'Ada' },
        lastError: { code: 'ROOM_FULL', message: 'Room is full' }
      })
    )
    expect(view.errorText).toBe('ROOM_FULL: Room is full')
  })

  it('hides the overlay panel while a match scene is active', () => {
    const game = new Game({ width: 10, height: 20, random: mulberry32(1) })
    game.start()
    const view = buildOnlineLobbyView(
      emptyState({
        connection: 'ready',
        lobby: 'in-match',
        user: { id: 'u1', email: 'a@b.co', displayName: 'Ada' },
        match: {
          roomId: 'room-1',
          seed: 1,
          startedAt: 1,
          localGame: game,
          lastAckedSeq: -1,
          nextActionSeq: 0,
          lockCount: 0,
          remote: null,
          elimination: null,
          gameOver: null
        }
      }),
      { matchSceneActive: true }
    )
    expect(view.panel).toBe('match-hidden')
  })
})

describe('online scene lifecycle helpers', () => {
  it('enters the match scene only on in-match with a local game', () => {
    const game = new Game({ width: 10, height: 20, random: mulberry32(2) })
    game.start()
    expect(
      nextOnlineSceneAction(
        { sceneIsOnline: false, lobby: 'in-room' },
        emptyState({
          lobby: 'in-match',
          match: {
            roomId: 'r',
            seed: 2,
            startedAt: 1,
            localGame: game,
            lastAckedSeq: -1,
            nextActionSeq: 0,
            lockCount: 0,
            remote: null,
            elimination: null,
            gameOver: null
          }
        })
      )
    ).toBe('enter-match')

    expect(nextOnlineSceneAction({ sceneIsOnline: false, lobby: 'in-room' }, emptyState({ lobby: 'starting' }))).toBe(
      'none'
    )
  })

  it('returns leave-to-menu when lobby clears while online', () => {
    expect(
      nextOnlineSceneAction({ sceneIsOnline: true, lobby: 'in-match' }, emptyState({ lobby: 'none', match: null }))
    ).toBe('leave-to-menu')
  })

  it('keeps the scene on disconnect so HUD can show terminal feedback', () => {
    expect(
      nextOnlineSceneAction(
        { sceneIsOnline: true, lobby: 'in-match' },
        emptyState({ connection: 'disconnected', lobby: 'none', match: null })
      )
    ).toBe('none')
  })
})

describe('remote wire piece reconstruction', () => {
  it('applies orientation turns from spawn', () => {
    const piece = pieceFromWire({ name: 'T', x: 3, y: 4, orientation: 2 })
    expect(piece.name).toBe('T')
    expect(piece.x).toBe(3)
    expect(piece.y).toBe(4)
    expect(piece.orientation).toBe(2)
  })
})

describe('online menu feature flag contract', () => {
  it('documents that Online Versus is inert without the flag handler', () => {
    // Menu hides the Online row when `onOnlineVersus` is omitted — the sketch
    // only passes the handler when `VITE_ONLINE_MULTIPLAYER_UI === '1'`.
    expect(typeof isOnlineMultiplayerUiEnabled()).toBe('boolean')
    expect(isOnlineMultiplayerUiEnabled()).toBe(parseOnlineFlag(import.meta.env))
  })
})

describe('lobby card entries', () => {
  it('offers both auth forms when signed out', () => {
    const entries = buildLobbyEntries(buildOnlineLobbyView(emptyState()))
    const fields = entries.flatMap((e) => (e.kind === 'field' ? [e.id] : []))
    const actions = entries.flatMap((e) => (e.kind === 'action' ? [e.id] : []))
    expect(fields).toEqual(['email', 'password', 'regName', 'regEmail', 'regPassword'])
    expect(actions).toEqual(['login', 'register', 'exit'])
  })

  it('shows players and a disabled Start until everyone is ready', () => {
    const room = {
      roomId: 'room-1',
      name: 'Private room',
      hostUserId: 'u1',
      maxPlayers: 2,
      isPrivate: true,
      players: [
        { userId: 'u1', displayName: 'Ada', ready: true, connected: true },
        { userId: 'u2', displayName: 'Bob', ready: false, connected: true }
      ]
    } as unknown as OnlineClientState['room']
    const view = buildOnlineLobbyView(
      emptyState({
        connection: 'ready',
        lobby: 'in-room',
        user: { id: 'u1', email: 'a@b.co', displayName: 'Ada' },
        room
      })
    )
    const entries = buildLobbyEntries(view)
    const start = entries.find((e) => e.kind === 'action' && e.id === 'start')
    expect(start).toMatchObject({ disabled: true })
    expect(entries.filter((e) => e.kind === 'stat')).toHaveLength(3) // room id + 2 players
  })

  it('reduces the terminal panel to a single way out', () => {
    const view = buildOnlineLobbyView(
      emptyState({
        connection: 'ready',
        lobby: 'finished',
        user: { id: 'u1', email: 'a@b.co', displayName: 'Ada' }
      })
    )
    const entries = buildLobbyEntries(view)
    expect(entries.flatMap((e) => (e.kind === 'action' ? [e.id] : []))).toEqual(['exit'])
  })
})

describe('OnlineLobby p5 card', () => {
  let state: OnlineClientState
  let listeners: Set<(s: OnlineClientState) => void>
  let client: OnlineClient

  const type = (text: string): void => {
    for (const key of text) window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }))
  }
  const press = (key: string, init: KeyboardEventInit = {}): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...init }))
  }

  beforeEach(() => {
    state = emptyState()
    listeners = new Set()
    client = {
      getState: () => state,
      get user() {
        return state.user
      },
      subscribe: (listener: (s: OnlineClientState) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    } as unknown as OnlineClient
  })

  it('types credentials and submits login, keeping values across state pushes', async () => {
    const login = vi.fn(async () => undefined)
    const connect = vi.fn(async () => undefined)
    const lobby = new OnlineLobby({ ...client, login, connect } as unknown as OnlineClient, {
      onExit: () => undefined
    })
    lobby.show()

    type('ada@example.com')

    // A client-driven rebuild (here: an error push) must not wipe the field.
    state = emptyState({ lastError: { code: 'AUTH_FAILED', message: 'Invalid credentials' } })
    for (const listener of listeners) listener(state)

    press('Tab')
    type('s3cret')
    press('Enter')

    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 's3cret' })
      expect(connect).toHaveBeenCalled()
    })
    lobby.dispose()
  })

  it('registers from the second form', async () => {
    const register = vi.fn(async () => undefined)
    const login = vi.fn(async () => undefined)
    const connect = vi.fn(async () => undefined)
    const lobby = new OnlineLobby({ ...client, register, login, connect } as unknown as OnlineClient, {
      onExit: () => undefined
    })
    lobby.show()

    // email, password, login, regName …
    press('ArrowDown')
    press('ArrowDown')
    press('ArrowDown')
    type('Ada')
    press('Tab')
    type('ada@example.com')
    press('Tab')
    type('s3cret!!')
    press('Enter')

    await vi.waitFor(() => {
      expect(register).toHaveBeenCalledWith({ email: 'ada@example.com', displayName: 'Ada', password: 's3cret!!' })
      expect(login).not.toHaveBeenCalled()
      expect(connect).toHaveBeenCalled()
    })
    lobby.dispose()
  })

  it('creates and joins rooms from the typed values', async () => {
    const joinRoom = vi.fn()
    const createRoom = vi.fn()
    state = emptyState({
      connection: 'ready',
      user: { id: 'u1', email: 'a@b.co', displayName: 'Ada' },
      sessionId: 's1'
    })
    const lobby = new OnlineLobby({ ...client, joinRoom, createRoom } as unknown as OnlineClient, {
      onExit: () => undefined
    })
    lobby.show()

    // roomName is prefilled with the default; clear it before typing.
    for (let i = 0; i < 'Private room'.length; i++) press('Backspace')
    type('Night shift')
    press('Enter')
    await vi.waitFor(() => {
      expect(createRoom).toHaveBeenCalledWith({ name: 'Night shift', maxPlayers: 2, isPrivate: true })
    })

    // roomName → create-room → roomId
    press('ArrowDown')
    press('ArrowDown')
    type('room-abc')
    press('Enter')
    await vi.waitFor(() => {
      expect(joinRoom).toHaveBeenCalledWith('room-abc')
    })
    lobby.dispose()
  })

  it('exits on Escape and stops listening once disposed', () => {
    const onExit = vi.fn()
    const lobby = new OnlineLobby(client, { onExit })
    lobby.show()
    press('Escape')
    expect(onExit).toHaveBeenCalledTimes(1)

    lobby.dispose()
    press('Escape')
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
