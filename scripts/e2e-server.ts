// Starts the real server against throwaway data and library folders for the Playwright tests.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server/server.ts";

const root = await mkdtemp(join(tmpdir(), "reader-e2e-"));
const server = await startServer({
  dataDir: join(root, "data"),
  libraryDir: join(root, "library"),
  port: Number(process.env.READER_E2E_PORT ?? 5199),
});
console.log(`e2e server on ${server.url} (${root})`);

async function shutdown() {
  await server.close().catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
