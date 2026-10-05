/**
 * vvoc install/sync/status: manage the `agent-presets` BUNDLE — the thing that
 * actually carries the vv-controller preset since 0.2.
 *
 * `assertBundle` validates the workspace bundle, `checkBundleSkills` validates
 * the shipped `SKILL.md` frontmatter, `presetInstalled` reports whether the
 * profile lists the bundle, and `installCommand` is the argv the CLI spawns.
 * Nothing here writes to the DSH home: `dsh plugin add` owns that.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bundleDir, bundleSkillsDir, profileDir } from './paths.js';
/** The bundle's package name, as the profile lists it. */
export const BUNDLE_NAME = 'dsh-agent-presets';
/** Throw unless the bundle carries everything an install needs. */
export function assertBundle() {
    const dir = bundleDir();
    for (const file of ['package.json', 'cordis.patch.yml']) {
        if (!existsSync(join(dir, file))) {
            throw new Error(`bundle is incomplete: ${join(dir, file)} is missing`);
        }
    }
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    }
    catch (error) {
        throw new Error(`bundle package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (manifest.name !== BUNDLE_NAME) {
        throw new Error(`bundle package.json must be named ${BUNDLE_NAME}, found ${JSON.stringify(manifest.name)}`);
    }
    if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
        throw new Error('bundle package.json must declare dsh.bundle.patch');
    }
}
/** Validate the SKILL.md frontmatter of every skill shipped in the bundle. */
export function checkBundleSkills() {
    const skillsDir = bundleSkillsDir();
    let names = [];
    try {
        names = readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory());
    }
    catch {
        return [];
    }
    const skills = [];
    for (const name of names.sort()) {
        try {
            const raw = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8');
            const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
            if (match === null) {
                skills.push({ name, ok: false, reason: 'no frontmatter' });
                continue;
            }
            const hasName = /^name\s*:/m.test(match[1]);
            const hasDescription = /^description\s*:/m.test(match[1]);
            if (!hasName || !hasDescription) {
                skills.push({ name, ok: false, reason: 'frontmatter needs name and description' });
                continue;
            }
            skills.push({ name, ok: true });
        }
        catch (error) {
            skills.push({ name, ok: false, reason: error instanceof Error ? error.message : String(error) });
        }
    }
    return skills;
}
/**
 * Whether the profile's own `package.json` lists the bundle.
 *
 * This is the honest test of "installed": the bundle patch only applies when
 * `dsh plugin add` has reconciled `dsh.profile.bundles`.
 */
export function presetInstalled(profile) {
    try {
        const manifest = JSON.parse(readFileSync(join(profileDir(profile), 'package.json'), 'utf8'));
        const bundles = manifest.dsh?.profile?.bundles;
        return Array.isArray(bundles) && bundles.includes(BUNDLE_NAME);
    }
    catch {
        return false;
    }
}
/** The argv (after the `dsh` binary) that installs the bundle into a profile. */
export function installCommand(profile) {
    return ['plugin', '--profile', profile, 'add', bundleDir()];
}
/** Read-only state of the bundle and its profile, for `vvoc status`. */
export function reportBundle(profile) {
    return {
        bundle: bundleDir(),
        profile,
        installed: presetInstalled(profile),
        skills: checkBundleSkills(),
    };
}
