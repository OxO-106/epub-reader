import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { selectListenAddresses } from "../../src/server/listen.ts";

/** A network-interfaces table as os.networkInterfaces() returns it, built from `name -> addresses`. */
function interfaces(table: Record<string, string[]>) {
  return () =>
    Object.fromEntries(
      Object.entries(table).map(([name, addresses]) => [
        name,
        addresses.map(
          (address) =>
            ({
              address,
              family: address.includes(":") ? "IPv6" : "IPv4",
              internal: address === "127.0.0.1",
            }) as NetworkInterfaceInfo,
        ),
      ]),
    );
}

const lanOnly = interfaces({ lo: ["127.0.0.1"], Ethernet: ["192.168.1.20", "fe80::1"] });

describe("choosing the addresses to listen on", () => {
  it("listens on localhost only by default", () => {
    expect(selectListenAddresses({ networkInterfaces: lanOnly })).toEqual(["127.0.0.1"]);
  });

  it("adds the Tailscale address (100.64.0.0/10) when asked", () => {
    const withTailscale = interfaces({ lo: ["127.0.0.1"], Ethernet: ["192.168.1.20"], Tailscale: ["fe80::2", "100.101.102.103"] });

    expect(selectListenAddresses({ tailscale: true, networkInterfaces: withTailscale })).toEqual([
      "127.0.0.1",
      "100.101.102.103",
    ]);
  });

  it.each([
    ["100.64.0.0", true],
    ["100.127.255.255", true],
    ["100.63.255.255", false],
    ["100.128.0.0", false],
    ["10.100.0.1", false],
    ["192.168.100.64", false],
  ])("treats %s as a Tailscale address: %s", (address, isTailscale) => {
    const table = interfaces({ lo: ["127.0.0.1"], other: [address] });
    const select = () => selectListenAddresses({ tailscale: true, networkInterfaces: table });

    if (isTailscale) expect(select()).toEqual(["127.0.0.1", address]);
    else expect(select).toThrow(/Tailscale/);
  });

  it("fails with a clear message, and never widens to every address, when Tailscale is requested but absent", () => {
    expect(() => selectListenAddresses({ tailscale: true, networkInterfaces: lanOnly })).toThrow(
      /READER_TAILSCALE.*no Tailscale address \(100\.64\.0\.0\/10\) was found.*Tailscale is running/s,
    );
  });

  it("ignores an unused Tailscale address when it was not asked for", () => {
    const withTailscale = interfaces({ lo: ["127.0.0.1"], Tailscale: ["100.101.102.103"] });

    expect(selectListenAddresses({ networkInterfaces: withTailscale })).toEqual(["127.0.0.1"]);
  });

  it("uses an explicit host instead of localhost, and the Tailscale address is added to it", () => {
    const withTailscale = interfaces({ lo: ["127.0.0.1"], Tailscale: ["100.101.102.103"] });

    expect(selectListenAddresses({ host: "192.168.1.20", networkInterfaces: withTailscale })).toEqual(["192.168.1.20"]);
    expect(selectListenAddresses({ host: "192.168.1.20", tailscale: true, networkInterfaces: withTailscale })).toEqual([
      "192.168.1.20",
      "100.101.102.103",
    ]);
  });

  it("does not list an address twice", () => {
    const withTailscale = interfaces({ Tailscale: ["100.101.102.103"] });

    expect(selectListenAddresses({ host: "100.101.102.103", tailscale: true, networkInterfaces: withTailscale })).toEqual([
      "100.101.102.103",
    ]);
  });
});
