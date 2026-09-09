export interface SyncReport {
    installed: boolean;
    path: string;
    skills: Array<{
        name: string;
        ok: boolean;
        reason?: string;
    }>;
}
/** Copy the repo preset into the user root; refuse overwrite without --force. */
export declare function installPreset(force: boolean): {
    copied: boolean;
    path: string;
    backup?: string;
};
/** Validate the SKILL.md frontmatter of the installed preset. */
export declare function checkInstalledPreset(): SyncReport;
