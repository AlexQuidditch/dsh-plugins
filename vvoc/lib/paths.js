/**
 * vvoc path resolution: the DSH home, the preset source inside this repo, and
 * the installed preset destination. Every test injects a fake home through
 * `dshHomeOverride`, so nothing here reads the real ~/.dsh unless the CLI is
 * actually run.
 */
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Overridable for tests. */
export const env = {
    dshHomeOverride: process.env.VVOC_TEST_DSH_HOME,
    cwdOverride: process.env.VVOC_TEST_CWD,
};
/** The DeepSeek Harness home: $DSH_HOME, else ~/.dsh. */
export function dshHome() {
    return env.dshHomeOverride ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
}
/** The user preset root inside the DSH home. */
export function presetsRoot() {
    return join(dshHome(), '.agent-presets');
}
/** The installed vv-controller preset directory. */
export function installedPresetDir() {
    return join(presetsRoot(), 'vv-controller');
}
/** This repository's vv-controller source directory (vvoc/lib → vvoc → repo root). */
export function repoPresetDir() {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, '..', '..', 'vv-controller');
}
/** The project working directory (overridable for tests). */
export function projectDir() {
    return env.cwdOverride ?? process.cwd();
}
/** Project-level vvoc config path. */
export function projectConfigPath() {
    return join(projectDir(), '.vvoc', 'vvoc.json');
}
/** Machine-level vvoc config path. */
export function globalConfigPath() {
    return join(dshHome(), 'vv-vvoc.json');
}
/** The analytics JSONL directory the dsh-vv-analytics bundle writes. */
export function analyticsDir() {
    return join(dshHome(), 'vv-analytics');
}
