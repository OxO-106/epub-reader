# 08: Read Markdown

**What to build:** I can import a .md file and read it as a Book in the same Reader. Its table of contents is built from its headings. Tables, task lists and syntax-highlighted code render. Images with http(s) or inline data show; an image pointing at a missing local file shows a clear placeholder without disturbing the page. Links to external sites open in a new tab; links to headings in the same Book jump within it. Reading position, search, themes and the scroll/paginated mode all work as for an EPUB, through a small adapter that presents the Markdown to the Reader as a Book with sections that carry base CFIs.

**Blocked by:** 03 Read an EPUB

**Status:** ready-for-agent

- [ ] Importing a .md adds a Book titled from its first heading, or its filename if it has none
- [ ] Table of contents is built from headings
- [ ] Tables, task lists and highlighted code blocks render
- [ ] Missing relative image shows a placeholder; http(s) and inline images display
- [ ] External links open in a new tab; in-Book heading links jump within the Book
- [ ] Reading position restores exactly for a Markdown Book
- [ ] Duplicate Markdown imports are detected
- [ ] API test covers import; Playwright covers rendering and position restore
