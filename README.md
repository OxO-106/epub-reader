# Reader

A personal ebook reader that runs on your own PC and is used through a web browser. A small local server keeps your Library (the Books and your Reading positions), so the same Library and place in each Book are there on every device that connects to it. Nothing leaves your machine and no internet connection is needed. Terms are defined in [GLOSSARY.md](GLOSSARY.md).

Formats: EPUB (`.epub`), Markdown (`.md`, `.markdown`) and plain text (`.txt`). A plain-text file may be UTF-8 (with or without a byte-order mark), UTF-16 with a byte-order mark, or GBK/GB2312/GB18030; it is stored as UTF-8, so the same text in different encodings is one Book. The format is detected from the content as well as the name: an EPUB with another name (`.zip`, say) is still imported as an EPUB, while a file named `.epub` that is really text is refused. Other file types are refused with a message, as are files over 200 MB and files that are damaged (an EPUB that cannot be parsed, or a "text" file that is really a binary one). Adding the same content twice keeps one Book.

## Requirements

- Node.js 24 or newer
- A browser. The end-to-end tests also need Google Chrome or Microsoft Edge installed.

```
npm install
```

## Start

```
npm start
```

This builds the front end and starts the server. Open <http://127.0.0.1:5174>. Stop it with Ctrl+C.

For development, `npm run dev` starts the server (restarting on change) and the Vite dev server with hot reload; open <http://localhost:5173>. It always uses port 5174 for the API, so `READER_PORT` does not apply to it.

### One-click start (Windows)

Double-click **`Start Reader.cmd`**. It starts the Reader server and the translation model server (both hidden) and puts an icon in the system tray: two dots, the left one for the Reader and the right one for Translation.

| Dot | Meaning |
|---|---|
| green | running and answering |
| amber | starting (the model needs about 10 s to load; the Reader a few seconds) |
| red | stopped or not answering |
| grey | not set up (model or llama.cpp missing, see [docs/translation-setup.md](docs/translation-setup.md)) or switched off |

Hover over the icon for the words ("Reader: running | Translation: running"). Double-click it to open the Reader in the browser. Right-click for Open Reader, Restart Reader, Restart Translation, Open logs folder and **Quit (stop both)**. A balloon tells you when both are up and when one stops unexpectedly. Windows may tuck a new tray icon into the "^" overflow: drag it onto the taskbar once to keep it visible.

- **Stop everything:** use Quit in the icon's menu, or double-click **`Stop Reader.cmd`**.
- **Already running?** Double-clicking `Start Reader.cmd` again just opens the Reader. A server that was already running on its port is used as it is and is left running when you quit; the tray only stops what it started.
- **Reader only:** `Start Reader.cmd -NoTranslation`. Another model location: `-ModelPath` and `-RuntimeDir`, or the `READER_MODEL_PATH` and `READER_LLAMA_DIR` variables (default `%USERPROFILE%\translation-models`).
- **Logs and status:** `%LOCALAPPDATA%\Reader\logs` (overwritten at each start; server messages, never Book text) and `%LOCALAPPDATA%\Reader\status.json`.
- The tray is `scripts/reader-tray.ps1` (Windows PowerShell 5.1, nothing to install). It needs `npm` on the PATH, as `npm start` does.

## Your files

Both folders are created on first start, relative to the folder you start the server from (so start it from the same place each time), unless you set them:

| Variable             | Default     | What it is                                                                 |
| -------------------- | ----------- | -------------------------------------------------------------------------- |
| `READER_DATA_DIR`    | `./data`    | The SQLite database and the stored Book files. Back this folder up.        |
| `READER_LIBRARY_DIR` | `./library` | Watched folder: a file copied in here is added to the Library.             |

Books can also be dragged onto the Library page or picked with its Choose files button. Deleting a Book removes only the app's copy, never your original file. The Library offers the Book you read last under Continue reading, and sorts by recently read, title or author (Chinese by pinyin); the sort is remembered per browser. A Book without a cover gets a generated one, and Markdown and text files are drawn as documents.

### The library folder is the source of truth

If the original of a deleted Book is still in the library folder, what happens depends on whether the server has been restarted:

- **While the server keeps running**, the Book stays deleted. The server remembers the files it has handled and the content of Books you deleted, so neither a rescan nor a slow copy brings the Book back. It is added again only if the file in the folder changes (a new version, or even just a new modification time), or if you add it yourself with Choose files.
- **After a restart**, the server imports everything in the folder again, so a Book whose original is still there returns. To get rid of a Book for good, remove its original from the library folder (or move it out) as well as deleting the Book.

Other settings, all optional:

| Variable          | Default       | What it is                                                               |
| ----------------- | ------------- | ------------------------------------------------------------------------ |
| `READER_PORT`     | `5174`        | Port to listen on.                                                       |
| `READER_HOST`     | `127.0.0.1`   | The one address to listen on instead of this PC only (see below).        |
| `READER_TAILSCALE`| off           | `1` or `true`: also listen on this PC's Tailscale address (see below).   |

On Windows PowerShell set a variable for one run like this (in a POSIX shell, `READER_PORT=8080 npm start`):

```
$env:READER_PORT = "8080"; npm start
```

## Fonts

English text is set in Libertinus Serif, which is installed with `npm install` (the package `@fontsource/libertinus-serif`, SIL Open Font License; the notice is in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)) and bundled into the front end. The interface itself is set in the system sans-serif font.

**IBM Plex Sans** is one of the choices in the Reader's Display settings (Font). It is installed the same way (the package `@fontsource/ibm-plex-sans`, SIL Open Font License, notice in the same file) and bundled, so it needs nothing from you. It has no Chinese, so Chinese text in a Book set in it uses the system's Chinese sans-serif font.

**Text size** (Display settings) scales all of a Book's text, including text the Book sizes for itself with CSS keywords (`small`, `x-large`), pixels or points, which would otherwise ignore the setting. The Book's own proportions are kept: small print stays smaller than body text and chapter titles stay larger. The number is the base size; a Book whose body text is "small" in its own design shows it at about 80% of that number, so raise the setting for such a Book.

Chinese text is set in 京华老宋体 (KingHwa_OldSong). Its licence is not stated, so **it is not in this repository** and must never be committed. If you have it installed on your PC, cut it into web pieces once; the server then serves them to every device that opens the Reader, the phone included, and the Library and every Book use the font for Chinese. Without it, everything still works and Chinese falls back to the system's Chinese serif font.

```
pip install fonttools brotli       # once; needs Python 3.9 or newer
npm run fonts:build                # about four minutes; finds the installed font by itself
```

The script looks for the font in the usual font folders (on Windows `%LOCALAPPDATA%\Microsoft\Windows\Fonts` and `C:\Windows\Fonts`) and says what to do if it cannot find it; or give the file: `npm run fonts:build -- "C:\path\to\京華老宋体.ttf"`. It writes about 120 woff2 pieces of roughly 150 KB (18 MB in all) with a style sheet and a manifest to the fonts folder, which git ignores, and refuses to write anywhere git would track. The result is the same every time. A browser downloads only the pieces its text needs (a page of common characters takes about 2 MB, once, then they are cached for good). No restart is needed after building.

| Variable           | Default    | What it is                                                                      |
| ------------------ | ---------- | ------------------------------------------------------------------------------- |
| `READER_FONTS_DIR` | `./fonts`  | The cut pieces of the Chinese font, served read-only at `/fonts/`. May be missing. |

## Translation (optional)

The Reader can show a Chinese translation under each English paragraph, produced on your own machines by a local model; nothing is sent to a cloud service. Translation is off until you point the app at a model server that speaks the OpenAI-style streaming API (`llama-server` from llama.cpp, Ollama, LM Studio, vLLM). The full set-up guide (what to download and where it goes, the start command and its flags, checking it, troubleshooting, and running the model on a second PC with a graphics card over Tailscale) is [docs/translation-setup.md](docs/translation-setup.md). In short, on the PC that has the files unpacked in `%USERPROFILE%\translation-models` (the model is `Hy-MT2-7B-Q4_K_M.gguf`, 4.6 GB, and the runtime is llama.cpp's Vulkan build):

```
npm run translate:server                       # window 1: starts the model server on 127.0.0.1:8080, Ctrl+C stops it
$env:READER_TRANSLATE_URL = "http://127.0.0.1:8080"; npm start        # window 2 (PowerShell)
```

The script `scripts/start-translation-server.ps1` takes `-RuntimeDir`, `-ModelPath`, `-ListenHost`, `-Port`, `-ContextSize` and `-ApiKey`, or the environment variables `READER_LLAMA_DIR`, `READER_MODEL_PATH` and `LLAMA_API_KEY` (prefer the variable for the key: a `-ApiKey` typed on the command line is visible in the process list). No model or program is kept in the repository. This section lists the app's settings.

| Variable                       | Default | What it is                                                                                         |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------- |
| `READER_TRANSLATE_URL`         | unset   | Base address of the model server, for example `http://127.0.0.1:8080`. Unset means "not set up".   |
| `READER_TRANSLATE_MODEL`       | unset   | Model name to ask for; servers that serve one model can ignore it.                                 |
| `READER_TRANSLATE_API_KEY`     | unset   | Sent to the model server as a Bearer token, for servers that need one.                             |
| `READER_TRANSLATE_CONCURRENCY` | `1`     | How many paragraphs the model server works on at once; the rest wait in the order they arrived.    |

The browser never talks to the model; the app server does, so a phone reaching the app over Tailscale needs nothing else. The app adds two endpoints: `POST /api/translate` (one English paragraph, optionally the previous paragraph as context, answered as a stream of newline-delimited JSON events) and `GET /api/translate/status` (`{"configured", "reachable", "model"}`, checked against the model server with a short timeout and cached for a few seconds). A browser that disconnects stops the work on the model. The text being translated is never logged or stored. The request is JSON, `{"text": "...", "context": "...", "names": ["..."]}` (`context` and `names` are optional); the answer is `application/x-ndjson`, one JSON event per line: `{"delta": "..."}` for each piece of the translation, then `{"done": true}` or `{"error": {"code", "message"}}`. Trouble before any text is sent is a plain JSON error with an HTTP status (`503` not set up, `400` bad request), always `{"error": {"code", "message"}}`. The other refusals: `413` `bad-request` (a paragraph over 20 000 characters, or a request body over 128 KiB, which is counted as it arrives so a chunked body cannot get round it), `415` `unsupported-media-type` (the body is not sent as `application/json`), `403` `forbidden-origin` and `503` `busy`. So that a web page on another site cannot make your model work, a request that carries an `Origin` header must name the host it was sent to (http or https, ports included); requests with no `Origin`, such as curl or another program, are accepted, and the status endpoint is left open. At most 64 requests wait for their turn behind the ones the model is working on; one more is answered `503` `busy` at once, and a request abandoned while it waits gives its place up (the number is `maxQueue` in the translate options, next to the concurrency, with no environment variable). The details are in `src/server/translate-routes.ts`.

The Book's text and the API key travel to the model server in each request, so its address should be `https` or a network you trust (a private network, or plain `http` over Tailscale, which encrypts the traffic). The address cannot carry a user name or password (`http://user:pass@host` stops the app at start with a message to use `READER_TRANSLATE_API_KEY`), and a wrong `READER_TRANSLATE_URL` is reported without repeating its value.

Names stay English by masking: the model transliterates names however it is asked, so before the text goes to the model each proper name (a capitalised word that does not start a sentence, with neighbouring ones joined, like "Netherfield Park") is swapped for a token such as `[[1]]`, the prompt tells the model to keep such tokens, and the names are put back into the stream as it arrives, even when a token is split between chunks. The model server therefore never receives the names, and the numbering is the same in the context paragraph and the paragraph; it lives only for the length of one request. A name that starts a sentence is masked when it also appears in the middle of a sentence in the same request, or when the caller lists it in `names` (up to 500 strings of up to 80 characters; titles such as "Mr." are ignored, so `"Mr. Darcy"` lists `Darcy`). Weekdays, months, countries, languages, nationalities, titles, pronouns and common sentence starters are never masked; that list is the plain text file `src/server/name-stop-list.txt`, which you can extend (it is read at start). Missing a name is preferred to masking an ordinary word.

### What the Reader does with it

In the Reader, an English Book (one that declares English, or whose text is clearly English) has a **Translate** button in the top bar, between Search and Display; turn it on and the Chinese appears as a soft tinted gloss under each English paragraph, in all three themes. The choice is remembered on this device and applies to every English Book until you turn it off. Beside the button a small status pill says what is happening ("Translating ahead", "Ready", "Not set up", "Backend unreachable", "Some paragraphs failed"; just a dot on a phone); when there is something to do it is a button that opens a short panel with the fix (the settings below, `npm run translate:server`, or Retry), and reading is never blocked.

The Reader module has a translation engine (`src/web/reader/translation`) for EPUB, Markdown and plain-text Books alike: `setTranslation(true)` finds the reading blocks (paragraphs, list items, quotations, headings) of the page on screen, skips empty blocks, decorations such as "* * *", bare chapter numbers and blocks that are already mostly Chinese, translates the blocks on screen and then about one screenful ahead, one block at a time and in reading order, and shows each Translation as generated content after its block. No element is added to the Book's document, so the Reading position (a CFI) is the same with translation on or off. Translations live in memory only; in scrolling mode those more than a screenful above the reader are cleared and the page is corrected so the text does not move, and a jump (Contents, Search) cancels the work in flight and starts again at the new place. A failed block shows a notice that retries it when clicked (or `retryTranslation`), the English keeps working whatever happens, and a model that is away or keeps failing pauses translation (status "unreachable" or "error") and is asked about now and then instead of again and again. The names the engine sends with every request are the capitalised words found in the middle of sentences in the loaded section, minus the words in `name-stop-list.txt` (which the front end now bundles too, so change it and rebuild).

Limits: a Book section (chapter file) is a separate page, so a chapter is translated from the moment the Reader loads it, not before; the Chinese is generated content, so it cannot be selected, copied or searched; paginated mode translates the page on screen and the next one but does not clear anything before the reader leaves the section.

## Reaching it from other devices (Tailscale)

By default the server accepts connections from this PC only. There is no login, so only open it to a network you trust. To also reach it from your other devices over [Tailscale](https://tailscale.com):

```
$env:READER_TAILSCALE = "1"; npm start        # PowerShell
READER_TAILSCALE=1 npm start                  # bash, zsh
```

The server then listens on `127.0.0.1` and on this PC's Tailscale address (the IPv4 address in 100.64.0.0/10, the first one found) and prints both, for example `http://100.101.102.103:5174`. Open that address from any device on your tailnet. If Tailscale is not running, the server refuses to start and says so; it never falls back to listening on every address.

Precedence: `READER_HOST` sets the base address (default `127.0.0.1`) and `READER_TAILSCALE` adds the Tailscale address to it, so `READER_HOST=192.168.1.20 READER_TAILSCALE=1` listens on exactly those two. `READER_HOST` alone listens on that one address only. Nothing listens on `0.0.0.0` unless you set `READER_HOST=0.0.0.0` yourself.

Over Tailscale the page is plain HTTP. Reading works that way, but if you want HTTPS (a secure browser context), leave `READER_TAILSCALE` off and let Tailscale proxy the localhost server instead: `tailscale serve --bg 5174`, then open the `https://` name it prints; `tailscale serve reset` undoes it.

## Tests

```
npm run typecheck   # TypeScript
npm test            # tests/api (real server on throwaway folders, over HTTP) and tests/unit (a few pieces of pure logic)
npm run test:e2e    # browser tests: tests/e2e (Playwright; builds the front end first)
npm run test:all    # all three
```

Use `npm run test:e2e` rather than `npx playwright test`, which skips the build and would test an old front end. `tests/e2e/layout.spec.ts` checks the Library and the Reader for sideways scrolling and clipped or overlapping controls at 900 px and 360 px wide. Test files are in `tests/fixtures`; `npm run fixtures` regenerates them.
