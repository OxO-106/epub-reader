# 11: Manage the Library

**What to build:** I can search the Library by title and author, and delete a Book. Deletion asks for confirmation, removes the app's stored copy, its metadata and its Reading position, and never touches an original file anywhere.

**Blocked by:** 02 Import an EPUB and see it in the Library

**Status:** ready-for-agent

- [x] Search narrows the Library by title and author, including Chinese
- [x] Deleting asks for confirmation
- [x] After deletion the Book, its stored copy and its Reading position are gone (Reading positions do not exist yet: the stored copy and metadata are tested; ticket 04 must extend `db.deleteBook` in `src/server/db.ts` and add its own deletion test)
- [x] An original file in the watched folder survives deletion of its Book
- [x] API tests cover delete and the survival of originals; Playwright covers search and delete
