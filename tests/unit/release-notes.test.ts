import { describe, expect, it } from "vitest";
import { bumpVersion, notesFor, releaseChangelog } from "../../scripts/release-notes.ts";

const repo = "https://github.com/OxO-106/epub-reader";

const changelog = `# Changelog

Intro.

## [Unreleased]

### Added

- Highlights.

### Fixed

- A crash.

## [0.1.0] - 2026-10-09

### Added

- Everything so far.

[Unreleased]: ${repo}/compare/v0.1.0...HEAD
[0.1.0]: ${repo}/releases/tag/v0.1.0
`;

describe("bumping the version", () => {
  it("bumps patch, minor and major", () => {
    expect(bumpVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpVersion("0.1.9", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.4.2", "major")).toBe("1.0.0");
  });

  it("accepts an explicit newer version and refuses an older or equal one", () => {
    expect(bumpVersion("0.1.0", "0.3.0")).toBe("0.3.0");
    expect(() => bumpVersion("0.2.0", "0.1.9")).toThrow(/not newer/);
    expect(() => bumpVersion("0.2.0", "0.2.0")).toThrow(/not newer/);
  });

  it("refuses anything that is not a version", () => {
    expect(() => bumpVersion("0.1.0", "next")).toThrow(/not patch, minor, major/);
    expect(() => bumpVersion("0.1", "patch")).toThrow(/not x\.y\.z/);
  });
});

describe("releasing the changelog", () => {
  const released = releaseChangelog(changelog, "0.2.0", "2026-11-01", repo);

  it("moves the Unreleased entries under the new version and leaves Unreleased empty", () => {
    expect(released).toContain("## [Unreleased]\n\n## [0.2.0] - 2026-11-01\n\n### Added\n\n- Highlights.\n\n### Fixed\n\n- A crash.\n\n## [0.1.0] - 2026-10-09");
  });

  it("updates the comparison links", () => {
    expect(released).toContain(`[Unreleased]: ${repo}/compare/v0.2.0...HEAD\n[0.2.0]: ${repo}/compare/v0.1.0...v0.2.0\n[0.1.0]: ${repo}/releases/tag/v0.1.0`);
  });

  it("refuses to release when there is nothing new", () => {
    expect(() => releaseChangelog(released, "0.3.0", "2026-12-01", repo)).toThrow(/nothing to release/);
  });

  it("links the first release to its tag", () => {
    const first = releaseChangelog("# Changelog\n\n## [Unreleased]\n\n- First.\n", "0.1.0", "2026-10-09", repo);
    expect(first).toContain(`[Unreleased]: ${repo}/compare/v0.1.0...HEAD\n[0.1.0]: ${repo}/releases/tag/v0.1.0`);
  });
});

describe("the release notes for one version", () => {
  it("is that version's section without its heading", () => {
    expect(notesFor(changelog, "0.1.0")).toBe("### Added\n\n- Everything so far.");
  });

  it("stops at the next section", () => {
    const released = releaseChangelog(changelog, "0.2.0", "2026-11-01", repo);
    expect(notesFor(released, "0.2.0")).toBe("### Added\n\n- Highlights.\n\n### Fixed\n\n- A crash.");
  });

  it("says so when the version has no section", () => {
    expect(() => notesFor(changelog, "9.9.9")).toThrow(/no section for 9\.9\.9/);
  });
});
