export function apply(ctx) {
    const sessions = ctx.get('sessions');
    if (sessions === undefined)
        throw new Error('no sessions');
    const session = sessions.binding('abc')?.session;
    if (session === undefined)
        throw new Error('no session');
    const content = [{ type: 'text', text: 'x' }];
    const r = session.prompt(content, 'queue');
    const c = session.command('/hello');
    const reveal = [r, c];
}
