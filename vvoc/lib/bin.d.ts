/** Runs one child process; injectable so tests never spawn `dsh`. */
export type Runner = (command: string, args: string[]) => number;
export declare function main(argv: string[], run?: Runner): Promise<number>;
