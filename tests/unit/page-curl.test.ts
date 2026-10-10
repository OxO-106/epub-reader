// The geometry of the paper page turn (issue #41): a fold line sweeps from the lifted edge to the spine, the turned leaf
// lies between the fold and twice the fold, and once the fold reaches the spine the new page under the leaf fades in.
import { describe, expect, it } from "vitest";
import { curlFrame, curlStyles, sweepShare } from "../../src/web/reader/page-curl.ts";

describe("curlFrame", () => {
  const spine = 600; // half of a 1200 px spread

  it("starts with nothing lifted", () => {
    expect(curlFrame(0, spine)).toEqual({ fold: 0, leafEnd: 0, settle: 0 });
  });

  it("sweeps the fold to the spine, the leaf then covering the whole other page", () => {
    const swept = curlFrame(sweepShare, spine);
    expect(swept.fold).toBeCloseTo(spine);
    expect(swept.leafEnd).toBeCloseTo(2 * spine);
    expect(swept.settle).toBe(0);
  });

  it("then lets the new page under the leaf fade in, and ends settled", () => {
    const halfway = curlFrame(sweepShare + (1 - sweepShare) / 2, spine);
    expect(halfway.fold).toBeCloseTo(spine);
    expect(halfway.settle).toBeCloseTo(0.5);
    expect(curlFrame(1, spine)).toEqual({ fold: spine, leafEnd: 2 * spine, settle: 1 });
  });

  it("moves the fold one way only, eased at both ends", () => {
    const folds = Array.from({ length: 41 }, (_, i) => curlFrame(i / 40, spine).fold);
    for (let i = 1; i < folds.length; i++) expect(folds[i]!).toBeGreaterThanOrEqual(folds[i - 1]!);
    // Slow at the start: the first tenth of the sweep moves the fold less than a tenth of the way.
    expect(curlFrame(sweepShare / 10, spine).fold).toBeLessThan(spine / 10);
  });

  it("keeps to its range outside 0 to 1", () => {
    expect(curlFrame(-0.5, spine)).toEqual(curlFrame(0, spine));
    expect(curlFrame(3, spine)).toEqual(curlFrame(1, spine));
  });

  it("with one page shown, carries the leaf off the page", () => {
    const width = 700;
    const end = curlFrame(1, width); // the spine is the far edge
    expect(end.fold).toBeCloseTo(width);
    expect(end.leafEnd).toBeGreaterThan(width);
  });
});

describe("curlStyles", () => {
  const paint = { paper: "#faf8f3", leaf: "#f6f2ea", shade: "rgb(70 50 25 / 0.2)" };

  it("runs its gradients from the lifted edge", () => {
    const frame = curlFrame(0.4, 600);
    expect(curlStyles(frame, "right", paint).next).toMatch(/^linear-gradient\(to left,/);
    expect(curlStyles(frame, "left", paint).next).toMatch(/^linear-gradient\(to right,/);
  });

  it("shows the old pages only beyond the leaf, and the new ones up to the fold", () => {
    const frame = curlFrame(0.4, 600);
    const { old, next } = curlStyles(frame, "right", paint);
    expect(old).toContain(`transparent ${frame.leafEnd.toFixed(1)}px`);
    expect(next).toContain(`rgb(0 0 0 / 0.72) ${frame.fold.toFixed(1)}px`);
    // Nothing of the new page shows past the fold until the leaf settles.
    expect(next).toContain(`rgb(0 0 0 / 0.000) ${frame.fold.toFixed(1)}px`);
  });
});
