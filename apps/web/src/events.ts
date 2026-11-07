import { useEffect, useRef } from "react";
import type { AppEvent } from "./api";

const APP_EVENT = "mc:event";

/** One EventSource for the whole app; events are re-dispatched on window. */
export function useEventStream(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      try {
        window.dispatchEvent(new CustomEvent<AppEvent>(APP_EVENT, { detail: JSON.parse(m.data) }));
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => es.close();
  }, [enabled]);
}

/** Subscribe to server events. The handler can change between renders without resubscribing. */
export function useAppEvent(handler: (e: AppEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h = (e: Event) => ref.current((e as CustomEvent<AppEvent>).detail);
    window.addEventListener(APP_EVENT, h);
    return () => window.removeEventListener(APP_EVENT, h);
  }, []);
}
