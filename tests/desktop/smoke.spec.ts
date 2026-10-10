// The desktop app (issue #33): it starts the Reader server, opens a window on the Library, adds and opens a Book, keeps
// to one copy, sends links to other sites to the system's browser, and quitting leaves no server behind. Everything it
// writes goes into a temporary folder (READER_DESKTOP_DATA).
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
  // The app is called Verso (issue #39), in the window as in the taskbar.
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())).toBe("Verso");
  expect(await app.evaluate(({ app }) => app.getName())).toBe("Verso");

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

test("adds a PDF with its title and a cover drawn from its first page", async () => {
  // The server runs in a utility process, where pdf.js does not take Electron for Node unless told (server-process.ts).
  app = await launch();
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible({ timeout: 30_000 });

  await page.locator("input[type=file]").setInputFiles(fixture("sample.pdf"));
  await expect(page.getByRole("link", { name: /Lamplight Papers/ })).toBeVisible();
  const { books } = (await (await fetch(new URL("/api/books", page.url()))).json()) as { books: { id: string }[] };
  const cover = await fetch(new URL(`/api/books/${books[0]!.id}/cover`, page.url()));
  expect(cover.status).toBe(200);
  expect(cover.headers.get("content-type")).toBe("image/jpeg");
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
    expect(await readFile(join(data, "logs/reader.log"), "utf8")).toMatch(new RegExp(`Verso could not start: Port ${taken} is already in use`));
  } finally {
    blocker.close();
  }
});

test("shows Verso and translation in the tray, and can keep running there when the window is closed", async () => {
  app = await launch();
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible({ timeout: 30_000 });
  const tray = () => app!.evaluate(() => (globalThis as unknown as { __readerShell: { tray(): { tooltip: string; present: boolean } } }).__readerShell.tray());
  await expect.poll(tray).toEqual({ tooltip: "Verso: running\nTranslation: not set up", present: true });

  await page.goto(new URL("/#/settings", page.url()).href);
  const desktop = page.getByRole("region", { name: "Desktop app" });
  await expect(desktop).toContainText("No model yet.");
  // The model is downloaded only into a folder the reader chose.
  await expect(desktop.getByRole("button", { name: "Download the model" })).toBeDisabled();
  await desktop.getByRole("checkbox", { name: "Keep Verso running in the tray when the window is closed" }).check();
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

// The packaged app (electron-builder's unpacked output), when READER_DESKTOP_EXE names its Verso.exe: the same code,
// shipped without an asar archive, must still start its server and show the Library.
test("the packaged app starts and shows the Library", async () => {
  test.skip(!process.env.READER_DESKTOP_EXE, "set READER_DESKTOP_EXE to the packaged Verso.exe (npx electron-builder --win --dir)");
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

test("Settings shows the model in use and deletes it, after asking", async () => {
  const models = join(data, "models");
  await import("node:fs/promises").then(async (fs) => {
    await fs.mkdir(models, { recursive: true });
    await fs.writeFile(join(models, "Hy-MT2-7B-Q4_K_M.gguf"), Buffer.alloc(2 * 1024 * 1024));
    // Not started with the app: the stand-in model file would not load in a real llama-server.
    await fs.writeFile(join(data, "desktop.json"), JSON.stringify({ startTranslation: false, modelOffered: true }));
  });
  port = String(20000 + Math.floor(Math.random() * 20000));
  app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, READER_DESKTOP_DATA: data, READER_DESKTOP_MODELS: models, READER_PORT: port } });
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible({ timeout: 30_000 });
  await page.goto(new URL("/#/settings", page.url()).href);
  const desktop = page.getByRole("region", { name: "Desktop app" });
  await expect(desktop).toContainText("Hy-MT2-7B-Q4_K_M.gguf");

  // The app asks before deleting; here the answer is Delete.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  await desktop.getByRole("button", { name: "Delete the model…" }).click();

  await expect(desktop).toContainText("No model yet.");
  await expect(desktop.getByRole("button", { name: "Delete the model…" })).toHaveCount(0);
  await expect(desktop.getByRole("button", { name: "Download the model" })).toBeEnabled();
  expect(existsSync(join(models, "Hy-MT2-7B-Q4_K_M.gguf"))).toBe(false);
});

test("the first start offers the translation model once, naming the folder it would go to", async () => {
  const models = join(data, "translation-model");
  port = String(20000 + Math.floor(Math.random() * 20000));
  app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, READER_DESKTOP_DATA: data, READER_DESKTOP_MODELS: models, READER_PORT: port } });
  // Answer "Not now", and keep what was asked.
  await app.evaluate(({ dialog }) => {
    const asked: unknown[] = ((globalThis as { __asked?: unknown[] }).__asked = []);
    dialog.showMessageBox = (async (...args: unknown[]) => {
      asked.push(args.at(-1));
      return { response: 2, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Your Library is empty" })).toBeVisible({ timeout: 30_000 });

  await expect.poll(() => app!.evaluate(() => ((globalThis as { __asked?: Array<{ message: string; detail: string }> }).__asked ?? []).length)).toBe(1);
  const [question] = await app.evaluate(() => (globalThis as unknown as { __asked: Array<{ message: string; detail: string; buttons: string[] }> }).__asked);
  expect(question!.message).toBe("Download the translation model?");
  expect(question!.detail).toContain(models);
  expect(question!.buttons).toEqual(["Download", "Choose another folder…", "Not now"]);
  expect(JSON.parse(await readFile(join(data, "desktop.json"), "utf8")).modelOffered).toBe(true);
});

test("a download stopped by closing the app shows as paused, with Resume, when it starts again", async () => {
  const models = join(data, "translation-model");
  await import("node:fs/promises").then(async (fs) => {
    await fs.mkdir(models, { recursive: true });
    await fs.writeFile(join(models, "Hy-MT2-7B-Q4_K_M.gguf.part"), Buffer.alloc(3 * 1024 * 1024));
    await fs.writeFile(join(data, "desktop.json"), JSON.stringify({ modelOffered: true }));
  });
  port = String(20000 + Math.floor(Math.random() * 20000));
  app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, READER_DESKTOP_DATA: data, READER_DESKTOP_MODELS: models, READER_PORT: port } });
  const page = await app.firstWindow();

  const card = page.getByRole("region", { name: "Translation model download" });
  await expect(card).toContainText("Translation model download paused", { timeout: 30_000 });
  await expect(card.getByRole("status")).toContainText("3.0 MB of 4.3 GB");
  await expect(card.getByRole("button", { name: "Resume" })).toBeVisible();
});
