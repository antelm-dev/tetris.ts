import { join } from 'node:path'

const appDir = process.cwd()

export const assetRegistry = [
  {
    id: 'sounds',
    label: 'Sounds',
    singular: 'sound',
    description: 'Effects and voice cues used by the game audio system.',
    sourceDir: join(appDir, '..', 'tetris', 'resources', 'sounds'),
    mirrors: [join(appDir, '..', '..', 'packages', 'renderer', 'public', 'sounds')],
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
    validate: (contents) =>
      contents.length >= 4 && contents.subarray(0, 4).toString('ascii') === 'OggS'
        ? undefined
        : 'The replacement must be a valid OGG file.'
  }
]
