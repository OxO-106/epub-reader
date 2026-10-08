import { request } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeStandInFonts } from "../support/stand-in-font.ts";
import { startTestServer, type TestServer } from "./helpers.ts";

const servers: TestServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.dispose();
});

async function start(options: Parameters<typeof startTestServer>[0] = {}): Promise<TestServer> {
  const server = await startTestServer(options);
  servers.push(server);
  return server;
}

/** A GET with the path exactly as given: fetch would tidy `..` away before the request is sent. */
function rawGet(server: TestServer, path: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the Chinese font is absent", () => {
  it("is reported as absent, and nothing is served under /fonts", async () => {
    const server = await start(); // its fonts folder does not exist

    const info = await fetch(`${server.url}/api/fonts`);
    expect(info.status).toBe(200);
    expect(await info.json()).toEqual({ chineseSerif: null });

    for (const path of ["/fonts/manifest.json", "/fonts/kinghwa-oldsong.css", "/fonts/"]) {
      const response = await fetch(`${server.url}${path}`);
      expect(response.status, path).toBe(404);
    }
  });

  it("is reported as absent while the folder holds no manifest, or a broken one", async () => {
    const server = await start();
    const fonts = server.config.fontsDir;
    await mkdir(fonts, { recursive: true });
    expect(await (await fetch(`${server.url}/api/fonts`)).json()).toEqual({ chineseSerif: null });

    await writeFile(join(fonts, "manifest.json"), "{ not json");
    expect(await (await fetch(`${server.url}/api/fonts`)).json()).toEqual({ chineseSerif: null });

    // A manifest that names a style sheet that is not there, or one outside the folder.
    await writeFile(join(fonts, "manifest.json"), JSON.stringify({ family: "KingHwa Web", css: "missing.css" }));
    expect(await (await fetch(`${server.url}/api/fonts`)).json()).toEqual({ chineseSerif: null });
    await writeFile(join(fonts, "manifest.json"), JSON.stringify({ family: "KingHwa Web", css: "../data/x.css" }));
    expect(await (await fetch(`${server.url}/api/fonts`)).json()).toEqual({ chineseSerif: null });
  });
});

describe("the Chinese font is present", () => {
  it("is reported as present, with the address of its style sheet, as soon as the folder is filled", async () => {
    const server = await start();
    await writeStandInFonts(server.config.fontsDir);

    const info = await (await fetch(`${server.url}/api/fonts`)).json();
    expect(info).toEqual({ chineseSerif: { family: "KingHwa Web", css: "/fonts/kinghwa-oldsong.css" } });
  });

  it("serves the style sheet and the font files with the right types, and the font files cached for good", async () => {
    const server = await start();
    await writeStandInFonts(server.config.fontsDir);

    const css = await fetch(`${server.url}/fonts/kinghwa-oldsong.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(css.headers.get("cache-control")).toBe("no-cache"); // small, and it names the files, so it is always checked
    expect(await css.text()).toContain("@font-face");

    const font = await fetch(`${server.url}/fonts/kinghwa-oldsong-standin.woff2`);
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(font.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const bytes = new Uint8Array(await font.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x77, 0x4f, 0x46, 0x32]); // "wOF2"
    expect(Number(font.headers.get("content-length"))).toBe(bytes.length);
  });

  it("answers 404 for a file that is not there, and for a folder", async () => {
    const server = await start();
    await writeStandInFonts(server.config.fontsDir);
    await mkdir(join(server.config.fontsDir, "sub"));

    expect((await fetch(`${server.url}/fonts/nope.woff2`)).status).toBe(404);
    expect((await fetch(`${server.url}/fonts/sub`)).status).toBe(404);
    expect((await fetch(`${server.url}/fonts/`)).status).toBe(404);
  });

  it("never serves a file from outside the fonts folder", async () => {
    const server = await start();
    await writeStandInFonts(server.config.fontsDir);
    await writeFile(join(server.root, "secret.txt"), "top secret");
    const secretNextToTheFolder = "secret.txt";

    for (const path of [
      `/fonts/../${secretNextToTheFolder}`,
      `/fonts/%2e%2e/${secretNextToTheFolder}`,
      `/fonts/..%2f${secretNextToTheFolder}`,
      `/fonts/%2e%2e%2f${secretNextToTheFolder}`,
      `/fonts/..%5c${secretNextToTheFolder}`,
      `/fonts/..\\${secretNextToTheFolder}`,
      `/fonts/%252e%252e/${secretNextToTheFolder}`,
      `/fonts/kinghwa-oldsong.css%00.txt`,
      `/fonts//../${secretNextToTheFolder}`,
      `/fonts/C:/Windows/win.ini`,
      `/fonts/%5C%5C.%5Cc$%5Cwindows%5Cwin.ini`,
    ]) {
      const response = await rawGet(server, path);
      expect(response.body, path).not.toContain("top secret");
      // Paths that stay under /fonts are refused. The URL parser tidies the first few (a ".." segment, a backslash read
      // as a slash, a doubled slash) into other paths, which the front end answers like any unknown page: for those,
      // what counts is that the secret is not sent.
      if (!/^\/fonts\/(\.\.|%2e%2e|\/)/i.test(path)) expect(response.status, path).toBe(404);
    }
  });

  it("is read-only", async () => {
    const server = await start();
    await writeStandInFonts(server.config.fontsDir);
    const before = await readFile(join(server.config.fontsDir, "kinghwa-oldsong.css"), "utf8");

    for (const method of ["PUT", "POST", "DELETE"]) {
      const response = await fetch(`${server.url}/fonts/kinghwa-oldsong.css`, { method, body: method === "DELETE" ? undefined : "x" });
      expect(response.status, method).toBeGreaterThanOrEqual(400);
    }
    expect(await readFile(join(server.config.fontsDir, "kinghwa-oldsong.css"), "utf8")).toBe(before);
    expect((await fetch(`${server.url}/fonts/new.css`, { method: "PUT", body: "x" })).status).toBeGreaterThanOrEqual(400);
    expect((await fetch(`${server.url}/fonts/new.css`)).status).toBe(404);
  });

  it("keeps the Content-Security-Policy and nosniff on font responses", async () => {
    const server = await start();
    await writeStandInFonts(server.config.fontsDir);

    const response = await fetch(`${server.url}/fonts/kinghwa-oldsong-standin.woff2`);
    expect(response.headers.get("content-security-policy")).toContain("font-src 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
