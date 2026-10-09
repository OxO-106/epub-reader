// The changelog and version arithmetic behind `npm run release` and the release workflow, kept pure so it is tested
// directly (tests/unit/release-notes.test.ts). The changelog follows Keep a Changelog: an "## [Unreleased]" section,
// then "## [x.y.z] - YYYY-MM-DD" sections, newest first, and comparison links at the bottom.

const semver = /^(\d+)\.(\d+)\.(\d+)$/;

/** The next version: "patch", "minor" or "major" of `current`, or an explicit x.y.z that must be greater. */
export function bumpVersion(current: string, request: string): string {
  const now = semver.exec(current);
  if (!now) throw new Error(`The current version "${current}" is not x.y.z.`);
  const [major, minor, patch] = now.slice(1).map(Number) as [number, number, number];
  if (request === "patch") return `${major}.${minor}.${patch + 1}`;
  if (request === "minor") return `${major}.${minor + 1}.0`;
  if (request === "major") return `${major + 1}.0.0`;
  const wanted = semver.exec(request);
  if (!wanted) throw new Error(`"${request}" is not patch, minor, major or a version like 1.2.3.`);
  const parts = wanted.slice(1).map(Number) as [number, number, number];
  const greater = parts[0] !== major ? parts[0] > major : parts[1] !== minor ? parts[1] > minor : parts[2] > patch;
  if (!greater) throw new Error(`${request} is not newer than ${current}.`);
  return request;
}

const unreleasedHeading = /^## \[Unreleased\][^\n]*\n/m;

/**
 * The changelog with the Unreleased section's entries moved under a new "## [version] - date" heading, an empty
 * Unreleased section left above it, and the comparison links updated. Throws when there is nothing to release.
 */
export function releaseChangelog(changelog: string, version: string, date: string, repoUrl: string): string {
  const heading = unreleasedHeading.exec(changelog);
  if (!heading) throw new Error("CHANGELOG.md has no \"## [Unreleased]\" section.");
  const start = heading.index + heading[0].length;
  const nextSection = changelog.slice(start).search(/^## \[/m);
  const linksStart = changelog.slice(start).search(/^\[Unreleased\]:/m);
  const end = start + (nextSection >= 0 ? nextSection : linksStart >= 0 ? linksStart : changelog.length - start);
  const entries = changelog.slice(start, end).trim();
  if (!entries) throw new Error("The Unreleased section is empty: there is nothing to release.");

  const previous = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog.slice(end))?.[1];
  let out = `${changelog.slice(0, start)}\n## [${version}] - ${date}\n\n${entries}\n\n${changelog.slice(end)}`;

  const unreleasedLink = `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD`;
  const versionLink = previous
    ? `[${version}]: ${repoUrl}/compare/v${previous}...v${version}`
    : `[${version}]: ${repoUrl}/releases/tag/v${version}`;
  out = /^\[Unreleased\]:.*$/m.test(out)
    ? out.replace(/^\[Unreleased\]:.*$/m, `${unreleasedLink}\n${versionLink}`)
    : `${out.trimEnd()}\n\n${unreleasedLink}\n${versionLink}\n`;
  return out;
}

/** The body of one version's section (without its heading), for the GitHub Release notes. */
export function notesFor(changelog: string, version: string): string {
  const escaped = version.replaceAll(".", "\\.");
  const heading = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n`, "m").exec(changelog);
  if (!heading) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  const rest = changelog.slice(heading.index + heading[0].length);
  const end = rest.search(/^(## \[|\[Unreleased\]:)/m);
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}
