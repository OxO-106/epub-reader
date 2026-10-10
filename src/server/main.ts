// Entry point: `npm start`. Configuration comes from READER_* environment variables
// (see resolveConfig in config.ts and docs/running-reader.md).
import { ConfigError } from "./config.ts";
import { ListenError } from "./listen.ts";
import { startServer } from "./server.ts";

const server = await startServer().catch((error: unknown) => {
  // A setup problem (no Tailscale address, port in use, an unusable READER_TRANSLATE_* value) gets its message alone, not a stack trace.
  if (error instanceof ListenError || error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
});
const urlOn = (address: string) => `http://${address.includes(":") ? `[${address}]` : address}:${server.config.port}`;
console.log(`Verso is running at ${server.addresses.map(urlOn).join(" and ")}`);
console.log(`  data folder:    ${server.config.dataDir}`);
console.log(`  library folder: ${server.config.libraryDir}`);
console.log(`  translation:    ${server.config.translate.url ?? "not set up (READER_TRANSLATE_URL)"}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close().finally(() => process.exit(0));
  });
}
