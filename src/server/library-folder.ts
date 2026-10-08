import { createReadStream, watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { ImportInput, ImportResult, RejectionCode } from "./import.ts";

/** A file in the library folder that could not be turned into a Book. */
export interface LibraryFolderFailure {
  /** Where the file is, relative to the library folder, with `/` separators. */
  path: string;
  fileName: string;
  /** The import rejection, or `unreadable` when the file could not be read from disk. */
  code: RejectionCode | "unreadable";
  message: string;
  /** When the failure was recorded, in milliseconds since the epoch. */
  at: number;
}

export interface LibraryFolder {
  /** Files that failed to import and have not changed or disappeared since. */
  failures(): LibraryFolderFailure[];
  /** Stops watching and waits for an import in progress to finish. */
  close(): Promise<void>;
}

export interface LibraryFolderOptions {
  /** The folder to watch, including its subfolders. */
  dir: string;
  /** The shared import step, the same one uploads use. */
  importBook(input: ImportInput): Promise<ImportResult>;
  /** A file is imported once its size and modification time have stayed the same for this long. */
  settleMs: number;
  /** How often the whole folder is rescanned, as a safety net for events the operating system dropped. */
  rescanMs: number;
}

/** Names that are never Books: dotfiles, Office lock files, shell metadata and unfinished downloads. */
const ignoredNames = new Set(["desktop.ini", "thumbs.db"]);
const partialExtensions = new Set([".crdownload", ".part", ".partial", ".download", ".tmp"]);

function isIgnored(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((s) => s.startsWith(".") || s.startsWith("~$"))) return true;
  const name = segments[segments.length - 1]!.toLowerCase();
  return ignoredNames.has(name) || partialExtensions.has(extname(name));
}

/**
 * Imports every file in the library folder, now and whenever one is added or changed, through the
 * same import step as uploads. Files are only ever read: never modified, moved or deleted.
 *
 * Operating-system change events say that something happened, not that a copy has finished, so an
 * event (or a scan) only nominates a file. A nominated file is imported once its size and
 * modification time are unchanged for a whole `settleMs`, so a half-copied file is never imported.
 * A failed file is not retried until it changes; it is listed in `failures()` until it does, or
 * disappears.
 */
export function watchLibraryFolder(options: LibraryFolderOptions): LibraryFolder {
  const { dir, settleMs } = options;
  /** The version (size and modification time) of each file whose import has finished. */
  const done = new Map<string, string>();
  /** Files waiting to settle, with the version seen at the previous check (null: not checked yet). */
  const pending = new Map<string, string | null>();
  const failed = new Map<string, LibraryFolderFailure>();
  const ready: Array<{ path: string; version: string }> = [];
  let importing: Promise<void> | null = null;
  let watcher: FSWatcher | null = null;
  let checkTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const fullPath = (path: string) => join(dir, ...path.split("/"));
  /** The key for a path that is relative to the folder (as watch events give them) or absolute. */
  const toKey = (native: string) => relative(dir, resolve(dir, native)).split(sep).join("/");
  const versionOf = (s: { size: number; mtimeMs: number }) => `${s.size}:${s.mtimeMs}`;

  function nominate(path: string) {
    if (closed || isIgnored(path)) return;
    if (!pending.has(path)) pending.set(path, null);
    scheduleCheck();
  }

  function scheduleCheck() {
    if (closed || checkTimer || pending.size === 0) return;
    checkTimer = setTimeout(() => {
      checkTimer = null;
      void checkPending();
    }, settleMs);
    checkTimer.unref();
  }

  async function checkPending() {
    for (const [path, previous] of [...pending]) {
      let info;
      try {
        info = await stat(fullPath(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") forget(path);
        continue; // anything else (a lock, say) is looked at again next time
      }
      if (closed) return;
      if (info.isDirectory()) {
        pending.delete(path);
        void scan(); // a folder arrived; look inside it
        continue;
      }
      const version = versionOf(info);
      if (version === done.get(path)) pending.delete(path);
      else if (version === previous) {
        pending.delete(path);
        ready.push({ path, version });
        importing ??= importReady();
      } else pending.set(path, version);
    }
    scheduleCheck();
  }

  function forget(path: string) {
    pending.delete(path);
    done.delete(path);
    failed.delete(path);
  }

  /** Imports settled files one at a time. */
  async function importReady() {
    try {
      await importAll();
    } finally {
      importing = null;
    }
  }

  async function importAll() {
    for (let next = ready.shift(); next && !closed; next = ready.shift()) {
      const { path, version } = next;
      const fileName = basename(path);
      try {
        const result = await options.importBook({ filename: fileName, content: createReadStream(fullPath(path)) });
        if (result.status === "rejected") {
          failed.set(path, { path, fileName, code: result.code, message: result.message, at: Date.now() });
        } else failed.delete(path);
        done.set(path, version);
      } catch (error) {
        // Not marked done, so the next rescan tries again (the file may just have been locked).
        const reason = error instanceof Error ? error.message : String(error);
        failed.set(path, {
          path,
          fileName,
          code: "unreadable",
          message: `"${fileName}" could not be read from the library folder (${reason}).`,
          at: Date.now(),
        });
      }
    }
  }

  /** Nominates every file whose version differs from the one last imported, and forgets vanished files. */
  async function scan() {
    startWatching();
    let entries;
    try {
      entries = await readdir(dir, { recursive: true, withFileTypes: true });
    } catch {
      return; // the folder is missing for now; try again at the next rescan
    }
    const present = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = toKey(join(entry.parentPath, entry.name));
      present.add(path);
      if (isIgnored(path)) continue;
      try {
        if (versionOf(await stat(fullPath(path))) !== done.get(path)) nominate(path);
      } catch {
        // gone again already; the next scan settles it
      }
    }
    for (const path of [...done.keys(), ...failed.keys(), ...pending.keys()]) {
      if (!present.has(path)) forget(path);
    }
  }

  function startWatching() {
    if (watcher || closed) return;
    try {
      watcher = watch(dir, { recursive: true, persistent: false }, (_event, name) => {
        if (name) nominate(toKey(name.toString()));
      });
      // If the folder is removed or the watch breaks, carry on with rescans and re-arm on the next one.
      watcher.on("error", () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  }

  void scan();
  const rescanTimer = setInterval(() => void scan(), options.rescanMs);
  rescanTimer.unref();

  return {
    failures: () => [...failed.values()].sort((a, b) => a.at - b.at),
    async close() {
      closed = true;
      clearInterval(rescanTimer);
      if (checkTimer) clearTimeout(checkTimer);
      watcher?.close();
      watcher = null;
      await importing;
    },
  };
}
