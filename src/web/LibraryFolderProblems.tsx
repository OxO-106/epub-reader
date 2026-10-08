import { useEffect, useState } from "preact/hooks";
import { listLibraryFolderFailures, type LibraryFolderFailure } from "./api.ts";

/** Lists files in the watched library folder that could not be added, so they are not silently missing. */
export function LibraryFolderProblems() {
  const [failures, setFailures] = useState<LibraryFolderFailure[]>([]);

  useEffect(() => {
    const load = () => listLibraryFolderFailures().then(setFailures, () => {});
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  if (failures.length === 0) return null;
  return (
    <section class="folder-problems">
      <h2>These files in your library folder were not added</h2>
      <ul class="outcomes" aria-label="Library folder problems">
        {failures.map((failure) => (
          <li key={failure.path} class="failed">
            {failure.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
