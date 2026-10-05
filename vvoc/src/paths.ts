/**
 * vvoc path resolution: the DSH home, this repo's preset BUNDLE, and the
 * profile that installs it. Every test injects a fake home through
 * `dshHomeOverride`, so nothing here reads the real ~/.dsh unless the CLI is
 * actually run.
 *
 * Since 0.2 an agent preset is a declaration row in a bundle patch, not a
 * directory: `$DSH_HOME/.agent-presets/<id>/` is read by nothing, so the CLI
 * manages the `agent-presets` bundle in the workspace instead.
 */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Overridable for tests. */
export const env = {
  dshHomeOverride: process.env.VVOC_TEST_DSH_HOME,
  cwdOverride: process.env.VVOC_TEST_CWD,
}

/** The DeepSeek Harness home: $DSH_HOME, else ~/.dsh. */
export function dshHome(): string {
  return env.dshHomeOverride ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** The default profile to manage: $DSH_PROFILE, else `web`. */
export function defaultProfile(): string {
  return process.env.DSH_PROFILE ?? 'web'
}

/** One profile directory inside the DSH home. */
export function profileDir(profile: string): string {
  return join(dshHome(), 'profiles', profile)
}

/** This repository's preset bundle directory (vvoc/lib → vvoc → repo root). */
export function bundleDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', '..', 'agent-presets')
}

/** The vv-* skills shipped inside that bundle. */
export function bundleSkillsDir(): string {
  return join(bundleDir(), 'skills')
}

/** The project working directory (overridable for tests). */
export function projectDir(): string {
  return env.cwdOverride ?? process.cwd()
}

/** Project-level vvoc config path. */
export function projectConfigPath(): string {
  return join(projectDir(), '.vvoc', 'vvoc.json')
}

/** Machine-level vvoc config path. */
export function globalConfigPath(): string {
  return join(dshHome(), 'vv-vvoc.json')
}

/** The analytics JSONL directory the dsh-vv-analytics bundle writes. */
export function analyticsDir(): string {
  return join(dshHome(), 'vv-analytics')
}
