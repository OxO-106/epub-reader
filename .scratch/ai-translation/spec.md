Status: ready-for-agent

# Live English-to-Chinese translation

## Problem Statement

I read English books but I am more comfortable reading Chinese. I want to read an English Book with a Chinese translation right under each English paragraph, produced on the fly by a model running on my own machines, with nothing stored and nothing sent to a cloud service. It must keep up with my reading: by the time I scroll to the next screen its translation should already be there.

## Solution

An optional **Translate** mode in the Reader for English Books. When it is on, each English paragraph is followed by its Chinese translation, set in a softer style, in the same page. The Reader translates the paragraphs on screen first and then roughly one screenful ahead, in reading order, so the next screen is ready when I get there. Translations live only in memory: paragraphs well above the current position are cleared, scrolling back re-translates them, and nothing is written to disk or to the database. The model runs on this laptop first, through a local model server; if the laptop is too slow, the same app points at a model server on a PC with a GPU over Tailscale by changing one setting.

## User Stories

1. As a reader, I want a Translate button in the Reader that appears only for English Books, so that it is there when it is useful and absent when it is not.
2. As a reader, I want the Translate setting remembered on this device, so that it stays on across Books until I turn it off.
3. As a reader, I want each English paragraph followed by its Chinese translation, so that I can compare them one by one.
4. As a reader, I want the Chinese styled as a quieter gloss in 京华老宋体, so that the English stays the main text.
5. As a reader, I want the paragraphs on screen translated first, so that what I am reading is covered before anything else.
6. As a reader, I want the next screenful translated ahead of me, so that it is ready when I scroll to it.
7. As a reader, I want translation to work in scrolling mode, which I prefer, and in paginated mode.
8. As a reader, I want a translation to appear progressively as the model produces it, so that I can start reading before it finishes.
9. As a reader, I want a calm placeholder for paragraphs that are waiting, so that I can see what is coming.
10. As a reader, I want a status indicator ("Translating ahead", "Ready", "Backend unreachable", "Not set up"), so that I know what the app is doing.
11. As a reader, I want a failed paragraph to show a retry action, so that one failure does not spoil the page.
12. As a reader, I want the English to keep working when the model is unreachable, so that reading never depends on translation.
13. As a reader, I want clear set-up guidance when translation is not configured, so that I know what to do.
14. As a reader, I want translations dropped once they are well above me, so that memory use stays small.
15. As a reader, I want the page not to jump when old translations are removed, so that reading is not disturbed.
16. As a reader, I want translations to be gone after I leave, with nothing on disk, so that my reading stays private and the Library stays clean.
17. As a reader, I want a jump somewhere far away (through Contents or Search) to cancel the old work and start at the new place, so that the model never wastes time on text I left.
18. As a reader, I want to scroll back up and have those paragraphs translated again, so that nothing needs to be stored.
19. As a reader, I want headings translated and decorations such as "* * *" or bare chapter numbers skipped, so that the output is useful.
20. As a reader, I want paragraphs that are already Chinese in a mixed Book left alone, so that nothing is translated twice.
21. As a reader, I want names kept in English inside the Chinese, so that I can recognise characters.
22. As a reader, I want a consistent style across paragraphs, with the previous paragraph used as context, so that the translation reads as one text.
23. As a reader, I want my Reading position to stay exact while translations are showing, so that opening the Book later puts me in the same place.
24. As a reader, I want the model run on this laptop by default, so that it works without another machine.
25. As a reader, I want to point the same app at a model server on a GPU PC over Tailscale by changing one setting, so that a faster machine can do the work.
26. As a reader, I want that to work from my phone too, so that translation follows me to the mobile view.
27. As a reader, I want the app server never to log or store Book text it sends for translation, so that my books stay private.
28. As a reader, I want a stalled or crashed model to be detected and reported, so that the Reader does not wait forever.
29. As the owner, I want a written set-up guide for the laptop and the GPU PC, so that I can reproduce the set-up.
30. As the owner, I want measured numbers for how fast this laptop translates a page, so that the choice of machine is based on facts.

## Implementation Decisions

The vocabulary in `GLOSSARY.md` applies (Book, Library, Reading position, Reader). New term to add to the glossary when the work starts: **Translation**, the Chinese rendering of one paragraph, held only in memory while it is near the Reading position.

- **Backend contract:** the app server talks to any server that speaks the OpenAI-style `chat/completions` API with streaming (llama.cpp's `llama-server`, Ollama, LM Studio, vLLM). The browser never talks to the model directly. Settings are server configuration: `READER_TRANSLATE_URL` (base URL), `READER_TRANSLATE_MODEL` (model name, optional for servers that ignore it) and an optional `READER_TRANSLATE_API_KEY`. Unset URL means translation is "not set up".
- **Server API:** a streaming translate endpoint takes one paragraph of English plus optional context (the previous English paragraph) and streams Chinese text back as it is produced, then a done marker, or an error. A status endpoint reports whether translation is configured, whether the backend is reachable and which model it reports. The endpoint limits concurrent requests to the backend (default 1, configurable) and queues the rest; a request aborted by the browser aborts the upstream request so the model stops working. Request and response text is never logged or written to disk; error logs carry no Book text.
- **Prompting:** a system prompt fixes the task: faithful literary translation into Simplified Chinese, English names kept in English without brackets, output only the translation, no commentary. The previous English paragraph is passed as context only. The prompt format and generation settings follow the chosen model's card; the benchmark ticket decides and records them.
- **Reader module:** the Reader module (the only runtime importer of foliate-js, ADR 0005) gets translation methods: turn translation on or off, report status changes, retry a paragraph. Paragraph discovery, windowing and rendering happen inside the Book documents the Reader already controls, for EPUB, Markdown and plain text alike.
- **Paragraph units:** block elements that carry reading text (paragraphs, list items, block quotes, headings). Skip blocks without at least a couple of letters, decorations, and blocks that are already mostly CJK.
- **Window and cleanup:** translate the blocks intersecting the viewport first, then the following screenful, in reading order; keep translations from one screenful above through the prefetch window; clear translations further above, correcting the scroll position by the height removed so the text under the reader does not move. A large jump cancels queued and in-flight work and restarts at the new place. Priorities favour the blocks closest to the top of the viewport.
- **Rendering without touching the document structure:** each translated block gets an attribute holding the Chinese text, shown through generated content after the block, so no elements are added and the CFI-based Reading position stays correct. The Chinese cannot be selected or searched. Streaming updates simply rewrite the attribute. A skeleton style shows waiting blocks. The style (size, colour, tint, 京华老宋体 stack) comes from the redesign tokens and travels with the display settings so it applies inside Book documents in every theme.
- **Language gating:** the Translate button shows for Books whose declared language is English, or, when none is declared, whose text is clearly English by the existing language guess.
- **Persistence:** only the on/off setting, per device, in browser storage (try/catch, works without it). No translations are persisted anywhere.
- **Section boundaries:** a Book section (chapter file) is a separate document; translation of the next section starts when the Reader loads it, so a short wait at chapter boundaries is accepted for now.
- **Model on this laptop:** `llama-server` from llama.cpp's Vulkan build on the Intel Arc 140V, with Tencent's Hy-MT2-7B (Q4_K_M, Apache-2.0), chosen from the research in `.scratch/ai-translation/research.md`; the benchmark ticket confirms or replaces this with measurements. Files live outside the repository (`C:\Users\Intel\translation-models`), nothing large enters git. The GPU PC runs the same model files with llama.cpp's CUDA build behind Tailscale.

## Testing Decisions

- Test external behaviour only, through the two seams: the app's HTTP API and headless Playwright via `tests/e2e/fixtures.ts`. A **model stand-in**, a small real HTTP server started by the tests that speaks the OpenAI-style streaming protocol and returns scripted translations, delays and errors, replaces the real model. The real model is never needed to run the suite. The app itself is never mocked.
- API tests: streaming a translation and its chunks, previous-paragraph context sent, status endpoint (not configured, unreachable, ready), concurrency limit and queueing, upstream aborted when the client disconnects, upstream errors and timeouts reported cleanly, nothing logged or written to disk (assert on the data folder and captured logs), configuration read from the environment.
- Playwright tests: the button only for English Books; Chinese under each paragraph, on-screen blocks first and then ahead, next screen already translated when scrolled; old translations cleared with no visible jump (assert scroll stability); a far jump cancels stale work (assert on the stand-in's request log); failure shows retry and the English keeps working; status pill states; mixed-language Book skips Chinese paragraphs; the Reading position is the same with Translate on or off after reload; works in paginated mode and at phone width.
- Pure logic (windowing, block filtering, queue priorities) may be tested directly through its own small interface only where tricky.
- Prior art: the existing specs under `tests/api` and `tests/e2e`, the shared fixtures, and the layout and legibility specs.

## Out of Scope

- Storing or caching translations in any form, exporting them, or searching them.
- Selecting or copying the Chinese text.
- Other language pairs, translating Chinese Books, or translating anything but English Books.
- Text-to-speech, dictionary look-ups, vocabulary lists.
- Installing or managing the model server from inside the app; it is set up by hand following the guide.
- Translating across chapter boundaries before the next section loads.
- Cloud translation services.

## Further Notes

- The research (`.scratch/ai-translation/research.md`) estimated about 30 to 35 seconds per 300-word page on this laptop from one measured third-party figure of 19.2 tokens/s on this chip, and 10 to 14 seconds on a discrete GPU. Those are estimates; the benchmark ticket produces real numbers and a blind quality comparison on passages from the owner's own books.
- Whether the plain Hy-MT2 Q4_K_M file loads on stock llama.cpp b11510 was unverified at research time. The fallback is Qwen3.5-9B, which needs a separate download and the owner's approval.
- Known driver issue to remember during the benchmark: some Intel Arc Vulkan driver versions crash with GPU timeouts; the workaround is the environment variable `GGML_VK_DISABLE_COOPMAT=1`.
- The design for the bilingual view is the "Reader, translation on (scrolling)" board in the redesign canvas, with a copy of the source in `docs/design/reader-redesign/`. The Translate button, status pill and bilingual styling belong to the redesign's visual language, so the UI ticket builds on the redesign work.
