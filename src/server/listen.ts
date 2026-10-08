import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces as osNetworkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { serve } from "@hono/node-server";

/** What os.networkInterfaces() returns. Injectable so tests can pretend to be on a Tailscale network. */
export type NetworkInterfaces = () => NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface AddressChoice {
  /** The base address. Localhost only unless explicitly changed. */
  host?: string;
  /** Also listen on this machine's Tailscale address. */
  tailscale?: boolean;
  networkInterfaces?: NetworkInterfaces;
}

/** Thrown when the requested addresses cannot be chosen or bound. The message says what to do. */
export class ListenError extends Error {
  override name = "ListenError";
}

/** Tailscale hands out IPv4 addresses from the shared address space 100.64.0.0/10 (100.64.0.0 to 100.127.255.255). */
function isTailscaleAddress(address: string): boolean {
  const octets = address.split(".").map(Number);
  return octets.length === 4 && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
}

/**
 * Chooses the addresses the server listens on: the base address (`host`, default 127.0.0.1) and, when asked,
 * this machine's Tailscale address. If Tailscale is asked for but there is no such address, this throws; it
 * never falls back to listening on every address.
 */
export function selectListenAddresses({
  host = "127.0.0.1",
  tailscale = false,
  networkInterfaces = osNetworkInterfaces,
}: AddressChoice = {}): string[] {
  const addresses = [host];
  if (tailscale) {
    const found = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      // `family` is the string "IPv4" in current Node, and the number 4 in a few older releases.
      .find((entry) => String(entry.family).replace("IPv", "") === "4" && isTailscaleAddress(entry.address));
    if (!found) {
      throw new ListenError(
        "READER_TAILSCALE is set, but no Tailscale address (100.64.0.0/10) was found on this PC. " +
          "Check that Tailscale is running and connected, or unset READER_TAILSCALE to listen on this PC only.",
      );
    }
    addresses.push(found.address);
  }
  return [...new Set(addresses)];
}

export interface Listener {
  /** The port every address is listening on (the one that was asked for, or the free one picked for 0). */
  port: number;
  close(): Promise<void>;
}

type Fetch = (request: Request) => Response | Promise<Response>;

/**
 * Serves one app on every given address, all on the same port. One listener per address: that is the only way to
 * serve exactly these addresses and nothing else. If any address cannot be bound, the ones already bound are closed
 * and this throws, so the server never runs on a surprising subset.
 */
export async function listenOnAddresses(
  fetch: Fetch,
  { addresses, port }: { addresses: string[]; port: number },
): Promise<Listener> {
  const servers: Server[] = [];
  const closeAll = () =>
    Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    ).then(() => {});

  for (const address of addresses) {
    // `port` 0 means "any free port": the first address picks one and the others join it.
    const wanted = servers.length === 0 ? port : (servers[0]!.address() as AddressInfo).port;
    try {
      servers.push(await listenOne(fetch, address, wanted));
    } catch (error) {
      await closeAll();
      const where = `${address.includes(":") ? `[${address}]` : address}:${wanted}`;
      throw new ListenError(`Cannot listen on ${where}: ${(error as Error).message}`);
    }
  }
  return { port: (servers[0]!.address() as AddressInfo).port, close: closeAll };
}

function listenOne(fetch: Fetch, hostname: string, port: number): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    // Plain HTTP/1.1, so the returned server is a node:http Server.
    const server = serve({ fetch, hostname, port }, () => {
      server.off("error", reject);
      resolve(server);
    }) as Server;
    server.once("error", reject);
  });
}
