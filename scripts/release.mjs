// Turns CHANGELOG.md's [Unreleased] section into the next version, because every merge to main is already live.
// Run by .github/workflows/release.yml on each push to main; prints the new version, or nothing when there is
// nothing to release. Added, Changed, Deprecated, or Removed entries bump the minor version; Fixed or Security
// alone bump the patch.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Returns the released changelog and version, or null when [Unreleased] has no entries. */
export function nextRelease(changelog, version, date) {
  const match = /^## \[Unreleased\]\n([\s\S]*?)(?=^## \[)/m.exec(changelog);
  const entries = match?.[1] ?? "";
  if (!/^- /m.test(entries)) return null;
  const [major, minor, patch] = version.split(".").map(Number);
  // Only headings that actually list entries count, so an empty "### Added" can't force a minor bump.
  const feature = entries
    .split(/^(?=### )/m)
    .some((section) => /^### (Added|Changed|Deprecated|Removed)\n/.test(section) && /^- /m.test(section));
  const next = feature ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  const released = changelog
    .replace(match[0], `## [Unreleased]\n\n## [${next}] - ${date}\n${entries}`)
    .replace(
      /^\[unreleased\]: (.+)\/compare\/v[\d.]+\.\.\.HEAD$/m,
      (_, repo) => `[unreleased]: ${repo}/compare/v${next}...HEAD\n[${next}]: ${repo}/compare/v${version}...v${next}`,
    );
  return { changelog: released, version: next };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const release = nextRelease(readFileSync("CHANGELOG.md", "utf8"), pkg.version, new Date().toISOString().slice(0, 10));
  if (release) {
    writeFileSync("CHANGELOG.md", release.changelog);
    for (const file of ["package.json", "package-lock.json"]) {
      const json = JSON.parse(readFileSync(file, "utf8"));
      json.version = release.version;
      if (json.packages?.[""]) json.packages[""].version = release.version;
      writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    }
    process.stdout.write(`${release.version}\n`);
  }
}
