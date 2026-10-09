// Reader's desktop app (issue #33): the app shell. It starts the same Reader server as `npm start` in a utility process
// (server-process.ts), waits for it to answer, and opens a window on it. The window is only the web front end: no Node,
// context isolation, the sandbox, and the server's Content-Security-Policy. The shell owns the server's lifecycle, the
// single-instance lock, the window's place, the menu, and turning startup problems into dialogs.
//
// Data lives in the platform's app-data folder (on Windows %APPDATA%\Reader), or in READER_DESKTOP_DATA when set (the
// tests use a temporary folder). The server's working directory is that folder, so its relative defaults land there.
import { app, BrowserWindow, dialog, Menu, screen, shell, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultWindowState, isReaderPage, opensInBrowser, restoreWindowState, type WindowState } from "./shell-rules.ts";

const here = dirname(fileURLToPath(import.meta.url));
app.setName("Reader");
if (process.env.READER_DESKTOP_DATA) app.setPath("userData", process.env.READER_DESKTOP_DATA);
const dataRoot = app.getPath("userData");
const logsDir = join(dataRoot, "logs");
const stateFile = join(dataRoot, "window-state.json");

let window: BrowserWindow | null = null;
let server: { process: UtilityProcess; url: string } | null = null;
let quitting = false;

function log(line: string) {
  try {
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(join(logsDir, "reader.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // logging must never stop the app
  }
}

// ---- the server --------------------------------------------------------------------------------------------------

/** A startup problem for the reader: a dialog (or only the log, for the automated tests, READER_DESKTOP_NO_DIALOGS). */
function showError(title: string, message: string) {
  log(`${title}: ${message}`);
  if (!process.env.READER_DESKTOP_NO_DIALOGS) dialog.showErrorBox(title, message);
}

/** Starts the server process and resolves with its address, or rejects with the message to show. */
function startServerProcess(): Promise<{ process: UtilityProcess; url: string }> {
  mkdirSync(dataRoot, { recursive: true });
  const child = utilityProcess.fork(join(here, "server-process.ts"), [], {
    cwd: dataRoot,
    serviceName: "Reader server",
    stdio: "pipe",
    env: {
      ...process.env,
      READER_WEB_DIR: process.env.READER_WEB_DIR ?? join(here, "../dist/web"),
      // The Chinese font pieces made by `npm run fonts:build` sit beside the app's code, not in its data folder.
      ...(!process.env.READER_FONTS_DIR && existsSync(join(here, "../fonts")) ? { READER_FONTS_DIR: join(here, "../fonts") } : {}),
    },
  });
  child.stdout?.on("data", (chunk: Buffer) => log(`server: ${chunk.toString().trimEnd()}`));
  child.stderr?.on("data", (chunk: Buffer) => log(`server error: ${chunk.toString().trimEnd()}`));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The Reader server did not start within 30 seconds. See the log in the data folder.")), 30_000);
    child.on("message", (message: { type?: string; url?: string; message?: string }) => {
      if (message?.type === "ready" && message.url) {
        clearTimeout(timer);
        resolve({ process: child, url: message.url });
      } else if (message?.type === "failed") {
        clearTimeout(timer);
        reject(new Error(message.message ?? "The Reader server could not start."));
      } else if (message?.type === "restart") {
        void restartServer();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (server?.process === child && !quitting) {
        log(`server exited unexpectedly (${code})`);
        server = null;
      }
      reject(new Error(`The Reader server stopped while starting (exit code ${code}). See the log in the data folder.`));
    });
  });
}

/** Asks the server to stop, and makes sure it has within a few seconds. */
function stopServerProcess(): Promise<void> {
  const running = server;
  server = null;
  if (!running) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      running.process.kill();
      resolve();
    }, 5000);
    running.process.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    running.process.postMessage("stop");
  });
}

/** The Settings screen's Restart: the server stops and starts again with the saved settings, and the window reloads. */
async function restartServer() {
  log("restarting the server");
  await stopServerProcess();
  try {
    server = await startServerProcess();
    window?.loadURL(server.url);
  } catch (error) {
    showError("Reader could not restart", (error as Error).message);
    app.quit();
  }
}

// ---- the window ----------------------------------------------------------------------------------------------------

function loadWindowState(): WindowState {
  try {
    return restoreWindowState(JSON.parse(readFileSync(stateFile, "utf8")), screen.getAllDisplays().map((d) => d.workArea));
  } catch {
    return { ...defaultWindowState };
  }
}

function saveWindowState(win: BrowserWindow) {
  try {
    const bounds = win.getNormalBounds();
    writeFileSync(stateFile, JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {
    // not worth a dialog
  }
}

function openWindow(url: string) {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...state,
    minWidth: 360,
    minHeight: 400,
    show: false,
    title: "Reader",
    backgroundColor: "#faf8f3",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  if (state.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  // Links to other sites open in the system's browser; the window only ever shows Reader.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (opensInBrowser(target) && !isReaderPage(target, url)) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (isReaderPage(target, server?.url ?? url)) return;
    event.preventDefault();
    if (opensInBrowser(target)) void shell.openExternal(target);
  });
  win.on("close", () => saveWindowState(win));
  win.on("closed", () => {
    window = null;
  });
  void win.loadURL(url);
  window = win;
}

function buildMenu() {
  const mac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        { label: "Open Data Folder", click: () => void shell.openPath(dataRoot) },
        { label: "Open Logs", click: () => void shell.openPath(logsDir) },
        { type: "separator" },
        mac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "Reader on GitHub", click: () => void shell.openExternal("https://github.com/OxO-106/epub-reader") }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- the app -------------------------------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  // Another copy is running: it is told (second-instance below) and shows its window; this one leaves at once.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window && server) openWindow(server.url);
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    log(`starting (Electron ${process.versions.electron}, Node ${process.versions.node}, data ${dataRoot})`);
    try {
      server = await startServerProcess();
    } catch (error) {
      showError("Reader could not start", `${(error as Error).message}\n\nThe data folder is ${dataRoot}.`);
      app.exit(1);
      return;
    }
    openWindow(server.url);
    app.on("activate", () => {
      if (!window && server) openWindow(server.url);
    });
  });

  // Closing the last window quits (the tray, which keeps Reader running for a phone, comes with issue #34).
  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void stopServerProcess().finally(() => app.exit(0));
  });
}
