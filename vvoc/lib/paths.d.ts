/** Overridable for tests. */
export declare const env: {
    dshHomeOverride: string | undefined;
    cwdOverride: string | undefined;
};
/** The DeepSeek Harness home: $DSH_HOME, else ~/.dsh. */
export declare function dshHome(): string;
/** The user preset root inside the DSH home. */
export declare function presetsRoot(): string;
/** The installed vv-controller preset directory. */
export declare function installedPresetDir(): string;
/** This repository's vv-controller source directory (vvoc/lib → vvoc → repo root). */
export declare function repoPresetDir(): string;
/** The project working directory (overridable for tests). */
export declare function projectDir(): string;
/** Project-level vvoc config path. */
export declare function projectConfigPath(): string;
/** Machine-level vvoc config path. */
export declare function globalConfigPath(): string;
/** The analytics JSONL directory the dsh-vv-analytics bundle writes. */
export declare function analyticsDir(): string;
