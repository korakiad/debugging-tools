import { useEffect, useRef } from "react";
import { useStore } from "../state/store";

export function useWebSocket(url: string = "/ws") {
    const ref = useRef<WebSocket | null>(null);
    const apply = useStore((s) => s.applyEvent);

    useEffect(() => {
        // Demo mode (?demo=<name>) preloads the store from a static fixture
        // and must not be clobbered by a real `init` from the server.
        if ((window as unknown as { __DEMO_MODE__?: boolean }).__DEMO_MODE__) {
            return;
        }
        const absolute = url.startsWith("ws") ? url : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${url}`;
        const ws = new WebSocket(absolute);
        ref.current = ws;
        ws.onmessage = (ev) => apply(JSON.parse(ev.data));
        return () => ws.close();
    }, [url, apply]);

    const send = (cmd: Record<string, unknown>) => {
        ref.current?.send(JSON.stringify(cmd));
    };
    return { send };
}
