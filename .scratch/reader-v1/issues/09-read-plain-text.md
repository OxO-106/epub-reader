# 09: Read plain text, including GBK

**What to build:** I can import a .txt file and read it as a Book. UTF-8 (with or without a byte-order mark) and GBK are detected and decoded correctly, so older Chinese ebooks do not show as garbage. A long file is split into sections so it has a usable table of contents. Position, search, themes and display settings work as for any Book.

**Blocked by:** 03 Read an EPUB, 08 Read Markdown (reuses its Markdown/TXT book adapter)

**Status:** ready-for-agent

- [ ] A UTF-8 file, a UTF-8 file with a byte-order mark and a GBK file all display correctly
- [ ] The decoded text is stored as UTF-8
- [ ] A long file gets a table of contents of sections
- [ ] Title falls back to the filename
- [ ] Reading position restores exactly
- [ ] API tests cover each encoding; Playwright confirms a GBK file shows readable Chinese in the Reader
