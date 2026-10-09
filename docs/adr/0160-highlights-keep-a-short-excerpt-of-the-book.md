# Highlights keep a short excerpt of the Book's text

Until now the database held nothing of a Book's text: its metadata, a cover and a Reading position (a CFI, which is an address, not words). A highlight is an address too (a CFI range), and that would be enough to draw it on the page. But the Highlights panel lists every highlight of a Book, the export writes them out as Markdown, and both must work without opening and laying out the Book (a PDF of 800 pages, a Book on a phone that has not downloaded it), and must still show something when a highlight's place can no longer be found.

So each highlight stores an excerpt: the highlighted text as the reader selected it, whitespace collapsed, cut to 1,000 characters (with an ellipsis) by the client before it is sent; the server refuses anything longer. It lives only in the SQLite file in the data folder, next to the Book file itself, which already holds all of the text; it is deleted with the highlight and with the Book (`db.deleteBook`), and it never leaves the server except to Reader's own pages. Nothing is logged.

The cost: a few kilobytes per Book that is highlighted heavily, and a copy that can drift from the Book if the same Book is somehow imported changed (it cannot, in practice: a changed file is a different Book, because a Book's id is its content hash).
