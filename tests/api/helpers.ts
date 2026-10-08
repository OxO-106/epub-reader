import { openAsBlob } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  const server = await startServer({ dataDir, libraryDir, port: 0, ...options });
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
