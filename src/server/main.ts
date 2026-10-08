// Entry point: `npm start`. Configuration comes from READER_* environment variables
// (see resolveConfig in config.ts and the README).
import { ListenError } from "./listen.ts";
import { startServer } from "./server.ts";

const server = await startServer().catch((error: unknown) => {
  // A setup problem (no Tailscale address, port in use) gets its message alone, not a stack trace.
  if (error instanceof ListenError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
});
const urlOn = (address: string) => `http://${address.includes(":") ? `[${address}]` : address}:${server.config.port}`;
console.log(`Reader is running at ${server.addresses.map(urlOn).join(" and ")}`);
console.log(`  data folder:    ${server.config.dataDir}`);
console.log(`  library folder: ${server.config.libraryDir}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close().finally(() => process.exit(0));
  });
}
