// Downloading the translation model (desktop/downloads.ts): resumed after an interruption with a range request,
// verified by SHA-256 (a mismatch deletes the file), and a runtime zip unpacked without escaping its folder.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { ChecksumError, downloadFile, unzip, type Download } from "../../desktop/downloads.ts";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const content = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251));
const digest = createHash("sha256").update(content).digest("hex");

/** A file server that honours range requests and, while `cutAt` is set, hangs up after that many bytes. */
async function fileServer(options: { cutAt?: number; ignoreRange?: boolean } = {}) {
  const requests: Array<string | undefined> = [];
  const server: Server = createServer((req, res) => {
    requests.push(req.headers.range);
    const range = !options.ignoreRange && /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    const body = content.subarray(start);
    res.writeHead(range ? 206 : 200, { "content-length": String(body.length) });
    if (options.cutAt !== undefined && start === 0) {
      res.write(body.subarray(0, options.cutAt));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/model.gguf`, requests, options };
}

async function folder() {
  const dir = await mkdtemp(join(tmpdir(), "reader-download-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const download = (url: string, sha256 = digest): Download => ({ name: "model.gguf", url, size: content.length, sha256 });

describe("downloading", () => {
  it("downloads, verifies and puts the file in place, reporting progress", async () => {
    const files = await fileServer();
    const dest = join(await folder(), "model.gguf");
    const seen: string[] = [];

    await downloadFile(download(files.url), dest, { onProgress: (p) => seen.push(p.phase) });

    expect(await readFile(dest)).toEqual(content);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(seen.at(-1)).toBe("verifying");
  });

  it("carries on from where an interrupted download stopped", async () => {
    const files = await fileServer({ cutAt: 50_000 });
    const dest = join(await folder(), "model.gguf");

    await expect(downloadFile(download(files.url), dest)).rejects.toThrow();
    const kept = (await stat(`${dest}.part`)).size;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(content.length);

    files.options.cutAt = undefined;
    await downloadFile(download(files.url), dest);

    expect(files.requests.at(-1)).toBe(`bytes=${kept}-`);
    expect(await readFile(dest)).toEqual(content);
  });

  it("starts again from nothing when the server ignores the range", async () => {
    const files = await fileServer({ ignoreRange: true });
    const dir = await folder();
    const dest = join(dir, "model.gguf");
    await writeFile(`${dest}.part`, content.subarray(0, 1000));

    await downloadFile(download(files.url), dest);

    expect(await readFile(dest)).toEqual(content);
  });

  it("deletes a file that does not match its published digest, and says so", async () => {
    const files = await fileServer();
    const dest = join(await folder(), "model.gguf");

    await expect(downloadFile(download(files.url, "0".repeat(64)), dest)).rejects.toBeInstanceOf(ChecksumError);

    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("stops when asked, keeping what it has for later", async () => {
    const files = await fileServer({ cutAt: 50_000 });
    const dest = join(await folder(), "model.gguf");
    const abort = new AbortController();

    await expect(downloadFile(download(files.url), dest, { signal: abort.signal, onProgress: (p) => p.received > 10_000 && abort.abort() })).rejects.toThrow();

    expect(existsSync(`${dest}.part`)).toBe(true);
  });
});

describe("unpacking the runtime", () => {
  it("unpacks a zip into the folder", async () => {
    const dir = await folder();
    await writeFile(join(dir, "r.zip"), zipSync({ "llama-server.exe": new Uint8Array([1, 2, 3]), "lib/ggml.dll": new Uint8Array([4]) }));

    await unzip(join(dir, "r.zip"), join(dir, "llama-vulkan"));

    expect(await readFile(join(dir, "llama-vulkan", "llama-server.exe"))).toEqual(Buffer.from([1, 2, 3]));
    expect(existsSync(join(dir, "llama-vulkan", "lib", "ggml.dll"))).toBe(true);
  });

  it("refuses an entry that would land outside the folder", async () => {
    const dir = await folder();
    await writeFile(join(dir, "evil.zip"), zipSync({ "../escaped.txt": new Uint8Array([1]) }));

    // yauzl refuses such a path itself; unzip checks again in case another zip reader is ever used.
    await expect(unzip(join(dir, "evil.zip"), join(dir, "out"))).rejects.toThrow(/outside|invalid relative path/);
    expect(existsSync(join(dir, "escaped.txt"))).toBe(false);
  });
});
