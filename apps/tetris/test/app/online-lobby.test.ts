/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Game, mulberry32 } from '@tetris/engine'
import {
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

    expect(
      nextOnlineSceneAction(
        { sceneIsOnline: false, lobby: 'in-room' },
        emptyState({ lobby: 'starting' })
      )
    ).toBe('none')
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

describe('OnlineLobby overlay DOM', () => {
  let parent: HTMLElement
  let state: OnlineClientState
  let listeners: Set<(s: OnlineClientState) => void>
  let client: OnlineClient

  beforeEach(() => {
    parent = document.createElement('div')
    document.body.appendChild(parent)
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

  afterEach(() => {
    parent.remove()
    document.getElementById('online-lobby-styles')?.remove()
  })

  it('preserves typed credentials across client-driven re-renders and dispose removes root', () => {
    const lobby = new OnlineLobby(client, parent, { onExit: () => undefined })
    lobby.show()

    const email = parent.querySelector<HTMLInputElement>('form[data-action="login"] input[name="email"]')
    expect(email).toBeTruthy()
    email!.value = 'player@example.com'
    email!.focus()

    state = emptyState({
      lastError: { code: 'AUTH_FAILED', message: 'Invalid credentials' }
    })
    for (const listener of listeners) listener(state)

    const emailAfter = parent.querySelector<HTMLInputElement>('form[data-action="login"] input[name="email"]')
    expect(emailAfter?.value).toBe('player@example.com')
    expect(document.activeElement).toBe(emailAfter)

    expect(parent.querySelector('.online-lobby')).toBeTruthy()
    lobby.dispose()
    expect(parent.querySelector('.online-lobby')).toBeNull()
    expect(document.getElementById('online-lobby-styles')).toBeNull()
  })

  it('Sign in click reaches login/connect with typed FormData', async () => {
    const login = vi.fn(async () => undefined)
    const connect = vi.fn(async () => undefined)
    client = {
      ...client,
      login,
      connect
    } as unknown as OnlineClient

    const lobby = new OnlineLobby(client, parent, { onExit: () => undefined })
    lobby.show()

    const form = parent.querySelector<HTMLFormElement>('form[data-action="login"]')!
    form.querySelector<HTMLInputElement>('input[name="email"]')!.value = 'ada@example.com'
    form.querySelector<HTMLInputElement>('input[name="password"]')!.value = 's3cret'
    form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()

    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 's3cret' })
      expect(connect).toHaveBeenCalled()
    })
    lobby.dispose()
  })

  it('Register click reaches register with typed FormData', async () => {
    const register = vi.fn(async () => undefined)
    const login = vi.fn(async () => undefined)
    const connect = vi.fn(async () => undefined)
    client = {
      ...client,
      register,
      login,
      connect
    } as unknown as OnlineClient

    const lobby = new OnlineLobby(client, parent, { onExit: () => undefined })
    lobby.show()

    const form = parent.querySelector<HTMLFormElement>('form[data-action="register"]')!
    form.querySelector<HTMLInputElement>('input[name="displayName"]')!.value = 'Ada'
    form.querySelector<HTMLInputElement>('input[name="email"]')!.value = 'ada@example.com'
    form.querySelector<HTMLInputElement>('input[name="password"]')!.value = 's3cret!!'
    form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()

    await vi.waitFor(() => {
      expect(register).toHaveBeenCalledWith({
        email: 'ada@example.com',
        displayName: 'Ada',
        password: 's3cret!!'
      })
      expect(login).not.toHaveBeenCalled()
      expect(connect).toHaveBeenCalled()
    })
    lobby.dispose()
  })

  it('Join by ID and create room pass typed values through submit', async () => {
    const joinRoom = vi.fn()
    const createRoom = vi.fn()
    state = emptyState({
      connection: 'ready',
      user: { id: 'u1', email: 'a@b.co', displayName: 'Ada' },
      sessionId: 's1'
    })
    client = {
      getState: () => state,
      get user() {
        return state.user
      },
      subscribe: (listener: (s: OnlineClientState) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      joinRoom,
      createRoom
    } as unknown as OnlineClient

    const lobby = new OnlineLobby(client, parent, { onExit: () => undefined })
    lobby.show()

    const joinForm = parent.querySelector<HTMLFormElement>('form[data-action="join-room"]')!
    joinForm.querySelector<HTMLInputElement>('input[name="roomId"]')!.value = 'room-abc'
    joinForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()

    await vi.waitFor(() => {
      expect(joinRoom).toHaveBeenCalledWith('room-abc')
    })

    const createForm = parent.querySelector<HTMLFormElement>('form[data-action="create-room"]')!
    createForm.querySelector<HTMLInputElement>('input[name="roomName"]')!.value = 'Night shift'
    createForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()

    await vi.waitFor(() => {
      expect(createRoom).toHaveBeenCalledWith({
        name: 'Night shift',
        maxPlayers: 2,
        isPrivate: true
      })
    })
    lobby.dispose()
  })
})
