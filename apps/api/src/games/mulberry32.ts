/**
 * Re-export the shared engine PRNG so the authoritative match layer and the
 * client stay byte-for-byte aligned on piece bags and related streams.
 */
export { mulberry32 } from '@tetris/engine'
