// Reader's desktop app: the app shell (issues #33 and #34). It starts the same Reader server as `npm start` in a
// utility process (server-process.ts), waits for it to answer, and opens a window on it. The window is only the web
// front end: no Node, context isolation, the sandbox, and the server's Content-Security-Policy; a small preload bridge
// (preload.cjs) lets the Settings screen change the app's own settings. The shell owns the server's lifecycle, the
// translation model server (model-server.ts), the tray with its two status dots, the single-instance lock, the window's
// place, the menu, starting with the system, and turning startup problems into dialogs.
//
// Data lives in the platform's app-data folder (on Windows %APPDATA%\Reader), or in READER_DESKTOP_DATA when set (the
// tests use a temporary folder). The server's working directory is that folder, so its relative defaults land there.
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray,
  utilityProcess,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type UtilityProcess,
} from "electron";
import { spawn } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, openAsBlob, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import updater from "electron-updater";
import { fileURLToPath } from "node:url";
import { applyDesktopChange, loadDesktopSettings, saveDesktopSettings, type DesktopSettings } from "./desktop-settings.ts";
import { downloadFile, translationDownloads, unzip } from "./downloads.ts";
import { createModelServer, findModelFile, findRuntime, type ModelServer } from "./model-server.ts";
import { booksInArguments, defaultWindowState, isReaderPage, opensInBrowser, restoreWindowState, trayLook, type ServerState, type WindowState } from "./shell-rules.ts";

const here = dirname(fileURLToPath(import.meta.url));
app.setName("Reader");
if (process.env.READER_DESKTOP_DATA) app.setPath("userData", process.env.READER_DESKTOP_DATA);
const dataRoot = app.getPath("userData");
const logsDir = join(dataRoot, "logs");
const stateFile = join(dataRoot, "window-state.json");
const settingsFile = join(dataRoot, "desktop.json");
const startedHidden = process.argv.includes("--hidden"); // started with the system: straight to the tray

let window: BrowserWindow | null = null;
let server: { process: UtilityProcess; url: string } | null = null;
let serverState: ServerState = "starting";
let tray: Tray | null = null;
let quitting = false;
mkdirSync(dataRoot, { recursive: true });
let settings: DesktopSettings = loadDesktopSettings(settingsFile);

function log(line: string) {
  try {
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(join(logsDir, "reader.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // logging must never stop the app
  }
}

/** A startup problem for the reader: a dialog (or only the log, for the automated tests, READER_DESKTOP_NO_DIALOGS). */
function showError(title: string, message: string) {
  log(`${title}: ${message}`);
  if (!process.env.READER_DESKTOP_NO_DIALOGS) dialog.showErrorBox(title, message);
}

// ---- the translation model server ----------------------------------------------------------------------------------

/**
 * The model folder: the one chosen in Settings; else, running from the repository, its git-ignored translation-models
 * folder when it is there; else `translation-model` in the app's data folder. READER_DESKTOP_MODELS replaces all of
 * them (the tests point it at nothing, so no model is found and nothing is offered).
 */
function modelFolder(): string | null {
  if (process.env.READER_DESKTOP_MODELS !== undefined) return process.env.READER_DESKTOP_MODELS || null;
  if (settings.modelFolder) return settings.modelFolder;
  const repo = join(here, "../translation-models");
  if (!app.isPackaged && existsSync(repo)) return repo;
  return join(dataRoot, "translation-model");
}

/**
 * Where llama.cpp's llama-server is when it is not in the model folder: the copy the installer ships (resources/runtime),
 * or, running from the repository, the one `npm run runtime` fetches into runtime/.
 */
const runtimeDirs = [app.isPackaged ? join(process.resourcesPath, "runtime", "llama-vulkan") : join(here, "../runtime/llama-vulkan")];

const model: ModelServer = createModelServer({
  folder: modelFolder(),
  runtimeDirs,
  deps: {
    spawn(command, args) {
      mkdirSync(logsDir, { recursive: true });
      const output = createWriteStream(join(logsDir, "model-server.log"), { flags: "a" });
      const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.pipe(output);
      child.stderr.pipe(output);
      log(`model server started: ${command}`);
      return child;
    },
    async answers(url) {
      try {
        return (await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(2000) })).ok;
      } catch {
        return false;
      }
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
});

/** Once the model answers, the Reader server translates through it, unless Settings already names a model server. */
async function pointReaderAtModel() {
  if (!server || model.state() !== "running") return;
  try {
    const view = (await (await fetch(new URL("/api/settings", server.url))).json()) as { settings: { translateUrl: { value: unknown; fixed?: unknown } } };
    if (view.settings.translateUrl.value || view.settings.translateUrl.fixed) return;
    await fetch(new URL("/api/settings", server.url), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ translateUrl: model.url }),
    });
    log(`translation set to the model server at ${model.url}`);
  } catch (error) {
    log(`could not set the translation address: ${(error as Error).message}`);
  }
}

model.onState((state) => {
  log(`translation: ${state}${model.problem() ? ` (${model.problem()})` : ""}`);
  updateTray();
  sendStatus();
  if (state === "running") void pointReaderAtModel();
});

// ---- downloading the model (issue #35) ----------------------------------------------------------------------------

type DownloadState =
  | { state: "idle" | "done" }
  | { state: "downloading" | "verifying" | "paused"; name: string; received: number; total: number }
  | { state: "failed"; message: string };

let download: DownloadState = { state: "idle" };
let downloadAbort: AbortController | null = null;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

/** Progress arrives many times a second; the page hears of it at most four times a second. */
function sendStatusSoon() {
  statusTimer ??= setTimeout(() => {
    statusTimer = undefined;
    sendStatus();
    updateTray();
  }, 250);
}

/**
 * Downloads llama.cpp's runtime and the model into the chosen model folder (never a folder the reader did not choose),
 * resuming what an earlier attempt left, verifying both, unpacking the runtime, then starting the model server.
 */
async function startDownload() {
  const folder = modelFolder();
  if (!folder) {
    download = { state: "failed", message: "Choose the folder for the model first: it needs about 5 GB." };
    return sendStatus();
  }
  // llama.cpp comes with the installed app; only a copy without it (or another system) needs the runtime too.
  const needRuntime = !findRuntime(folder, runtimeDirs);
  if (needRuntime && process.platform !== "win32") {
    download = { state: "failed", message: "The download is for Windows. On this system, put llama.cpp's llama-server and the model in the folder yourself (see docs/translation-setup.md)." };
    return sendStatus();
  }
  if (downloadAbort) return;
  const abort = (downloadAbort = new AbortController());
  let last: { name: string; received: number; total: number } = { name: "", received: 0, total: 0 };
  try {
    mkdirSync(folder, { recursive: true });
    for (const item of needRuntime ? [translationDownloads.runtime, translationDownloads.model] : [translationDownloads.model]) {
      const dest = join(folder, item.name);
      if (existsSync(dest)) continue;
      await downloadFile(item, dest, {
        signal: abort.signal,
        onProgress: (progress) => {
          last = { name: progress.name, received: progress.received, total: progress.total };
          download = { state: progress.phase, ...last };
          sendStatusSoon();
        },
      });
    }
    if (!findRuntime(folder, runtimeDirs)) await unzip(join(folder, translationDownloads.runtime.name), join(folder, "llama-vulkan"));
    download = { state: "done" };
    log(`translation model downloaded into ${folder}`);
    await model.setFolder(modelFolder());
    if (model.state() === "stopped") void model.start();
    if (Notification.isSupported()) new Notification({ title: "Translation is ready", body: "Turn on Translate in an English Book to read it with Chinese." }).show();
  } catch (error) {
    download = abort.signal.aborted ? { state: "paused", ...last } : { state: "failed", message: (error as Error).message };
    log(`download ${download.state}: ${(error as Error).message}`);
  } finally {
    downloadAbort = null;
    sendStatus();
  }
}

function pauseDownload() {
  downloadAbort?.abort();
}

/**
 * On the first start, offer the translation model once (the installer cannot hold it: 4.6 GB). Asked with the folder it
 * will go to, which can be changed; the answer is remembered either way, and Settings can download it later.
 */
async function offerModel() {
  if (settings.modelOffered || !modelFolder() || process.env.READER_DESKTOP_NO_DIALOGS) return;
  if (model.state() !== "not-set-up" || !window) return;
  settings = { ...settings, modelOffered: true };
  saveDesktopSettings(settingsFile, settings);
  for (;;) {
    const folder = modelFolder()!;
    const answer = await dialog.showMessageBox(window, {
      type: "question",
      title: "Translation",
      message: "Download the translation model?",
      detail:
        `Reader translates English Books into Chinese with a model that runs on this PC: Tencent Hy-MT2 (4.6 GB). It downloads in the background, and translation turns on when it is done.\n\nIt will be saved in:\n${folder}`,
      buttons: ["Download", "Choose another folder…", "Not now"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (answer.response === 0) return void startDownload();
    if (answer.response === 2) return;
    const picked = await dialog.showOpenDialog(window, { title: "Choose the folder for the translation model", properties: ["openDirectory", "createDirectory"] });
    if (!picked.canceled && picked.filePaths[0]) {
      settings = { ...settings, modelFolder: picked.filePaths[0] };
      saveDesktopSettings(settingsFile, settings);
      await model.setFolder(modelFolder());
      if (model.state() !== "not-set-up") return void model.start();
    }
  }
}

/**
 * Deletes the model file (after asking), freeing its space: the model server stops, and if Reader was translating
 * through it, translation goes back to "not set up". llama.cpp and any other file in the folder stay.
 */
async function deleteModel() {
  const file = findModelFile(modelFolder());
  if (!file || !window) return;
  const answer = await dialog.showMessageBox(window, {
    type: "warning",
    message: "Delete the translation model?",
    detail: `This deletes ${file} and turns translation off. You can download it again from Settings.`,
    buttons: ["Delete", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (answer.response !== 0) return;
  pauseDownload();
  await model.stop();
  rmSync(file, { force: true });
  rmSync(`${file}.part`, { force: true });
  log(`translation model deleted: ${file}`);
  download = { state: "idle" };
  await model.setFolder(modelFolder());
  await forgetModelAddress();
  sendStatus();
}

/** Clears Reader's translation address when it is the app's own model server (so it reads "not set up", not "unreachable"). */
async function forgetModelAddress() {
  if (!server) return;
  try {
    const view = (await (await fetch(new URL("/api/settings", server.url))).json()) as { settings: { translateUrl: { value: unknown } } };
    if (view.settings.translateUrl.value !== model.url) return;
    await fetch(new URL("/api/settings", server.url), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ translateUrl: null }) });
  } catch (error) {
    log(`could not clear the translation address: ${(error as Error).message}`);
  }
}

// ---- the server --------------------------------------------------------------------------------------------------

/** Starts the server process and resolves with its address, or rejects with the message to show. */
function startServerProcess(): Promise<{ process: UtilityProcess; url: string }> {
  serverState = "starting";
  updateTray();
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
        serverState = "running";
        updateTray();
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
      serverState = "stopped";
      updateTray();
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

// ---- the tray ------------------------------------------------------------------------------------------------------

function updateTray() {
  if (!tray) return;
  const look = trayLook(serverState, model.state());
  tray.setImage(nativeImage.createFromPath(join(here, "icons", look.icon)));
  const downloading = download.state === "downloading" ? `\nDownloading the model: ${Math.floor((download.received / download.total) * 100)}%` : "";
  tray.setToolTip(look.tooltip + downloading);
  const translation = model.state();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Reader", click: showWindow },
      { type: "separator" },
      translation === "running" || translation === "starting"
        ? { label: "Stop translation", click: () => void model.stop() }
        : { label: "Start translation", enabled: translation !== "not-set-up", click: () => void model.start() },
      { type: "separator" },
      { label: "Open data folder", click: () => void shell.openPath(dataRoot) },
      { label: "Open logs", click: () => void shell.openPath(logsDir) },
      { type: "separator" },
      { label: "Quit Reader", click: () => app.quit() },
    ]),
  );
}

function createTray() {
  const look = trayLook(serverState, model.state());
  tray = new Tray(nativeImage.createFromPath(join(here, "icons", look.icon)));
  tray.on("click", showWindow);
  updateTray();
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

function showWindow() {
  if (!server) return;
  if (!window) openWindow(server.url);
  else {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
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
    icon: join(here, "icons", "app.png"),
    backgroundColor: "#faf8f3",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, preload: join(here, "preload.cjs") },
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
  win.on("close", (event) => {
    saveWindowState(win);
    // With "keep running in the tray" on, closing the window only hides it: Reader keeps serving a phone.
    if (settings.closeToTray && !quitting) {
      event.preventDefault();
      win.hide();
    }
  });
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

// ---- Books given to the app (issue #36) ----------------------------------------------------------------------------

/** Files given before the server was ready (the app was started by opening one). */
const waitingFiles: string[] = [];

/**
 * Adds Books given to the app (double-clicked, dropped on its icon, `Reader book.epub`) to the Library, as the
 * Library's own import does, and opens the last one. A file the Library refuses is explained in a message.
 */
async function addAndOpen(paths: string[]) {
  if (!paths.length) return;
  if (!server) {
    waitingFiles.push(...paths);
    return;
  }
  let opened: string | null = null;
  const problems: string[] = [];
  for (const path of paths) {
    try {
      const response = await fetch(new URL(`/api/books?name=${encodeURIComponent(basename(path))}`, server.url), { method: "POST", body: await openAsBlob(path) });
      const body = (await response.json()) as { book?: { id: string }; error?: string };
      if (body.book) opened = body.book.id;
      else problems.push(body.error ?? `${basename(path)} could not be added.`);
    } catch (error) {
      problems.push(`${basename(path)} could not be read: ${(error as Error).message}`);
    }
  }
  if (opened) {
    showWindow();
    void window?.loadURL(new URL(`/#/read/${opened}`, server.url).href);
  }
  if (problems.length) showError("Some files were not added", problems.join("\n"));
}

// ---- updates (issue #36) -------------------------------------------------------------------------------------------

/**
 * The installed app checks GitHub Releases for a newer version at start, downloads it in the background, and asks
 * before restarting; "Later" installs it when Reader next quits. The Library and settings live in the data folder, not
 * the install folder, so they stay as they are.
 */
function checkForUpdates() {
  if (!app.isPackaged || process.env.READER_DESKTOP_NO_UPDATES) return;
  const { autoUpdater } = updater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (error) => log(`update check failed: ${error.message}`));
  autoUpdater.on("update-downloaded", async (info) => {
    log(`update ${info.version} downloaded`);
    const answer = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `Reader ${info.version} is ready to install`,
      detail: "Restart Reader to use it. Your Library, Reading positions, highlights and settings stay as they are.",
    });
    if (answer.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.checkForUpdates().catch((error: Error) => log(`update check failed: ${error.message}`));
}

// ---- the bridge to the Settings screen -----------------------------------------------------------------------------

function status() {
  const modelFile = findModelFile(modelFolder());
  return { settings: { ...settings, modelFolder: modelFolder() }, translation: { state: model.state(), problem: model.problem(), modelFile }, download };
}

function sendStatus() {
  window?.webContents.send("desktop:status", status());
}

/** Only Reader's own page may use the bridge. */
function fromReader(event: IpcMainInvokeEvent): boolean {
  return !!server && isReaderPage(event.senderFrame?.url ?? "", server.url);
}

function applyStartWithSystem() {
  // Only from the packaged app: a development copy must not register itself to start with the system.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.startWithSystem, args: ["--hidden"] });
}

function registerBridge() {
  ipcMain.handle("desktop:status", (event) => (fromReader(event) ? status() : null));
  ipcMain.handle("desktop:update", (event, change: unknown) => {
    if (!fromReader(event)) return null;
    const before = settings;
    settings = applyDesktopChange(settings, change);
    saveDesktopSettings(settingsFile, settings);
    if (before.startWithSystem !== settings.startWithSystem) applyStartWithSystem();
    return status();
  });
  ipcMain.handle("desktop:choose-model-folder", async (event) => {
    if (!fromReader(event) || !window) return null;
    const picked = await dialog.showOpenDialog(window, { title: "Choose the folder for the translation model", properties: ["openDirectory", "createDirectory"] });
    if (picked.canceled || !picked.filePaths[0]) return status();
    settings = { ...settings, modelFolder: picked.filePaths[0] };
    saveDesktopSettings(settingsFile, settings);
    await model.setFolder(modelFolder());
    if (settings.startTranslation && model.state() === "stopped") void model.start();
    return status();
  });
  ipcMain.handle("desktop:download", (event, action: unknown) => {
    if (!fromReader(event)) return null;
    if (action === "start") void startDownload();
    else if (action === "pause") pauseDownload();
    return status();
  });
  ipcMain.handle("desktop:delete-model", async (event) => {
    if (!fromReader(event)) return null;
    await deleteModel();
    return status();
  });
  ipcMain.handle("desktop:translation", (event, action: unknown) => {
    if (!fromReader(event)) return null;
    if (action === "start") void model.start();
    else if (action === "stop") void model.stop();
    return status();
  });
}

// For the smoke test: what the tray shows.
(globalThis as { __readerShell?: unknown }).__readerShell = {
  tray: () => ({ tooltip: trayLook(serverState, model.state()).tooltip, present: !!tray && !tray.isDestroyed() }),
};

// ---- the app -------------------------------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  // Another copy is running: it is told (second-instance below) and shows its window; this one leaves at once.
  app.quit();
} else {
  // Starting Reader again (also by opening a Book file while it runs) brings its window forward and adds the files.
  app.on("second-instance", (_event, argv) => {
    showWindow();
    void addAndOpen(booksInArguments(argv.slice(1)));
  });
  // macOS hands files over with an event instead of arguments.
  app.on("open-file", (event, path) => {
    event.preventDefault();
    void addAndOpen([path]);
  });

  app.whenReady().then(async () => {
    buildMenu();
    registerBridge();
    createTray();
    log(`starting (Electron ${process.versions.electron}, Node ${process.versions.node}, data ${dataRoot})`);
    try {
      server = await startServerProcess();
    } catch (error) {
      showError("Reader could not start", `${(error as Error).message}\n\nThe data folder is ${dataRoot}.`);
      app.exit(1);
      return;
    }
    if (!startedHidden) openWindow(server.url);
    if (settings.startTranslation && model.state() === "stopped") void model.start();
    // Once the window is up, so the question sits over the app rather than alone on the desktop.
    window?.once("ready-to-show", () => setTimeout(() => void offerModel(), 600));
    app.on("activate", showWindow);
    void addAndOpen([...waitingFiles.splice(0), ...booksInArguments(process.argv.slice(1))]);
    checkForUpdates();
  });

  // Closing the last window quits, unless Reader is to keep running in the tray.
  app.on("window-all-closed", () => {
    if (!settings.closeToTray) app.quit();
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    pauseDownload(); // what has arrived is kept, and the next download carries on from there
    void Promise.all([stopServerProcess(), model.stop()]).finally(() => {
      tray?.destroy();
      // Quit again, now for real: the normal quit lets an update install itself on the way out.
      app.quit();
    });
  });
}
