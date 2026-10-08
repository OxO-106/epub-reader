import { useEffect, useRef, useState } from "preact/hooks";
import { deleteBook, type BookSummary } from "./api.ts";
import { TrashIcon } from "./library-icons.tsx";

/**
 * A Delete button for one Book that asks for confirmation in a dialog before anything is removed. The button is an icon,
 * always visible, with a 44 px target (see library.css); the dialog is the native one, so Escape and focus work as usual.
 */
export function DeleteBook({ book, onDeleted }: { book: BookSummary; onDeleted: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (asking && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [asking]);

  function close() {
    setAsking(false);
    setFailed(false);
  }

  async function confirm() {
    setBusy(true);
    const removed = await deleteBook(book);
    setBusy(false);
    if (removed) {
      close();
      onDeleted();
    } else {
      setFailed(true);
    }
  }

  return (
    <>
      <button type="button" class="delete-book" aria-label={`Delete ${book.title}`} onClick={() => setAsking(true)}>
        <TrashIcon />
      </button>
      {asking && (
        <dialog ref={dialog} class="confirm" aria-labelledby={`delete-${book.id}`} onClose={close}>
          <h2 id={`delete-${book.id}`}>Delete “{book.title}”?</h2>
          <p>
            This removes the Book and your place in it from your Library. Your original file is not touched, so you can
            add it again later.
          </p>
          {failed && (
            <p role="alert" class="error">
              The Book could not be deleted. Check that Reader is still running, then try again.
            </p>
          )}
          <div class="actions">
            <button type="button" class="cancel" onClick={() => dialog.current?.close()} autofocus>
              Cancel
            </button>
            <button type="button" class="danger" onClick={confirm} disabled={busy}>
              Delete
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
