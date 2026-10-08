# 12: Chinese reading polish

**What to build:** Chinese and mixed Chinese and English Books read well across all three formats: suitable CJK font stacks, and line-breaking that follows Chinese rules so punctuation does not start a line. End-to-end checks cover a Chinese EPUB, a Chinese Markdown file and a GBK text file. Vertical text stays out of scope.

**Blocked by:** 05 Display settings, 08 Read Markdown, 09 Read plain text, including GBK

**Status:** ready-for-agent

- [ ] Chinese text uses CJK-capable fonts in every theme and with the font-family setting
- [ ] Punctuation does not begin a line in paginated and scrolling modes
- [ ] Mixed Chinese and English paragraphs display correctly
- [ ] Playwright journeys open a Chinese EPUB, Markdown file and GBK text file and check readable text
