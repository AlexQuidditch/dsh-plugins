import { jsx as _jsx } from "react/jsx-runtime";
export function HelloAction({ runHello }) {
    return (_jsx("button", { type: "button", title: "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443 \u0430\u0433\u0435\u043D\u0442\u0443", onClick: () => void runHello().catch((error) => {
            console.error('[dsh-hello-world] runHello failed:', error);
        }), children: "Foo" }));
}
