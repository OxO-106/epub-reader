import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/server/config.ts";
import { listenOnAddresses } from "../../src/server/listen.ts";
import { startServer } from "../../src/server/server.ts";
import { startTestServer, type TestServer } from "./helpers.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  while (cleanups.length) await cleanups.pop()!();
});

const fakeInterfaces = (address: string) => () => ({
  Tailscale: [{ address, family: "IPv4", internal: false } as NetworkInterfaceInfo],
});

/** The first address of this PC that is not loopback, if it has one (a LAN address, a VPN, Tailscale...). */
const nonLoopbackAddress = Object.values(networkInterfaces())
  .flatMap((entries) => entries ?? [])
  .find((entry) => entry.family === "IPv4" && !entry.internal)?.address;

/** Whether `address` can be bound on this PC (127.0.0.2 is a second loopback address everywhere but macOS). */
async function canBind(address: string): Promise<boolean> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(0, address, () => probe.close(() => resolve(true)));
  });
}

describe("who can connect", () => {
  it.skipIf(!nonLoopbackAddress)("refuses connections to this PC's other addresses by default", async () => {
    const server: TestServer = await startTestServer();
    cleanups.push(() => server.dispose());
    const port = new URL(server.url).port;

    expect((await fetch(`${server.url}/api/books`)).status).toBe(200);
    await expect(fetch(`http://${nonLoopbackAddress}:${port}/api/books`)).rejects.toThrow();
  });

  // Only on a PC where Tailscale is really installed and connected.
  const tailscaleAddress = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .find((entry) => entry.family === "IPv4" && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(entry.address))?.address;

  it.skipIf(!tailscaleAddress)("also answers on this PC's real Tailscale address when asked", async () => {
    const server = await startTestServer({ tailscale: true });
    cleanups.push(() => server.dispose());
    const port = new URL(server.url).port;

    expect(server.addresses).toEqual(["127.0.0.1", tailscaleAddress]);
    expect((await fetch(`http://${tailscaleAddress}:${port}/api/books`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/books`)).status).toBe(200);
  });

  it("asks nothing of the client on a permitted address: no login", async () => {
    const server = await startTestServer();
    cleanups.push(() => server.dispose());

    const response = await fetch(`${server.url}/api/books`);

    expect(response.status).toBe(200);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("reads the Tailscale option from READER_TAILSCALE, off unless set to 1 or true", () => {
    expect(resolveConfig({}, {}).tailscale).toBe(false);
    expect(resolveConfig({}, { READER_TAILSCALE: "0" }).tailscale).toBe(false);
    expect(resolveConfig({}, { READER_TAILSCALE: "" }).tailscale).toBe(false);
    expect(resolveConfig({}, { READER_TAILSCALE: "1" }).tailscale).toBe(true);
    expect(resolveConfig({}, { READER_TAILSCALE: "true" }).tailscale).toBe(true);
  });

  it("does not start, and says why, when Tailscale is requested but this PC has no Tailscale address", async () => {
    vi.stubEnv("READER_TAILSCALE", "1");

    await expect(
      startServer({ port: 0, dataDir: "unused", libraryDir: "unused", networkInterfaces: () => ({}) }),
    ).rejects.toThrow(/READER_TAILSCALE.*no Tailscale address/s);
  });

  it("does not start with a half-working setup when the Tailscale address cannot be used", async () => {
    // 100.64.0.1 is a valid Tailscale-range address, but this PC does not own it, so binding it fails.
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(join(tmpdir(), "reader-ts-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    await expect(
      startServer({
        dataDir: join(root, "data"),
        libraryDir: join(root, "library"),
        port: 0,
        tailscale: true,
        networkInterfaces: fakeInterfaces("100.64.0.1"),
      }),
    ).rejects.toThrow(/Cannot listen on 100\.64\.0\.1/);
  });
});

describe("listening on two addresses", () => {
  it("serves one app on both addresses and the same port, and stops listening on both", async () => {
    if (!(await canBind("127.0.0.2"))) return;
    const listener = await listenOnAddresses((request) => new Response(`hello ${new URL(request.url).host}`), {
      addresses: ["127.0.0.1", "127.0.0.2"],
      port: 0,
    });

    const first = await (await fetch(`http://127.0.0.1:${listener.port}/`)).text();
    const second = await (await fetch(`http://127.0.0.2:${listener.port}/`)).text();
    await listener.close();

    expect(first).toBe(`hello 127.0.0.1:${listener.port}`);
    expect(second).toBe(`hello 127.0.0.2:${listener.port}`);
    await expect(fetch(`http://127.0.0.1:${listener.port}/`)).rejects.toThrow();
    await expect(fetch(`http://127.0.0.2:${listener.port}/`)).rejects.toThrow();
  });

  it("leaves nothing listening when one of the addresses cannot be bound", async () => {
    const probe = await listenOnAddresses(() => new Response("probe"), { addresses: ["127.0.0.1"], port: 0 });
    const takenPort = probe.port;
    cleanups.push(() => probe.close());

    // The port is taken on 127.0.0.1, so the whole call fails and says which address and port.
    await expect(
      listenOnAddresses(() => new Response("never"), { addresses: ["127.0.0.1"], port: takenPort }),
    ).rejects.toThrow(new RegExp(`Cannot listen on 127\\.0\\.0\\.1:${takenPort}`));
  });
});
