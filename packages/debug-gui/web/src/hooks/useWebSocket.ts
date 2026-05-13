import { useEffect, useRef } from "react";
import { parseServerEvent } from "@debug-gui/protocol";
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
        ws.onmessage = (ev) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(ev.data);
            } catch {
                return; // malformed JSON
            }
            const evt = parseServerEvent(parsed);
            if (!evt) {
                console.warn("[ws] dropped malformed server event:", parsed);
                return;
            }
            apply(evt);
        };
        return () => ws.close();
    }, [url, apply]);

    const send = (cmd: Record<string, unknown>) => {
        ref.current?.send(JSON.stringify(cmd));
    };
    return { send };
}
