import { join } from 'node:path'
import type { AssetTypeDefinition } from './types.ts'

const appDir = process.cwd()
const resourcesDir = join(appDir, '..', 'tetris', 'resources')
const rendererDir = join(appDir, '..', '..', 'packages', 'renderer')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const validateOgg = (contents: Buffer): string | undefined =>
  contents.length >= 4 && contents.subarray(0, 4).toString('ascii') === 'OggS'
    ? undefined
    : 'The replacement must be a valid OGG file.'

export const validatePng = (contents: Buffer): string | undefined =>
  contents.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? undefined : 'The file must be a valid PNG image.'

export const assetRegistry: AssetTypeDefinition[] = [
  {
    id: 'sounds',
    label: 'Sounds',
    singular: 'sound',
    description: 'Effects and voice cues used by the game audio system.',
    sourceDir: join(resourcesDir, 'sounds'),
    mirrors: [join(rendererDir, 'public', 'sounds')],
    extensions: ['.ogg'],
    accept: '.ogg,audio/ogg,application/ogg',
    contentType: 'audio/ogg',
    preview: 'audio',
    maxBytes: 8 * 1024 * 1024,
    filters: [
      { id: 'all', label: 'All' },
      { id: 'sfx', label: 'Effects' },
      { id: 'voice', label: 'Voice' }
    ],
    classify: (name) => (name.startsWith('VO_') ? 'voice' : 'sfx'),
    badge: (name) => (name.startsWith('VO_') ? 'VO' : 'SFX'),
    validate: validateOgg,
    usageSource: join(rendererDir, 'src', 'audio', 'manifest.ts')
  },
  {
    id: 'music',
    label: 'Music',
    singular: 'track',
    description: 'Background music tracks. New tracks must be wired into MUSIC_TRACKS by hand.',
    sourceDir: join(resourcesDir, 'music'),
    mirrors: [join(rendererDir, 'public', 'music')],
    extensions: ['.ogg'],
    accept: '.ogg,audio/ogg,application/ogg',
    contentType: 'audio/ogg',
    preview: 'audio',
    maxBytes: 32 * 1024 * 1024,
    filters: [{ id: 'all', label: 'All' }],
    validate: validateOgg
  },
  {
    id: 'images',
    label: 'Images',
    singular: 'image',
    description: 'Application images such as the window icon.',
    sourceDir: resourcesDir,
    mirrors: [],
    extensions: ['.png'],
    accept: '.png,image/png',
    contentType: 'image/png',
    preview: 'image',
    maxBytes: 2 * 1024 * 1024,
    filters: [{ id: 'all', label: 'All' }],
    validate: validatePng
  }
]
