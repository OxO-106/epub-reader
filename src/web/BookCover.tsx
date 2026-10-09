import { coverUrl, type BookSummary } from "./api.ts";
import { coverShade, documentLabel, titleSize } from "./library-model.ts";

/**
 * A Book's cover, in the Library's grid and in the Continue reading card:
 *  - its own cover picture when the file has one;
 *  - a document drawn from the title for Markdown and text Books, labelled MD or TXT;
 *  - otherwise a typographic cover: the title on a colour taken from the Book's id, with a thin bar on top.
 * The drawn covers repeat the title that the card shows next to them, so they are hidden from screen readers.
 */
export function BookCover({ book, src }: { book: BookSummary; /** The cover picture from elsewhere (a Book kept on this device). */ src?: string }) {
  if (book.hasCover) {
    return <img class="cover cover-image" src={src ?? coverUrl(book)} alt={`Cover of ${book.title}`} loading="lazy" />;
  }
  const label = documentLabel(book.format);
  if (label) {
    return (
      <div class="cover cover-document" aria-hidden="true">
        <span class="cover-kind">{label}</span>
        <div class="cover-text">
          <span class="cover-line" />
          <span class="cover-line" />
          <span class="cover-line" />
          <span class={`cover-title size-${titleSize(book.title)}`}>{book.title}</span>
        </div>
      </div>
    );
  }
  return (
    <div class={`cover cover-typographic shade-${coverShade(book.id)}`} aria-hidden="true">
      <span class="cover-bar" />
      <span class={`cover-title size-${titleSize(book.title)}`}>{book.title}</span>
    </div>
  );
}
