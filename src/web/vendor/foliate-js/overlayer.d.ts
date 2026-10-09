// Types for the parts of overlayer.js that Reader uses. Written for this project, not part of foliate-js.

export class Overlayer {
  /** A filled box over each rect, at the opacity of the CSS variable `--overlayer-highlight-opacity` (default .3). */
  static highlight(rects: DOMRectList, options?: { color?: string }): SVGElement;
}
