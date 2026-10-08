import { formatFraction } from "./reading-position.ts";

/** How far through the Book the reader is, as a percentage. Nothing until the position is known. */
export function ReadingFraction({ fraction }: { fraction: number | null }) {
  if (fraction === null) return null;
  return (
    <span class="reading-fraction" title="How far through this Book">
      {formatFraction(fraction)}
    </span>
  );
}
