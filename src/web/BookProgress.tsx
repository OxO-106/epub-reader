import { progressOf } from "./library-model.ts";

/** A thin bar and its words under a Book: "New" until it is opened, the percentage while it is read, "Done" at the end. */
export function BookProgress({ fraction, large = false }: { fraction: number | null; large?: boolean }) {
  const progress = progressOf(fraction);
  const filled = progress.kind === "done" ? 100 : progress.kind === "reading" ? progress.percent : 0;
  return (
    <div class={`progress-row${large ? " large" : ""}`}>
      <div class="progress-bar" aria-hidden="true">
        <div class="progress-fill" style={{ width: `${filled}%` }} />
      </div>
      <span class={`progress-label ${progress.kind}`}>
        {progress.kind === "new" ? "New" : progress.kind === "done" ? "Done" : progress.label}
      </span>
    </div>
  );
}
