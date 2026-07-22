/**
 * The sound-effect catalogue: every playable id and the asset file backing it,
 * plus a couple of small pure helpers (combo-voice / praise selection, music
 * tier) that stay asset-agnostic and are unit-tested without touching
 * `AudioManager` or Web Audio at all.
 *
 * Files live in this package's `public/sounds/` (copied from the app's
 * `resources/sounds/`, which is the source of truth) and each host app points
 * Vite's `publicDir` here (see each host app's `vite.config.ts`), so Vite serves and
 * packages them as plain static assets: no bundler import
 * graph, no bindings to worry about, and `soundUrl` resolves them relative to
 * Vite's own `BASE_URL`, so a non-default `base` (see `vite.config.ts`) still
 * works in both the Electron and web builds.
 *
 * Mapping notes (why these files for these ids):
 *  - The shipped pack (`SFX_*`/`VO_*`, 51 files) is far richer than a first
 *    read of the ticket suggested — it already has dedicated assets for hold,
 *    combo, back-to-back, T-spins (including non-T "EZ" spins), Tetris, level
 *    up, game start/over, and a set of announcer voice lines. Nearly every
 *    "no asset yet" gap called out in the ticket is in fact covered here.
 *  - `spinEZ*` — Puyo Puyo Tetris-style naming for an "easy"/immobile spin by
 *    a non-T piece (S/Z/L/J/I); reused for every non-T spin since only one
 *    asset exists for the family.
 *  - `comboN` — `VO_0{n}TIC`/`VO_{n}TIC` numbered announcer lines double as a
 *    combo counter callout (1–10, clamped).
 *  - `b2bTetris`/`b2bSpin` — the `VO_B2BTETRS`/`VO_B2BTSPIN` lines, played as
 *    a short accent layered over the clear/spin sound (see `priority.ts`).
 *  - `praise*` — the eight superlative voice lines (`VO_AMAZING`, …) form a
 *    pool `AudioManager` picks from at random for a perfect clear, so the
 *    game's biggest reward doesn't repeat the same line every time.
 *  - `complete` — `VO_RECTIME` ("record time"), reused for a mode's
 *    successful completion (Sprint/Marathon/Ultra) — thematically the
 *    closest fit of what's on hand for "you finished."
 *  - `buttonClick` — `SFX_ButtonUp`, reused as the pause-toggle blip; a real
 *    dedicated pause cue doesn't exist yet.
 *  - No asset exists for "garbage received" — `synth.ts` generates a short
 *    alert tone instead of leaving it silent (see that file).
 *  - No music loops exist yet — `MusicController` implements the tier state
 *    machine (see `tierForLevel`) against an empty `MUSIC_TRACKS` map, so it
 *    runs (silently) today and only needs files dropped in later.
 *  - Unused-but-available in the pack: `SFX_PieceFall`, `SFX_PieceSoftDrop`,
 *    `SFX_PieceTouchDown`, `SFX_PieceTouchLR`, `SFX_PieceRotateFail`,
 *    `SFX_ButtonHover`, `SFX_Splash`, `VO_20sec`/`VO_30sec`/`VO_COUNTDWN`/
 *    `VO_TIME` — no `GameEvents` hook currently fits them (soft-drop ticks,
 *    a rejected-rotation event, menu hover, a countdown/time-remaining
 *    event). Left out rather than force-mapped.
 */

export type SfxId =
  | 'move'
  | 'rotate'
  | 'hold'
  | 'lockSoft'
  | 'lockHard'
  | 'clearSingle'
  | 'clearDouble'
  | 'clearTriple'
  | 'clearTetris'
  | 'spinT'
  | 'spinTSingle'
  | 'spinTDouble'
  | 'spinTTriple'
  | 'spinEZ'
  | 'spinEZClear'
  | 'b2bTetris'
  | 'b2bSpin'
  | 'combo1'
  | 'combo2'
  | 'combo3'
  | 'combo4'
  | 'combo5'
  | 'combo6'
  | 'combo7'
  | 'combo8'
  | 'combo9'
  | 'combo10'
  | 'levelUp'
  | 'gameOver'
  | 'gameStart'
  | 'complete'
  | 'praiseAmazing'
  | 'praiseBrilliant'
  | 'praiseExcellent'
  | 'praiseFantastic'
  | 'praiseGreat'
  | 'praiseGood'
  | 'praiseWonderful'
  | 'praiseWow'
  | 'buttonClick'

export const SFX_FILES: Record<SfxId, string> = {
  move: 'SFX_PieceMoveLR.ogg',
  rotate: 'SFX_PieceRotateLR.ogg',
  hold: 'SFX_PieceHold.ogg',
  lockSoft: 'SFX_PieceLockdown.ogg',
  lockHard: 'SFX_PieceHardDrop.ogg',
  clearSingle: 'SFX_SpecialLineClearSingle.ogg',
  clearDouble: 'SFX_SpecialLineClearDouble.ogg',
  clearTriple: 'SFX_SpecialLineClearTriple.ogg',
  clearTetris: 'SFX_SpecialTetris.ogg',
  spinT: 'SFX_SpecialTSpin.ogg',
  spinTSingle: 'SFX_SpecialTSpinSingle.ogg',
  spinTDouble: 'SFX_SpecialTSpinDouble.ogg',
  spinTTriple: 'SFX_SpecialTSpinTriple.ogg',
  spinEZ: 'SFX_SpecialTSpinEZ.ogg',
  spinEZClear: 'SFX_SpecialTSpinEZSingle.ogg',
  b2bTetris: 'VO_B2BTETRS.ogg',
  b2bSpin: 'VO_B2BTSPIN.ogg',
  combo1: 'VO_01TIC.ogg',
  combo2: 'VO_02TIC.ogg',
  combo3: 'VO_03TIC.ogg',
  combo4: 'VO_04TIC.ogg',
  combo5: 'VO_05TIC.ogg',
  combo6: 'VO_06TIC.ogg',
  combo7: 'VO_07TIC.ogg',
  combo8: 'VO_08TIC.ogg',
  combo9: 'VO_09TIC.ogg',
  combo10: 'VO_10TIC.ogg',
  levelUp: 'SFX_LevelUp.ogg',
  gameOver: 'SFX_GameOver.ogg',
  gameStart: 'SFX_GameStart.ogg',
  complete: 'VO_RECTIME.ogg',
  praiseAmazing: 'VO_AMAZING.ogg',
  praiseBrilliant: 'VO_BRILLIANT.ogg',
  praiseExcellent: 'VO_EXLNT.ogg',
  praiseFantastic: 'VO_FANTSTC.ogg',
  praiseGreat: 'VO_THTGREAT.ogg',
  praiseGood: 'VO_VRYGOOD.ogg',
  praiseWonderful: 'VO_WONDRFL.ogg',
  praiseWow: 'VO_WOW.ogg',
  buttonClick: 'SFX_ButtonUp.ogg'
}

export const PRAISE_IDS: readonly SfxId[] = [
  'praiseAmazing',
  'praiseBrilliant',
  'praiseExcellent',
  'praiseFantastic',
  'praiseGreat',
  'praiseGood',
  'praiseWonderful',
  'praiseWow'
]

const COMBO_IDS: readonly SfxId[] = [
  'combo1',
  'combo2',
  'combo3',
  'combo4',
  'combo5',
  'combo6',
  'combo7',
  'combo8',
  'combo9',
  'combo10'
]

/** Combo count (1-based, as displayed to the player) → announcer voice line, clamped to the 1–10 pack. */
export function comboVoiceId(count: number): SfxId {
  const i = Math.min(COMBO_IDS.length, Math.max(1, Math.round(count))) - 1
  return COMBO_IDS[i]
}

/** Resolve a manifest filename to a URL that respects Vite's configured `base`. */
export function soundUrl(file: string): string {
  const base = typeof import.meta !== 'undefined' ? (import.meta.env?.BASE_URL ?? '/') : '/'
  return `${base}sounds/${file}`
}

/**
 * Adaptive-music tiers. Levels 1–3 map to the minimal arrangement tier and it
 * climbs from there — see the ticket's progression. Level thresholds are
 * exposed as a pure function so the mapping is testable on its own.
 */
export type MusicTier = 1 | 2 | 3 | 4

export function tierForLevel(level: number): MusicTier {
  if (level >= 10) return 4
  if (level >= 7) return 3
  if (level >= 4) return 2
  return 1
}

/**
 * Per-tier loop file, empty until real music is authored/sourced — no track
 * shipped with this change, so `MusicController` runs its full state machine
 * against silence rather than inventing a placeholder loop.
 */
export const MUSIC_TRACKS: Partial<Record<MusicTier, string>> = {}
