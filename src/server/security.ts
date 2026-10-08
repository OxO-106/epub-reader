import type { MiddlewareHandler } from "hono";

/**
 * Content-Security-Policy for every response. Books are untrusted content: an EPUB may carry
 * scripts, and the Reader shows its pages in iframes that share the app's origin. Only scripts
 * served by the app itself may run, which also covers those iframes (blob: documents inherit this
 * policy). The rest is the narrowest set the Reader needs: foliate-js turns a Book's pages,
 * stylesheets, images and fonts into blob: URLs, and Books use inline styles.
 */
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' blob:",
  "frame-src blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Adds the Content-Security-Policy (and `nosniff`, so Book files are never guessed to be scripts) to every response. */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  // Set on the finished response: handlers that return a raw Response (file streams) bypass `c.header`.
  c.res.headers.set("Content-Security-Policy", contentSecurityPolicy);
  c.res.headers.set("X-Content-Type-Options", "nosniff");
};
