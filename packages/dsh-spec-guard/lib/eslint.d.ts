interface GraceSourceCode {
    text: string;
}
interface GraceRuleContext {
    filename?: string;
    sourceCode?: GraceSourceCode;
    getSourceCode?: () => GraceSourceCode;
    getFilename?: () => string;
    report: (descriptor: {
        loc: {
            start: {
                line: number;
                column: number;
            };
            end: {
                line: number;
                column: number;
            };
        };
        message: string;
    }) => void;
}
declare const rules: {
    'unpaired-marker': {
        meta: {
            type: "problem";
            docs: {
                description: string;
            };
            schema: never[];
        };
        create(context: GraceRuleContext): {};
    };
    'complexity-blocks': {
        meta: {
            type: "problem";
            docs: {
                description: string;
            };
            schema: never[];
        };
        create(context: GraceRuleContext): {};
    };
    'complexity-missing': {
        meta: {
            type: "problem";
            docs: {
                description: string;
            };
            schema: never[];
        };
        create(context: GraceRuleContext): {};
    };
};
declare const plugin: {
    meta: {
        name: string;
        version: string;
    };
    rules: {
        'unpaired-marker': {
            meta: {
                type: "problem";
                docs: {
                    description: string;
                };
                schema: never[];
            };
            create(context: GraceRuleContext): {};
        };
        'complexity-blocks': {
            meta: {
                type: "problem";
                docs: {
                    description: string;
                };
                schema: never[];
            };
            create(context: GraceRuleContext): {};
        };
        'complexity-missing': {
            meta: {
                type: "problem";
                docs: {
                    description: string;
                };
                schema: never[];
            };
            create(context: GraceRuleContext): {};
        };
    };
};
export default plugin;
export { rules };
