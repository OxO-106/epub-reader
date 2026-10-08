"""Builds probe-font.ttf, a tiny font used only by the obfuscated-font EPUB fixture.

The only visible glyph is a solid square for "A". It is generated here, so it carries no third-party
license. The output is committed; rerun (needs `pip install fonttools`) only when changing the font:

    python scripts/fixture-assets/make-probe-font.py
"""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000


def square():
    pen = TTGlyphPen(None)
    pen.moveTo((100, 0))
    pen.lineTo((100, 800))
    pen.lineTo((900, 800))
    pen.lineTo((900, 0))
    pen.closePath()
    return pen.glyph()


def empty():
    return TTGlyphPen(None).glyph()


fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder([".notdef", "A"])
fb.setupCharacterMap({ord("A"): "A"})
fb.setupGlyf({".notdef": empty(), "A": square()})
fb.setupHorizontalMetrics({".notdef": (500, 0), "A": (1000, 100)})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "ProbeFont", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
fb.setupPost()
fb.font.save(Path(__file__).with_name("probe-font.ttf"))
