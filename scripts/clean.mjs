import { rmSync } from 'node:fs'

for (const dir of ['dist-main', 'dist-renderer', 'release']) {
  rmSync(dir, { recursive: true, force: true })
}
