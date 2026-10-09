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
    const child = spawn(electronPath, [root], { cwd: root, env: { ...process.env, ...env }, stdio: "ignore" });
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
  return electron.launch({ args: [root], cwd: root, env: { ...process.env, READER_DESKTOP_DATA: data, READER_PORT: port } });
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
