/**
 * vvoc install/sync/status: manage the vv-controller preset in the DSH user
 * preset root. install copies the repo preset directory; sync re-copies and
 * validates the skill frontmatter of the installed copy; status reports both.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { installedPresetDir, presetsRoot, repoPresetDir } from './paths.js'

export interface SyncReport {
  installed: boolean
  path: string
  skills: Array<{ name: string; ok: boolean; reason?: string }>
}

function timestamp(): string {
  // Milliseconds: two forced installs within one second must not collide.
  return String(Date.now())
}

/** Copy the repo preset into the user root; refuse overwrite without --force. */
export function installPreset(force: boolean): { copied: boolean; path: string; backup?: string } {
  const src = repoPresetDir()
  if (!existsSync(join(src, 'agent.cordis.yml')) || !existsSync(join(src, 'preset.yml'))) {
    throw new Error(`source preset not found at ${src}`)
  }
  const dest = installedPresetDir()
  if (existsSync(dest) && !force) {
    throw new Error(`preset already installed at ${dest}; use --force to overwrite (old copy is backed up)`)
  }
  let backup: string | undefined
  if (existsSync(dest)) {
    backup = `${dest}.bak-${timestamp()}`
    renameSync(dest, backup)
  }
  mkdirSync(presetsRoot(), { recursive: true })
  cpSync(src, dest, { recursive: true })
  return { copied: true, path: dest, backup }
}

/** Validate the SKILL.md frontmatter of the installed preset. */
export function checkInstalledPreset(): SyncReport {
  const path = installedPresetDir()
  const skillsDir = join(path, 'skills')
  const skills: SyncReport['skills'] = []
  if (!existsSync(join(path, 'agent.cordis.yml'))) return { installed: false, path, skills }

  let names: string[] = []
  try {
    names = readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory())
  } catch {
    return { installed: true, path, skills }
  }
  for (const name of names.sort()) {
    const file = join(skillsDir, name, 'SKILL.md')
    try {
      const raw = readFileSync(file, 'utf8')
      const match = /^---\n([\s\S]*?)\n---\n/.exec(raw)
      if (match === null) { skills.push({ name, ok: false, reason: 'no frontmatter' }); continue }
      const hasName = /^name\s*:/m.test(match[1])
      const hasDescription = /^description\s*:/m.test(match[1])
      if (!hasName || !hasDescription) { skills.push({ name, ok: false, reason: 'frontmatter needs name and description' }); continue }
      skills.push({ name, ok: true })
    } catch (error) {
      skills.push({ name, ok: false, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return { installed: true, path, skills }
}
