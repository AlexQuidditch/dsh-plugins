/** The bundle's package name, as the profile lists it. */
export declare const BUNDLE_NAME = "dsh-agent-presets";
export interface SkillReport {
    name: string;
    ok: boolean;
    reason?: string;
}
/** Throw unless the bundle carries everything an install needs. */
export declare function assertBundle(): void;
/** Validate the SKILL.md frontmatter of every skill shipped in the bundle. */
export declare function checkBundleSkills(): SkillReport[];
/**
 * Whether the profile's own `package.json` lists the bundle.
 *
 * This is the honest test of "installed": the bundle patch only applies when
 * `dsh plugin add` has reconciled `dsh.profile.bundles`.
 */
export declare function presetInstalled(profile: string): boolean;
/** The argv (after the `dsh` binary) that installs the bundle into a profile. */
export declare function installCommand(profile: string): string[];
export interface BundleReport {
    bundle: string;
    profile: string;
    installed: boolean;
    skills: SkillReport[];
}
/** Read-only state of the bundle and its profile, for `vvoc status`. */
export declare function reportBundle(profile: string): BundleReport;
