/** The config file shape. */
export interface VvocConfig {
    roles?: Record<string, string>;
    presets?: Record<string, Record<string, string>>;
}
export declare const ROLE_ID_RE: RegExp;
export declare function configPath(globalScope: boolean): string;
export declare function readConfig(path: string): VvocConfig;
export declare function writeConfig(path: string, config: VvocConfig): void;
/** The machine-scope config merged UNDER the project-scope config. */
export declare function effectiveConfig(): {
    config: VvocConfig;
    sources: Array<{
        path: string;
        scope: 'global' | 'project';
    }>;
};
export declare function validateRoleId(role: string): string | undefined;
export declare function validateModel(model: string): string | undefined;
export interface RoleRow {
    role: string;
    model?: string;
    scope: 'global' | 'project' | null;
}
/** Rows for `vvoc role list`, project wins per role. */
export declare function listRoles(): RoleRow[];
export declare function setRole(role: string, model: string, globalScope: boolean): void;
export declare function unsetRole(role: string, globalScope: boolean): boolean;
export declare function applyPreset(name: string, globalScope: boolean): string | undefined;
/** Rows for `vvoc preset list`. */
export interface PresetRow {
    name: string;
    roles: Record<string, string>;
}
export declare function listPresets(): PresetRow[];
