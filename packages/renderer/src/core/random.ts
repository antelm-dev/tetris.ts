/**
 * Re-export the shared engine PRNG. Kept at this path so existing renderer /
 * test imports continue to resolve without a package-wide rename.
 */
export { mulberry32 } from '@tetris/engine'
