// The Reader server inside the desktop app (issue #33). The app shell (main.ts) starts this file in an Electron utility
// process, with its working directory set to the app's data folder, so the server's usual relative defaults (`data`,
// `library`, `fonts`) land there and the Settings screen can still change them. It is the same server as `npm start`,
// run unchanged by the Node that Electron bundles. Messages to the shell: {type: "ready", url}, {type: "failed",
// message}, {type: "restart"} (the Settings screen asked for a restart). From the shell: "stop".
import { ConfigError } from "../src/server/config.ts";
import { ListenError } from "../src/server/listen.ts";
import { startServer, type RunningServer } from "../src/server/server.ts";

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
}
const parent = (process as unknown as { parentPort: ParentPort }).parentPort;

// pdf.js decides whether it runs in Node by `process.type`, and takes Electron's "utility" for a browser page: it then
// skips the canvas it uses in Node (@napi-rs/canvas, for DOMMatrix and the PDF covers) and every PDF import fails. This
// process is plain Node, so it says so. pdf.js is loaded on the first PDF import, after this line has run.
Object.defineProperty(process, "type", { value: undefined, configurable: true });

let server: RunningServer | undefined;
try {
  server = await startServer({ restart: () => parent.postMessage({ type: "restart" }) });
  parent.postMessage({ type: "ready", url: server.url });
  console.log(`Verso is running at ${server.url} (data folder ${server.config.dataDir})`);
} catch (error) {
  // A port in use, a folder that cannot be created, a bad saved setting: the shell shows the message in a dialog.
  const known = error instanceof ListenError || error instanceof ConfigError;
  const text = (error as Error)?.message ?? String(error);
  const port = /EADDRINUSE.*:(\d+)\s*$/.exec(text)?.[1];
  const message = port
    ? `Port ${port} is already in use, perhaps by another copy of Verso started with npm start. Close it, or choose another port in Settings, then start Verso again.`
    : known
      ? text
      : `Verso could not start: ${text}`;
  console.error(message);
  parent.postMessage({ type: "failed", message });
  process.exit(1);
}

parent.on("message", ({ data }) => {
  if (data === "stop") void server!.close().finally(() => process.exit(0));
});
