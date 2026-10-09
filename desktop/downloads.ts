// Downloading the translation model and its runtime in the desktop app (issue #35): resumable (an interrupted or
// paused download carries on from where it stopped, with an HTTP range request), verified (SHA-256 against the
// published digest before the file is used; a mismatch deletes it and says so), and unpacked (the runtime zip, safely:
// no entry may land outside its folder). The network is passed in as `fetch`, so tests use a local fake server.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

/** A file to download: where from, its size and its SHA-256 as published. */
export interface Download {
  name: string;
  url: string;
  size: number;
  sha256: string;
}

/** The two files of the translation set-up (docs/translation-setup.md), for Windows. */
export const translationDownloads: { runtime: Download; model: Download } = {
  runtime: {
    name: "llama-b11510-bin-win-vulkan-x64.zip",
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b11510/llama-b11510-bin-win-vulkan-x64.zip",
    size: 33_446_147,
    sha256: "1137d7ffa61103f651d9d0e3e8f43b97d4df1c2fa44f768bf8275701b4d38891",
  },
  model: {
    name: "Hy-MT2-7B-Q4_K_M.gguf",
    url: "https://huggingface.co/tencent/Hy-MT2-7B-GGUF/resolve/main/Hy-MT2-7B-Q4_K_M.gguf",
    size: 4_624_648_896,
    sha256: "9f96256500f3fc1ab4d64336b58f52a949a95ad7516b0c229476eef782f9f77b",
  },
};

/** The file arrived but is not the published one. */
export class ChecksumError extends Error {
  constructor(name: string) {
    super(`${name} did not match its published SHA-256, so it was deleted. Try the download again.`);
  }
}

export interface Progress {
  name: string;
  received: number;
  total: number;
  /** "verifying" while the SHA-256 is computed, after the last byte. */
  phase: "downloading" | "verifying";
}

/** SHA-256 of a file, streamed (a model file is gigabytes). */
export async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * Downloads `download` to `dest`, by way of `dest.part`: a part already there is continued with a range request (a
 * server that ignores the range sends the whole file, which then starts again from nothing). Aborting `signal` stops
 * it, keeping the part for next time. Resolves once the file is in place and verified; rejects with ChecksumError (the
 * part deleted) when it does not match.
 */
export async function downloadFile(
  download: Download,
  dest: string,
  options: { signal?: AbortSignal; onProgress?: (progress: Progress) => void; fetch?: typeof fetch } = {},
): Promise<void> {
  const { signal, onProgress, fetch: get = fetch } = options;
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let have = existsSync(part) ? statSync(part).size : 0;
  if (have > download.size) {
    rmSync(part);
    have = 0;
  }
  if (have < download.size) {
    const response = await get(download.url, { headers: have ? { range: `bytes=${have}-` } : {}, signal, redirect: "follow" });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`The download of ${download.name} failed: the server answered ${response.status}.`);
    } else {
      const resumed = response.status === 206;
      if (!resumed) have = 0; // the whole file is coming
      let received = have;
      const out = createWriteStream(part, { flags: resumed ? "a" : "w" });
      const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      body.on("data", (chunk: Buffer) => {
        received += chunk.length;
        onProgress?.({ name: download.name, received, total: download.size, phase: "downloading" });
      });
      await pipeline(body, out, { signal });
      have = received;
    }
  }
  if (statSync(part).size !== download.size) {
    throw new Error(`The download of ${download.name} stopped before the end. Resume it to carry on.`);
  }
  onProgress?.({ name: download.name, received: download.size, total: download.size, phase: "verifying" });
  if ((await sha256Of(part)) !== download.sha256.toLowerCase()) {
    rmSync(part, { force: true });
    throw new ChecksumError(download.name);
  }
  renameSync(part, dest);
}

/** Unpacks a zip into `folder`. An entry whose path would land outside the folder stops it. */
export function unzip(zip: string, folder: string): Promise<void> {
  const root = normalize(folder);
  return new Promise((resolve, reject) => {
    yauzl.open(zip, { lazyEntries: true }, (error, archive) => {
      if (error || !archive) return reject(error ?? new Error("The zip could not be opened."));
      archive.on("error", reject);
      archive.on("end", () => resolve());
      archive.on("entry", (entry: yauzl.Entry) => {
        const target = normalize(join(root, entry.fileName));
        if (target !== root && !target.startsWith(root + sep)) {
          archive.close();
          return reject(new Error(`The zip holds a file outside its folder (${entry.fileName}).`));
        }
        if (/\/$/.test(entry.fileName)) {
          mkdirSync(target, { recursive: true });
          return archive.readEntry();
        }
        mkdirSync(dirname(target), { recursive: true });
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error("A file in the zip could not be read."));
          pipeline(stream, createWriteStream(target)).then(() => archive.readEntry(), reject);
        });
      });
      archive.readEntry();
    });
  });
}
