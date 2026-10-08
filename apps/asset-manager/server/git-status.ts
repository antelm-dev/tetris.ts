import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Absolute paths that `git status` reports as changed (including untracked) under `dirs`.
 * Resolves to an empty set when git is missing or `cwd` is not inside a repository.
 */
export async function modifiedPaths(cwd: string, dirs: string[]): Promise<Set<string>> {
  try {
    // Sequential on purpose: outside a repository this fails fast without leaving a second git process running.
    const { stdout: prefix } = await execFileAsync('git', ['rev-parse', '--show-prefix'], { cwd })
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain', '-z', '--untracked-files=all', '--', ...dirs],
      { cwd, maxBuffer: 16 * 1024 * 1024 }
    )
    // Porcelain paths are relative to the repository root; derive the root from `cwd` so the
    // result uses the same spelling as the caller's paths (e.g. Windows 8.3 temp dirs).
    const root = resolve(
      cwd,
      ...prefix
        .trim()
        .split('/')
        .filter(Boolean)
        .map(() => '..')
    )
    return new Set(parsePorcelain(stdout).map((path) => resolve(root, path)))
  } catch {
    return new Set()
  }
}

/** Repository-relative paths from `git status --porcelain -z` output (rename sources are skipped). */
export function parsePorcelain(output: string): string[] {
  const records = output.split('\0')
  const paths: string[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.length < 4) continue
    paths.push(record.slice(3))
    // Renames and copies are followed by a second NUL-terminated record holding the original path.
    if (record[0] === 'R' || record[0] === 'C') index += 1
  }
  return paths
}
