import type { PieceName } from '../engine'
import { comboVoiceId, PRAISE_IDS, type SfxId } from './manifest'

/**
 * A single lock can fire up to seven engine events synchronously (`onLock`,
 * `onB2B`, `onCombo`, `onPerfectClear`, `onLevelUp`, `onSpin`, `onClear` — see
 * `GameEvents` in `engine/types.ts`). `AudioManager` collects all of them into
 * one of these per lock (see its cluster-batching) and hands it to
 * {@link resolveCluster} once the synchronous stack has finished, so this
 * module can decide the whole mix in one place — pure data in, pure data out,
 * no `AudioContext` involved, which is what makes the priority strategy easy
 * to unit-test on its own.
 */
export interface ClusterAccumulator {
  hard: boolean
  spin?: { name: PieceName; lines: number }
  clear?: { rows: number[]; count: number; level: number }
  combo?: { combo: number; level: number }
  b2b?: { chain: number; name: PieceName; lines: number }
  perfectClear?: { lines: number; level: number }
  levelUp?: number
}

export interface ResolvedPlay {
  id: SfxId
  gain: number
  /** Small stagger (ms) so a stacked reward reads as a cascade, not a mush of simultaneous hits. */
  delayMs?: number
}

/**
 * Priority hierarchy (highest first), per the ticket: perfect clear > level
 * up > Tetris/spin > B2B > combo > lock/hard-drop. A perfect clear is
 * exclusive — the ordinary clear/spin/combo layer would be redundant once the
 * best possible reward already fired — everything else can stack, ducked and
 * staggered so the more important sound stays legible.
 */
export function resolveCluster(c: ClusterAccumulator, pickPraise: () => SfxId = defaultPickPraise): ResolvedPlay[] {
  if (c.perfectClear) {
    const plays: ResolvedPlay[] = [{ id: pickPraise(), gain: 1 }]
    if (c.levelUp) plays.push({ id: 'levelUp', gain: 0.55, delayMs: 110 })
    return plays
  }

  const plays: ResolvedPlay[] = []

  if (c.levelUp) plays.push({ id: 'levelUp', gain: 0.8 })

  const rewardDelay = c.levelUp ? 60 : 0
  if (c.spin) {
    const { name, lines } = c.spin
    const id: SfxId =
      name === 'T'
        ? lines === 0
          ? 'spinT'
          : lines === 1
            ? 'spinTSingle'
            : lines === 2
              ? 'spinTDouble'
              : 'spinTTriple'
        : lines === 0
          ? 'spinEZ'
          : 'spinEZClear'
    plays.push({ id, gain: 1, delayMs: rewardDelay })
  } else if (c.clear) {
    const { count } = c.clear
    const id: SfxId =
      count >= 4 ? 'clearTetris' : count === 3 ? 'clearTriple' : count === 2 ? 'clearDouble' : 'clearSingle'
    plays.push({ id, gain: 1, delayMs: rewardDelay })
  }

  if (c.b2b) {
    const id: SfxId = c.b2b.lines === 4 ? 'b2bTetris' : 'b2bSpin'
    plays.push({ id, gain: Math.min(0.9, 0.55 + c.b2b.chain * 0.04), delayMs: 70 })
  }

  if (c.combo) {
    const ducked = !!(c.clear || c.spin)
    plays.push({ id: comboVoiceId(c.combo.combo), gain: ducked ? 0.35 : 0.6, delayMs: 40 })
  }

  // The impact is the base layer under everything else — kept audible on its
  // own (a quiet lock with no clear), pulled well down once a bigger reward
  // is already sounding this same lock so it doesn't muddy the mix.
  const hasReward = !!(c.clear || c.spin || c.combo || c.b2b || c.levelUp)
  plays.unshift({ id: c.hard ? 'lockHard' : 'lockSoft', gain: hasReward ? 0.25 : 0.85 })

  return plays
}

function defaultPickPraise(): SfxId {
  return PRAISE_IDS[Math.floor(Math.random() * PRAISE_IDS.length)]
}
