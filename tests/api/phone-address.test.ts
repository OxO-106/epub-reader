// The phone's address (issue #32): this PC's Tailscale HTTPS name, read from `tailscale status --json`.
import { afterEach, describe, expect, it } from "vitest";
import { phoneAddressFrom } from "../../src/server/phone-address.ts";
import { startTestServer, type TestServer } from "./helpers.ts";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

describe("the phone address", () => {
  it("is this PC's tailnet name over https, with HTTPS certificates switched on", () => {
    expect(
      phoneAddressFrom({ BackendState: "Running", Self: { DNSName: "my-pc.tail1234.ts.net." }, CertDomains: ["my-pc.tail1234.ts.net"] }),
    ).toEqual({ tailscale: true, dnsName: "my-pc.tail1234.ts.net", httpsEnabled: true, address: "https://my-pc.tail1234.ts.net" });
  });

  it("says when the tailnet has no HTTPS certificates yet", () => {
    expect(phoneAddressFrom({ BackendState: "Running", Self: { DNSName: "my-pc.tail1234.ts.net." }, CertDomains: null })).toMatchObject({
      tailscale: true,
      httpsEnabled: false,
      address: "https://my-pc.tail1234.ts.net",
    });
  });

  it("is nothing when Tailscale is not installed, stopped or logged out", () => {
    const none = { tailscale: false, dnsName: null, httpsEnabled: false, address: null };
    expect(phoneAddressFrom(null)).toEqual(none);
    expect(phoneAddressFrom({ BackendState: "Stopped", Self: { DNSName: "x.ts.net." } })).toEqual(none);
    expect(phoneAddressFrom({ BackendState: "NeedsLogin" })).toEqual(none);
  });

  it("is served to the Settings screen", async () => {
    server = await startTestServer();
    const body = await (await fetch(`${server.url}/api/settings/phone`)).json();
    expect(Object.keys(body).sort()).toEqual(["address", "dnsName", "httpsEnabled", "tailscale"]);
  });
});
