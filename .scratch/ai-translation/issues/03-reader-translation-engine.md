# 03: Reader translation engine

**What to build:** Inside the Reader module, translation can be switched on for the open Book. For EPUB, Markdown and plain text alike it finds the reading paragraphs in the loaded Book documents, translates the ones on screen first and then about one screenful ahead in reading order through the translate API, and shows each Chinese translation right after its English paragraph without adding any elements to the document (generated content from an attribute), so the saved Reading position stays correct. It clears translations that are far above the reader without moving the text, restarts at the new place after a far jump, cancels stale work, skips decorations and paragraphs that are already Chinese, retries a failed paragraph on request, and reports status. Nothing is stored.

**Blocked by:** 02 Translation API on the server (done), 06 Keep English names English (placeholder masking)

**Status:** ready-for-agent

- [x] Blocks on screen are translated before blocks ahead; with a slow stand-in the next screen is already translated when scrolled to (Playwright, scrolling and paginated mode)
- [x] Each translation appears after its paragraph, streams in progressively, and waiting blocks show a placeholder
- [x] Reading position after reload is the same with translation on or off, and a translation never changes the CFI saved while it is showing
- [x] Translations further than one screenful above the reader are cleared with no visible movement of the text (assert on scroll stability)
- [x] A far jump (Contents or Search) cancels queued and in-flight requests (assert on the stand-in's request log) and restarts at the new place; scrolling back up translates again
- [x] The engine learns proper names from the whole loaded section (capitalised words that are not sentence-initial, minus the shared stop-list from ticket 06) and sends that list with every translate request, so names that begin a sentence are also kept in English (assert on the stand-in's request log)
- [x] Decorations, bare chapter numbers and already-Chinese paragraphs are skipped; headings are translated
- [x] A failed paragraph shows a retry action and the English keeps working; the Reader module exposes status changes; foliate-js is still imported only by the Reader module
- [x] Nothing is written to disk or the database; `npm run test:all` passes with the model stand-in
