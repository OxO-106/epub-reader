# Running Reader

How to install and start Reader, where it keeps your files, and the settings it reads from environment variables. For the overview see the [README](../README.md); for translation see [translation.md](translation.md); for reaching Reader from your phone or other devices see [network-access.md](network-access.md).

## What it reads

Formats: EPUB (`.epub`), Kindle files (`.mobi`, `.azw3`, `.azw`; MOBI 6 and KF8, without DRM: a file locked by DRM is refused with a message saying so), Markdown (`.md`, `.markdown`) and plain text (`.txt`). A plain-text file may be UTF-8 (with or without a byte-order mark), UTF-16 with a byte-order mark, or GBK/GB2312/GB18030; it is stored as UTF-8, so the same text in different encodings is one Book. The format is detected from the content as well as the name: an EPUB with another name (`.zip`, say) is still imported as an EPUB, while a file named `.epub` that is really text is refused. Other file types are refused with a message, as are files over 200 MB and files that are damaged (an EPUB that cannot be parsed, or a "text" file that is really a binary one). Adding the same content twice keeps one Book.

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
| grey | not set up (model or llama.cpp missing, see [docs/translation-setup.md](translation-setup.md)) or switched off |

Hover over the icon for the words ("Reader: running | Translation: running"). Double-click it to open the Reader in the browser. Right-click for Open Reader, Restart Reader, Restart Translation, Open logs folder and **Quit (stop both)**. A balloon tells you when both are up and when one stops unexpectedly. Windows may tuck a new tray icon into the "^" overflow: drag it onto the taskbar once to keep it visible.

- **Stop everything:** use Quit in the icon's menu, or double-click **`Stop Reader.cmd`**.
- **Already running?** Double-clicking `Start Reader.cmd` again just opens the Reader. A server that was already running on its port is used as it is and is left running when you quit; the tray only stops what it started.
- **Reader only:** `Start Reader.cmd -NoTranslation`. Another model location: `-ModelPath` and `-RuntimeDir`, or the `READER_MODEL_PATH` and `READER_LLAMA_DIR` variables (default: the repository's `translation-models` folder when the model is there, else `%USERPROFILE%\translation-models`).
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

### Settings and environment variables

Most settings below can be changed in two places: on the **Settings** screen (the gear in the Library), which saves them in `settings.json` in the data folder, or with an environment variable. An environment variable always wins, and the Settings screen shows such a setting as fixed. Translation settings changed on the screen apply at once; the library folder, address and port when Reader restarts. The data folder itself is only set with `READER_DATA_DIR`, since the saved settings live in it.

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
