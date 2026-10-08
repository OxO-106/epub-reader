# 02: Import an EPUB and see it in the Library

**What to build:** I can drag an EPUB onto the page, or pick files with a file picker (several at once), and each appears in the Library as a Book with its title, author and cover when available. Importing the same file twice is detected by content hash and ignored. Unsupported types, corrupt EPUBs and files over 200 MB are rejected with a clear message. The Library survives a server restart. The server streams Book files and never buffers a whole file in memory.

**Blocked by:** 01 Walking skeleton

**Status:** ready-for-agent

- [ ] Uploading an EPUB adds one Book with correct title and author (CJK metadata included)
- [ ] Cover is shown when the EPUB has one
- [ ] Importing the same EPUB twice results in one Book
- [ ] Unsupported file type, corrupt EPUB and a file over 200 MB each produce a clear message and add nothing
- [ ] Multi-file upload works
- [ ] The Library and its Books are intact after restarting the server
- [ ] API tests cover these through the HTTP seam; one Playwright journey covers drag-and-drop to Library
