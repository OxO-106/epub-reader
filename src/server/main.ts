// Entry point: `npm start`. Configuration comes from READER_* environment variables
// (see resolveConfig in config.ts).
import { startServer } from "./server.ts";

const server = await startServer();
console.log(`Reader is running at ${server.url}`);
console.log(`  data folder:    ${server.config.dataDir}`);
console.log(`  library folder: ${server.config.libraryDir}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close().finally(() => process.exit(0));
  });
}
