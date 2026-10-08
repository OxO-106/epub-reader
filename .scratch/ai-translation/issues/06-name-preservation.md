# 06: Keep English names English (placeholder masking)

**What to build:** The translate pipeline keeps proper names in English, consistently, by masking them: names in the paragraph (and in the context paragraph) are replaced by opaque placeholder tokens before the text goes to the model, the prompt tells the model to keep such tokens exactly as written, and the names are restored in the streamed output. See the spec decision "Names stay English by masking, not by asking" and the benchmark (`.scratch/ai-translation/benchmark.md`, section Quality findings) for the evidence and the working prompt. The translate endpoint also accepts an optional list of names that the caller already knows (so sentence-initial names such as "Elizabeth said..." are caught), and the prompt module is updated to the benchmark's prompt (no system prompt, model-card user-message templates, Background Information form for the previous paragraph).

**Blocked by:** 02 Translation API on the server (done)

**Status:** ready-for-agent

- [x] Names in the paragraph and context are masked before the backend sees them: capitalised words that are not sentence-initial, adjacent ones joined as phrases, sentence-initial words only when known (from the caller's list or earlier in the same request), minus a stop-list of weekdays, months, countries, languages, nationalities, titles, pronouns and common sentence starters kept in a plain data file; "Mr." and similar abbreviations do not count as sentence ends
- [x] The backend never receives the names themselves (assert on the stand-in's request log) and receives placeholders in a consistent numbering within a request
- [x] Names are restored in the streamed output, including when a placeholder is split across stream chunks (stream-safe), whatever the chunk boundaries
- [x] A placeholder the model drops is tolerated; a leftover or mangled token (e.g. `[[` or `[[3` at the end of the stream) is never shown to the browser
- [x] The optional `names` request field is validated (array of short strings, bounded count) and merged with the names detected in the paragraph
- [x] The prompt module follows the benchmark: no system prompt, plain template without context, Background Information template with context, sampling from the model card; the existing API tests are updated, not weakened
- [x] Tests with the model stand-in cover the cases above, including 'England' and 'Monday' not being masked, 'Mr. Bennet' being masked, and a name only known from the caller's list; `npm run test:all` passes
