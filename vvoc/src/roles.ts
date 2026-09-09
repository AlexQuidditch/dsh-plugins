/**
 * vvoc model roles: the DSH port of vv-opencode's ModelRolesPlugin.
 *
 * Roles are semantic names (`default`, `smart`, `fast`, `reviewer`, or any
 * lowercase-hyphenated id) mapped to `provider/model` strings. The map lives in
 * a JSON file — project-scope `./.vvoc/vvoc.json` or machine-scope
 * `$DSH_HOME/vv-vvoc.json`. The vv-controller skills consult the map when
 * spawning subagents (the DSH `subagent` tool takes a model argument), so the
 * CLI only manages configuration and the convention stays prompt-driven.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { globalConfigPath, projectConfigPath } from './paths.js'

/** The config file shape. */
export interface VvocConfig {
  roles?: Record<string, string>
  presets?: Record<string, Record<string, string>>
}

export const ROLE_ID_RE = /^[a-z][a-z0-9-]*$/
const MODEL_RE = /^[^\s/]+\/[^\s/]+$/

export function configPath(globalScope: boolean): string {
  return globalScope ? globalConfigPath() : projectConfigPath()
}

export function readConfig(path: string): VvocConfig {
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as VvocConfig
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function writeConfig(path: string, config: VvocConfig): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
}

/** The machine-scope config merged UNDER the project-scope config. */
export function effectiveConfig(): { config: VvocConfig; sources: Array<{ path: string; scope: 'global' | 'project' }> } {
  const sources: Array<{ path: string; scope: 'global' | 'project' }> = []
  const global = readConfig(globalConfigPath())
  if (existsSync(globalConfigPath())) sources.push({ path: globalConfigPath(), scope: 'global' })
  const project = readConfig(projectConfigPath())
  if (existsSync(projectConfigPath())) sources.push({ path: projectConfigPath(), scope: 'project' })
  return { config: { roles: { ...global.roles, ...project.roles }, presets: { ...global.presets, ...project.presets } }, sources }
}

export function validateRoleId(role: string): string | undefined {
  if (!ROLE_ID_RE.test(role)) return `role id must match ${ROLE_ID_RE}, got "${role}"`
  return undefined
}

export function validateModel(model: string): string | undefined {
  if (!MODEL_RE.test(model)) return `model must look like "provider/model" (no spaces, one slash), got "${model}"`
  return undefined
}

export interface RoleRow {
  role: string
  model?: string
  scope: 'global' | 'project' | null
}

/** Rows for `vvoc role list`, project wins per role. */
export function listRoles(): RoleRow[] {
  const { config } = effectiveConfig()
  return Object.keys(config.roles ?? {}).sort().map((role) => ({
    role,
    model: config.roles?.[role],
    scope: scopeOf(role),
  }))
}

function scopeOf(role: string): 'global' | 'project' | null {
  const project = readConfig(projectConfigPath())
  if (project.roles?.[role] !== undefined) return 'project'
  const global = readConfig(globalConfigPath())
  if (global.roles?.[role] !== undefined) return 'global'
  return null
}

export function setRole(role: string, model: string, globalScope: boolean): void {
  const path = configPath(globalScope)
  const config = readConfig(path)
  config.roles = { ...config.roles, [role]: model }
  writeConfig(path, config)
}

export function unsetRole(role: string, globalScope: boolean): boolean {
  const path = configPath(globalScope)
  const config = readConfig(path)
  if (config.roles?.[role] === undefined) return false
  delete config.roles[role]
  if (Object.keys(config.roles).length === 0) delete config.roles
  writeConfig(path, config)
  return true
}

export function applyPreset(name: string, globalScope: boolean): string | undefined {
  const path = configPath(globalScope)
  const config = readConfig(path)
  const preset = config.presets?.[name]
  if (preset === undefined) return `preset "${name}" not found in ${path}`
  config.roles = { ...preset }
  writeConfig(path, config)
  return undefined
}

/** Rows for `vvoc preset list`. */
export interface PresetRow {
  name: string
  roles: Record<string, string>
}

export function listPresets(): PresetRow[] {
  const { config } = effectiveConfig()
  return Object.keys(config.presets ?? {}).sort().map((name) => ({
    name,
    roles: config.presets?.[name] ?? {},
  }))
}
