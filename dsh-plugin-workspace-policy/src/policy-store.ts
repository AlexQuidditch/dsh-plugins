/**
 * Per-workspace policy file store: load, validate, and hot-reload
 * `<workspaceRoot>/<configFileName>` with a last-good guarantee.
 *
 * One slot per workspace root. The first `load` reads and parses the file and
 * (when watching is enabled) attaches directory watchers: the config file's
 * parent directory when it exists, otherwise the workspace root itself,
 * upgrading once the parent directory appears. Watcher events are debounced;
 * a re-parse failure keeps the last good policy and only degrades the slot
 * status, so a half-written file can never unsettle live sessions.
 *
 * All timers and watchers created here are released by `dispose()`, which the
 * plugin registers as its fiber effect.
 */

import { type FSWatcher, watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { parsePolicyFile } from './policy-file.ts'
import type { PolicySlot, PolicySlotStatus, WorkspacePolicy } from './types.ts'

/** Logging surface the store needs; satisfied by a Cordis logger. */
export interface PolicyStoreLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

/** Constructor options. */
export interface PolicyStoreOptions {
  /** Policy file path relative to the workspace root. */
  configFileName: string
  /** Attach watchers for hot reload. */
  watchEnabled: boolean
  /** Debounce for watcher-triggered reloads, milliseconds. */
  debounceMs: number
  /** Diagnostics sink. */
  logger: PolicyStoreLogger
}

interface Slot {
  rootDir: string
  filePath: string
  status: PolicySlotStatus
  policy: WorkspacePolicy | null
  problem: string | null
  loadPromise: Promise<PolicySlot> | null
  dirWatcher: FSWatcher | null
  rootWatcher: FSWatcher | null
  upgradeWatcher: FSWatcher | null
  reloadTimer: ReturnType<typeof setTimeout> | null
  /** Suppresses repeat warnings while the slot stays invalid. */
  warned: boolean
}

/** Store of per-workspace policy slots. */
export class WorkspacePolicyStore {
  private readonly slots = new Map<string, Slot>()
  private disposed = false

  constructor(private readonly options: PolicyStoreOptions) {}

  /** Whether the store still accepts work; false after {@link dispose}. */
  get alive(): boolean {
    return !this.disposed
  }

  /**
   * Resolve the policy slot for one workspace root, loading it on first use.
   * Returns a plain snapshot; a missing or broken file yields `policy: null`
   * (the callers stay inert), never a rejection.
   */
  async load(rootDir: string): Promise<PolicySlot> {
    const slot = this.slotFor(rootDir)
    if (slot.status !== 'unloaded') return this.snapshot(slot)
    if (slot.loadPromise !== null) {
      try {
        return await slot.loadPromise
      } catch {
        return this.snapshot(slot)
      }
    }
    const promise = this.reload(slot).then(() => this.snapshot(slot))
    slot.loadPromise = promise
    try {
      return await promise
    } catch {
      // reload() never rejects; this guards against unforeseen throws.
      slot.status = 'invalid'
      slot.problem = 'unexpected load failure'
      return this.snapshot(slot)
    } finally {
      slot.loadPromise = null
    }
  }

  /** Cached snapshot without any I/O; `undefined` when never loaded. */
  peek(rootDir: string): PolicySlot | undefined {
    const slot = this.slots.get(rootDir)
    return slot === undefined || slot.status === 'unloaded' ? undefined : this.snapshot(slot)
  }

  /** Release every watcher and pending timer. */
  dispose(): void {
    this.disposed = true
    for (const slot of this.slots.values()) this.teardownWatchers(slot)
    this.slots.clear()
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private slotFor(rootDir: string): Slot {
    let slot = this.slots.get(rootDir)
    if (slot === undefined) {
      slot = {
        rootDir,
        filePath: join(rootDir, this.options.configFileName),
        status: 'unloaded',
        policy: null,
        problem: null,
        loadPromise: null,
        dirWatcher: null,
        rootWatcher: null,
        upgradeWatcher: null,
        reloadTimer: null,
        warned: false,
      }
      this.slots.set(rootDir, slot)
      if (this.options.watchEnabled && !this.disposed) this.attachWatchers(slot)
    }
    return slot
  }

  private snapshot(slot: Slot): PolicySlot {
    return {
      status: slot.status,
      policy: slot.policy,
      problem: slot.problem,
      filePath: slot.filePath,
    }
  }

  /** Read and parse the policy file into the slot. Never rejects. */
  private async reload(slot: Slot): Promise<void> {
    if (this.disposed) return
    let text: string
    try {
      text = await readFile(slot.filePath, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        if (slot.status === 'loaded' || slot.status === 'invalid') {
          this.options.logger.info(
            '[workspace-policy] policy file removed at %s; workspace is now policy-free',
            slot.filePath,
          )
        }
        slot.status = 'missing'
        slot.policy = null
        slot.problem = null
        slot.warned = false
        return
      }
      this.degrade(slot, `policy file unreadable (${code ?? 'unknown error'}); keeping last known state`)
      return
    }
    const parsed = parsePolicyFile(text)
    for (const note of parsed.notes) {
      this.options.logger.info('[workspace-policy] %s: %s', slot.filePath, note)
    }
    if (parsed.problem !== null) {
      this.degrade(slot, `${slot.filePath}: ${parsed.problem}`)
      return
    }
    const wasWarned = slot.warned
    slot.status = 'loaded'
    slot.policy = parsed.policy
    slot.problem = null
    slot.warned = false
    if (wasWarned) {
      this.options.logger.info('[workspace-policy] policy file recovered: %s', slot.filePath)
    }
  }

  /** Mark a slot invalid, keeping its last good policy. */
  private degrade(slot: Slot, problem: string): void {
    slot.status = 'invalid'
    slot.problem = problem
    if (!slot.warned) {
      this.options.logger.warn('[workspace-policy] %s%s', problem, slot.policy === null ? '' : '; keeping the last good policy')
      slot.warned = true
    }
  }

  private scheduleReload(slot: Slot): void {
    if (this.disposed || slot.reloadTimer !== null) return
    slot.reloadTimer = setTimeout(() => {
      slot.reloadTimer = null
      void this.reload(slot)
    }, this.options.debounceMs)
  }

  // START_BLOCK_WATCHERS: [Two-level directory watch with debounced reload]
  private attachWatchers(slot: Slot): void {
    const configDir = dirname(slot.filePath)
    const configName = basename(slot.filePath)

    // Watch the config directory when it exists.
    try {
      slot.dirWatcher = watch(configDir, (_event, filename) => {
        if (filename === configName) this.scheduleReload(slot)
      })
    } catch {
      slot.dirWatcher = null
    }
    if (slot.dirWatcher !== null) {
      slot.dirWatcher.on('error', () => {
        this.options.logger.warn('[workspace-policy] watcher error on %s; hot reload disabled there', configDir)
        this.closeWatcher(slot, 'dirWatcher')
      })
    }

    // When the config directory does not exist yet, watch the workspace root
    // for its creation and upgrade. Also keep the root watcher when the
    // config file sits directly in the root.
    if (slot.dirWatcher === null || configDir === slot.rootDir) {
      const watchedName = configDir === slot.rootDir ? configName : basename(configDir)
      try {
        slot.rootWatcher = watch(slot.rootDir, (_event, filename) => {
          const name = filename ?? ''
          if (name === watchedName) this.scheduleReload(slot)
          if (name === basename(configDir) && configDir !== slot.rootDir && slot.upgradeWatcher === null) {
            this.upgrade(slot)
          }
        })
      } catch {
        slot.rootWatcher = null
      }
      if (slot.rootWatcher !== null) {
        slot.rootWatcher.on('error', () => {
          this.options.logger.warn('[workspace-policy] watcher error on %s; hot reload disabled there', slot.rootDir)
          this.closeWatcher(slot, 'rootWatcher')
        })
      }
    }
  }

  /** Start watching the config directory once it exists. */
  private upgrade(slot: Slot): void {
    if (this.disposed) return
    const configDir = dirname(slot.filePath)
    const configName = basename(slot.filePath)
    try {
      const watcher = watch(configDir, (_event, filename) => {
        if (filename === configName) this.scheduleReload(slot)
      })
      slot.upgradeWatcher = watcher
      watcher.on('error', () => {
        this.closeWatcher(slot, 'upgradeWatcher')
      })
      this.scheduleReload(slot)
    } catch {
      // The directory vanished again; the root watcher will retry later.
    }
  }

  private closeWatcher(slot: Slot, key: 'dirWatcher' | 'rootWatcher' | 'upgradeWatcher'): void {
    const watcher = slot[key]
    slot[key] = null
    try {
      watcher?.close()
    } catch {
      // already closed
    }
  }

  private teardownWatchers(slot: Slot): void {
    this.closeWatcher(slot, 'dirWatcher')
    this.closeWatcher(slot, 'rootWatcher')
    this.closeWatcher(slot, 'upgradeWatcher')
    if (slot.reloadTimer !== null) {
      clearTimeout(slot.reloadTimer)
      slot.reloadTimer = null
    }
  }
  // END_BLOCK_WATCHERS
}
