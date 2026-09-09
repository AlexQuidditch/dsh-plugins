export interface LintFinding {
    rule: string;
    message: string;
}
export interface LintVerdict {
    errors: LintFinding[];
    warnings: LintFinding[];
}
interface XmlNode {
    name: string;
    attrs: Record<string, string>;
    children: XmlNode[];
    text?: string;
}
/** Minimal structural parser shared with the fallback engine. */
export declare function parseXmlLite(text: string): XmlNode;
/** The fallback engine: structure, statuses, identities, references, cycles. */
export declare function lintXml(text: string, kind: 'spec' | 'plan', options?: {
    status?: string;
    specText?: string;
}): LintVerdict;
/** Engine type: sync or async verdict, uniform for callers via `await`. */
export type LintEngine = (text: string, kind: 'spec' | 'plan', options?: {
    status?: string;
    specText?: string;
}) => LintVerdict | Promise<LintVerdict>;
/** Engine selection: the built sibling package wins when present. */
export declare function resolveEngine(): Promise<LintEngine>;
export {};
