import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers.ts";

// `npm run fonts:build` run for real, on the tiny generated stand-in instead of the 35 MB font that is not in the
// repository. It needs Python with fonttools and brotli, which is a documented developer prerequisite and not
// something every machine has, so these tests are skipped where that is missing.

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/build-fonts.py");
const standIn = join(root, "scripts/fixture-assets/standin-cjk.woff2");

const python = ["python", "python3"].find(
  (command) => spawnSync(command, ["-c", "import fontTools, brotli"], { stdio: "ignore" }).status === 0,
);

const run = (args: string[]) =>
  spawnSync(python!, [script, ...args], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reader-fonts-build-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Name and content hash of every file in a folder. */
async function fingerprint(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    result[name] = createHash("sha256").update(await readFile(join(dir, name))).digest("hex");
  }
  return result;
}

describe.skipIf(!python)("npm run fonts:build", () => {
  it("cuts a font into pieces with unicode-range, a style sheet and a manifest that the server then serves", async () => {
    const out = await tempDir();
    const result = run([standIn, "--out", out]);
    expect(result.status, result.stderr).toBe(0);

    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    expect(manifest.family).toBe("KingHwa Web");
    expect(manifest.css).toBe("kinghwa-oldsong.css");
    expect(manifest.pieces).toHaveLength(1);
    expect(manifest.pieces[0].characters).toBe(3);

    const css = await readFile(join(out, "kinghwa-oldsong.css"), "utf8");
    expect(css).toContain('font-family:"KingHwa Web"');
    expect(css).toContain(`src:url("${manifest.pieces[0].file}") format("woff2")`);
    expect(css).toContain("unicode-range:U+4E2D,U+6587,U+6C49"); // 中, 文, 汉
    expect(await readFile(join(out, manifest.pieces[0].file))).toSatisfy((bytes: Buffer) => bytes.subarray(0, 4).toString() === "wOF2");

    // The server counts this folder as the Chinese font, and serves its pieces.
    const server: TestServer = await startTestServer({ fontsDir: out });
    cleanups.push(() => server.dispose());
    expect(await (await fetch(`${server.url}/api/fonts`)).json()).toEqual({
      chineseSerif: { family: "KingHwa Web", css: "/fonts/kinghwa-oldsong.css" },
    });
    const piece = await fetch(`${server.url}/fonts/${manifest.pieces[0].file}`);
    expect(piece.status).toBe(200);
    expect(piece.headers.get("cache-control")).toContain("immutable");
  });

  it("gives byte-identical output every time, and removes pieces of an earlier build that are no longer wanted", async () => {
    const first = await tempDir();
    const second = await tempDir();
    expect(run([standIn, "--out", first]).status).toBe(0);
    expect(run([standIn, "--out", second]).status).toBe(0);
    expect(await fingerprint(first)).toEqual(await fingerprint(second));

    await writeFile(join(first, "kinghwa-oldsong-099-0000000000.woff2"), "stale"); // left by an earlier build
    expect(run([standIn, "--out", first]).status).toBe(0);
    expect(await fingerprint(first)).toEqual(await fingerprint(second));
  });

  it("explains itself when the font file does not exist", async () => {
    const out = await tempDir();
    const result = run([join(out, "nothing.ttf"), "--out", out]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No such file");
  });

  it("refuses to write where git would track the files", async () => {
    // Inside this repository, in a folder .gitignore does not cover.
    const tracked = join(root, "tests/support/not-ignored-fonts-output");
    cleanups.push(() => rm(tracked, { recursive: true, force: true }));
    const result = run([standIn, "--out", tracked]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("git does not ignore it");
    expect(existsSync(join(tracked, "manifest.json"))).toBe(false);
  });
});
