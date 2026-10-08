/** The tail of the queue of operations waiting on each Book (by content hash). Entries are removed when the queue empties. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Runs `task` once every earlier task for the same Book has finished, so that at most one task per Book runs at a
 * time. Importing and deleting a Book both go through here: the same content arriving twice at once (two uploads, or
 * an upload and the watched folder) must not move files into the same stored path concurrently, and a deletion must
 * not interleave with an import of the same content. Different Books never wait for each other.
 *
 * One process owns the data folder, so an in-process queue is enough.
 */
export async function withBookLock<T>(hash: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(hash) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => {});
  queues.set(hash, tail);
  try {
    return await run;
  } finally {
    if (queues.get(hash) === tail) queues.delete(hash);
  }
}
