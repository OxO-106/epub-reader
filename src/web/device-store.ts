/**
 * Books kept on this device (issue #31), for reading when the PC cannot be reached: each with its summary, its file and
 * its cover, in the browser's IndexedDB. Nothing here talks to the Reader; the Library, the Reader screen and Settings
 * use it. Every change is announced with the `reader:kept` event on `window`, so open screens update.
 *
 * An installed web app's storage is kept by the browser (an iPhone's Home Screen app is not subject to Safari's
 * seven-day clearing), but it is finite: a Book that does not fit is reported with `DeviceFullError`.
 */
import { coverUrl, getBookFile, type BookSummary } from "./api.ts";
import { apiFetch } from "./connection.ts";

export const keptEvent = "reader:kept";

/** A Book on this device. */
export interface KeptBook {
  id: string;
  summary: BookSummary;
  file: Blob;
  cover: Blob | null;
  /** Bytes the file and cover take. */
  size: number;
  keptAt: number;
}

/** The device has no room left for a Book. */
export class DeviceFullError extends Error {
  constructor() {
    super("There is not enough space on this device to keep this Book.");
  }
}

const dbName = "reader-device";
let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("books", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

/** Runs one request in a transaction on the books store, resolving with its result once the transaction is done. */
async function run<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction("books", mode);
    const request = make(transaction.objectStore("books"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () => {
      const error = transaction.error ?? request.error;
      reject(error?.name === "QuotaExceededError" ? new DeviceFullError() : error);
    };
  });
}

const announce = () => dispatchEvent(new Event(keptEvent));

/** Every Book kept on this device, most recently kept first. */
export async function keptBooks(): Promise<KeptBook[]> {
  try {
    const all = await run("readonly", (store) => store.getAll() as IDBRequest<KeptBook[]>);
    return all.sort((a, b) => b.keptAt - a.keptAt);
  } catch {
    return []; // no IndexedDB (a private window, an old browser): nothing is kept
  }
}

export async function keptBook(id: string): Promise<KeptBook | undefined> {
  try {
    return await run("readonly", (store) => store.get(id) as IDBRequest<KeptBook | undefined>);
  } catch {
    return undefined;
  }
}

/** Downloads a Book (file and cover) and keeps it on this device. Rejects with DeviceFullError when it does not fit. */
export async function keepBook(summary: BookSummary): Promise<void> {
  const file = await getBookFile(summary.id);
  let cover: Blob | null = null;
  if (summary.hasCover) {
    const response = await apiFetch(coverUrl(summary)).catch(() => null);
    if (response?.ok) cover = await response.blob();
  }
  const kept: KeptBook = { id: summary.id, summary, file, cover, size: file.size + (cover?.size ?? 0), keptAt: Date.now() };
  await run("readwrite", (store) => store.put(kept));
  announce();
}

/** Updates the summary of a kept Book (its progress, its highlights) without downloading it again. */
export async function refreshKeptSummary(summary: BookSummary): Promise<void> {
  const kept = await keptBook(summary.id);
  if (!kept) return;
  await run("readwrite", (store) => store.put({ ...kept, summary })).catch(() => {});
}

export async function forgetBook(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id)).catch(() => {});
  announce();
}

export async function forgetAllBooks(): Promise<void> {
  await run("readwrite", (store) => store.clear()).catch(() => {});
  announce();
}

/** How much this site may store and how much it does, when the browser says. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.quota ? { usage: estimate.usage ?? 0, quota: estimate.quota } : null;
  } catch {
    return null;
  }
}

/** "3.4 MB": a size for people. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// ---- keeping the Book being read --------------------------------------------------------------------------------

const autoKeepKey = "reader.keepOpenBook";

/** Whether the Book being read is kept on this device by itself (a setting of this device). */
export function loadAutoKeep(): boolean {
  try {
    return localStorage.getItem(autoKeepKey) === "true";
  } catch {
    return false;
  }
}

export function saveAutoKeep(on: boolean): void {
  try {
    localStorage.setItem(autoKeepKey, String(on));
  } catch {
    // storage refused: the setting lasts for this visit only
  }
  announce();
}
