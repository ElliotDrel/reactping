// Turns CHANGELOG.md's [Unreleased] section into the next version, because every merge to main is already live.
// Run by .github/workflows/release.yml on each push to main; prints the new version, or nothing when there is
// nothing to release. Added, Changed, Deprecated, or Removed entries bump the minor version; Fixed or Security
// alone bump the patch. `--verify <base CHANGELOG>` fails if released sections differ from the base branch's.
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
    // A replacer function inserts entries verbatim; a replacement string would expand `$&` and friends.
    .replace(match[0], () => `## [Unreleased]\n\n## [${next}] - ${date}\n${entries}`)
    .replace(
      /^\[unreleased\]: (.+)\/compare\/v[\d.]+\.\.\.HEAD$/m,
      (_, repo) => `[unreleased]: ${repo}/compare/v${next}...HEAD\n[${next}]: ${repo}/compare/v${version}...v${next}`,
    );
  return { changelog: released, version: next };
}

/** Versions whose released section differs from the base branch's: a merge that edited history, never allowed. */
export function changedReleases(base, head) {
  const sections = (text) =>
    new Map(
      [...text.matchAll(/^## \[(\d+\.\d+\.\d+)\][^\n]*\n[\s\S]*?(?=^## \[|^\[unreleased\]:)/gm)].map((m) => [
        m[1],
        m[0],
      ]),
    );
  const now = sections(head);
  return [...sections(base)].filter(([version, text]) => now.get(version) !== text).map(([version]) => version);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv[2] === "--verify") {
  // CI on pull requests: a branch cut before a release can auto-merge its new entries into the released section.
  const changed = changedReleases(readFileSync(process.argv[3], "utf8"), readFileSync("CHANGELOG.md", "utf8"));
  if (changed.length) {
    process.stderr.write(
      `CHANGELOG.md edits released versions ${changed.join(", ")}; put new entries under [Unreleased].\n`,
    );
    process.exit(1);
  }
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
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
