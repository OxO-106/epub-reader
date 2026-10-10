// The translation model server in the desktop app (desktop/model-server.ts): found in the model folder, started with
// the benchmark's flags, its state followed from starting to running, stopped, failed; with fake processes.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModelServer, findModelFile, findModelFiles, findRuntime, modelServerArgs, type ChildLike, type ModelState } from "../../desktop/model-server.ts";
import { trayLook } from "../../desktop/shell-rules.ts";
import { applyDesktopChange, defaultDesktopSettings, parseDesktopSettings } from "../../desktop/desktop-settings.ts";

const exe = process.platform === "win32" ? "llama-server.exe" : "llama-server";
const folders: string[] = [];
afterEach(async () => {
  while (folders.length) await rm(folders.pop()!, { recursive: true, force: true });
});

/** A model folder like the unpacked llama.cpp zip plus the model file. */
async function modelFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "reader-models-"));
  folders.push(folder);
  await mkdir(join(folder, "llama-vulkan"));
  await writeFile(join(folder, "llama-vulkan", exe), "");
  await writeFile(join(folder, "Hy-MT2-7B-Q4_K_M.gguf"), Buffer.alloc(2 * 1024 * 1024));
  return folder;
}

class FakeChild implements ChildLike {
  killed = false;
  private exits: Array<(code: number | null) => void> = [];
  kill() {
    this.killed = true;
  }
  on(_event: "exit", listener: (code: number | null) => void) {
    this.exits.push(listener);
  }
  exit(code: number | null) {
    for (const listener of this.exits) listener(code);
  }
}

function fakes() {
  const children: Array<{ command: string; args: string[]; child: FakeChild }> = [];
  let up = false;
  return {
    children,
    setUp: (value: boolean) => (up = value),
    deps: {
      spawn(command: string, args: string[]) {
        const child = new FakeChild();
        children.push({ command, args, child });
        return child;
      },
      answers: async () => up,
      wait: () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
    },
  };
}

describe("finding the model files", () => {
  it("finds llama-server one folder down and the preferred model", async () => {
    const folder = await modelFolder();
    expect(findModelFiles(folder)).toEqual({ runtime: join(folder, "llama-vulkan", exe), model: join(folder, "Hy-MT2-7B-Q4_K_M.gguf") });
  });

  it("finds nothing without a runtime, without a model, or with a model that is almost empty", async () => {
    expect(findModelFiles(null)).toBeNull();
    const folder = await modelFolder();
    await writeFile(join(folder, "Hy-MT2-7B-Q4_K_M.gguf"), "x");
    expect(findModelFiles(folder)).toBeNull();
  });

  it("finds llama-server where the installer put it when the folder has only the model", async () => {
    const folder = await modelFolder();
    const shipped = await mkdtemp(join(tmpdir(), "reader-runtime-"));
    folders.push(shipped);
    await writeFile(join(shipped, exe), "");
    await rm(join(folder, "llama-vulkan"), { recursive: true });

    expect(findModelFiles(folder)).toBeNull();
    expect(findModelFiles(folder, [shipped])).toEqual({ runtime: join(shipped, exe), model: join(folder, "Hy-MT2-7B-Q4_K_M.gguf") });
    expect(findRuntime(null, [shipped])).toBe(join(shipped, exe));
  });

  it("uses any GGUF model put in the folder, the largest when there are several", async () => {
    const folder = await modelFolder();
    await rm(join(folder, "Hy-MT2-7B-Q4_K_M.gguf"));
    await writeFile(join(folder, "small.gguf"), Buffer.alloc(1024 * 1024 + 1));
    await writeFile(join(folder, "large.gguf"), Buffer.alloc(3 * 1024 * 1024));
    await writeFile(join(folder, "unfinished.gguf.part"), Buffer.alloc(9 * 1024 * 1024));
    expect(findModelFile(folder)).toBe(join(folder, "large.gguf"));
  });

  it("starts llama-server with the benchmark's settings, on this PC only", () => {
    expect(modelServerArgs({ runtime: "r", model: "m.gguf" }, 8080)).toEqual(["-m", "m.gguf", "-ngl", "99", "-c", "4096", "-np", "1", "--host", "127.0.0.1", "--port", "8080", "--jinja"]);
  });
});

describe("supervising the model server", () => {
  it("is not set up without the files", () => {
    const { deps } = fakes();
    expect(createModelServer({ folder: null, deps }).state()).toBe("not-set-up");
  });

  it("goes from stopped to starting to running, and stops", async () => {
    const f = fakes();
    const server = createModelServer({ folder: await modelFolder(), deps: f.deps });
    const seen: ModelState[] = [];
    server.onState((state) => seen.push(state));
    expect(server.state()).toBe("stopped");

    const started = server.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.state()).toBe("starting");
    f.setUp(true);
    await started;

    expect(server.state()).toBe("running");
    expect(f.children).toHaveLength(1);
    await server.stop();
    expect(f.children[0]!.child.killed).toBe(true);
    expect(seen).toEqual(["starting", "running", "stopped"]);
  });

  it("fails, saying why, when the process stops by itself", async () => {
    const f = fakes();
    const server = createModelServer({ folder: await modelFolder(), deps: f.deps });
    const started = server.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    f.children[0]!.child.exit(3);
    await started;
    expect(server.state()).toBe("failed");
    expect(server.problem()).toMatch(/exit code 3/);
  });

  it("gives up, and stops the process, when it never answers", async () => {
    const f = fakes();
    const server = createModelServer({ folder: await modelFolder(), deps: f.deps, startTimeoutMs: 30 });
    await server.start();
    expect(server.state()).toBe("failed");
    expect(f.children[0]!.child.killed).toBe(true);
  });

  it("uses a model server that already answers, without starting another", async () => {
    const f = fakes();
    f.setUp(true);
    const server = createModelServer({ folder: await modelFolder(), deps: f.deps });
    await server.start();
    expect(server.state()).toBe("running");
    expect(f.children).toHaveLength(0);
  });
});

describe("the tray and the app's settings", () => {
  it("shows the two states as two coloured dots and says them in the tooltip", () => {
    expect(trayLook("running", "not-set-up")).toEqual({ icon: "tray-green-grey.png", tooltip: "Reader: running\nTranslation: not set up" });
    expect(trayLook("starting", "failed").icon).toBe("tray-amber-red.png");
  });

  it("keeps only sound settings, and changes only known ones", () => {
    expect(parseDesktopSettings({ closeToTray: "yes", modelFolder: 3 })).toEqual(defaultDesktopSettings);
    expect(applyDesktopChange(defaultDesktopSettings, { closeToTray: true, modelFolder: "C:\elsewhere", other: 1 })).toEqual({ ...defaultDesktopSettings, closeToTray: true });
  });
});
