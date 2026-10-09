import qrcode from "qrcode-generator";
import { useMemo } from "preact/hooks";

/**
 * A QR code of `text`, drawn in the page as an SVG (no outside service sees the address): dark modules on white with
 * the four-module quiet zone scanners need, whatever the theme. Error correction M, the smallest version that fits.
 */
export function QrCode({ text, label, size = 176 }: { text: string; label: string; size?: number }) {
  const path = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(text, "Byte");
    code.make();
    const count = code.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) if (code.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
    }
    return { d, extent: count + 8 };
  }, [text]);

  return (
    <svg class="qr-code" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${path.extent} ${path.extent}`} shape-rendering="crispEdges">
      <rect width={path.extent} height={path.extent} fill="#ffffff" />
      <path d={path.d} fill="#000000" />
    </svg>
  );
}
