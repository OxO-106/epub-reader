import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer, type ServerOptions } from "../../src/server/server.ts";

export interface TestServer extends RunningServer {
  dataDir: string;
  libraryDir: string;
  /** Stops the server and removes its temporary folders. */
  dispose(): Promise<void>;
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
