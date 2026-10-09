// Cuts a release: `npm run release -- <patch|minor|major|x.y.z>`.
//
// Refuses to run unless the working tree is clean and on main. Bumps the version in package.json and
// package-lock.json, moves the changelog's Unreleased section into the new version with today's date (and updates the
// comparison links at the bottom), commits "Release vX.Y.Z" and tags vX.Y.Z. It does not push: pushing the tag is
// what starts the release workflow, so it is left as a deliberate last step, printed at the end.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bumpVersion, releaseChangelog } from "./release-notes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Runs a step whose errors are messages for the person releasing, not crashes. */
function attempt<T>(step: () => T): T {
  try {
    return step();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

const npmCli = process.env.npm_execpath;
if (!npmCli) fail("Run this through npm: npm run release -- <patch|minor|major|x.y.z>");

const request = process.argv[2];
if (!request) fail("Say which version: npm run release -- <patch|minor|major|x.y.z>");
if (git("status", "--porcelain")) fail("The working tree has changes. Commit or stash them first.");
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("Releases are cut from main.");

const manifestPath = join(root, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
const version = attempt(() => bumpVersion(manifest.version, request));
if (git("tag", "--list", `v${version}`)) fail(`The tag v${version} already exists.`);

const changelogPath = join(root, "CHANGELOG.md");
const today = new Date().toISOString().slice(0, 10);
const changelog = attempt(() =>
  releaseChangelog(readFileSync(changelogPath, "utf8"), version, today, "https://github.com/OxO-106/epub-reader"),
);
writeFileSync(changelogPath, changelog);

// npm updates package.json and package-lock.json together and keeps their formatting. It is run through the npm that
// started this script (npm sets npm_execpath), so no shell is needed on Windows.
execFileSync(process.execPath, [npmCli, "version", version, "--no-git-tag-version"], { cwd: root, stdio: "inherit" });

git("add", "package.json", "package-lock.json", "CHANGELOG.md");
git("commit", "-m", `Release v${version}`);
git("tag", "-a", `v${version}`, "-m", `Release v${version}`);

console.log(`\nReleased v${version} locally. Push it to start the release workflow:\n\n    git push origin main v${version}\n`);
