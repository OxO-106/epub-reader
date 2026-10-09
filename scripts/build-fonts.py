"""Cuts the Chinese font 京华老宋体 (KingHwa_OldSong) into web font pieces for the Reader to serve.

The original font ships with the repository, in assets/fonts (ADR 0140). This script reads it (or, without it, the copy
installed on this PC) and writes woff2 pieces, a style sheet with one @font-face rule per piece (each with a
`unicode-range`, so a browser downloads only the pieces its text needs, the way Google Fonts serves Chinese), and a
manifest to the fonts folder. The pieces are generated output, so git ignores that folder. The server serves it under
/fonts/ and tells the front end whether the font is there.

    npm run fonts:build                          uses assets/fonts, else finds the installed font by itself
    npm run fonts:build -- "C:\\path\\to\\font.ttf"  uses this file
    npm run fonts:build -- --out some\\folder     writes there (default: READER_FONTS_DIR, else ./fonts)

It needs Python 3.9 or newer and two packages, installed once: `pip install fonttools brotli`.

The output depends only on the font and the script: running it again gives byte-identical files. The pieces are named
after their content, so the server may let browsers cache them for good.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

try:
    from fontTools import subset
    from fontTools.ttLib import TTFont
    import brotli  # noqa: F401  (fontTools needs it to write woff2)
except ImportError as error:
    sys.exit(
        f"Missing a Python package ({error.name}). Install the two this script needs, once:\n\n"
        "    pip install fonttools brotli\n"
    )

# The name the pieces are declared under in the style sheet. It is deliberately not the font's own name, so that a copy
# of the font installed on a device cannot stand in for the pieces. Keep in step with src/web/display-settings.ts.
FAMILY = "KingHwa Web"
OWN_NAMES = {"KingHwa_OldSong", "京華老宋体", "京华老宋体"}
STEM = "kinghwa-oldsong"
CSS_NAME = f"{STEM}.css"
# Characters per piece. About 480 bytes each as woff2, so about 150 KB per piece.
PIECE_CHARACTERS = 320
FORMAT_VERSION = 1
# The copy of the font that ships with the repository.
REPO_FONT = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "KingHwa_OldSong-2.002.ttf"


def is_ideograph(code: int) -> bool:
    return (
        0x3400 <= code <= 0x4DBF
        or 0x4E00 <= code <= 0x9FFF
        or 0xF900 <= code <= 0xFAFF
        or 0x20000 <= code <= 0x323AF
        or 0x2F800 <= code <= 0x2FA1F
    )


def is_left_to_libertinus(code: int) -> bool:
    """ASCII and the Latin letters of Latin-1 and Latin Extended-A/B: Libertinus Serif draws those, so the pieces leave them out
    (the middle dot U+00B7, used in Chinese names, stays)."""
    return code <= 0x00B6 or 0x00B8 <= code <= 0x024F


def codes_in_encoding(encoding: str, first: int, last: int, second_low: int, second_high: int) -> set[int]:
    """Every character a double-byte legacy encoding has with a lead byte from `first` to `last`."""
    found = set()
    for lead in range(first, last + 1):
        for trail in range(second_low, second_high + 1):
            try:
                found.add(ord(bytes([lead, trail]).decode(encoding)))
            except (UnicodeDecodeError, TypeError):
                pass
    return found


def piece_groups(available: set[int]) -> list[list[int]]:
    """The characters of the font in the order the pieces are cut: first everything that is not an ideograph (punctuation,
    kana, symbols), then the ideographs by how common they are: GB2312 level 1 (3755 Simplified), level 2 (3008), Big5
    level 1 (5401 Traditional), level 2 (7652), and the rest by code point. Each group is cut into pieces of its own, so
    a typical page needs few pieces."""
    others = {code for code in available if not is_ideograph(code) and not is_left_to_libertinus(code)}
    ideographs = {code for code in available if is_ideograph(code)}
    tiers = [
        others,
        codes_in_encoding("gb2312", 0xB0, 0xD7, 0xA1, 0xFE),
        codes_in_encoding("gb2312", 0xD8, 0xF7, 0xA1, 0xFE),
        codes_in_encoding("big5", 0xA4, 0xC6, 0x40, 0xFE),
        codes_in_encoding("big5", 0xC9, 0xF9, 0x40, 0xFE),
        ideographs,
    ]
    pieces: list[list[int]] = []
    taken: set[int] = set()
    for tier in tiers:
        codes = sorted((tier & available) - taken)
        taken.update(codes)
        for start in range(0, len(codes), PIECE_CHARACTERS):
            pieces.append(codes[start : start + PIECE_CHARACTERS])
    return pieces


def unicode_range(codes: list[int]) -> str:
    ranges = []
    start = previous = codes[0]
    for code in codes[1:] + [None]:  # type: ignore[list-item]
        if code is not None and code == previous + 1:
            previous = code
            continue
        ranges.append(f"U+{start:X}" if start == previous else f"U+{start:X}-{previous:X}")
        if code is not None:
            start = previous = code
    return ",".join(ranges)


def cut_piece(font_bytes: bytes, codes: list[int]) -> bytes:
    font = TTFont(io.BytesIO(font_bytes), recalcTimestamp=False)  # keep the font's own dates: same input, same output
    options = subset.Options()
    options.hinting = False
    options.notdef_outline = True
    options.drop_tables += ["DSIG"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codes)
    subsetter.subset(font)
    font.flavor = "woff2"
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def family_names(path: Path) -> set[str]:
    try:
        font = TTFont(str(path), lazy=True, fontNumber=0)
        return {str(record) for record in font["name"].names if record.nameID in (1, 4, 16)}
    except Exception:  # not a font, or a broken one: not the one we look for
        return set()


def font_folders() -> list[Path]:
    home = Path.home()
    if sys.platform == "win32":
        return [Path(p) for p in (
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Windows", "Fonts"),
            os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"),
        ) if p]
    if sys.platform == "darwin":
        return [home / "Library" / "Fonts", Path("/Library/Fonts")]
    return [home / ".local/share/fonts", home / ".fonts", Path("/usr/local/share/fonts"), Path("/usr/share/fonts")]


def find_installed_font() -> Path | None:
    """The installed 京華老宋体: a file whose name says so, else any font file in the usual folders whose family name does."""
    files: list[Path] = []
    for folder in font_folders():
        if folder.is_dir():
            walk = folder.rglob("*") if sys.platform != "win32" else folder.glob("*")
            files += [f for f in walk if f.suffix.lower() in (".ttf", ".otf")]
    hinted = [f for f in files if "kinghwa" in f.name.lower() or "京華老宋体" in f.name or "京华老宋体" in f.name]
    for path in hinted + [f for f in files if f not in hinted]:
        if family_names(path) & OWN_NAMES:
            return path
    return None


def refuse_if_git_would_track(folder: Path) -> None:
    """The pieces are generated output, never committed (the original is). If git would track the folder, stop."""
    folder.mkdir(parents=True, exist_ok=True)
    probe = str(folder / "manifest.json")
    try:
        inside = subprocess.run(["git", "-C", str(folder), "rev-parse", "--is-inside-work-tree"], capture_output=True, text=True)
        if inside.returncode != 0:
            return
        ignored = subprocess.run(["git", "-C", str(folder), "check-ignore", "-q", "--", probe], capture_output=True)
    except OSError:  # no git on this PC
        return
    if ignored.returncode == 1:
        sys.exit(
            f"Refusing to write to {folder}: git does not ignore it, and the pieces are generated output that should "
            "not be committed. Use the git-ignored ./fonts folder (the default), or add the folder to .gitignore first."
        )


def write_atomically(path: Path, data: bytes) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def main() -> None:
    for stream in (sys.stdout, sys.stderr):  # a Windows console that cannot show Chinese must not stop the build
        stream.reconfigure(errors="replace")
    parser = argparse.ArgumentParser(description="Cut 京华老宋体 into web font pieces for the Reader.")
    parser.add_argument("font", nargs="?", type=Path, help="the font file (.ttf or .otf); default: assets/fonts, else the installed one")
    parser.add_argument("--out", type=Path, help="folder to write to; default: $READER_FONTS_DIR, else ./fonts")
    args = parser.parse_args()

    source = args.font
    if source is None and REPO_FONT.is_file():
        source = REPO_FONT
        print(f"Using the font in the repository: {source}")
    if source is None:
        source = find_installed_font()
        if source is None:
            sys.exit(
                "Could not find 京华老宋体 (KingHwa_OldSong) among the fonts installed on this PC.\n"
                "Install it, or give the path of its .ttf file:\n\n"
                '    npm run fonts:build -- "C:\\path\\to\\京華老宋体.ttf"\n\n'
                "Looked in: " + ", ".join(str(f) for f in font_folders())
            )
        print(f"Found the installed font: {source}")
    elif not source.is_file():
        sys.exit(f"No such file: {source}")

    out = (args.out or Path(os.environ.get("READER_FONTS_DIR") or "fonts")).resolve()
    refuse_if_git_would_track(out)

    font_bytes = source.read_bytes()
    available = set(TTFont(io.BytesIO(font_bytes), lazy=True).getBestCmap())
    pieces = piece_groups(available)
    print(f"{len(available)} characters in the font, cutting {len(pieces)} pieces of up to {PIECE_CHARACTERS} into {out}")

    entries = []
    css_rules = []
    for index, codes in enumerate(pieces):
        data = cut_piece(font_bytes, codes)
        name = f"{STEM}-{index:03d}-{hashlib.sha256(data).hexdigest()[:10]}.woff2"
        write_atomically(out / name, data)
        entries.append({"file": name, "characters": len(codes), "bytes": len(data)})
        css_rules.append(
            f'@font-face{{font-family:"{FAMILY}";font-style:normal;font-weight:400;font-display:swap;'
            f'src:url("{name}") format("woff2");unicode-range:{unicode_range(codes)}}}'
        )
        progress = f"  {index + 1:3}/{len(pieces)}  {len(codes):4} characters  {len(data) / 1024:7.1f} KB"
        if sys.stdout.isatty():
            print(progress, end="\r")
        elif index % 10 == 9 or index + 1 == len(pieces):
            print(progress)
    if sys.stdout.isatty():
        print()

    # The style sheet and, last, the manifest: the server counts the font as present once the manifest and style sheet exist.
    write_atomically(out / CSS_NAME, ("\n".join(css_rules) + "\n").encode("utf-8"))
    manifest = {
        "format": FORMAT_VERSION,
        "family": FAMILY,
        "css": CSS_NAME,
        "source": {"file": source.name, "bytes": len(font_bytes), "sha256": hashlib.sha256(font_bytes).hexdigest()},
        "pieces": entries,
        "totalBytes": sum(entry["bytes"] for entry in entries),
    }
    write_atomically(out / "manifest.json", (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

    wanted = {entry["file"] for entry in entries}
    for stale in out.glob(f"{STEM}-*.woff2"):
        if stale.name not in wanted:
            stale.unlink()
    total = manifest["totalBytes"]
    print(f"Done: {len(entries)} pieces, {total / 1024 / 1024:.1f} MB in all, the largest {max(e['bytes'] for e in entries) / 1024:.0f} KB.")
    print("Restart is not needed: the server notices the font on the next page load.")


if __name__ == "__main__":
    main()
