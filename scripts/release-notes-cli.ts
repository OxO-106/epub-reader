// Used by the release workflow: `node scripts/release-notes-cli.ts <version>` prints that version's changelog section,
// and fails (so the release stops) when the changelog has none or when package.json names a different version.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { notesFor } from "./release-notes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = (process.argv[2] ?? "").replace(/^v/, "");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

if (manifest.version !== version) {
  console.error(`The tag says ${version} but package.json says ${manifest.version}. Use npm run release to cut a release.`);
  process.exit(1);
}
process.stdout.write(`${notesFor(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version)}\n`);
