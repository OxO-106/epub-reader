/**
 * Whether the server can be reached, as one fact shared by the Library and the Reader. Every request to the
 * server goes through `apiFetch`, which reports the outcome here; and while a screen is watching, a small
 * request is sent every few seconds, so a server that goes away (or comes back) is noticed without the user
 * doing anything.
 */
import { useEffect, useState } from "preact/hooks";

/** How often the server is asked "are you there?" while a screen is watching. */
export const heartbeatMs = 3000;

let reachable = true;
const listeners = new Set<(reachable: boolean) => void>();
let heartbeat: ReturnType<typeof setInterval> | undefined;

function report(next: boolean) {
  if (next === reachable) return;
  reachable = next;
  for (const listener of [...listeners]) listener(next);
}

/** `fetch` for the server's API. A request that gets any answer proves the server is there; one that cannot connect proves it is not. */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(input, init);
    report(true);
    return response;
  } catch (error) {
    // Only a failure to connect: an aborted request says nothing about the server.
    if (!(error instanceof DOMException && error.name === "AbortError")) report(false);
    throw error;
  }
}

/** Asks the server something cheap, to find out right now whether it is there. */
export function checkConnection(): Promise<void> {
  return apiFetch("/api/library-folder").then(
    () => {},
    () => {},
  );
}

/** True while the server cannot be reached. Watching also starts the periodic check. */
export function useServerUnreachable(): boolean {
  const [unreachable, setUnreachable] = useState(!reachable);
  useEffect(() => {
    const listener = (isReachable: boolean) => setUnreachable(!isReachable);
    listeners.add(listener);
    setUnreachable(!reachable);
    heartbeat ??= setInterval(checkConnection, heartbeatMs);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
    };
  }, []);
  return unreachable;
}
