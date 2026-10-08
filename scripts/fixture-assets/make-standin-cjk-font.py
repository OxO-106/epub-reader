"""Builds standin-cjk.woff2, a tiny font that stands in for the real Chinese font (京华老宋体) in tests.

It has the family name KingHwa Web (what the real font is declared as for the web, see display-settings.ts) and three glyphs (U+4E2D, U+6587, U+6C49), each a solid square that is only
half an em wide. Real Chinese fonts are one em wide, so a test can tell from the width of a character whether this font
was used. It is generated here, so it carries no third-party license. The output is committed; rerun (needs
`pip install fonttools brotli`) only when changing the font:

    python scripts/fixture-assets/make-standin-cjk-font.py
"""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
ADVANCE = 500
CHARACTERS = {"zhong": 0x4E2D, "wen": 0x6587, "han": 0x6C49}


def square():
    pen = TTGlyphPen(None)
    pen.moveTo((50, 0))
    pen.lineTo((50, 800))
    pen.lineTo((450, 800))
    pen.lineTo((450, 0))
    pen.closePath()
    return pen.glyph()


def empty():
    return TTGlyphPen(None).glyph()


names = [".notdef", *CHARACTERS]
fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(names)
fb.setupCharacterMap({code: name for name, code in CHARACTERS.items()})
fb.setupGlyf({".notdef": empty(), **{name: square() for name in CHARACTERS}})
fb.setupHorizontalMetrics({".notdef": (ADVANCE, 0), **{name: (ADVANCE, 50) for name in CHARACTERS}})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "KingHwa Web", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
fb.setupPost()
fb.font.flavor = "woff2"
fb.font.save(Path(__file__).with_name("standin-cjk.woff2"))
