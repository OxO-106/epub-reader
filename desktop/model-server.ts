// The translation model server inside the desktop app (issue #34): llama.cpp's llama-server, started and stopped by the
// app with the flags the benchmark chose (as scripts/start-translation-server.ps1 does), its state shown by the tray's
// second dot. Processes and the network are passed in, so the supervision can be tested with fakes.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type ModelState =
  /** No model folder chosen, or no runtime or model in it. */
  | "not-set-up"
  | "stopped"
  | "starting"
  | "running"
  /** It stopped by itself, or did not come up in time. `problem` says why. */
  | "failed";

/** What the supervisor needs of a started process. */
export interface ChildLike {
  kill(): void;
  on(event: "exit", listener: (code: number | null) => void): void;
}

export interface ModelServerDeps {
  spawn(command: string, args: string[]): ChildLike;
  /** True when something answers GET <url>/v1/models. */
  answers(url: string): Promise<boolean>;
  wait(ms: number): Promise<void>;
}

export interface ModelFiles {
  /** llama-server(.exe). */
  runtime: string;
  /** The .gguf model file. */
  model: string;
}

/** The model the benchmark chose; another .gguf in the folder is used when this one is not there. */
export const preferredModel = "Hy-MT2-7B-Q4_K_M.gguf";

const exe = process.platform === "win32" ? "llama-server.exe" : "llama-server";

/**
 * The model file in the model folder: `preferredModel`, or else the largest .gguf (so any GGUF model the reader puts
 * there is used). Null when there is none worth the name (an unfinished download is a .part, never a .gguf).
 */
export function findModelFile(folder: string | null): string | null {
  if (!folder || !existsSync(folder)) return null;
  const models = readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".gguf"))
    .map((e) => join(folder, e.name));
  const model = models.find((path) => path.endsWith(preferredModel)) ?? models.sort((a, b) => statSync(b).size - statSync(a).size)[0];
  return model && statSync(model).size >= 1024 * 1024 ? model : null;
}

/**
 * llama-server: in the model folder itself or one level down (the unpacked llama.cpp zip, e.g. `llama-vulkan/`), else in
 * one of `runtimeDirs` (the copy the installer ships).
 */
export function findRuntime(folder: string | null, runtimeDirs: readonly string[] = []): string | null {
  const candidates: string[] = [];
  if (folder && existsSync(folder)) {
    candidates.push(join(folder, exe), ...readdirSync(folder, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(folder, e.name, exe)));
  }
  candidates.push(...runtimeDirs.map((dir) => join(dir, exe)));
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** llama-server and a model file, when both are there. */
export function findModelFiles(folder: string | null, runtimeDirs: readonly string[] = []): ModelFiles | null {
  return findFiles(folder, runtimeDirs);
}

function findFiles(folder: string | null, runtimeDirs: readonly string[]): ModelFiles | null {
  const model = findModelFile(folder);
  const runtime = model ? findRuntime(folder, runtimeDirs) : null;
  return runtime && model ? { runtime, model } : null;
}

/** The arguments llama-server gets: the benchmark's settings, listening on this PC only. */
export function modelServerArgs(files: ModelFiles, port: number): string[] {
  return ["-m", files.model, "-ngl", "99", "-c", "4096", "-np", "1", "--host", "127.0.0.1", "--port", String(port), "--jinja"];
}

export interface ModelServer {
  state(): ModelState;
  /** Why it failed, for the tray's tooltip and Settings. */
  problem(): string | null;
  /** The address the Reader server translates through while running. */
  readonly url: string;
  /** Uses another model folder (stopping a running server first). */
  setFolder(folder: string | null): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  onState(listener: (state: ModelState) => void): () => void;
}

export function createModelServer(options: {
  folder: string | null;
  /** Where else llama-server may be (the installer's copy). */
  runtimeDirs?: readonly string[];
  port?: number;
  startTimeoutMs?: number;
  pollMs?: number;
  deps: ModelServerDeps;
}): ModelServer {
  const { deps, runtimeDirs = [], port = 8080, startTimeoutMs = 180_000, pollMs = 500 } = options;
  const findModelFiles = (dir: string | null) => findFiles(dir, runtimeDirs);
  const url = `http://127.0.0.1:${port}`;
  let folder = options.folder;
  let files = findModelFiles(folder);
  let state: ModelState = files ? "stopped" : "not-set-up";
  let problem: string | null = null;
  let child: ChildLike | null = null;
  let run = 0; // a newer start or a stop makes an older start give up
  const listeners = new Set<(state: ModelState) => void>();

  const set = (next: ModelState, why: string | null = null) => {
    problem = why;
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener(next);
  };

  async function start() {
    files = findModelFiles(folder);
    if (!files) return set("not-set-up");
    if (state === "starting" || state === "running") return;
    const mine = ++run;
    if (await deps.answers(url)) {
      // Something already serves that port (a model server started by hand): use it, but it is not ours to stop.
      return set("running");
    }
    set("starting");
    const started = deps.spawn(files.runtime, modelServerArgs(files, port));
    child = started;
    started.on("exit", (code) => {
      if (child !== started) return;
      child = null;
      if (mine === run) set(code === 0 ? "stopped" : "failed", code === 0 ? null : `The model server stopped (exit code ${code}). See its log.`);
    });
    const deadline = Date.now() + startTimeoutMs;
    while (mine === run && child === started && Date.now() < deadline) {
      if (await deps.answers(url)) {
        if (mine === run && child === started) set("running");
        return;
      }
      await deps.wait(pollMs);
    }
    if (mine === run && child === started) {
      started.kill();
      child = null;
      set("failed", "The model server did not answer within three minutes. Is the model too large for this PC?");
    }
  }

  async function stop() {
    run++;
    const running = child;
    child = null;
    running?.kill();
    set(findModelFiles(folder) ? "stopped" : "not-set-up");
  }

  return {
    state: () => state,
    problem: () => problem,
    url,
    async setFolder(next) {
      await stop();
      folder = next;
      files = findModelFiles(folder);
      set(files ? "stopped" : "not-set-up");
    },
    start,
    stop,
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
