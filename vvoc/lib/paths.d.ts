/** Overridable for tests. */
export declare const env: {
    dshHomeOverride: string | undefined;
    cwdOverride: string | undefined;
};
/** The DeepSeek Harness home: $DSH_HOME, else ~/.dsh. */
export declare function dshHome(): string;
/** The default profile to manage: $DSH_PROFILE, else `web`. */
export declare function defaultProfile(): string;
/** One profile directory inside the DSH home. */
export declare function profileDir(profile: string): string;
/** This repository's preset bundle directory (vvoc/lib → vvoc → repo root). */
export declare function bundleDir(): string;
/** The vv-* skills shipped inside that bundle. */
export declare function bundleSkillsDir(): string;
/** The project working directory (overridable for tests). */
export declare function projectDir(): string;
/** Project-level vvoc config path. */
export declare function projectConfigPath(): string;
/** Machine-level vvoc config path. */
export declare function globalConfigPath(): string;
/** The analytics JSONL directory the dsh-vv-analytics bundle writes. */
export declare function analyticsDir(): string;
