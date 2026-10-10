// Draws Verso's app icon (an open book on the terracotta accent: the left-hand page, the verso, filled in the paper
// colour with lines of text, the right-hand page drawn as an outline) at every size the web app manifest and the iPhone
// Home Screen need, from one drawing, into src/web/public/icons; and the desktop app's tray icons (two status dots,
// Verso and Translation, in every pair of colours) into desktop/icons. Run `npm run icons` after changing it; the
// results are committed. Uses @napi-rs/canvas, which comes with pdfjs-dist.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// @napi-rs/canvas is a dependency of pdfjs-dist, so it is resolved from there.
const fromPdfjs = createRequire(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const { createCanvas, Path2D } = fromPdfjs("@napi-rs/canvas") as typeof import("@napi-rs/canvas");

const out = fileURLToPath(new URL("../src/web/public/icons/", import.meta.url));
mkdirSync(out, { recursive: true });

const accent = "#a4492a";
const paper = "#faf8f3";
/** The verso (left-hand page), filled, on a 512 × 512 grid. */
const verso = "M256 150C218 124 164 116 108 122V358C164 352 218 360 256 386Z";
/** The recto (right-hand page), an outline of this width. */
const recto = "M256 150C294 124 348 116 404 122V358C348 352 294 360 256 386Z";
const rectoStroke = 20;
/** Lines of text on the verso, drawn in the accent. */
const lines = ["M140 172C172 168 202 174 226 186", "M140 216C172 212 202 218 226 230", "M140 260C172 256 202 262 226 274"];

/** The SVG, for the favicon; `inset` shrinks the book toward the middle (maskable icons keep to the inner 80%). */
function svg(inset = 1): string {
  const t = (256 * (1 - inset)).toFixed(1);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`,
    `<rect width="512" height="512" rx="0" fill="${accent}"/>`,
    `<g transform="translate(${t} ${t}) scale(${inset})">`,
    `<path d="${verso}" fill="${paper}"/>`,
    `<path d="${recto}" fill="none" stroke="${paper}" stroke-width="${rectoStroke}" stroke-linejoin="round"/>`,
    ...lines.map((d) => `<path d="${d}" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round" opacity="0.6"/>`),
    `</g></svg>`,
  ].join("");
}

function png(size: number, inset = 1): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, size, size);
  ctx.scale(size / 512, size / 512);
  ctx.translate(256 * (1 - inset), 256 * (1 - inset));
  ctx.scale(inset, inset);
  ctx.fillStyle = paper;
  ctx.fill(new Path2D(verso));
  ctx.strokeStyle = paper;
  ctx.lineWidth = rectoStroke;
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D(recto));
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  for (const d of lines) ctx.stroke(new Path2D(d));
  return canvas.toBuffer("image/png");
}

writeFileSync(join(out, "icon.svg"), svg(0.92));
for (const size of [32, 180, 192, 512]) writeFileSync(join(out, `icon-${size}.png`), png(size, size === 32 ? 1.05 : 0.92));
writeFileSync(join(out, "maskable-512.png"), png(512, 0.74));
// ---- the desktop app ----------------------------------------------------------------------------------------------

const desktop = fileURLToPath(new URL("../desktop/icons/", import.meta.url));
mkdirSync(desktop, { recursive: true });
writeFileSync(join(desktop, "app.png"), png(256, 0.92));

const dotColours = { green: "#2e9d57", amber: "#e3a21a", red: "#d0453a", grey: "#9a958c" } as const;
type Dot = keyof typeof dotColours;

/** Two dots side by side, each with a light ring so it shows on a dark taskbar as on a light one. */
function tray(size: number, left: Dot, right: Dot): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const r = size * 0.21;
  for (const [cx, colour] of [[size * 0.27, left], [size * 0.73, right]] as const) {
    ctx.beginPath();
    ctx.arc(cx, size / 2, r + size * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, size / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = dotColours[colour];
    ctx.fill();
  }
  return canvas.toBuffer("image/png");
}

for (const left of ["green", "amber", "red"] as const) {
  for (const right of Object.keys(dotColours) as Dot[]) {
    writeFileSync(join(desktop, `tray-${left}-${right}.png`), tray(16, left, right));
    writeFileSync(join(desktop, `tray-${left}-${right}@2x.png`), tray(32, left, right));
  }
}
console.log(`Icons written to ${out} and ${desktop}`);
