import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Reaching Reader from a phone (issue #32). An iPhone installs a web app and keeps its files only for a site served over
// HTTPS, so the supported route is Tailscale's own HTTPS: `tailscale serve` gives this PC a certificate for its tailnet
// name (machine.tailnet.ts.net) and forwards https://that-name to Reader on this PC. Reader needs no certificate of its
// own, and keeps listening on 127.0.0.1. Here the server finds that name, so Settings can show it and its QR code.

/** What Settings shows about the phone address. */
export interface PhoneAddress {
  /** Tailscale is installed and running on this PC. */
  tailscale: boolean;
  /** This PC's name on the tailnet (machine.tailnet.ts.net), when Tailscale knows it. */
  dnsName: string | null;
  /** The tailnet can issue HTTPS certificates (HTTPS is switched on in its DNS settings). */
  httpsEnabled: boolean;
  /** https://dnsName, when there is one. */
  address: string | null;
}

/** The part of `tailscale status --json` that is read. */
interface TailscaleStatus {
  BackendState?: string;
  Self?: { DNSName?: string };
  CertDomains?: string[] | null;
}

/** Reads the answer of `tailscale status --json`. Exported for tests. */
export function phoneAddressFrom(status: TailscaleStatus | null): PhoneAddress {
  if (!status || status.BackendState !== "Running") return { tailscale: false, dnsName: null, httpsEnabled: false, address: null };
  const dnsName = status.Self?.DNSName?.replace(/\.$/, "").toLowerCase() || null;
  const httpsEnabled = !!dnsName && (status.CertDomains ?? []).some((domain) => domain.toLowerCase().replace(/\.$/, "") === dnsName);
  return { tailscale: true, dnsName, httpsEnabled, address: dnsName ? `https://${dnsName}` : null };
}

/** Where the Tailscale command line is: on the PATH, or in its usual Windows folder. */
function tailscaleCommand(): string {
  if (process.platform === "win32") {
    const installed = join(process.env.ProgramFiles ?? "C:\\Program Files", "Tailscale", "tailscale.exe");
    if (existsSync(installed)) return installed;
  }
  if (process.platform === "darwin" && existsSync("/Applications/Tailscale.app/Contents/MacOS/Tailscale")) {
    return "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  }
  return "tailscale";
}

/** Asks Tailscale on this PC for its name; never throws (no Tailscale, or it does not answer, means no address). */
export function findPhoneAddress(timeoutMs = 3000): Promise<PhoneAddress> {
  return new Promise((resolve) => {
    execFile(tailscaleCommand(), ["status", "--json"], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(phoneAddressFrom(null));
      try {
        resolve(phoneAddressFrom(JSON.parse(stdout) as TailscaleStatus));
      } catch {
        resolve(phoneAddressFrom(null));
      }
    });
  });
}
