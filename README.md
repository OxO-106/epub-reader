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

## Your files

Both folders are created on first start, relative to the folder you start the server from (so start it from the same place each time), unless you set them:

| Variable             | Default     | What it is                                                                 |
| -------------------- | ----------- | -------------------------------------------------------------------------- |
| `READER_DATA_DIR`    | `./data`    | The SQLite database and the stored Book files. Back this folder up.        |
| `READER_LIBRARY_DIR` | `./library` | Watched folder: a file copied in here is added to the Library.             |

Books can also be dragged onto the Library page or picked with its Choose files button. Deleting a Book removes only the app's copy, never your original file.

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
