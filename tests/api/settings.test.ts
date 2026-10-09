// Settings (issue #19): saved in the data folder, read back with environment and app options winning, translation
// settings applied at once, secrets never sent back, and writes only from Reader itself.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { startServer, type RunningServer, type ServerOptions } from "../../src/server/server.ts";
import { SettingsError, specs } from "../../src/server/settings.ts";
import { deadModelUrl, startModelStandIn, type ModelStandIn } from "../helpers/model-stand-in.ts";
import { translate } from "./helpers.ts";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

interface Setup {
  server: RunningServer;
  root: string;
  dataDir: string;
}

/** A server on throwaway folders that reads no environment of the developer's shell unless `env` gives one. */
async function setup(options: ServerOptions = {}, root?: string): Promise<Setup> {
  root ??= await mkdtemp(join(tmpdir(), "reader-settings-"));
  const dataDir = join(root, "data");
  const server = await startServer({ dataDir, libraryDir: join(root, "library"), fontsDir: join(root, "fonts"), port: 0, env: {}, ...options });
  const dir = root;
  cleanups.push(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { server, root, dataDir };
}

async function stand(): Promise<ModelStandIn> {
  const model = await startModelStandIn();
  cleanups.push(() => model.close());
  return model;
}

const view = async (server: RunningServer) => (await fetch(`${server.url}/api/settings`)).json();

const put = (server: RunningServer, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${server.url}/api/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** A PUT with exactly these headers, Host included (fetch does not let a request choose its Host). */
function rawPut(server: RunningServer, body: unknown, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const target = new URL(`${server.url}/api/settings`);
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: target.hostname, port: target.port, path: target.pathname, method: "PUT", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

const post = (server: RunningServer, path: string, body: unknown) =>
  fetch(`${server.url}/api/settings${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("reading the settings", () => {
  it("lists every setting with its value, where it comes from, and whether a change needs a restart", async () => {
    const { server, dataDir } = await setup();

    const settings = await view(server);

    expect(settings.settings.translateUrl).toEqual({ value: null, source: "default", fixed: false, restart: false, pending: false });
    expect(settings.settings.translateConcurrency).toMatchObject({ value: 1, source: "default", restart: false });
    expect(settings.settings.host).toMatchObject({ value: "127.0.0.1", source: "default", restart: true, pending: false });
    expect(settings.settings.tailscale).toMatchObject({ value: false, restart: true });
    expect(settings.settings.translateApiKey).toEqual({ value: null, source: "default", fixed: false, restart: false, pending: false, set: false });
    expect(settings.restartNeeded).toBe(false);
    expect(settings.canRestart).toBe(false);
    expect(settings.about.dataDir).toBe(dataDir);
    expect(settings.about.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("marks a setting given by an environment variable or by the app as fixed", async () => {
    const { server } = await setup({ env: { READER_TRANSLATE_MODEL: "from-env" }, libraryDir: undefined, port: 0 });

    const settings = await view(server);

    expect(settings.settings.translateModel).toMatchObject({ value: "from-env", source: "environment", fixed: true });
    expect(settings.settings.port).toMatchObject({ source: "app", fixed: true });
  });
});

describe("changing the settings", () => {
  it("saves a change to settings.json in the data folder and reports it as saved", async () => {
    const { server, dataDir } = await setup();

    const response = await put(server, { translateModel: "hy-mt", translateConcurrency: "2" });

    expect(response.status).toBe(200);
    const settings = await response.json();
    expect(settings.settings.translateModel).toMatchObject({ value: "hy-mt", source: "saved" });
    expect(settings.settings.translateConcurrency).toMatchObject({ value: 2, source: "saved" });
    expect(JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8")).values).toEqual({ translateModel: "hy-mt", translateConcurrency: 2 });
  });

  it("uses saved settings when the server starts again", async () => {
    const first = await setup();
    await put(first.server, { translateModel: "kept", host: "127.0.0.1" });
    await first.server.close();

    const again = await setup({}, first.root);

    expect((await view(again.server)).settings.translateModel).toMatchObject({ value: "kept", source: "saved" });
  });

  it("lets an environment variable win over a saved value, and refuses to change a fixed setting", async () => {
    const first = await setup();
    await put(first.server, { translateModel: "saved" });
    await first.server.close();
    const { server } = await setup({ env: { READER_TRANSLATE_MODEL: "env" } }, first.root);

    expect((await view(server)).settings.translateModel).toMatchObject({ value: "env", source: "environment" });
    const refused = await put(server, { translateModel: "other" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: { code: "fixed", key: "translateModel", message: expect.stringContaining("READER_TRANSLATE_MODEL") } });
  });

  it("clears a saved value with null, falling back to the default", async () => {
    const { server } = await setup();
    await put(server, { translateModel: "x" });

    const settings = await (await put(server, { translateModel: null })).json();

    expect(settings.settings.translateModel).toMatchObject({ value: null, source: "default" });
  });

  it("refuses unusable values with a message for the field at fault, and saves nothing of that request", async () => {
    const { server, dataDir } = await setup();
    const cases: Array<[Record<string, unknown>, string, RegExp]> = [
      [{ translateUrl: "not an address" }, "translateUrl", /not a web address/],
      [{ translateUrl: "ftp://host" }, "translateUrl", /http:\/\/ or https:\/\//],
      [{ translateUrl: "http://user:secret@host:8080" }, "translateUrl", /user name or password/],
      [{ translateConcurrency: "0" }, "translateConcurrency", /whole number of 1 or more/],
      [{ translateConcurrency: 40 }, "translateConcurrency", /At most 16/],
      [{ host: "example.com" }, "host", /IP address/],
      [{ tailscale: "yes" }, "tailscale", /on or off/],
      [{ translateModel: "ok", translateConcurrency: "many" }, "translateConcurrency", /whole number/],
    ];
    for (const [body, key, message] of cases) {
      const response = await put(server, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      const { error } = await response.json();
      expect(error.key).toBe(key);
      expect(error.message).toMatch(message);
      expect(error.message).not.toContain("secret");
    }
    await expect(readFile(join(dataDir, "settings.json"), "utf8")).rejects.toThrow();
  });

  it("refuses a setting that does not exist", async () => {
    const { server } = await setup();
    const response = await put(server, { colour: "red" });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatchObject({ code: "unknown", key: "colour" });
  });

  it("normalises the model server's address as the environment variable does", async () => {
    const { server } = await setup();
    const settings = await (await put(server, { translateUrl: " http://127.0.0.1:8080/v1/ " })).json();
    expect(settings.settings.translateUrl.value).toBe("http://127.0.0.1:8080");
  });

  it("never sends the API key back, only whether one is set", async () => {
    const { server } = await setup();

    const settings = await (await put(server, { translateApiKey: "sk-very-secret" })).json();

    expect(JSON.stringify(settings)).not.toContain("sk-very-secret");
    expect(settings.settings.translateApiKey).toMatchObject({ value: null, set: true, source: "saved" });
    expect(JSON.stringify(await view(server))).not.toContain("sk-very-secret");
  });

  it("reports a saved network setting as waiting for a restart", async () => {
    const { server } = await setup();

    const settings = await (await put(server, { tailscale: true })).json();

    expect(settings.settings.tailscale).toMatchObject({ value: true, pending: true });
    expect(settings.restartNeeded).toBe(true);
  });

  it("ignores a hand-edited settings file's unusable values and keeps the rest", async () => {
    const root = await mkdtemp(join(tmpdir(), "reader-settings-"));
    const dataDir = join(root, "data");
    await import("node:fs/promises").then((fs) => fs.mkdir(dataDir, { recursive: true }));
    await writeFile(join(dataDir, "settings.json"), JSON.stringify({ values: { translateModel: "good", port: "nonsense" } }));

    const { server } = await setup({}, root);

    const settings = await view(server);
    expect(settings.settings.translateModel).toMatchObject({ value: "good", source: "saved" });
    expect(settings.settings.port.source).toBe("app"); // the test fixes the port; the bad saved value is simply dropped
  });
});

describe("translation settings apply at once", () => {
  it("sends the next translation to the newly saved model server, without a restart", async () => {
    const model = await stand();
    model.setReply({ chunks: ["新的服务器。"] });
    const { server } = await setup();
    expect((await translate(server, { text: "Hello." })).status).toBe(503); // not set up yet

    await put(server, { translateUrl: model.url, translateModel: "chosen", translateApiKey: "sk-key" });

    const response = await translate(server, { text: "Hello." });
    expect(response.text).toBe("新的服务器。");
    const request = model.chatRequests()[0]!;
    expect(request.chat?.model).toBe("chosen");
    expect(request.headers.authorization).toBe("Bearer sk-key");
    const status = await (await fetch(`${server.url}/api/translate/status`)).json();
    expect(status).toMatchObject({ configured: true, reachable: true });
  });

  it("turns translation off again when the address is cleared", async () => {
    const model = await stand();
    const { server } = await setup();
    await put(server, { translateUrl: model.url });

    await put(server, { translateUrl: null });

    expect((await translate(server, { text: "Hello." })).status).toBe(503);
  });
});

describe("testing a model server before saving it", () => {
  it("says whether a candidate address answers, without saving it", async () => {
    const model = await stand();
    const { server } = await setup();

    const good = await (await post(server, "/test-translation", { url: model.url })).json();
    const dead = await (await post(server, "/test-translation", { url: await deadModelUrl() })).json();

    expect(good.reachable).toBe(true);
    expect(dead.reachable).toBe(false);
    expect((await view(server)).settings.translateUrl.value).toBeNull();
  });

  it("uses the saved key when none is typed, so it need not be entered again", async () => {
    const model = await stand();
    const { server } = await setup();
    await put(server, { translateApiKey: "sk-saved" });

    await post(server, "/test-translation", { url: model.url });

    expect(model.requests.at(-1)!.headers.authorization).toBe("Bearer sk-saved");
  });

  it("refuses an unusable address with the same message as saving would", async () => {
    const { server } = await setup();
    const response = await post(server, "/test-translation", { url: "http://u:p@host" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ key: "translateUrl", message: expect.stringMatching(/user name or password/) });
  });
});

describe("only Reader itself can change settings", () => {
  it("refuses a request from another site, or addressed to Reader by another site's name", async () => {
    const { server } = await setup();
    const port = new URL(server.url).port;

    const crossSite = await rawPut(server, { translateModel: "x" }, { host: `127.0.0.1:${port}`, origin: "https://evil.example" });
    // DNS rebinding: the evil site's name now points at this PC, so its Origin matches the Host it sends.
    const rebound = await rawPut(server, { translateModel: "x" }, { host: `evil.example:${port}`, origin: `http://evil.example:${port}` });

    for (const response of [crossSite, rebound]) {
      expect(response.status).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe("forbidden-origin");
    }
    expect((await view(server)).settings.translateModel.value).toBeNull();
  });

  it("accepts Reader's own page, addressed by IP, localhost or a Tailscale name", async () => {
    const { server } = await setup();
    const port = new URL(server.url).port;
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `reader-pc.tail1234.ts.net:${port}`, `[::1]:${port}`]) {
      const response = await rawPut(server, { translateModel: "x" }, { host, origin: `http://${host}` });
      expect(response.status, host).toBe(200);
    }
    // And a program on the PC, which sends no Origin.
    expect((await rawPut(server, { translateModel: "x" }, { host: `127.0.0.1:${port}` })).status).toBe(200);
  });

  it("refuses a body that is not JSON, or too large", async () => {
    const { server } = await setup();
    const notJson = await fetch(`${server.url}/api/settings`, { method: "PUT", headers: { "content-type": "text/plain" }, body: "{}" });
    const huge = await put(server, { translateModel: "x".repeat(20_000) });
    const broken = await put(server, "{not json");
    expect(notJson.status).toBe(415);
    expect(huge.status).toBe(413);
    expect(broken.status).toBe(400);
  });
});

describe("restarting from the screen", () => {
  it("is refused when the host cannot restart, and asks the host when it can", async () => {
    const plain = await setup();
    const refused = await post(plain.server, "/restart", {});
    expect(refused.status).toBe(409);

    let asked = 0;
    const hosted = await setup({ restart: () => asked++ });
    expect((await view(hosted.server)).canRestart).toBe(true);
    expect((await post(hosted.server, "/restart", {})).status).toBe(202);
    expect(asked).toBe(1);
  });
});

describe("the rules for each setting", () => {
  it("accepts a port from 1 to 65535 and refuses anything else", () => {
    expect(specs.port.parse("8080")).toBe(8080);
    expect(specs.port.parse("")).toBeUndefined();
    for (const bad of ["0", "70000", "8.5", "x"]) expect(() => specs.port.parse(bad), bad).toThrow(SettingsError);
  });

  it("accepts an IP address of this PC or localhost as the address to listen on", () => {
    for (const good of ["127.0.0.1", "192.168.1.20", "0.0.0.0", "::1", "localhost"]) expect(specs.host.parse(good)).toBe(good);
    for (const bad of ["300.1.1.1", "example.com", "1.2.3"]) expect(() => specs.host.parse(bad), bad).toThrow(SettingsError);
  });

  it("refuses a library folder that is really a file, and accepts one that does not exist yet", async () => {
    const root = await mkdtemp(join(tmpdir(), "reader-settings-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, "a-file.txt"), "x");
    expect(() => specs.libraryDir.parse(join(root, "a-file.txt"))).toThrow(/a file, not a folder/);
    expect(specs.libraryDir.parse(join(root, "Books"))).toBe(join(root, "Books"));
  });

  it("needs the library folder as a full path", () => {
    expect(() => specs.libraryDir.parse("relative/folder")).toThrow(/full path/);
    expect(specs.libraryDir.parse(process.platform === "win32" ? "D:\\Books" : "/home/me/Books")).toBeTruthy();
  });
});
