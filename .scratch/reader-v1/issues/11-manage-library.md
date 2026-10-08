# 11: Manage the Library

**What to build:** I can search the Library by title and author, and delete a Book. Deletion asks for confirmation, removes the app's stored copy, its metadata and its Reading position, and never touches an original file anywhere.

**Blocked by:** 02 Import an EPUB and see it in the Library

**Status:** ready-for-agent

- [ ] Search narrows the Library by title and author, including Chinese
- [ ] Deleting asks for confirmation
- [ ] After deletion the Book, its stored copy and its Reading position are gone
- [ ] An original file in the watched folder survives deletion of its Book
- [ ] API tests cover delete and the survival of originals; Playwright covers search and delete
