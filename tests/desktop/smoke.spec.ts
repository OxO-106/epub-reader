// The desktop app (issue #33): it starts the Reader server, opens a window on the Library, adds and opens a Book, keeps
// to one copy, sends links to other sites to the system's browser, and quitting leaves no server behind. Everything it
// writes goes into a temporary folder (READER_DESKTOP_DATA).
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = (name: string) => join(root, "tests/fixtures", name);

let app: ElectronApplication | undefined;
let data: string;

test.beforeEach(async () => {
  data = await mkdtemp(join(tmpdir(), "reader-desktop-"));
});

test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  await rm(data, { recursive: true, force: true }).catch(() => {});
});

/** The Electron executable (the `electron` package's main export is its path). */
const electronPath = createRequire(import.meta.url)("electron") as unknown as string;

/** Runs the app without Playwright attached (for a copy that is expected to leave at once) and resolves with its exit code. */
function runToExit(env: Record<string, string>, timeoutMs = 30_000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [root], { cwd: root, env: { ...process.env, READER_DESKTOP_MODELS: "", ...env }, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the app did not leave"));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

let port = "";

/** Launches the app on a free port, with its data in the test's temporary folder. */
async function launch(): Promise<ElectronApplication> {
  port = String(20000 + Math.floor(Math.random() * 20000));
  return electron.launch({ args: [root], cwd: root, env: { ...process.env, READER_DESKTOP_DATA: data, READER_DESKTOP_MODELS: "", READER_PORT: port } });
}

test("starts the server, shows the Library, adds and opens a Book, and quits leaving nothing running", async () => {
  app = await launch();
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible({ timeout: 30_000 });
  const url = page.url();

  await page.locator("input[type=file]").setInputFiles(fixture("sample.epub"));
  await page.getByRole("link", { name: /Sample Book/ }).click();
  await expect(page.getByRole("heading", { name: "Sample Book" })).toBeVisible();
  await expect.poll(async () => (await Promise.all(page.frames().slice(1).map((f) => f.evaluate(() => document.body?.innerText ?? "").catch(() => "")))).join(" ")).toContain("quiet morning");

  // The window is the web app only: no Node in the page.
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe("undefined");

  await app.close();
  app = undefined;
  // The server went with the app.
  await expect(fetch(new URL("/api/books", url))).rejects.toThrow();
  // Its data stayed in the temporary folder.
  expect(await readdir(join(data, "data"))).toContain("reader.sqlite");
});

test("a second copy hands over to the first and leaves", async () => {
  app = await launch();
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible({ timeout: 30_000 });

  expect(await runToExit({ READER_DESKTOP_DATA: data, READER_PORT: port })).toBe(0);
  expect(app.windows()).toHaveLength(1);
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible();
});

test("a port already in use ends in a message, not a blank window", async () => {
  const { createServer } = await import("node:net");
  const blocker = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => blocker.once("listening", resolve));
  const taken = String((blocker.address() as { port: number }).port);
  try {
    expect(await runToExit({ READER_DESKTOP_DATA: data, READER_PORT: taken, READER_DESKTOP_NO_DIALOGS: "1" })).toBe(1);
    expect(await readFile(join(data, "logs/reader.log"), "utf8")).toMatch(new RegExp(`Reader could not start: Port ${taken} is already in use`));
  } finally {
    blocker.close();
  }
});

test("shows Reader and translation in the tray, and can keep running there when the window is closed", async () => {
  app = await launch();
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible({ timeout: 30_000 });
  const tray = () => app!.evaluate(() => (globalThis as unknown as { __readerShell: { tray(): { tooltip: string; present: boolean } } }).__readerShell.tray());
  await expect.poll(tray).toEqual({ tooltip: "Reader: running\nTranslation: not set up", present: true });

  await page.goto(new URL("/#/settings", page.url()).href);
  const desktop = page.getByRole("region", { name: "Desktop app" });
  await expect(desktop).toContainText("Not set up");
  // The model is downloaded only into a folder the reader chose.
  await expect(desktop.getByRole("button", { name: "Download the model" })).toBeDisabled();
  await desktop.getByRole("checkbox", { name: "Keep Reader running in the tray when the window is closed" }).check();
  await expect.poll(async () => JSON.parse(await readFile(join(data, "desktop.json"), "utf8")).closeToTray).toBe(true);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());

  // Still running, with the server answering, and the window only hidden.
  await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()))).toEqual([false]);
  expect((await fetch(new URL("/api/books", page.url()))).ok).toBe(true);
});

test("a Book file given to the app is added to the Library and opened", async () => {
  port = String(20000 + Math.floor(Math.random() * 20000));
  app = await electron.launch({ args: [root, fixture("sample.epub")], cwd: root, env: { ...process.env, READER_DESKTOP_DATA: data, READER_DESKTOP_MODELS: "", READER_PORT: port } });
  const page = await app.firstWindow();

  await expect(page.getByRole("heading", { name: "Sample Book" })).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toMatch(/#\/read\/[0-9a-f]{64}$/);
});

// The packaged app (electron-builder's unpacked output), when READER_DESKTOP_EXE names its Reader.exe: the same code,
// shipped without an asar archive, must still start its server and show the Library.
test("the packaged app starts and shows the Library", async () => {
  test.skip(!process.env.READER_DESKTOP_EXE, "set READER_DESKTOP_EXE to the packaged Reader.exe (npx electron-builder --win --dir)");
  port = String(20000 + Math.floor(Math.random() * 20000));
  app = await electron.launch({
    executablePath: process.env.READER_DESKTOP_EXE,
    args: [],
    env: { ...process.env, READER_DESKTOP_DATA: data, READER_DESKTOP_MODELS: "", READER_DESKTOP_NO_UPDATES: "1", READER_PORT: port },
  });
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible({ timeout: 30_000 });
  expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true);
});
