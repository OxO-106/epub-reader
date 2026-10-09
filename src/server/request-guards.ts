// Checks shared by the endpoints that change things or start work on behalf of a page: the translate endpoint and the
// settings endpoints. A web page on another site can send a request to this server from the reader's own browser;
// these make sure only Reader's own pages (or programs on the PC, which send no Origin) get through.

/**
 * True when the request came from a page of this app: an `Origin` header (browsers send one on every cross-site POST)
 * names the host the request itself arrived on, over http or https. No `Origin` (curl, tests, other programs) passes.
 */
export function fromOwnOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && host !== undefined && url.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false; // "null" and anything else that is not an address
  }
}

/**
 * True when the `Host` the request was sent to is one Reader is reached by: an IP address, `localhost`, or a Tailscale
 * name (`*.ts.net`). A page on a site whose name has been pointed at this PC (DNS rebinding) arrives with that site's
 * name as its Host and its own Origin, which match each other, so the origin check alone would let it through.
 */
export function addressedDirectly(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.replace(/:\d+$/, "");
  const lower = name.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower.endsWith(".ts.net")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) return true;
  return lower.includes(":") && /^[0-9a-f:.]+$/.test(lower); // an IPv6 literal
}

export const isJson = (contentType: string | undefined) => contentType?.split(";")[0]!.trim().toLowerCase() === "application/json";

/**
 * The request body as text, or undefined when it is larger than `limit` bytes. A declared Content-Length over the limit
 * is refused without reading; otherwise the stream is counted as it arrives and abandoned at the limit, so a chunked
 * body (no Content-Length) or one that lies about its length cannot make the server buffer more.
 */
export async function readLimited(request: Request, limit: number): Promise<string | undefined> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > limit) {
    await request.body?.cancel().catch(() => {});
    return undefined;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return ""; // the connection broke mid-body; the empty body is then answered as malformed
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
