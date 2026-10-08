# 02: Translation API on the server

**What to build:** The app server gains a streaming translate endpoint and a status endpoint in front of any OpenAI-style model server, configured by READER_TRANSLATE_URL, READER_TRANSLATE_MODEL and an optional READER_TRANSLATE_API_KEY. A paragraph of English plus optional context in, Chinese text streamed out as it is produced, then done or an error. The backend is limited to a configurable number of concurrent requests with the rest queued, a browser that disconnects aborts the upstream request, and no Book text is ever logged or stored. The prompt follows the benchmark's conclusions, or the research's model-card defaults until they exist.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] With a model stand-in (a real tiny HTTP server in the tests speaking the streaming protocol) the endpoint streams chunks in order and ends with a done marker
- [x] The previous paragraph is sent to the backend as context only; the system prompt demands Simplified Chinese, English names kept without brackets, translation only
- [x] The status endpoint reports not configured, unreachable and ready (with the backend's model name)
- [x] At most N backend requests run at once (default 1) and the rest wait in order; a request abandoned by the browser while queued or running is dropped and the upstream request aborted
- [x] Backend errors, refusals, timeouts and malformed streams become clean errors for the browser, never hangs or crashes
- [x] No Book text appears in logs, in the data folder or in the database (tests assert on them)
- [x] Configuration is read from the environment and documented in README and CLAUDE.md; API tests pass through the HTTP seam with no mocks of the app
