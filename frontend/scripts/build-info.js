import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
export const buildInfoPath = fileURLToPath(new URL('../../backend/app/site_build.json', import.meta.url))

export function createBuildInfo() {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  let revision = null, dirty = null
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    // dist and this generated manifest are outputs of the same build.
    dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal', '--',
      'frontend', 'backend', 'git_auto_commit.sh', 'docker-compose.yml',
      ':!frontend/dist', ':!backend/app/site_build.json'], { cwd: root, encoding: 'utf8' }).trim())
  } catch { /* Source archives may not include .git; never invent a revision. */ }
  const builtAt = new Date().toISOString()
  return { version, revision, dirty, builtAt, buildId: `${version}/${revision?.slice(0, 12) || 'unknown'}/${builtAt}` }
}
