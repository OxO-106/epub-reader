// `npm run dev`: the API server (restarts on change) plus the Vite dev server (hot reload).
// Open http://localhost:5173; Vite proxies /api to the server on 5174.
import { spawn } from "node:child_process";

const commands = [
  ["node", "--watch", "src/server/main.ts"],
  ["node", "node_modules/vite/bin/vite.js"],
] as const;

const children = commands.map(([cmd, ...args]) => spawn(cmd, args, { stdio: "inherit" }));
let stopping = false;

function stop(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}

for (const child of children) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
