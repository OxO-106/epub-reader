import { useState } from "preact/hooks";
import type { BookSummary } from "./api.ts";
import { DeviceFullError, forgetBook, keepBook } from "./device-store.ts";
import { KeepIcon, KeptIcon } from "./library-icons.tsx";

/**
 * "Keep on this device" for one Book in the Library: a toggle (`aria-pressed`) that downloads the Book into this
 * device's storage for reading offline, or removes it from there. Keeping takes a moment for a large Book; the button
 * says so, and a Book that does not fit is reported.
 */
export function KeepBook({ book, kept, disabled, onProblem }: { book: BookSummary; kept: boolean; disabled?: boolean; onProblem(message: string | null): void }) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    onProblem(null);
    setBusy(true);
    try {
      if (kept) await forgetBook(book.id);
      else await keepBook(book);
    } catch (error) {
      onProblem(error instanceof DeviceFullError ? error.message : `“${book.title}” could not be kept on this device. Check that Verso is running.`);
    } finally {
      setBusy(false);
    }
  }

  const label = busy ? `Keeping ${book.title} on this device…` : `Keep ${book.title} on this device`;
  return (
    <button
      type="button"
      class="keep-book"
      aria-label={label}
      title={kept ? "Kept on this device" : "Keep on this device"}
      aria-pressed={kept}
      aria-busy={busy}
      disabled={disabled || busy}
      onClick={toggle}
    >
      {kept ? <KeptIcon /> : <KeepIcon />}
    </button>
  );
}
