import { openAsBlob } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { startServer, type RunningServer, type ServerOptions } from "../../src/server/server.ts";

export interface TestServer extends RunningServer {
  dataDir: string;
  libraryDir: string;
  /** Stops the server and removes its temporary folders. */
  dispose(): Promise<void>;
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

/** Absolute path of a file in tests/fixtures. */
export function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

/** Uploads a file the way the front end does: the raw file as the request body, its name in the query. */
export function uploadBook(server: RunningServer, filename: string, body: BodyInit): Promise<Response> {
  return fetch(`${server.url}/api/books?name=${encodeURIComponent(filename)}`, { method: "POST", body });
}

/** Uploads a fixture under its own name. */
export async function uploadFixture(server: RunningServer, name: string): Promise<Response> {
  return uploadBook(server, name, await openAsBlob(fixturePath(name)));
}

/** Starts the real server on a free port against fresh temporary folders. */
export async function startTestServer(options: ServerOptions = {}): Promise<TestServer> {
  const root = await mkdtemp(join(tmpdir(), "reader-test-"));
  const dataDir = join(root, "data");
  const libraryDir = join(root, "library");
  // Translation is off unless the test asks for it, whatever READER_TRANSLATE_* says in the developer's shell.
  const server = await startServer({ dataDir, libraryDir, port: 0, ...options, translate: { url: undefined, ...options.translate } });
  return {
    ...server,
    dataDir,
    libraryDir,
    async dispose() {
      await server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Watched-folder timings for tests, so they need not wait for the production ones (1 s to settle, 60 s between rescans). */
export const fastLibraryFolder = { librarySettleMs: 150, libraryRescanMs: 300 };

/**
 * Retries `assertion` until it holds, for something the watched folder does in the background. The longest the folder
 * needs, when the operating system's change event is missed, is one rescan plus two settle periods (about 0.6 s with
 * `fastLibraryFolder`); the deadline is eight times that, so a busy PC (other test files, other programs) still
 * passes, and a folder that really does nothing still fails within the test timeout.
 */
export function eventually<T>(assertion: () => T | Promise<T>): Promise<T> {
  const worstCase = fastLibraryFolder.libraryRescanMs + 2 * fastLibraryFolder.librarySettleMs;
  return vi.waitFor(assertion, { timeout: 8 * worstCase, interval: 50 });
}

/** One line of the translate stream as the browser sees it. */
export type StreamedEvent = { delta: string } | { done: true } | { error: { code: string; message: string } };

/** POSTs a paragraph to the translate endpoint and reads the whole newline-delimited JSON answer. */
export async function translate(
  server: RunningServer,
  body: { text: string; context?: string },
  init: { signal?: AbortSignal } = {},
): Promise<{ status: number; events: StreamedEvent[]; text: string }> {
  const response = await fetch(`${server.url}/api/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: init.signal,
  });
  const raw = await response.text();
  if (!response.ok) return { status: response.status, events: [], text: raw };
  const events = raw
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as StreamedEvent);
  const text = events.map((event) => ("delta" in event ? event.delta : "")).join("");
  return { status: response.status, events, text };
}
