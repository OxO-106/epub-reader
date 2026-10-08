import { formatProgress } from "./reading-position.ts";

/** How far through the Book the reader is, as a percentage. Nothing until the position is known. */
export function ReadingProgress({ fraction }: { fraction: number | null }) {
  if (fraction === null) return null;
  return (
    <span class="reading-progress" title="How far through this Book">
      {formatProgress(fraction)}
    </span>
  );
}
